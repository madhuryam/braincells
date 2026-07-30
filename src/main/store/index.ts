import DatabaseConstructor, { type Database } from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { migrate } from './migrations'
import { nowStamp, ymdAddDays } from '../../shared/dates'
import type {
  CalendarEvent,
  Item,
  ItemKind,
  ItemStatus,
  Link,
  LinkRole,
  Meeting,
  PrepProgress,
  Project
} from '../../shared/types'

/** Fields a caller may set when creating an item. Everything else gets a default. */
export interface NewItem {
  kind: ItemKind
  title: string
  content?: string
  richContent?: string | null
  status?: ItemStatus
  projectId?: string | null
  dueDate?: string | null
  scheduledDate?: string | null
  scheduledTime?: string | null
  timeEstimateMinutes?: number | null
}

/** Fields a caller may change on an existing item. */
export type ItemPatch = Partial<Omit<Item, 'id' | 'createdAt' | 'completedAt'>>

export interface LinkedItem {
  link: Link
  item: Item
}

// Column lists are written out once so every query returns identical shapes.
const ITEM_COLS = `id, kind, title, content, rich_content, status, project_id, due_date,
  scheduled_date, scheduled_time, time_estimate_minutes, sort_order, starred,
  created_at, completed_at`

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToItem(r: any): Item {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    content: r.content,
    richContent: r.rich_content,
    status: r.status,
    projectId: r.project_id,
    dueDate: r.due_date,
    scheduledDate: r.scheduled_date,
    scheduledTime: r.scheduled_time,
    timeEstimateMinutes: r.time_estimate_minutes,
    sortOrder: r.sort_order,
    starred: !!r.starred,
    createdAt: r.created_at,
    completedAt: r.completed_at
  }
}

function rowToLink(r: any): Link {
  return {
    id: r.id,
    fromItemId: r.from_item_id,
    toItemId: r.to_item_id,
    toEventKey: r.to_event_key,
    role: r.role,
    eventTitle: r.event_title,
    eventDate: r.event_date,
    createdAt: r.created_at
  }
}

/**
 * All database access for the app, as plain synchronous methods
 * (better-sqlite3 is synchronous, which is fine in the main process —
 * every call here is a few microseconds of local I/O).
 *
 * Constructed with a file path, or ':memory:' in tests.
 */
export class Store {
  readonly db: Database

  constructor(path: string) {
    this.db = new DatabaseConstructor(path)
    this.db.pragma('journal_mode = WAL')
    migrate(this.db) // may rebuild tables, so FKs go on afterwards
    this.db.pragma('foreign_keys = ON')
  }

  close(): void {
    this.db.close()
  }

  /** Absolute path of the database file (used by backup). */
  get path(): string {
    return this.db.name
  }

  // ── Projects ────────────────────────────────────────────────────────

  /**
   * Project names are unique, case-insensitively, across active AND
   * archived projects — otherwise "create, archive, create same name,
   * un-archive" would leave two identical-looking buckets. Items link
   * by id, so uniqueness is purely a naming rule, never a data fix-up.
   */
  private assertProjectNameFree(name: string, exceptId?: string): void {
    const clash = this.db
      .prepare('SELECT status FROM projects WHERE lower(name) = lower(?) AND id != ?')
      .get(name.trim(), exceptId ?? '') as { status: string } | undefined
    if (clash) {
      throw new Error(
        clash.status === 'archived'
          ? `An archived project is already named “${name.trim()}” — restore or rename it instead`
          : `A project named “${name.trim()}” already exists`
      )
    }
  }

