import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { type PlatformId, type Status, validateUsername } from './src/platforms'

type CheckRequest = {
  platform?: PlatformId
  username?: string
}

type CheckResponse = {
  status: Status
  detail: string
  normalized: string
}

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

async function checkPlatform(platform: PlatformId, username: string): Promise<CheckResponse> {
  const validation = validateUsername(platform, username)

  if (!validation.valid) {
    return {
      status: 'invalid',
      detail: validation.reason ?? 'Invalid username',
      normalized: validation.normalized,
    }
  }

  try {
    if (platform === 'minecraft') {
      return checkMinecraft(validation.normalized)
    }

    if (platform === 'roblox') {
      return checkRoblox(validation.normalized)
    }

    if (platform === 'discord') {
      return checkDiscord(validation.normalized)
    }

    return checkInstagram(validation.normalized)
  } catch (error) {
    return {
      status: 'uncertain',
      detail: error instanceof Error ? error.message : 'Network check failed',
      normalized: validation.normalized,
    }
  }
}

async function checkMinecraft(username: string): Promise<CheckResponse> {
  const response = await fetchWithTimeout(
    `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`,
    { headers: browserHeaders },
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

async function checkRoblox(username: string): Promise<CheckResponse> {
  const url = new URL('https://auth.roblox.com/v1/usernames/validate')

  url.searchParams.set('request.username', username)
  url.searchParams.set('request.birthday', '2000-01-01')
  url.searchParams.set('request.context', 'Signup')

  const response = await fetchWithTimeout(url, { headers: browserHeaders })

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

async function checkDiscord(username: string): Promise<CheckResponse> {
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

async function checkInstagram(username: string): Promise<CheckResponse> {
  const profileInfo = new URL('https://www.instagram.com/api/v1/users/web_profile_info/')

  profileInfo.searchParams.set('username', username)

  const response = await fetchWithTimeout(profileInfo, {
    headers: {
      ...browserHeaders,
      'x-ig-app-id': '936619743392459',
      referer: `https://www.instagram.com/${username}/`,
    },
  })

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

function sendJson(response: ServerResponse, statusCode: number, body: CheckResponse) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

export default defineConfig({
  plugins: [react(), usernameAvailabilityApi()],
})
