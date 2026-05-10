import { useMemo, useState } from 'react'
import './App.css'
import {
  PLATFORM_IDS,
  PLATFORMS,
  type PlatformId,
  type Status,
  makeSuggestions,
  validateUsername,
} from './platforms'

type CheckCell = {
  status: Status
  detail: string
  normalized: string
  suggestions: string[]
  checkedAt?: string
}

type ApiCheckResponse = {
  status: Status
  detail: string
  normalized: string
}

type UsernameRow = {
  original: string
  key: string
}

const DEFAULT_NAMES = ['pixelpilot', 'nova_rift', 'shadow.core', 'builder_21'].join('\n')

function App() {
  const [input, setInput] = useState(DEFAULT_NAMES)
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>([...PLATFORM_IDS])
  const [delayMs, setDelayMs] = useState(650)
  const [results, setResults] = useState<Record<string, CheckCell>>({})
  const [isChecking, setIsChecking] = useState(false)

  const usernames = useMemo(() => parseUsernames(input), [input])
  const selectedSet = useMemo(() => new Set(selectedPlatforms), [selectedPlatforms])

  const visiblePlatforms = PLATFORMS.filter((platform) => selectedSet.has(platform.id))
  const readiness = useMemo(() => {
    const cells = usernames.flatMap((username) =>
      visiblePlatforms.map((platform) => validateUsername(platform.id, username.original)),
    )
    const invalid = cells.filter((cell) => !cell.valid).length
    const adjusted = cells.filter((cell) => cell.note).length

    return { total: cells.length, invalid, adjusted }
  }, [usernames, visiblePlatforms])

  const counts = useMemo(() => {
    return Object.values(results).reduce(
      (summary, result) => {
        if (result.status in summary) {
          summary[result.status as keyof typeof summary] += 1
        }

        return summary
      },
      { available: 0, taken: 0, invalid: 0, uncertain: 0, checking: 0 },
    )
  }, [results])

  const runChecks = async () => {
    if (!usernames.length || !visiblePlatforms.length || isChecking) {
      return
    }

    const nextResults: Record<string, CheckCell> = {}

    for (const username of usernames) {
      for (const platform of visiblePlatforms) {
        const validation = validateUsername(platform.id, username.original)

        if (!validation.valid) {
          nextResults[cellKey(username, platform.id)] = {
            status: 'invalid',
            detail: validation.reason ?? 'Invalid username',
            normalized: validation.normalized,
            suggestions: [],
          }
        }
      }
    }

    setResults(nextResults)
    setIsChecking(true)

    try {
      for (const username of usernames) {
        for (const platform of visiblePlatforms) {
          const key = cellKey(username, platform.id)
          const validation = validateUsername(platform.id, username.original)

          if (!validation.valid) {
            continue
          }

          setResults((current) => ({
            ...current,
            [key]: {
              status: 'checking',
              detail: validation.note ?? 'Checking',
              normalized: validation.normalized,
              suggestions: [],
            },
          }))

          const checked = await checkUsername(platform.id, username.original)

          setResults((current) => ({
            ...current,
            [key]: checked,
          }))

          if (delayMs > 0) {
            await wait(delayMs)
          }
        }
      }
    } finally {
      setIsChecking(false)
    }
  }

  const clearResults = () => {
    if (!isChecking) {
      setResults({})
    }
  }

  const togglePlatform = (platform: PlatformId) => {
    setSelectedPlatforms((current) => {
      if (current.includes(platform)) {
        return current.length === 1 ? current : current.filter((item) => item !== platform)
      }

      return [...current, platform]
    })
  }

  const exportCsv = () => {
    const csv = buildCsv(usernames, visiblePlatforms.map((platform) => platform.id), results)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `username-availability-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Availability checker</p>
          <h1>Handle Matrix</h1>
        </div>
        <div className="summary-strip" aria-label="Result summary">
          <span className="summary-pill available">{counts.available} available</span>
          <span className="summary-pill taken">{counts.taken} taken</span>
          <span className="summary-pill invalid">{counts.invalid} invalid</span>
          <span className="summary-pill uncertain">{counts.uncertain} uncertain</span>
        </div>
      </section>

      <section className="control-grid" aria-label="Checker controls">
        <div className="input-panel">
          <label htmlFor="usernames">Usernames</label>
          <textarea
            id="usernames"
            value={input}
            spellCheck={false}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Paste usernames here"
          />
          <div className="input-footer">
            <span>{usernames.length} unique names</span>
            <span>{readiness.invalid} blocked before network checks</span>
          </div>
        </div>

        <div className="settings-panel">
          <div className="field-group">
            <span className="field-label">Platforms</span>
            <div className="platform-toggles">
              {PLATFORMS.map((platform) => (
                <label
                  className={`platform-toggle ${selectedSet.has(platform.id) ? 'active' : ''}`}
                  key={platform.id}
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(platform.id)}
                    onChange={() => togglePlatform(platform.id)}
                  />
                  <span className="platform-mark">{platform.shortLabel}</span>
                  <span>
                    <strong>{platform.label}</strong>
                    <small>{platform.ruleSummary}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <label className="delay-control" htmlFor="delay">
            <span>
              <strong>Delay</strong>
              <small>{delayMs}ms between checks</small>
            </span>
            <input
              id="delay"
              type="range"
              min="250"
              max="2500"
              step="250"
              value={delayMs}
              onChange={(event) => setDelayMs(Number(event.target.value))}
            />
          </label>

          <div className="actions">
            <button className="primary-action" type="button" onClick={runChecks} disabled={isChecking}>
              {isChecking ? 'Checking...' : 'Check names'}
            </button>
            <button type="button" onClick={exportCsv} disabled={!Object.keys(results).length}>
              Export CSV
            </button>
            <button type="button" onClick={clearResults} disabled={isChecking || !Object.keys(results).length}>
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="preflight" aria-label="Preflight validation">
        <span>{readiness.total} platform checks queued</span>
        <span>{readiness.adjusted} normalized automatically</span>
        <span>{isChecking ? `${counts.checking} running now` : 'Ready'}</span>
      </section>

      <section className="table-shell" aria-label="Availability results">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              {visiblePlatforms.map((platform) => (
                <th key={platform.id}>{platform.label}</th>
              ))}
              <th>Suggestions</th>
            </tr>
          </thead>
          <tbody>
            {usernames.length ? (
              usernames.map((username) => {
                const rowSuggestions = collectRowSuggestions(username, visiblePlatforms.map((platform) => platform.id), results)

                return (
                  <tr key={username.key}>
                    <th scope="row">
                      <span className="username-value">{username.original}</span>
                    </th>
                    {visiblePlatforms.map((platform) => (
                      <td key={platform.id}>{renderCell(username, platform.id, results)}</td>
                    ))}
                    <td>
                      {rowSuggestions.length ? (
                        <div className="suggestion-list">
                          {rowSuggestions.map((suggestion) => (
                            <span key={suggestion}>{suggestion}</span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={visiblePlatforms.length + 2} className="empty-state">
                  Add at least one username.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  )
}

async function checkUsername(platform: PlatformId, username: string): Promise<CheckCell> {
  try {
    const response = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, username }),
    })

    if (!response.ok) {
      throw new Error('Check failed')
    }

    const data = (await response.json()) as ApiCheckResponse

    return {
      status: data.status,
      detail: data.detail,
      normalized: data.normalized,
      suggestions: data.status === 'taken' ? makeSuggestions(platform, data.normalized) : [],
      checkedAt: new Date().toISOString(),
    }
  } catch {
    const validation = validateUsername(platform, username)

    return {
      status: 'uncertain',
      detail: 'Local check API unavailable',
      normalized: validation.normalized,
      suggestions: [],
      checkedAt: new Date().toISOString(),
    }
  }
}

function renderCell(username: UsernameRow, platform: PlatformId, results: Record<string, CheckCell>) {
  const result = results[cellKey(username, platform)]
  const validation = validateUsername(platform, username.original)

  if (!result) {
    if (!validation.valid) {
      return <StatusBadge status="invalid" detail={validation.reason ?? 'Invalid username'} />
    }

    return <StatusBadge status="idle" detail={validation.note ?? 'Ready'} />
  }

  return <StatusBadge status={result.status} detail={result.detail} />
}

function StatusBadge({ status, detail }: { status: Status; detail: string }) {
  return (
    <span className={`status-badge ${status}`}>
      <strong>{status}</strong>
      <small>{detail}</small>
    </span>
  )
}

function parseUsernames(value: string): UsernameRow[] {
  const seen = new Set<string>()

  return value
    .split(/[\s,;]+/)
    .map((item) => item.trim().replace(/^@/, ''))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase()

      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    .map((item) => ({ original: item, key: item.toLowerCase() }))
}

function cellKey(username: UsernameRow, platform: PlatformId) {
  return `${username.key}:${platform}`
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function collectRowSuggestions(
  username: UsernameRow,
  platforms: PlatformId[],
  results: Record<string, CheckCell>,
) {
  const suggestions = platforms.flatMap((platform) => results[cellKey(username, platform)]?.suggestions ?? [])

  return Array.from(new Set(suggestions)).slice(0, 5)
}

function buildCsv(usernames: UsernameRow[], platforms: PlatformId[], results: Record<string, CheckCell>) {
  const headers = ['username', 'platform', 'status', 'detail', 'normalized', 'suggestions', 'checked_at']
  const rows = usernames.flatMap((username) =>
    platforms.map((platform) => {
      const validation = validateUsername(platform, username.original)
      const result =
        results[cellKey(username, platform)] ??
        ({
          status: validation.valid ? 'idle' : 'invalid',
          detail: validation.note ?? validation.reason ?? 'Not checked',
          normalized: validation.normalized,
          suggestions: [],
        } satisfies CheckCell)

      return [
        username.original,
        platform,
        result.status,
        result.detail,
        result.normalized,
        result.suggestions.join(' '),
        result.checkedAt ?? '',
      ]
    }),
  )

  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

export default App
