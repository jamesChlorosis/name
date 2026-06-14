import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { PLATFORM_IDS, type PlatformId, type Status, getProfileUrl, validateUsername } from './src/platforms'

type CheckRequest = {
  platform?: PlatformId
  username?: string
}

type BulkCheckItem = {
  platform?: PlatformId
  username?: string
}

type BulkCheckRequest = {
  checks?: BulkCheckItem[]
  concurrency?: number
  timeoutMs?: number
}

type CheckResponse = {
  status: Status
  detail: string
  normalized: string
  url?: string
}

type BulkCheckResult = CheckResponse & {
  platform: PlatformId
  username: string
}

const MAX_BULK_CHECKS = 5000

const browserHeaders = {
  accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
}

function usernameAvailabilityApi(): Plugin {
  return {
    name: 'username-availability-api',
    configureServer(server) {
      server.middlewares.use('/api/check-bulk', async (request, response) => {
        if (request.method !== 'POST') {
          sendAnyJson(response, 405, { error: 'Use POST' })
          return
        }

        try {
          const body = (await readJson(request)) as BulkCheckRequest
          const checks = Array.isArray(body.checks) ? body.checks : []

          if (!checks.length) {
            sendAnyJson(response, 400, { error: 'No checks provided' })
            return
          }

          if (checks.length > MAX_BULK_CHECKS) {
            sendAnyJson(response, 413, { error: `Bulk scan limit is ${MAX_BULK_CHECKS} platform checks` })
            return
          }

          const concurrency = clampNumber(body.concurrency, 1, 96, 32)
          const timeoutMs = clampNumber(body.timeoutMs, 1200, 10000, 3200)
          const startedAt = Date.now()
          const results = await runBulkChecks(checks, concurrency, timeoutMs)

          sendAnyJson(response, 200, {
            durationMs: Date.now() - startedAt,
            results,
          })
        } catch (error) {
          sendAnyJson(response, 500, {
            error: error instanceof Error ? error.message : 'Bulk check failed',
          })
        }
      })

      server.middlewares.use('/api/check', async (request, response) => {
        if (request.method !== 'POST') {
          sendJson(response, 405, {
            status: 'invalid',
            detail: 'Use POST',
            normalized: '',
          })
          return
        }

        try {
          const body = (await readJson(request)) as CheckRequest

          if (!body.platform || !body.username) {
            sendJson(response, 400, {
              status: 'invalid',
              detail: 'Missing platform or username',
              normalized: body.username ?? '',
            })
            return
          }

          sendJson(response, 200, await checkPlatform(body.platform, body.username))
        } catch (error) {
          sendJson(response, 500, {
            status: 'uncertain',
            detail: error instanceof Error ? error.message : 'Unable to check',
            normalized: '',
          })
        }
      })
    },
  }
}

async function checkPlatform(platform: PlatformId, username: string, timeoutMs = 8000): Promise<CheckResponse> {
  const validation = validateUsername(platform, username)

  if (!validation.valid) {
    return {
      status: 'invalid',
      detail: validation.reason ?? 'Invalid username',
      normalized: validation.normalized,
      url: getProfileUrl(platform, validation.normalized),
    }
  }

  try {
    if (platform === 'minecraft') {
      return withProfileUrl(platform, await checkMinecraft(validation.normalized, timeoutMs))
    }

    if (platform === 'roblox') {
      return withProfileUrl(platform, await checkRoblox(validation.normalized, timeoutMs))
    }

    if (platform === 'discord') {
      return withProfileUrl(platform, await checkDiscord(validation.normalized, timeoutMs))
    }

    if (platform === 'medium') {
      return withProfileUrl(platform, await checkMedium(validation.normalized, timeoutMs))
    }

    if (platform === 'linkedin') {
      return withProfileUrl(platform, await checkLinkedIn(validation.normalized, timeoutMs))
    }

    return withProfileUrl(platform, await checkInstagram(validation.normalized, timeoutMs))
  } catch (error) {
    return {
      status: 'uncertain',
      detail: error instanceof Error ? error.message : 'Network check failed',
      normalized: validation.normalized,
      url: getProfileUrl(platform, validation.normalized),
    }
  }
}

