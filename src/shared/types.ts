// The whole data model, shared by the main process (which owns the
// database) and the renderer (which displays it). See docs/SPEC.md §3.
//
// Date/time conventions used everywhere:
// - calendar dates are strings like '2026-06-12' (local, no timezone)
// - times of day are strings like '14:30' (local, 24h)
// - timestamps are strings like '2026-06-12 14:30:05' (local time).
//   This is a single-user local app; storing local wall-clock time keeps
//   SQL date() queries and exported files human-readable.

export type ItemKind = 'task' | 'note' | 'journal' | 'prep' | 'page'
export type ItemStatus = 'inbox' | 'active' | 'done' | 'dropped'
export type LinkRole = 'prep-for' | 'notes-for' | 'follow-up-from' | 'related' | 'subtask-of'
export type ProjectStatus = 'active' | 'archived'

/** Everything the user creates is an Item; `kind` says how it behaves. */
export interface Item {
  id: string
  kind: ItemKind
  title: string
  content: string // Markdown (for pages: a plain-text mirror for search/export)
  /** Pages only: the rich editor's HTML. */
  richContent: string | null
  status: ItemStatus
  projectId: string | null
  dueDate: string | null
  /** Powers the Today list and time blocks. */
  scheduledDate: string | null
  /** Set when the item is dragged onto the Today timeline (a time block). */
  scheduledTime: string | null
  timeEstimateMinutes: number | null
  /** Manual ordering within the Today "top tasks" list. */
  sortOrder: number
  /** Quick-access favorites, surfaced in the sidebar. */
  starred: boolean
  createdAt: string
  completedAt: string | null
}

export interface Project {
  id: string
  name: string
  color: string // hex accent color, carries through the whole UI
  status: ProjectStatus
  createdAt: string
}

/**
 * Links connect an item to another item OR to a calendar event.
 * Exactly one of `toItemId` / `toEventKey` is set.
 *
 * For calendar targets we keep a denormalized snapshot of the event's
 * title and date, captured at link time and refreshed whenever the
 * event is seen again. If the event is later deleted from the calendar,
 * the linked notes stay fully browsable via the snapshot.
 */
export interface Link {
  id: string
  fromItemId: string
  toItemId: string | null
  toEventKey: string | null
  role: LinkRole
  eventTitle: string | null
  eventDate: string | null
  createdAt: string
}

/**
 * A calendar event, read live from the provider (Google or demo) and
 * never stored. `eventKey` = `${stableEventId}::${occurrenceDate}` so
 * recurring meetings get notes per-occurrence (SPEC §10) and links
 * survive event edits (Google event ids persist across reschedules).
 */
export interface CalendarEvent {
  eventKey: string
  title: string
  date: string
  startTime: string | null // null = all-day event
  endTime: string | null
}

/**
 * A local time block on the day's schedule — lives only in the local
 * database, never synced to Google (or any provider). Blocking out
 * time shouldn't pollute the real calendar.
 */
export interface LocalEvent {
  id: string
  title: string
  date: string
  startTime: string
  endTime: string
}

/**
 * Per-meeting app data (currently: which project the meeting belongs
 * to), keyed by eventKey, with the same survive-deletion snapshot.
 */
export interface Meeting {
  eventKey: string
  projectId: string | null
  title: string
  date: string
}

/** "2 of 3 prep items done" badges, computed per event. */
export interface PrepProgress {
  eventKey: string
  done: number
  total: number
}

export function eventKeyOf(eventId: string, date: string): string {
  return `${eventId}::${date}`
}
