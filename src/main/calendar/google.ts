import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'
import { eventKeyOf, type CalendarEvent } from '../../shared/types'
import { hhmm, ymd } from '../../shared/dates'
import type { Store } from '../store'

/**
 * Read-only Google Calendar access (SPEC §8), no SDK — just the two
 * documented endpoints over fetch:
 *
 * 1. OAuth happens in the system browser. We start a one-shot local
 *    HTTP server on a random port, open Google's consent page with
 *    PKCE, and Google redirects back to http://127.0.0.1:<port> with
 *    a code we exchange for tokens. This is Google's recommended flow
 *    for desktop apps; the user supplies their own OAuth client
 *    (a "Desktop app" credential from console.cloud.google.com).
 * 2. Events come from the standard /calendar/v3 list endpoint with
 *    singleEvents=true, so recurring meetings arrive as individual
 *    occurrences — matching the per-occurrence notes decision
 *    (SPEC §10). Tokens live in the local settings table.
 */

interface GoogleTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms when accessToken expires. */
  expiresAt: number
}

interface GoogleClient {
  clientId: string
  clientSecret: string
}

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export class GoogleCalendar {
  constructor(private store: Store) {}

  isConnected(): boolean {
    return this.store.getSetting<GoogleTokens>('googleTokens') !== null
  }

  disconnect(): void {
    this.store.setSetting('googleTokens', null)
  }

  /** Runs the full browser consent flow and stores the tokens. */
  async connect(client: GoogleClient): Promise<void> {
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')

    const { server, port } = await listenOnLoopback()
    try {
      const redirectUri = `http://127.0.0.1:${port}`
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline', // we need a refresh token
        prompt: 'consent',
        code_challenge: challenge,
        code_challenge_method: 'S256'
      })
      shell.openExternal(`${AUTH_URL}?${params}`)

      const code = await waitForCode(server)
      const tokens = await postForm<TokenResponse>(TOKEN_URL, {
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      })
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token')

      this.store.setSetting('googleClient', client)
      this.saveTokens(tokens, tokens.refresh_token)
    } finally {
      server.close()
    }
  }

  async eventsBetween(startDate: string, endDate: string): Promise<CalendarEvent[]> {
    const accessToken = await this.freshAccessToken()
    const events: CalendarEvent[] = []
    // Wide ranges (the scrolling calendar asks for months at a time)
    // can exceed one page — follow nextPageToken to the end.
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        timeMin: localDayStart(startDate).toISOString(),
        timeMax: localDayStart(endDate, /* nextDay */ true).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250'
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await fetch(`${EVENTS_URL}?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      if (!res.ok) throw new Error(`Google Calendar: ${res.status} ${await res.text()}`)
      const body = (await res.json()) as {
        nextPageToken?: string
        items?: Array<{
          id: string
          status?: string
          summary?: string
          colorId?: string
          eventLabelId?: string
          start?: { dateTime?: string; date?: string }
          end?: { dateTime?: string; date?: string }
        }>
      }

      for (const e of body.items ?? []) {
        if (e.status === 'cancelled' || !e.start) continue
        const startsAt = e.start.dateTime ? new Date(e.start.dateTime) : null
        const date = startsAt ? ymd(startsAt) : e.start.date
        if (!date) continue
        events.push({
          // Google event ids persist across edits and reschedules, which
          // is what lets links survive (SPEC §3).
          eventKey: eventKeyOf(e.id, date),
          title: e.summary ?? '(untitled)',
          date,
          startTime: startsAt ? hhmm(startsAt) : null,
          endTime: e.end?.dateTime ? hhmm(new Date(e.end.dateTime)) : null,
          colorId: e.colorId ?? null,
          // Lowercased so a label's id is one key regardless of the
          // casing Google happens to return per event.
          eventLabelId: e.eventLabelId ? e.eventLabelId.toLowerCase() : null
        })
      }
      pageToken = body.nextPageToken
    } while (pageToken)
    return events
  }

  private saveTokens(t: TokenResponse, refreshToken: string): void {
    this.store.setSetting('googleTokens', {
      accessToken: t.access_token,
      refreshToken,
      expiresAt: Date.now() + (t.expires_in - 60) * 1000 // refresh a minute early
    } satisfies GoogleTokens)
  }

  private async freshAccessToken(): Promise<string> {
    const tokens = this.store.getSetting<GoogleTokens>('googleTokens')
    const client = this.store.getSetting<GoogleClient>('googleClient')
    if (!tokens || !client) throw new Error('Google Calendar is not connected')
    if (Date.now() < tokens.expiresAt) return tokens.accessToken

    const refreshed = await postForm<TokenResponse>(TOKEN_URL, {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token'
    })
    this.saveTokens(refreshed, tokens.refreshToken)
    return refreshed.access_token
  }
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

async function postForm<T>(url: string, form: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form)
  })
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

function listenOnLoopback(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') resolve({ server, port: address.port })
      else reject(new Error('could not bind loopback port'))
    })
  })
}

/** Waits (up to 5 minutes) for Google to redirect back with ?code=. */
function waitForCode(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sign-in timed out')), 5 * 60_000)
    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      const error = url.searchParams.get('error')
      if (!code && !error) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<body style="font-family:sans-serif"><h2>braincells is connected 🎉</h2>You can close this tab.</body>')
      clearTimeout(timeout)
      if (code) resolve(code)
      else reject(new Error(`Google sign-in failed: ${error}`))
    })
  })
}

/** Midnight local time for a YYYY-MM-DD (optionally the following midnight). */
function localDayStart(date: string, nextDay = false): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d + (nextDay ? 1 : 0))
}
