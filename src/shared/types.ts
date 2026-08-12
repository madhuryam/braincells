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
export type LinkRole =
  | 'prep-for'
  | 'notes-for'
  | 'follow-up-from'
  | 'related'
  | 'subtask-of'
  /** from = the waiting task, to = the task it waits on. */
  | 'blocked-by'
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
  /** Optional section within the project (null = unfiled). Cleared
   *  automatically when the item moves to another project. */
  sectionId: string | null
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
  /** Last edit (null only for rows migrated before this existed). */
  updatedAt: string | null
  completedAt: string | null
}

export interface Project {
  id: string
  name: string
  /** Optional shorter label for tight spots (card pills); falls back to name. */
  nickname: string | null
  color: string // hex accent color, carries through the whole UI
  status: ProjectStatus
  createdAt: string
  /** Sidebar position (drag-to-reorder); also lands in the export. */
  sortOrder: number
}

/**
 * A named bucket inside one project ("Testing", "Customer", …) that
 * tasks are filed into on the project page — flat separation, not
 * hierarchy. Sections are real objects: creatable, renameable,
 * reorderable, and allowed to be empty.
 */
export interface Section {
  id: string
  projectId: string
  name: string
  sortOrder: number
  createdAt: string
  /** Archived sections keep their items filed but bow out of the UI. */
  status: 'active' | 'archived'
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
  /** Google label color id ("1"–"11" classically, but Google now
   *  allows more); absent = calendar default. */
  colorId?: string | null
  /** Google's custom event-label id (a UUID). The true label the user
   *  applied; `colorId` is just its underlying color when that color is
   *  one of the classic eleven. A custom-colored label carries an
   *  `eventLabelId` but no `colorId`. Absent = unlabeled. */
  eventLabelId?: string | null
}

/**
 * Google Calendar's eleven event label colors, keyed by colorId. These
 * are the hexes the modern Google UI shows (the /colors API endpoint
 * still serves the faded pre-2018 palette, so it's not used).
 */
/**
 * The user's personalization of one Google label (Settings → Calendar
 * labels), stored sparsely in the `calendarLabels` setting keyed by
 * colorId. Every field optional: absent = Google's default.
 */
export interface LabelOverride {
  name?: string
  hex?: string
  projectId?: string | null
}

export const GOOGLE_EVENT_COLORS: Record<string, { name: string; hex: string }> = {
  '1': { name: 'Lavender', hex: '#7986cb' },
  '2': { name: 'Sage', hex: '#33b679' },
  '3': { name: 'Grape', hex: '#8e24aa' },
  '4': { name: 'Flamingo', hex: '#e67c73' },
  '5': { name: 'Banana', hex: '#f6bf26' },
  '6': { name: 'Tangerine', hex: '#f4511e' },
  '7': { name: 'Peacock', hex: '#039be5' },
  '8': { name: 'Graphite', hex: '#616161' },
  '9': { name: 'Blueberry', hex: '#3f51b5' },
  '10': { name: 'Basil', hex: '#0b8043' },
  '11': { name: 'Tomato', hex: '#d50000' }
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
  /** Optional project — the block tints with its color on the timeline. */
  projectId: string | null
  /** Optional task this block schedules — lets one task appear as
   *  several blocks. Deleting the task deletes its blocks. */
  itemId: string | null
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
