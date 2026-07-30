import { ipcMain } from 'electron'
import type { CalendarEvent } from '../../shared/types'
import type { Store } from '../store'
import { demoEvents } from './demo'
import { withoutWorkLocationEvents } from './filter'
import { GoogleCalendar } from './google'

export type CalendarMode = 'demo' | 'google' | 'off'

/**
 * The calendar IPC surface. Whichever provider is active, events are
 * read live and never stored — but every fetch refreshes the
 * title/date snapshots on existing links, which is how reschedules
 * propagate to saved notes (SPEC §3).
 */
export function registerCalendarIpc(store: Store): void {
  const google = new GoogleCalendar(store)

  ipcMain.handle(
    'calendar:events',
    async (_e, startDate: string, endDate: string): Promise<CalendarEvent[]> => {
      const mode = store.getSetting<CalendarMode>('calendarMode') ?? 'demo'
      let events: CalendarEvent[] = []
      if (mode === 'demo') {
        events = demoEvents(startDate, endDate)
      } else if (mode === 'google' && google.isConnected()) {
        events = await google.eventsBetween(startDate, endDate)
      }
      // Work-location noise ("Home"/"Office" all-day events) is filtered
      // here at the source, so every view benefits at once.
      if (store.getSetting<boolean>('hideWorkLocation')) {
        events = withoutWorkLocationEvents(events)
      }
      store.refreshEventSnapshots(events)
      return events
    }
  )

  ipcMain.handle('calendar:googleStatus', () => ({ connected: google.isConnected() }))

  ipcMain.handle(
    'calendar:googleConnect',
    async (_e, clientId: string, clientSecret: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        await google.connect({ clientId, clientSecret })
        store.setSetting('calendarMode', 'google')
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle('calendar:googleDisconnect', () => {
    google.disconnect()
    store.setSetting('calendarMode', 'demo')
  })
}