async function checkMinecraft(username: string, timeoutMs: number): Promise<CheckResponse> {
  const response = await fetchWithTimeout(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
    { headers: browserHeaders },
    timeoutMs,
  )

  if (response.status === 200) {
    return { status: 'taken', detail: 'Profile resolves on Mojang', normalized: username }
  }

  if (response.status === 204 || response.status === 404) {
    return { status: 'available', detail: 'No profile found', normalized: username }
  }

  if (response.status === 400) {
    return { status: 'invalid', detail: 'Rejected by Mojang', normalized: username }
  }

  if (response.status === 429) {
    return { status: 'uncertain', detail: 'Mojang rate limit', normalized: username }
  }

  return { status: 'uncertain', detail: `Mojang returned ${response.status}`, normalized: username }
}

async function checkRoblox(username: string, timeoutMs: number): Promise<CheckResponse> {
  const url = new URL('https://auth.roblox.com/v1/usernames/validate')

  url.searchParams.set('request.username', username)
  url.searchParams.set('request.birthday', '2000-01-01')
  url.searchParams.set('request.context', 'Signup')

  const response = await fetchWithTimeout(url, { headers: browserHeaders }, timeoutMs)

  if (response.status === 429) {
    return { status: 'uncertain', detail: 'Roblox rate limit', normalized: username }
  }

  const data = (await safeJson(response)) as { code?: string | number; message?: string }
  const code = String(data?.code ?? '')
  const message = data?.message ?? `Roblox returned ${response.status}`

  if (response.ok && /validusername|^0$/i.test(code)) {
    return { status: 'available', detail: 'Roblox accepted it', normalized: username }
  }

  if (/alreadyinuse|already in use|taken/i.test(`${code} ${message}`)) {
    return { status: 'taken', detail: message, normalized: username }
  }

  if (response.status === 400 || /error|invalid|moderation|reserved|spaces|pii|underscore|length/i.test(code)) {
    return { status: 'invalid', detail: message, normalized: username }
  }

  return { status: 'uncertain', detail: message, normalized: username }
}

async function checkDiscord(username: string, timeoutMs: number): Promise<CheckResponse> {
  const response = await fetchWithTimeout(
    'https://discord.com/api/v9/unique-username/username-attempt-unauthed',
    {
      method: 'POST',
      headers: {
        ...browserHeaders,
        'content-type': 'application/json',
        origin: 'https://discord.com',
        referer: 'https://discord.com/register',
      },
      body: JSON.stringify({ username }),
    },
    timeoutMs,
  )

  if (response.status === 429) {
    return { status: 'uncertain', detail: 'Discord rate limit', normalized: username }
  }

  const data = (await safeJson(response)) as { taken?: boolean; captcha_key?: string[]; message?: string }

  if (Array.isArray(data?.captcha_key)) {
    return { status: 'uncertain', detail: 'Discord requested a captcha', normalized: username }
  }

  if (typeof data?.taken === 'boolean') {
    return {
      status: data.taken ? 'taken' : 'available',
      detail: data.taken ? 'Username is already used' : 'Discord says it is open',
      normalized: username,
    }
  }

  if (response.status === 400) {
    return { status: 'invalid', detail: data?.message ?? 'Rejected by Discord', normalized: username }
  }

  return {
    status: 'uncertain',
    detail: data?.message ?? `Discord returned ${response.status}`,
    normalized: username,
  }
}

