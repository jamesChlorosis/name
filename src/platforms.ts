export type PlatformId = 'instagram' | 'discord' | 'minecraft' | 'roblox' | 'medium' | 'linkedin'

export type Status = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'uncertain'

export type ValidationResult = {
  valid: boolean
  normalized: string
  reason?: string
  note?: string
}

export type Platform = {
  id: PlatformId
  label: string
  shortLabel: string
  ruleSummary: string
}

export const PLATFORMS: Platform[] = [
  {
    id: 'instagram',
    label: 'Instagram',
    shortLabel: 'IG',
    ruleSummary: '1-30 letters, numbers, periods, or underscores',
  },
  {
    id: 'discord',
    label: 'Discord',
    shortLabel: 'DC',
    ruleSummary: '2-32 lowercase letters, numbers, periods, or underscores',
  },
  {
    id: 'minecraft',
    label: 'Minecraft',
    shortLabel: 'MC',
    ruleSummary: '3-16 letters, numbers, or underscores',
  },
  {
    id: 'roblox',
    label: 'Roblox',
    shortLabel: 'RB',
    ruleSummary: '3-20 letters, numbers, with up to one middle underscore',
  },
  {
    id: 'medium',
    label: 'Medium',
    shortLabel: 'MD',
    ruleSummary: '3-30 letters, numbers, or underscores',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn URL',
    shortLabel: 'IN',
    ruleSummary: '3-100 letters, numbers, or hyphens',
  },
]

export const PLATFORM_IDS = PLATFORMS.map((platform) => platform.id)

const MEDIUM_RESERVED_HANDLES = new Set([
  'about',
  'account',
  'accounts',
  'admin',
  'api',
  'app',
  'assets',
  'billing',
  'blog',
  'blogs',
  'cdn',
  'careers',
  'creators',
  'dashboard',
  'drafts',
  'email',
  'feed',
  'feeds',
  'help',
  'home',
  'jobs',
  'legal',
  'login',
  'logout',
  'mail',
  'me',
  'medium',
  'membership',
  'new',
  'notifications',
  'partner',
  'partners',
  'policy',
  'press',
  'privacy',
  'publications',
  'search',
  'settings',
  'signin',
  'signup',
  'staff',
  'status',
  'stories',
  'support',
  'tag',
  'tags',
  'terms',
  'topics',
  'trust',
  'user',
  'users',
  'write',
  'www',
])

export function normalizeUsername(platform: PlatformId, username: string) {
  const trimmed = username.trim().replace(/^@/, '')

  if (platform === 'discord' || platform === 'instagram' || platform === 'medium' || platform === 'linkedin') {
    return trimmed.toLowerCase()
  }

  return trimmed
}

export function getProfileUrl(platform: PlatformId, username: string) {
  const normalized = normalizeUsername(platform, username)

  if (!normalized) {
    return undefined
  }

  if (platform === 'instagram') {
    return `https://www.instagram.com/${normalized}/`
  }

  if (platform === 'medium') {
    return `https://medium.com/@${normalized}`
  }

  if (platform === 'linkedin') {
    return `https://www.linkedin.com/in/${normalized}/`
  }

  return undefined
}

