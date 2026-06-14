import { useMemo, useState } from 'react'
import './App.css'
import {
  PLATFORM_IDS,
  PLATFORMS,
  type PlatformId,
  type Status,
  getProfileUrl,
  makeSuggestions,
  validateUsername,
} from './platforms'

type CheckCell = {
  status: Status
  detail: string
  normalized: string
  suggestions: string[]
  url?: string
  checkedAt?: string
}

type ApiCheckResponse = {
  status: Status
  detail: string
  normalized: string
  url?: string
}

type BulkApiCheck = ApiCheckResponse & {
  platform: PlatformId
  username: string
}

type BulkApiResponse = {
  results: BulkApiCheck[]
  durationMs: number
}

type UsernameRow = {
  original: string
  key: string
}

type CheckTask = {
  username: UsernameRow
  platform: PlatformId
}

const DEFAULT_NAMES = ['pixelpilot', 'nova_rift', 'shadow.core', 'builder_21'].join('\n')

function App() {
  const [input, setInput] = useState(DEFAULT_NAMES)
  const [selectedPlatforms, setSelectedPlatforms] = useState<PlatformId[]>([...PLATFORM_IDS])
  const [concurrency, setConcurrency] = useState(48)
  const [timeoutMs, setTimeoutMs] = useState(3200)
  const [results, setResults] = useState<Record<string, CheckCell>>({})
  const [isChecking, setIsChecking] = useState(false)
  const [lastRunMs, setLastRunMs] = useState<number>()

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
    const validTasks: CheckTask[] = []

    for (const username of usernames) {
      for (const platform of visiblePlatforms) {
        const validation = validateUsername(platform.id, username.original)

        if (!validation.valid) {
          nextResults[cellKey(username, platform.id)] = {
            status: 'invalid',
            detail: validation.reason ?? 'Invalid username',
            normalized: validation.normalized,
            suggestions: [],
            url: getProfileUrl(platform.id, validation.normalized),
          }
        } else {
          validTasks.push({ username, platform: platform.id })
          nextResults[cellKey(username, platform.id)] = {
            status: 'checking',
            detail: validation.note ?? 'Queued',
            normalized: validation.normalized,
            suggestions: [],
            url: getProfileUrl(platform.id, validation.normalized),
          }
        }
      }
    }

    setResults(nextResults)
    setLastRunMs(undefined)

    if (!validTasks.length) {
      return
    }

    setIsChecking(true)

    try {
      const startedAt = performance.now()
      const checked = await checkBulk(validTasks, concurrency, timeoutMs)

      setResults((current) => ({ ...current, ...checked }))
      setLastRunMs(performance.now() - startedAt)
    } catch {
      const failedResults = Object.fromEntries(
        validTasks.map(({ username, platform }) => {
          const validation = validateUsername(platform, username.original)

          return [
            cellKey(username, platform),
            {
              status: 'uncertain',
              detail: 'Bulk check API unavailable',
              normalized: validation.normalized,
              suggestions: [],
              url: getProfileUrl(platform, validation.normalized),
              checkedAt: new Date().toISOString(),
            } satisfies CheckCell,
          ]
        }),
      )

      setResults((current) => ({ ...current, ...failedResults }))
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

          <div className="speed-controls">
            <label className="range-control" htmlFor="concurrency">
              <span>
                <strong>Parallel workers</strong>
                <small>{concurrency} checks at once</small>
              </span>
              <input
                id="concurrency"
                type="range"
                min="4"
                max="96"
                step="4"
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
              />
            </label>

            <label className="range-control" htmlFor="timeout">
              <span>
                <strong>Timeout</strong>
                <small>{timeoutMs}ms per probe</small>
              </span>
              <input
                id="timeout"
                type="range"
                min="1200"
                max="10000"
                step="200"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(Number(event.target.value))}
              />
            </label>
          </div>

          <div className="actions">
            <button className="primary-action" type="button" onClick={runChecks} disabled={isChecking}>
              {isChecking ? 'Scanning...' : 'Bulk scan'}
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
        <span>{isChecking ? `${counts.checking} running now` : formatRunState(lastRunMs)}</span>
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

function renderCell(username: UsernameRow, platform: PlatformId, results: Record<string, CheckCell>) {
  const result = results[cellKey(username, platform)]
  const validation = validateUsername(platform, username.original)

  if (!result) {
    if (!validation.valid) {
      return (
        <StatusBadge
          status="invalid"
          detail={validation.reason ?? 'Invalid username'}
          url={getProfileUrl(platform, validation.normalized)}
        />
      )
    }

    return <StatusBadge status="idle" detail={validation.note ?? 'Ready'} url={getProfileUrl(platform, validation.normalized)} />
  }

  return <StatusBadge status={result.status} detail={result.detail} url={result.url} />
}

function StatusBadge({ status, detail, url }: { status: Status; detail: string; url?: string }) {
  return (
    <span className={`status-badge ${status}`}>
      <strong>{status}</strong>
      <small>{detail}</small>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          Open
        </a>
      ) : null}
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

function collectRowSuggestions(
  username: UsernameRow,
  platforms: PlatformId[],
  results: Record<string, CheckCell>,
) {
  const suggestions = platforms.flatMap((platform) => results[cellKey(username, platform)]?.suggestions ?? [])

  return Array.from(new Set(suggestions)).slice(0, 5)
}

function buildCsv(usernames: UsernameRow[], platforms: PlatformId[], results: Record<string, CheckCell>) {
  const headers = ['username', 'platform', 'status', 'detail', 'normalized', 'url', 'suggestions', 'checked_at']
  const rows = usernames.flatMap((username) =>
    platforms.map((platform) => {
      const validation = validateUsername(platform, username.original)
      const result =
        results[cellKey(username, platform)] ??
        ({
          status: validation.valid ? 'idle' : 'invalid',
          detail: validation.note ?? validation.reason ?? 'Not checked',
          normalized: validation.normalized,
          url: getProfileUrl(platform, validation.normalized),
          suggestions: [],
        } satisfies CheckCell)

      return [
        username.original,
        platform,
        result.status,
        result.detail,
        result.normalized,
        result.url ?? '',
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

async function checkBulk(tasks: CheckTask[], concurrency: number, timeoutMs: number) {
  const response = await fetch('/api/check-bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      concurrency,
      timeoutMs,
      checks: tasks.map(({ username, platform }) => ({
        platform,
        username: username.original,
      })),
    }),
  })

  if (!response.ok) {
    throw new Error('Bulk check failed')
  }

  const data = (await response.json()) as BulkApiResponse

  return Object.fromEntries(
    data.results.map((result) => [
      cellKeyFromValues(result.username, result.platform),
      {
        status: result.status,
        detail: result.detail,
        normalized: result.normalized,
        suggestions: result.status === 'taken' ? makeSuggestions(result.platform, result.normalized) : [],
        url: result.url ?? getProfileUrl(result.platform, result.normalized),
        checkedAt: new Date().toISOString(),
      } satisfies CheckCell,
    ]),
  )
}

function cellKeyFromValues(username: string, platform: PlatformId) {
  return `${username.trim().replace(/^@/, '').toLowerCase()}:${platform}`
}

function formatRunState(durationMs?: number) {
  if (!durationMs) {
    return 'Ready'
  }

  return `Last run ${Math.max(0.1, durationMs / 1000).toFixed(1)}s`
}

export default App
