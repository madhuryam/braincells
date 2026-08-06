import { ipcMain } from 'electron'
import type { CalendarEvent } from '../../shared/types'
import type { Store } from '../store'
import { autoFileMeetingsByLabel } from './classify'
import { demoEvents } from './demo'
import { withoutWorkLocationEvents } from './filter'
import { GoogleCalendar } from './google'

export type CalendarMode = 'demo' | 'google' | 'off'

/**
 * The calendar IPC surface. Whichever provider is active, events are
 * read live and never stored — but every fetch refreshes the
 * title/date snapshots on existing links (how reschedules propagate
 * to saved notes, SPEC §3) and files labeled meetings into their
 * label's associated project.
 */
// The renderer re-queries on every data mutation, so identical Google
// ranges get fetched seconds apart. Long enough to absorb those bursts,
// short enough that external calendar edits still show up quickly.
const GOOGLE_CACHE_TTL_MS = 45_000
// Bounds memory during long scrolling sessions (one entry per range).
const GOOGLE_CACHE_MAX_ENTRIES = 30

export function registerCalendarIpc(store: Store): void {
  const google = new GoogleCalendar(store)
  // Raw (pre-filter) events per range — hideWorkLocation can flip
  // mid-TTL, so filtering happens after retrieval, never before caching.
  const googleCache = new Map<string, { events: CalendarEvent[]; fetchedAt: number }>()

  const cachedGoogleEvents = async (startDate: string, endDate: string): Promise<CalendarEvent[]> => {
    const key = `${startDate}..${endDate}`
    const hit = googleCache.get(key)
    if (hit && Date.now() - hit.fetchedAt < GOOGLE_CACHE_TTL_MS) return hit.events
    const events = await google.eventsBetween(startDate, endDate)
    googleCache.delete(key) // re-insert so Map order stays oldest-first
    googleCache.set(key, { events, fetchedAt: Date.now() })
    for (const oldest of googleCache.keys()) {
      if (googleCache.size <= GOOGLE_CACHE_MAX_ENTRIES) break
      googleCache.delete(oldest)
    }
    return events
  }

  ipcMain.handle(
    'calendar:events',
    async (e, startDate: string, endDate: string): Promise<CalendarEvent[]> => {
      const mode = store.getSetting<CalendarMode>('calendarMode') ?? 'demo'
      let events: CalendarEvent[] = []
      if (mode === 'demo') {
        events = demoEvents(startDate, endDate)
      } else if (mode === 'google' && google.isConnected()) {
        events = await cachedGoogleEvents(startDate, endDate)
      }
      // Work-location noise ("Home"/"Office" all-day events) is filtered
      // here at the source, so every view benefits at once.
      if (store.getSetting<boolean>('hideWorkLocation')) {
        events = withoutWorkLocationEvents(events)
      }
      store.refreshEventSnapshots(events)
      // Filing only ever creates rows, so this converges: the refresh
      // it triggers re-fetches once, files nothing, and goes quiet.
      if (autoFileMeetingsByLabel(store, events) > 0) {
        e.sender.send('data-changed')
      }
      return events
    }
  )

  ipcMain.handle('calendar:googleStatus', () => ({ connected: google.isConnected() }))

  ipcMain.handle(
    'calendar:googleConnect',
    async (_e, clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        await google.connect({ clientId, clientSecret })
        googleCache.clear() // new account/mode — cached ranges are wrong
        store.setSetting('calendarMode', 'google')
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('calendar:googleDisconnect', () => {
    google.disconnect()
    googleCache.clear()
    store.setSetting('calendarMode', 'demo')
  })
}
