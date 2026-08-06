import type { CalendarEvent, LabelOverride } from '../../shared/types'
import type { Store } from '../store'

/**
 * File meetings into projects by their Google label (Settings →
 * Calendar labels → project association). Any existing decision wins:
 * a meetings row — even one that says "no project" — means a human
 * (or an earlier pass) already chose, so it is never overwritten.
 * Associations to archived or deleted projects are ignored.
 *
 * Returns how many meetings were filed, so the caller can tell the
 * renderer to refresh when something actually changed.
 */
export function autoFileMeetingsByLabel(store: Store, events: CalendarEvent[]): number {
  const raw = store.getSetting<Record<string, LabelOverride>>('calendarLabels') ?? {}
  // Case-insensitive keys, matching the renderer's normLabelId — a
  // label saved as 'AbC…' must still match events reporting 'abc…'.
  const labels: Record<string, LabelOverride> = {}
  for (const [k, v] of Object.entries(raw)) labels[k.toLowerCase()] = { ...labels[k.toLowerCase()], ...v }
  if (!Object.values(labels).some((l) => l.projectId)) return 0
  const activeProjects = new Set(store.listProjects().map((p) => p.id))
  let filed = 0
  for (const e of events) {
    // Same key the UI colors by: standard color id first, else the
    // custom event-label id.
    const labelId = (e.colorId ?? e.eventLabelId)?.toLowerCase()
    if (!labelId) continue
    const projectId = labels[labelId]?.projectId
    if (!projectId || !activeProjects.has(projectId)) continue
    if (store.getMeeting(e.eventKey)) continue
    store.assignMeetingProject({ eventKey: e.eventKey, title: e.title, date: e.date }, projectId)
    filed++
  }
  return filed
}
