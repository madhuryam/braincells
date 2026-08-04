import { useEffect, useState } from 'react'
import { THEMES, useData, useLiveQuery, useMutate } from '../state/data'
import { Card } from '../components/Card'
import { DEFAULT_TIME_ZONE } from '../components/Sidebar'
import { BackButton } from '../components/bits'
import { ampm } from '../format'

type CalendarMode = 'demo' | 'google' | 'off'

export function Settings(): React.JSX.Element {
  const { theme, setTheme } = useData()
  const mutate = useMutate()
  const mode = useLiveQuery(() => window.api.getSetting<CalendarMode>('calendarMode'), []) ?? 'demo'
  const google = useLiveQuery(() => window.api.googleStatus(), [])
  const hideWorkLocation =
    useLiveQuery(() => window.api.getSetting<boolean>('hideWorkLocation'), []) ?? false
  const timeZone =
    useLiveQuery(() => window.api.getSetting<string>('timeZone'), []) ?? DEFAULT_TIME_ZONE
  const timelineBounds = useLiveQuery(
    () => window.api.getSetting<{ start: number; end: number }>('timelineBounds'),
    []
  ) ?? { start: 7, end: 20 }
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [backupNote, setBackupNote] = useState<string | null>(null)

  // Pre-fill the saved OAuth client so reconnecting is one click.
  useEffect(() => {
    window.api
      .getSetting<{ clientId: string; clientSecret: string }>('googleClient')
      .then((c) => {
        if (c) {
          setClientId(c.clientId)
          setClientSecret(c.clientSecret)
        }
      })
  }, [])

  const setMode = (m: CalendarMode): Promise<void> =>
    mutate(() => window.api.setSetting('calendarMode', m))

  const connect = async (): Promise<void> => {
    setConnecting(true)
    setError(null)
    const result = await window.api.googleConnect(clientId.trim(), clientSecret.trim())
    setConnecting(false)
    if (!result.ok) setError(result.error ?? 'Could not connect')
    else mutate(() => Promise.resolve())
  }

  return (
    <div className="canvas" style={{ '--canvas-max': '720px' } as React.CSSProperties}>
      <header className="canvas-header">
        <BackButton />
        <h1>Settings</h1>
      </header>

      <div className="stack" style={{ gap: 16 }}>
        <Card className="stack">
          <h2>Theme</h2>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {THEMES.map((t) => (
              <button
                key={t.id}
                className={`btn ${theme === t.id ? 'primary' : ''}`}
                onClick={() => setTheme(t.id)}
              >
                <span
                  aria-hidden
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: t.swatch,
                    boxShadow: theme === t.id ? '0 0 0 2px #fff' : undefined,
                    flexShrink: 0
                  }}
                />
                {t.label}
              </button>
            ))}
          </div>
        </Card>

        <Card className="stack">
          <h2>Time zone</h2>
          <p style={{ margin: 0, color: 'var(--text-soft)' }}>
            Sets the sidebar clock. Times display in 12-hour AM/PM everywhere.
          </p>
          <select
            value={timeZone}
            onChange={(e) => mutate(() => window.api.setSetting('timeZone', e.target.value))}
          >
            {Intl.supportedValuesOf('timeZone').map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Card>

        <Card className="stack">
          <h2>Timeline window</h2>
          <p style={{ margin: 0, color: 'var(--text-soft)' }}>
            The hours the Today schedule shows (it stretches automatically if something falls
            outside). Click or drag on empty schedule space to block out time — those blocks stay
            local and are never written to your calendar.
          </p>
          <div className="row">
            from
            <select
              value={timelineBounds.start}
              onChange={(e) =>
                mutate(() =>
                  window.api.setSetting('timelineBounds', {
                    ...timelineBounds,
                    start: Number(e.target.value)
                  })
                )
              }
            >
              {Array.from({ length: 8 }, (_, i) => i + 5).map((h) => (
                <option key={h} value={h}>
                  {ampm(`${h}:00`)}
                </option>
              ))}
            </select>
            to
            <select
              value={timelineBounds.end}
              onChange={(e) =>
                mutate(() =>
                  window.api.setSetting('timelineBounds', {
                    ...timelineBounds,
                    end: Number(e.target.value)
                  })
                )
              }
            >
              {Array.from({ length: 10 }, (_, i) => i + 14).map((h) => (
                <option key={h} value={h}>
                  {ampm(`${h}:00`)}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <Card className="stack">
          <h2>Calendar</h2>
          <p style={{ margin: 0, color: 'var(--text-soft)' }}>
            Events are read live and never copied into the database. Notes you attach to a
            meeting survive even if the event is later deleted.
          </p>
          <div className="row">
            {(
              [
                ['demo', 'Demo calendar'],
                ['google', 'Google Calendar'],
                ['off', 'Off']
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                className={`btn ${mode === m ? 'primary' : ''}`}
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              style={{ width: 16, height: 16, padding: 0, accentColor: 'var(--accent)' }}
              checked={hideWorkLocation}
              onChange={(e) => mutate(() => window.api.setSetting('hideWorkLocation', e.target.checked))}
            />
            Hide “Home” / “Office” work-location events everywhere
          </label>

          {mode === 'google' && (
            <div className="stack" style={{ marginTop: 8 }}>
              {google?.connected ? (
                <div className="row">
                  <span className="pill">✅ Connected (read-only)</span>
                  <button
                    className="btn"
                    onClick={() => mutate(() => window.api.googleDisconnect())}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ margin: 0, color: 'var(--text-soft)', fontSize: 13 }}>
                    One-time setup: in console.cloud.google.com create an OAuth client of type
                    “Desktop app”, enable the Google Calendar API, and paste the credentials
                    here. They are stored only in your local database.
                  </p>
                  <input
                    placeholder="OAuth client ID"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                  <input
                    placeholder="OAuth client secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                  />
                  <div className="row">
                    <button
                      className="btn primary"
                      disabled={!clientId.trim() || !clientSecret.trim() || connecting}
                      onClick={connect}
                    >
                      {connecting ? 'Waiting for browser…' : 'Connect Google Calendar'}
                    </button>
                  </div>
                  {error && <p style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
                </>
              )}
            </div>
          )}
        </Card>

        <Card className="stack">
          <h2>Backup</h2>
          <p style={{ margin: 0, color: 'var(--text-soft)' }}>
            Everything lives in one local SQLite file — no cloud, no account. A backup is a copy
            of that file; the markdown export is the same data as plain .md files you can read
            anywhere. These are also in the File menu.
          </p>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button
              className="btn primary"
              onClick={async () => {
                const path = await window.api.createBackup()
                setBackupNote(path ? `Backup written to ${path}` : null)
              }}
            >
              Create Backup…
            </button>
            <button
              className="btn"
              onClick={async () => {
                const path = await window.api.exportMarkdown()
                setBackupNote(path ? `Exported to ${path}` : null)
              }}
            >
              Export as Markdown…
            </button>
            <button className="btn" onClick={() => window.api.restoreBackup()}>
              Restore from Backup…
            </button>
          </div>
          {backupNote && <p style={{ margin: 0, color: 'var(--ok)' }}>{backupNote}</p>}
        </Card>

        <Card className="stack">
          <h2>Start over</h2>
          <p style={{ margin: 0, color: 'var(--text-soft)' }}>
            Clear Database wipes every item, note, project, meeting, and timeblock and relaunches
            the app empty. A full backup is saved automatically first, and your settings are kept.
          </p>
          <div className="row">
            <button
              className="btn"
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={() => window.api.clearDatabase()}
            >
              Clear Database…
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