async function checkInstagram(username: string, timeoutMs: number): Promise<CheckResponse> {
  const profileInfo = new URL('https://www.instagram.com/api/v1/users/web_profile_info/')

  profileInfo.searchParams.set('username', username)

  const response = await fetchWithTimeout(
    profileInfo,
    {
      headers: {
        ...browserHeaders,
        'x-ig-app-id': '936619743392459',
        referer: `https://www.instagram.com/${username}/`,
      },
    },
    timeoutMs,
  )

  if (response.status === 429) {
    return { status: 'uncertain', detail: 'Instagram rate limit', normalized: username }
  }

  if (response.status === 404) {
    return { status: 'available', detail: 'No public profile found', normalized: username }
  }

  const data = (await safeJson(response)) as { data?: { user?: unknown }; message?: string }

  if (response.ok && data?.data?.user) {
    return { status: 'taken', detail: 'Public profile exists', normalized: username }
  }

  if (/not found|does not exist/i.test(data?.message ?? '')) {
    return { status: 'available', detail: 'No public profile found', normalized: username }
  }

  return {
    status: 'uncertain',
    detail: data?.message ?? `Instagram returned ${response.status}`,
    normalized: username,
  }
}

async function checkMedium(username: string, timeoutMs: number): Promise<CheckResponse> {
  const notFoundSignals: string[] = []
  const blockedSignals: string[] = []
  const profileResponse = await tryFetchWithTimeout(
    `https://medium.com/@${encodeURIComponent(username)}`,
    { headers: browserHeaders },
    timeoutMs,
  )

  if (profileResponse?.status === 404) {
    notFoundSignals.push('profile')
  }

  if (profileResponse?.status === 403 || profileResponse?.status === 429) {
    blockedSignals.push('profile')
  }

  if (profileResponse?.ok) {
    const html = await safeText(profileResponse)

    if (/out of nothing|page not found|404/i.test(html)) {
      notFoundSignals.push('profile')
    } else {
      return { status: 'taken', detail: 'Medium profile route resolved', normalized: username }
    }
  }

  const feedResponse = await tryFetchWithTimeout(
    `https://medium.com/feed/@${encodeURIComponent(username)}`,
    {
      headers: {
        ...browserHeaders,
        accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    },
    timeoutMs,
  )

  if (feedResponse?.status === 200) {
    const feed = await safeText(feedResponse)

    if (/<rss|<feed|<channel/i.test(feed)) {
      return { status: 'taken', detail: 'Medium feed resolved', normalized: username }
    }
  }

  if (feedResponse?.status === 404) {
    notFoundSignals.push('feed')
  }

  if (feedResponse?.status === 403 || feedResponse?.status === 429) {
    blockedSignals.push('feed')
  }

  if (/^[a-z0-9-]+$/.test(username)) {
    const subdomainResponse = await tryFetchWithTimeout(
      `https://${username}.medium.com/`,
      { headers: browserHeaders },
      timeoutMs,
    )

    if (subdomainResponse?.status === 200) {
      const html = await safeText(subdomainResponse)

      if (!/out of nothing|page not found|404/i.test(html)) {
        return { status: 'taken', detail: 'Medium subdomain resolved', normalized: username }
      }
    }

    if (subdomainResponse?.status === 404) {
      notFoundSignals.push('subdomain')
    }

    if (subdomainResponse?.status === 403 || subdomainResponse?.status === 429) {
      blockedSignals.push('subdomain')
    }
  }

  const userLookup = `https://medium.com/_/api/users/@${encodeURIComponent(username)}`
  const response = await tryFetchWithTimeout(
    userLookup,
    {
      headers: {
        ...browserHeaders,
        referer: `https://medium.com/@${username}`,
      },
    },
    timeoutMs,
  )

  if (response?.status === 200) {
    return { status: 'taken', detail: 'Medium user lookup resolved', normalized: username }
  }

  if (response?.status === 404) {
    return {
      status: 'available',
      detail: 'Medium user lookup found no account; claim may still be reserved',
      normalized: username,
    }
  }

  if (response?.status === 400) {
    return { status: 'invalid', detail: 'Rejected by Medium', normalized: username }
  }

  if (
    response?.status === 403 ||
    response?.status === 429
  ) {
    blockedSignals.push('user lookup')
  }

  if (notFoundSignals.length >= 2 && !blockedSignals.length) {
    return {
      status: 'available',
      detail: `No Medium ${notFoundSignals.join('/')} found; claim may still be reserved`,
      normalized: username,
    }
  }

  if (blockedSignals.length) {
    return {
      status: 'uncertain',
      detail: `Medium blocked ${blockedSignals.join('/')} probe; open claim page to confirm`,
      normalized: username,
    }
  }

  const returnedStatus = profileResponse?.status ?? feedResponse?.status ?? response?.status

  return {
    status: 'uncertain',
    detail: returnedStatus ? `Medium returned ${returnedStatus}` : 'Medium probes failed',
    normalized: username,
  }
}

async function checkLinkedIn(username: string, timeoutMs: number): Promise<CheckResponse> {
  const profileUrl = `https://www.linkedin.com/in/${encodeURIComponent(username)}/`
  const response = await tryFetchWithTimeout(profileUrl, {
    headers: {
      ...browserHeaders,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: 'https://www.linkedin.com/',
    },
    redirect: 'manual',
  }, timeoutMs)

  if (!response) {
    return { status: 'uncertain', detail: 'LinkedIn blocked or rejected the scanner', normalized: username }
  }

  if (response.status === 404) {
    return { status: 'available', detail: 'No LinkedIn public profile found', normalized: username }
  }

  if (response.status === 999 || response.status === 403 || response.status === 429) {
    return { status: 'uncertain', detail: 'LinkedIn blocked the scanner', normalized: username }
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? ''

    if (/authwall|uas\/login|checkpoint/i.test(location)) {
      return { status: 'uncertain', detail: 'LinkedIn sent the scanner to an auth wall', normalized: username }
    }

    if (location.includes(`/in/${username}`) || location.includes(`/in/${encodeURIComponent(username)}`)) {
      return { status: 'taken', detail: 'LinkedIn public URL redirected', normalized: username }
    }

    return { status: 'uncertain', detail: 'LinkedIn redirected the scanner', normalized: username }
  }

  if (response.ok) {
    const html = await safeText(response)

    if (/page not found|profile not found|doesn't exist/i.test(html)) {
      return { status: 'available', detail: 'No LinkedIn public profile found', normalized: username }
    }

    if (/authwall|uas\/login|checkpoint/i.test(html)) {
      return { status: 'uncertain', detail: 'LinkedIn auth wall detected', normalized: username }
    }

    return { status: 'taken', detail: 'LinkedIn public URL resolved', normalized: username }
  }

  return { status: 'uncertain', detail: `LinkedIn returned ${response.status}`, normalized: username }
}

async function fetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Platform request timed out', { cause: error })
    }

    throw new Error('Platform request failed', { cause: error })
  } finally {
    clearTimeout(timer)
  }
}

