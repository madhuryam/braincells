import { useEffect, useState } from 'react'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { Card } from '../components/Card'
import { BackButton } from '../components/bits'

type CalendarMode = 'demo' | 'google' | 'off'

export function Settings(): React.JSX.Element {
  const { theme, setTheme } = useData()
  const mutate = useMutate()
  const mode = useLiveQuery(() => window.api.getSetting<CalendarMode>('calendarMode'), []) ?? 'demo'
  const google = useLiveQuery(() => window.api.googleStatus(), [])
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
          <h2>Appearance</h2>
          <div className="row">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <button
                key={t}
                className={`btn ${theme === t ? 'primary' : ''}`}
                onClick={() => setTheme(t)}
              >
                {t}
              </button>
            ))}
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
            Clear Database wipes every item, note, project, and meeting and relaunches the app
            empty. A full backup is saved automatically first, and your settings are kept.
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
