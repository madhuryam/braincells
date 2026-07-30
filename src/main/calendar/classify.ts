import type { CalendarEvent, CalendarLabel } from '../../shared/types'
import type { Store } from '../store'

/** label id → project id: the auto-filing rule set (a settings blob). */
export type LabelProjects = Record<string, string>

/**
 * Merge freshly-seen labels into the saved set. Colors follow the
 * provider; names stay as the user renamed them (Google's API never
 * exposes custom label names, so the app's names are the truth).
 */
export function mergeLabels(store: Store, fresh: CalendarLabel[]): void {
  const saved = store.getSetting<CalendarLabel[]>('calendarLabels') ?? []
  const byId = new Map(saved.map((l) => [l.id, l]))
  for (const f of fresh) {
    const existing = byId.get(f.id)
    byId.set(f.id, existing ? { ...existing, color: f.color } : f)
  }
  store.setSetting('calendarLabels', [...byId.values()])
}

/**
 * File meetings into projects by their color label. Any existing
 * decision wins: a meetings row — even one that says "no project" —
 * means a human (or an earlier pass) already chose, so we never
 * overwrite it. Mappings to since-deleted projects are ignored.
 */
export function autoClassifyMeetings(store: Store, events: CalendarEvent[]): void {
  const mapping = store.getSetting<LabelProjects>('labelProjects') ?? {}
  if (Object.keys(mapping).length === 0) return
  const projectIds = new Set(store.listProjects(true).map((p) => p.id))
  for (const e of events) {
    if (!e.colorId) continue
    const projectId = mapping[e.colorId]
    if (!projectId || !projectIds.has(projectId)) continue
    if (store.getMeeting(e.eventKey)) continue
    store.assignMeetingProject({ eventKey: e.eventKey, title: e.title, date: e.date }, projectId)
  }
}