async function tryFetchWithTimeout(input: string | URL, init: RequestInit, timeoutMs = 8000) {
  try {
    return await fetchWithTimeout(input, init, timeoutMs)
  } catch {
    return undefined
  }
}

async function runBulkChecks(checks: BulkCheckItem[], concurrency: number, timeoutMs: number) {
  const results: BulkCheckResult[] = new Array(checks.length)
  let cursor = 0

  async function worker() {
    while (cursor < checks.length) {
      const index = cursor
      cursor += 1

      const check = checks[index]
      const username = check.username?.trim().replace(/^@/, '') ?? ''
      const platform = check.platform

      if (!username || !isPlatformId(platform)) {
        results[index] = {
          platform: 'instagram',
          username,
          status: 'invalid',
          detail: 'Missing or invalid platform',
          normalized: username,
        }
        continue
      }

      const result = await checkPlatform(platform, username, timeoutMs)

      results[index] = {
        ...result,
        platform,
        username,
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, checks.length) }, worker))

  return results
}

function isPlatformId(value: unknown): value is PlatformId {
  return typeof value === 'string' && PLATFORM_IDS.includes(value as PlatformId)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.min(max, Math.max(min, Math.round(value)))
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

async function safeJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

async function safeText(response: Response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: CheckResponse) {
  sendAnyJson(response, statusCode, body)
}

function sendAnyJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

function withProfileUrl(platform: PlatformId, body: CheckResponse): CheckResponse {
  return {
    ...body,
    url: body.url ?? getProfileUrl(platform, body.normalized),
  }
}

export default defineConfig({
  plugins: [react(), usernameAvailabilityApi()],
})