export function validateUsername(platform: PlatformId, username: string): ValidationResult {
  const raw = username.trim().replace(/^@/, '')
  const normalized = normalizeUsername(platform, username)

  if (!raw) {
    return { valid: false, normalized, reason: 'Required' }
  }

  if (platform === 'instagram') {
    if (normalized.length > 30) {
      return { valid: false, normalized, reason: 'Max 30 characters' }
    }
    if (!/^[a-z0-9._]+$/.test(normalized)) {
      return { valid: false, normalized, reason: 'Only letters, numbers, periods, and underscores' }
    }
    if (normalized.startsWith('.') || normalized.endsWith('.')) {
      return { valid: false, normalized, reason: 'Cannot start or end with a period' }
    }
    if (normalized.includes('..')) {
      return { valid: false, normalized, reason: 'No consecutive periods' }
    }
  }

  if (platform === 'discord') {
    if (normalized.length < 2 || normalized.length > 32) {
      return { valid: false, normalized, reason: 'Must be 2-32 characters' }
    }
    if (!/^[a-z0-9._]+$/.test(normalized)) {
      return { valid: false, normalized, reason: 'Only letters, numbers, periods, and underscores' }
    }
    if (normalized.includes('..')) {
      return { valid: false, normalized, reason: 'No consecutive periods' }
    }
  }

  if (platform === 'minecraft') {
    if (normalized.length < 3 || normalized.length > 16) {
      return { valid: false, normalized, reason: 'Must be 3-16 characters' }
    }
    if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
      return { valid: false, normalized, reason: 'Only letters, numbers, and underscores' }
    }
  }

  if (platform === 'roblox') {
    const underscoreCount = (normalized.match(/_/g) ?? []).length

    if (normalized.length < 3 || normalized.length > 20) {
      return { valid: false, normalized, reason: 'Must be 3-20 characters' }
    }
    if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
      return { valid: false, normalized, reason: 'Only letters, numbers, and underscores' }
    }
    if (normalized.startsWith('_') || normalized.endsWith('_')) {
      return { valid: false, normalized, reason: 'Underscore cannot be first or last' }
    }
    if (underscoreCount > 1) {
      return { valid: false, normalized, reason: 'Only one underscore allowed' }
    }
  }

  if (platform === 'medium') {
    if (normalized.length < 3 || normalized.length > 30) {
      return { valid: false, normalized, reason: 'Must be 3-30 characters to claim' }
    }
    if (MEDIUM_RESERVED_HANDLES.has(normalized)) {
      return { valid: false, normalized, reason: 'Reserved by Medium' }
    }
    if (!/^[a-z0-9_]+$/.test(normalized)) {
      return { valid: false, normalized, reason: 'Only letters, numbers, and underscores' }
    }
    if (normalized.startsWith('_') || normalized.endsWith('_')) {
      return { valid: false, normalized, reason: 'Underscore cannot be first or last' }
    }
    if (normalized.includes('__')) {
      return { valid: false, normalized, reason: 'No repeated underscores' }
    }
  }

  if (platform === 'linkedin') {
    if (normalized.length < 3 || normalized.length > 100) {
      return { valid: false, normalized, reason: 'Must be 3-100 characters' }
    }
    if (!/^[a-z0-9-]+$/.test(normalized)) {
      return { valid: false, normalized, reason: 'Only letters, numbers, and hyphens' }
    }
    if (normalized.startsWith('-') || normalized.endsWith('-')) {
      return { valid: false, normalized, reason: 'Hyphen cannot be first or last' }
    }
    if (normalized.includes('--')) {
      return { valid: false, normalized, reason: 'No repeated hyphens' }
    }
  }

  if (raw !== normalized) {
    return { valid: true, normalized, note: `Checks as ${normalized}` }
  }

  return { valid: true, normalized }
}

export function makeSuggestions(platform: PlatformId, username: string) {
  const base = normalizeUsername(platform, username).replace(/[^A-Za-z0-9]/g, '')
  const fallback = base || 'name'
  const year = new Date().getFullYear().toString().slice(-2)
  const candidates = [
    `${fallback}_${year}`,
    `${fallback}.hq`,
    `${fallback}io`,
    `${fallback}x`,
    `the${fallback}`,
    `${fallback}24`,
    `${fallback}_studio`,
    `${fallback}official`,
  ]

  const seen = new Set<string>()

  return candidates
    .map((candidate) => fitSuggestion(platform, candidate))
    .filter((candidate) => validateUsername(platform, candidate).valid)
    .filter((candidate) => {
      const key = candidate.toLowerCase()

      if (key === normalizeUsername(platform, username).toLowerCase() || seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    .slice(0, 3)
}

function fitSuggestion(platform: PlatformId, candidate: string) {
  const maxLengthByPlatform: Record<PlatformId, number> = {
    instagram: 30,
    discord: 32,
    minecraft: 16,
    roblox: 20,
    medium: 30,
    linkedin: 100,
  }

  let fitted = normalizeUsername(platform, candidate).slice(0, maxLengthByPlatform[platform])

  if (platform === 'roblox') {
    fitted = fitted.replace(/_/g, '')
    const midpoint = Math.min(Math.max(3, Math.floor(fitted.length / 2)), fitted.length - 1)

    if (fitted.length > 5) {
      fitted = `${fitted.slice(0, midpoint)}_${fitted.slice(midpoint)}`.slice(0, 20)
    }
  }

  if (platform === 'minecraft') {
    fitted = fitted.replace(/\./g, '').slice(0, 16)
  }

  if (platform === 'medium') {
    fitted = fitted.replace(/[^a-z0-9_]/g, '').slice(0, 30)
  }

  if (platform === 'linkedin') {
    fitted = fitted.replace(/[._]/g, '-').replace(/-+/g, '-').slice(0, 100)
  }

  return fitted.replace(/[._-]+$/, '').replace(/^[._-]+/, '')
}
