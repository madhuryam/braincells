import { ipcMain } from 'electron'
import type { CalendarEvent, CalendarLabel } from '../../shared/types'
import type { Store } from '../store'
import { autoClassifyMeetings, mergeLabels, type LabelProjects } from './classify'
import { demoEvents, DEMO_LABELS } from './demo'
import { GoogleCalendar } from './google'

export type CalendarMode = 'demo' | 'google' | 'off'

/**
 * The calendar IPC surface. Whichever provider is active, events are
 * read live and never stored — but every fetch refreshes the
 * title/date snapshots on existing links, which is how reschedules
 * propagate to saved notes (SPEC §3), and runs label auto-filing.
 */
export function registerCalendarIpc(store: Store): void {
  const google = new GoogleCalendar(store)
  // The color palette almost never changes; fetch it once per app run.
  let googleLabelsSynced = false

  ipcMain.handle(
    'calendar:events',
    async (_e, startDate: string, endDate: string): Promise<CalendarEvent[]> => {
      const mode = store.getSetting<CalendarMode>('calendarMode') ?? 'demo'
      let events: CalendarEvent[] = []
      if (mode === 'demo') {
        events = demoEvents(startDate, endDate)
        mergeLabels(store, DEMO_LABELS)
      } else if (mode === 'google' && google.isConnected()) {
        events = await google.eventsBetween(startDate, endDate)
        if (!googleLabelsSynced) {
          try {
            mergeLabels(store, await google.labels())
            googleLabelsSynced = true
          } catch {
            // Palette fetch is cosmetic — never block events on it.
          }
        }
      }
      store.refreshEventSnapshots(events)
      autoClassifyMeetings(store, events)
      return events
    }
  )

  // Labels and their project mapping
  ipcMain.handle('calendar:labels', () => store.getSetting<CalendarLabel[]>('calendarLabels') ?? [])
  ipcMain.handle('calendar:renameLabel', (_e, id: string, name: string) => {
    const labels = store.getSetting<CalendarLabel[]>('calendarLabels') ?? []
    store.setSetting(
      'calendarLabels',
      labels.map((l) => (l.id === id ? { ...l, name } : l))
    )
  })
  ipcMain.handle('calendar:assignLabel', (_e, labelId: string, projectId: string | null) => {
    const mapping = store.getSetting<LabelProjects>('labelProjects') ?? {}
    if (projectId) mapping[labelId] = projectId
    else delete mapping[labelId]
    store.setSetting('labelProjects', mapping)
  })

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