  createProject(name: string, color: string): Project {
    this.assertProjectNameFree(name)
    const p: Project = {
      id: randomUUID(),
      name,
      color,
      status: 'active',
      createdAt: nowStamp()
    }
    this.db
      .prepare('INSERT INTO projects (id, name, color, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(p.id, p.name, p.color, p.status, p.createdAt)
    return p
  }

  listProjects(includeArchived = false): Project[] {
    const where = includeArchived ? '' : "WHERE status = 'active'"
    return this.db
      .prepare(`SELECT id, name, color, status, created_at AS createdAt FROM projects ${where} ORDER BY name`)
      .all() as Project[]
  }

  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color' | 'status'>>): void {
    if (patch.name !== undefined) this.assertProjectNameFree(patch.name, id)
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.name !== undefined) (sets.push('name = ?'), vals.push(patch.name))
    if (patch.color !== undefined) (sets.push('color = ?'), vals.push(patch.color))
    if (patch.status !== undefined) (sets.push('status = ?'), vals.push(patch.status))
    if (sets.length === 0) return
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  }

  // ── Items ───────────────────────────────────────────────────────────

  createItem(n: NewItem): Item {
    const item: Item = {
      id: randomUUID(),
      kind: n.kind,
      title: n.title,
      content: n.content ?? '',
      richContent: n.richContent ?? null,
      status: n.status ?? 'inbox',
      projectId: n.projectId ?? null,
      dueDate: n.dueDate ?? null,
      scheduledDate: n.scheduledDate ?? null,
      scheduledTime: n.scheduledTime ?? null,
      timeEstimateMinutes: n.timeEstimateMinutes ?? null,
      sortOrder: this.nextSortOrder(),
      starred: false,
      createdAt: nowStamp(),
      completedAt: null
    }
    this.db
      .prepare(
        `INSERT INTO items (${ITEM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.kind,
        item.title,
        item.content,
        item.richContent,
        item.status,
        item.projectId,
        item.dueDate,
        item.scheduledDate,
        item.scheduledTime,
        item.timeEstimateMinutes,
        item.sortOrder,
        item.starred ? 1 : 0,
        item.createdAt,
        item.completedAt
      )
    return item
  }

  private nextSortOrder(): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM items').get() as any
    return r.next
  }

  getItem(id: string): Item | null {
    const r = this.db.prepare(`SELECT ${ITEM_COLS} FROM items WHERE id = ?`).get(id)
    return r ? rowToItem(r) : null
  }

  /**
   * Patch any editable fields. Completion timestamps are managed here:
   * moving to 'done' stamps completedAt; leaving 'done' clears it.
   */
  updateItem(id: string, patch: ItemPatch): Item | null {
    const existing = this.getItem(id)
    if (!existing) return null

    const colOf: Record<string, string> = {
      kind: 'kind',
      title: 'title',
      content: 'content',
      richContent: 'rich_content',
      status: 'status',
      projectId: 'project_id',
      dueDate: 'due_date',
      scheduledDate: 'scheduled_date',
      scheduledTime: 'scheduled_time',
      timeEstimateMinutes: 'time_estimate_minutes',
      sortOrder: 'sort_order',
      starred: 'starred'
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [field, col] of Object.entries(colOf)) {
      const v = (patch as any)[field]
      if (v !== undefined) {
        sets.push(`${col} = ?`)
        // SQLite can't bind booleans directly.
        vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
      }
    }
    if (patch.status === 'done' && existing.status !== 'done') {
      sets.push('completed_at = ?')
      vals.push(nowStamp())
    } else if (patch.status && patch.status !== 'done' && existing.status === 'done') {
      sets.push('completed_at = NULL')
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    return this.getItem(id)
  }

  deleteItem(id: string): void {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id)
  }

  // ── The lists each screen shows ─────────────────────────────────────

  /** Raw captures, oldest first, so triage clears the queue in order. */
  inboxItems(): Item[] {
    return this.db
      .prepare(`SELECT ${ITEM_COLS} FROM items WHERE status = 'inbox' ORDER BY created_at`)
      .all()
      .map(rowToItem)
  }

  inboxCount(): number {
    const r = this.db.prepare("SELECT COUNT(*) AS n FROM items WHERE status = 'inbox'").get() as any
    return r.n
  }

  /** Active tasks scheduled for exactly this date, in manual order. */
  tasksFor(date: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status = 'active' AND scheduled_date = ?
         ORDER BY sort_order, created_at`
      )
      .all(date)
      .map(rowToItem)
  }

  /** Active tasks scheduled after `date`, within the next 7 days. */
  tasksThisWeek(date: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status = 'active'
           AND scheduled_date > ? AND scheduled_date <= ?
         ORDER BY scheduled_date, sort_order`
      )
      .all(date, ymdAddDays(date, 7))
      .map(rowToItem)
  }

  /**
   * Unfinished tasks scheduled before today. Shown in the quiet
   * "carried over" group — never styled as overdue (SPEC §6).
   */
  carriedOver(today: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status = 'active' AND scheduled_date < ?
         ORDER BY scheduled_date, sort_order`
      )
      .all(today)
      .map(rowToItem)
  }

  /**
   * The 'someday' backlog: live tasks with no scheduled date. They sit
   * on the Inbox screen until a day (or a project board) claims them.
   * Subtasks are excluded — they live inside their parent's card.
   */
  backlogTasks(): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status = 'active' AND scheduled_date IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM links l
             WHERE l.from_item_id = items.id AND l.role = 'subtask-of'
           )
         ORDER BY created_at`
      )
      .all()
      .map(rowToItem)
  }

  /** Notes that were triaged out of the inbox but never given a project. */
  unfiledNotes(): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'note' AND status = 'active' AND project_id IS NULL
         ORDER BY created_at DESC`
      )
      .all()
      .map(rowToItem)
  }

  /**
   * Everything in a project that isn't dropped, newest activity first.
   * Subtasks are excluded — they show inside their parent's card.
   */
  projectItems(projectId: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE project_id = ? AND status != 'dropped'
           AND NOT EXISTS (
             SELECT 1 FROM links l
             WHERE l.from_item_id = items.id AND l.role = 'subtask-of'
           )
         ORDER BY created_at DESC`
      )
      .all(projectId)
      .map(rowToItem)
  }

  /** A task's checkbox subtasks, oldest first. */
  subtasksOf(parentId: string): Item[] {
    return this.db
      .prepare(
        `SELECT i.* FROM links l JOIN items i ON i.id = l.from_item_id
         WHERE l.to_item_id = ? AND l.role = 'subtask-of' AND i.status != 'dropped'
         ORDER BY i.created_at`
      )
      .all(parentId)
      .map(rowToItem)
  }

  /** Quick-access favorites for the sidebar. */
  starredItems(): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE starred = 1 AND status != 'dropped' ORDER BY title`
      )
      .all()
      .map(rowToItem)
  }

  /** Most recently completed items — the visible 'done' history. */
  recentCompleted(limit = 50): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE status = 'done' ORDER BY completed_at DESC LIMIT ?`
      )
      .all(limit)
      .map(rowToItem)
  }

  /** Tasks completed on a given local date — feeds the daily log. */
  completedOn(date: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE status = 'done' AND date(completed_at) = ?
         ORDER BY completed_at`
      )
      .all(date)
      .map(rowToItem)
  }

  /** The day's journal entry, created on first access. */
  journalFor(date: string): Item {
    const r = this.db
      .prepare(`SELECT ${ITEM_COLS} FROM items WHERE kind = 'journal' AND scheduled_date = ?`)
      .get(date)
    if (r) return rowToItem(r)
    return this.createItem({
      kind: 'journal',
      title: `Journal — ${date}`,
      status: 'active',
      scheduledDate: date
    })
  }

  /**
   * Persist a manual drag-reorder: items get sort_order 0..n-1 in the
   * order given.
   */
  reorderItems(ids: string[]): void {
    const stmt = this.db.prepare('UPDATE items SET sort_order = ? WHERE id = ?')
    this.db.transaction(() => {
      ids.forEach((id, i) => stmt.run(i, id))
    })()
  }

  /** "Declare bankruptcy": drop a batch of items guiltlessly, no judgment. */
  dropItems(ids: string[]): void {
    const stmt = this.db.prepare("UPDATE items SET status = 'dropped' WHERE id = ?")
    this.db.transaction(() => {
      ids.forEach((id) => stmt.run(id))
    })()
  }

  // ── Links ───────────────────────────────────────────────────────────

  linkItems(fromItemId: string, toItemId: string, role: LinkRole): Link {
    const link: Link = {
      id: randomUUID(),
      fromItemId,
      toItemId,
      toEventKey: null,
      role,
      eventTitle: null,
      eventDate: null,
      createdAt: nowStamp()
    }
    this.insertLink(link)
    return link
  }

  /** Link an item to a calendar event, capturing the survival snapshot. */
  linkToEvent(fromItemId: string, event: CalendarEvent, role: LinkRole): Link {
    const link: Link = {
      id: randomUUID(),
      fromItemId,
      toItemId: null,
      toEventKey: event.eventKey,
      role,
      eventTitle: event.title,
      eventDate: event.date,
      createdAt: nowStamp()
    }
    this.insertLink(link)
    return link
  }

  private insertLink(l: Link): void {
    this.db
      .prepare(
        `INSERT INTO links (id, from_item_id, to_item_id, to_event_key, role,
          event_title, event_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(l.id, l.fromItemId, l.toItemId, l.toEventKey, l.role, l.eventTitle, l.eventDate, l.createdAt)
  }

  deleteLink(id: string): void {
    this.db.prepare('DELETE FROM links WHERE id = ?').run(id)
  }

  linksFrom(itemId: string): Link[] {
    return this.db
      .prepare('SELECT * FROM links WHERE from_item_id = ? ORDER BY created_at')
      .all(itemId)
      .map(rowToLink)
  }

  /** Items attached to a calendar event, optionally filtered by role. */
  itemsForEvent(eventKey: string, role?: LinkRole): LinkedItem[] {
    const roleClause = role ? 'AND l.role = ?' : ''
    const args = role ? [eventKey, role] : [eventKey]
    const rows = this.db
      .prepare(
        `SELECT l.id AS link_id, l.from_item_id, l.to_item_id, l.to_event_key,
                l.role, l.event_title, l.event_date, l.created_at AS link_created_at,
                i.*
         FROM links l JOIN items i ON i.id = l.from_item_id
         WHERE l.to_event_key = ? ${roleClause} AND i.status != 'dropped'
         ORDER BY i.sort_order, i.created_at`
      )
      .all(...args) as any[]
    return rows.map((r) => ({
      link: {
        id: r.link_id,
        fromItemId: r.from_item_id,
        toItemId: r.to_item_id,
        toEventKey: r.to_event_key,
        role: r.role,
        eventTitle: r.event_title,
        eventDate: r.event_date,
        createdAt: r.link_created_at
      },
      item: rowToItem(r)
    }))
  }

  /**
   * Called whenever fresh events arrive from the calendar: refreshes the
   * denormalized title/date snapshots so reschedules are picked up
   * automatically (the event key itself is stable).
   */
  refreshEventSnapshots(events: CalendarEvent[]): void {
    const linkStmt = this.db.prepare(
      'UPDATE links SET event_title = ?, event_date = ? WHERE to_event_key = ?'
    )
    const meetingStmt = this.db.prepare(
      'UPDATE meetings SET title = ?, date = ? WHERE event_key = ?'
    )
    this.db.transaction(() => {
      for (const e of events) {
        linkStmt.run(e.title, e.date, e.eventKey)
        meetingStmt.run(e.title, e.date, e.eventKey)
      }
    })()
  }

  /** "2 of 3 prep items done" for each event, in one query. */
  prepProgress(eventKeys: string[]): PrepProgress[] {
    if (eventKeys.length === 0) return []
    const placeholders = eventKeys.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT l.to_event_key AS eventKey,
                SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END) AS done,
                COUNT(*) AS total
         FROM links l JOIN items i ON i.id = l.from_item_id
         WHERE l.role = 'prep-for' AND i.status != 'dropped'
           AND l.to_event_key IN (${placeholders})
         GROUP BY l.to_event_key`
      )
      .all(...eventKeys) as PrepProgress[]
  }

  // ── Meetings (event ↔ project assignment) ───────────────────────────

  getMeeting(eventKey: string): Meeting | null {
    const r = this.db
      .prepare('SELECT event_key AS eventKey, project_id AS projectId, title, date FROM meetings WHERE event_key = ?')
      .get(eventKey)
    return (r as Meeting) ?? null
  }

  /** Assign a meeting to a project (or null to unassign). Upserts the snapshot. */
  assignMeetingProject(event: { eventKey: string; title: string; date: string }, projectId: string | null): void {
    this.db
      .prepare(
        `INSERT INTO meetings (event_key, project_id, title, date) VALUES (?, ?, ?, ?)
         ON CONFLICT(event_key) DO UPDATE SET project_id = excluded.project_id,
           title = excluded.title, date = excluded.date`
      )
      .run(event.eventKey, projectId, event.title, event.date)
  }

  meetingsForProject(projectId: string): Meeting[] {
    return this.db
      .prepare(
        `SELECT event_key AS eventKey, project_id AS projectId, title, date
         FROM meetings WHERE project_id = ? ORDER BY date DESC`
      )
      .all(projectId) as Meeting[]
  }

  // ── Full dumps (markdown export) ────────────────────────────────────

  allItems(): Item[] {
    return this.db.prepare(`SELECT ${ITEM_COLS} FROM items ORDER BY created_at`).all().map(rowToItem)
  }

  allLinks(): Link[] {
    return this.db.prepare('SELECT * FROM links ORDER BY created_at').all().map(rowToLink)
  }

  allMeetings(): Meeting[] {
    return this.db
      .prepare('SELECT event_key AS eventKey, project_id AS projectId, title, date FROM meetings ORDER BY date')
      .all() as Meeting[]
  }

  // ── Search ──────────────────────────────────────────────────────────

  /**
   * Full-text search over titles and content. Every word is treated
   * as a quoted prefix ('mee' finds 'meeting'), so partial typing
   * works and FTS5 operator syntax can't blow up on the user.
   */
  search(query: string, limit = 50): Item[] {
    const words = query.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return []
    const ftsQuery = words.map((w) => `"${w.replaceAll('"', '""')}"*`).join(' ')
    return this.db
      .prepare(
        `SELECT i.* FROM items_fts f
         JOIN items i ON i.rowid = f.rowid
         WHERE items_fts MATCH ? AND i.status != 'dropped'
         ORDER BY rank LIMIT ?`
      )
      .all(ftsQuery, limit)
      .map(rowToItem)
  }

  // ── Danger zone ─────────────────────────────────────────────────────

  /**
   * Wipe every piece of content — items, links, meetings, projects —
   * while leaving settings (theme, calendar mode, OAuth client) intact.
   * Links go first so no FK fires; the FTS index empties via triggers.
   */
  clearContent(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM links').run()
      this.db.prepare('DELETE FROM meetings').run()
      this.db.prepare('DELETE FROM items').run()
      this.db.prepare('DELETE FROM projects').run()
    })()
  }

  // ── Settings (small key/value JSON blobs) ───────────────────────────

  getSetting<T>(key: string): T | null {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return r ? (JSON.parse(r.value) as T) : null
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, JSON.stringify(value))
  }
}
