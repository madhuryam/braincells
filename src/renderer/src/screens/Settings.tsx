import { useEffect, useState } from 'react'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { Card } from '../components/Card'

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
    <div className="canvas" style={{ maxWidth: 720 }}>
      <header className="canvas-header">
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
      </div>
    </div>
  )
}
