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
  LocalEvent,
  Meeting,
  PrepProgress,
  Project,
  Section
} from '../../shared/types'

/** Fields a caller may set when creating an item. Everything else gets a default. */
export interface NewItem {
  kind: ItemKind
  title: string
  content?: string
  richContent?: string | null
  status?: ItemStatus
  projectId?: string | null
  /** Only meaningful with a projectId — the project page's per-section adder sets it. */
  sectionId?: string | null
  dueDate?: string | null
  scheduledDate?: string | null
  scheduledTime?: string | null
  timeEstimateMinutes?: number | null
}

/**
 * Fields a caller may change on an existing item. completedAt is
 * normally managed by the status transition in updateItem; a patch
 * carries it explicitly only to backdate a completion ("done on").
 */
export type ItemPatch = Partial<Omit<Item, 'id' | 'createdAt'>>

export interface LinkedItem {
  link: Link
  item: Item
}

// Column lists are written out once so every query returns identical shapes.
const ITEM_COLS = `id, kind, title, content, rich_content, status, project_id, section_id,
  due_date, scheduled_date, scheduled_time, time_estimate_minutes, sort_order, starred,
  created_at, updated_at, completed_at`

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
    sectionId: r.section_id,
    dueDate: r.due_date,
    scheduledDate: r.scheduled_date,
    scheduledTime: r.scheduled_time,
    timeEstimateMinutes: r.time_estimate_minutes,
    sortOrder: r.sort_order,
    starred: !!r.starred,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
      nickname: null, // set later from the Projects page, if ever
      color,
      status: 'active',
      createdAt: nowStamp()
    }
    // New projects land at the end of the user's ordering.
    const nextOrder = (
      this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM projects').get() as {
        n: number
      }
    ).n
    this.db
      .prepare(
        'INSERT INTO projects (id, name, nickname, color, status, created_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(p.id, p.name, p.nickname, p.color, p.status, p.createdAt, nextOrder)
    return p
  }

  listProjects(includeArchived = false): Project[] {
    const where = includeArchived ? '' : "WHERE status = 'active'"
    return this.db
      .prepare(
        `SELECT id, name, nickname, color, status, created_at AS createdAt FROM projects ${where} ORDER BY sort_order, name`
      )
      .all() as Project[]
  }

  /** Persist a new sidebar order: sort_order follows the given id list. */
  reorderProjects(ids: string[]): void {
    const stmt = this.db.prepare('UPDATE projects SET sort_order = ? WHERE id = ?')
    this.db.transaction(() => {
      ids.forEach((id, i) => stmt.run(i, id))
    })()
  }

  updateProject(
    id: string,
    patch: Partial<Pick<Project, 'name' | 'nickname' | 'color' | 'status'>>
  ): void {
    if (patch.name !== undefined) this.assertProjectNameFree(patch.name, id)
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.name !== undefined) (sets.push('name = ?'), vals.push(patch.name))
    // nickname: null is meaningful — it clears back to "use the name".
    if (patch.nickname !== undefined) (sets.push('nickname = ?'), vals.push(patch.nickname))
    if (patch.color !== undefined) (sets.push('color = ?'), vals.push(patch.color))
    if (patch.status !== undefined) (sets.push('status = ?'), vals.push(patch.status))
    if (sets.length === 0) return
    this.db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
  }

  /**
   * Deleting a project never deletes content: items and meeting
   * assignments fall back to "No project" via ON DELETE SET NULL.
   * (Its sections DO go with it — they're structure, not content —
   * and their items unfile via the section FK's own SET NULL.)
   */
  deleteProject(id: string): void {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  }

  // ── Sections (named buckets inside one project) ─────────────────────

  listSections(projectId: string): Section[] {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, name, sort_order AS sortOrder,
           created_at AS createdAt
         FROM sections WHERE project_id = ? ORDER BY sort_order, created_at`
      )
      .all(projectId) as Section[]
  }

  createSection(projectId: string, name: string): Section {
    // New sections land at the end of the project's ordering (same
    // convention as createProject).
    const nextOrder = (
      this.db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM sections WHERE project_id = ?')
        .get(projectId) as { n: number }
    ).n
    const s: Section = {
      id: randomUUID(),
      projectId,
      name,
      sortOrder: nextOrder,
      createdAt: nowStamp()
    }
    this.db
      .prepare(
        'INSERT INTO sections (id, project_id, name, sort_order, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(s.id, s.projectId, s.name, s.sortOrder, s.createdAt)
    return s
  }

  renameSection(id: string, name: string): void {
    this.db.prepare('UPDATE sections SET name = ? WHERE id = ?').run(name, id)
  }

  /** Persist a new section order: sort_order follows the given id list. */
  reorderSections(ids: string[]): void {
    const stmt = this.db.prepare('UPDATE sections SET sort_order = ? WHERE id = ?')
    this.db.transaction(() => {
      ids.forEach((id, i) => stmt.run(i, id))
    })()
  }

  /** Deleting a section unfiles its tasks (SET NULL) — never deletes them. */
  deleteSection(id: string): void {
    this.db.prepare('DELETE FROM sections WHERE id = ?').run(id)
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
      sectionId: n.sectionId ?? null,
      dueDate: n.dueDate ?? null,
      scheduledDate: n.scheduledDate ?? null,
      scheduledTime: n.scheduledTime ?? null,
      timeEstimateMinutes: n.timeEstimateMinutes ?? null,
      sortOrder: this.nextSortOrder(),
      starred: false,
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
      completedAt: null
    }
    this.db
      .prepare(
        `INSERT INTO items (${ITEM_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.kind,
        item.title,
        item.content,
        item.richContent,
        item.status,
        item.projectId,
        item.sectionId,
        item.dueDate,
        item.scheduledDate,
        item.scheduledTime,
        item.timeEstimateMinutes,
        item.sortOrder,
        item.starred ? 1 : 0,
        item.createdAt,
        item.updatedAt,
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
   * moving to 'done' stamps completedAt; leaving 'done' clears it. A
   * patch may carry completedAt explicitly to backdate a completion —
   * honored only while the item is (or is becoming) done, and a bare
   * 'YYYY-MM-DD' lands at noon so it sorts sanely within its day.
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
      sectionId: 'section_id',
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
    const explicitDone =
      patch.completedAt && patch.completedAt.length === 10
        ? `${patch.completedAt} 12:00:00`
        : patch.completedAt
    if (patch.status === 'done' && existing.status !== 'done') {
      sets.push('completed_at = ?')
      vals.push(explicitDone ?? nowStamp())
    } else if (patch.status && patch.status !== 'done' && existing.status === 'done') {
      sets.push('completed_at = NULL')
    } else if (explicitDone && (patch.status ?? existing.status) === 'done') {
      // Moving an existing completion to another day.
      sets.push('completed_at = ?')
      vals.push(explicitDone)
    }
    // Intake triage: giving an inbox item a day or a project IS the
    // categorization — it graduates to active unless the patch says
    // otherwise, so no UI path has to remember to flip the status.
    if (
      patch.status === undefined &&
      existing.status === 'inbox' &&
      (patch.scheduledDate || patch.projectId)
    ) {
      sets.push(`status = 'active'`)
    }
    // A section is meaningless outside its project: moving the item to
    // another project clears its section unless the patch places it in
    // one explicitly — so every "file into project X" path (sidebar
    // drop, triage, the picker) can stay ignorant of sections.
    if (
      patch.projectId !== undefined &&
      patch.projectId !== existing.projectId &&
      patch.sectionId === undefined
    ) {
      sets.push('section_id = NULL')
    }
    if (sets.length > 0) {
      // Every real edit refreshes recency ("most recently edited").
      sets.push('updated_at = ?')
      vals.push(nowStamp())
      this.db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    // A subtask belongs to its parent's project — refiling a task takes
    // its whole subtask tree along, so a time-blocked subtask on the
    // calendar keeps wearing the right project color. Sections travel
    // the same way they do for the item itself (cleared on a move).
    if (patch.projectId !== undefined && patch.projectId !== existing.projectId) {
      this.db
        .prepare(
          `WITH RECURSIVE tree(id) AS (
             SELECT l.from_item_id FROM links l
             WHERE l.to_item_id = ? AND l.role = 'subtask-of'
             UNION ALL
             SELECT l.from_item_id FROM links l JOIN tree t ON l.to_item_id = t.id
             WHERE l.role = 'subtask-of'
           )
           UPDATE items SET project_id = ?, section_id = NULL
           WHERE id IN (SELECT id FROM tree)`
        )
        .run(id, patch.projectId)
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

  /**
   * Active tasks scheduled for exactly this date, in manual order.
   * Subtasks are excluded — a time-blocked subtask shows on the
   * timeline and inside its parent's card, never as its own card.
   */
  tasksFor(date: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status = 'active' AND scheduled_date = ?
           AND NOT EXISTS (
             SELECT 1 FROM links l
             WHERE l.from_item_id = items.id AND l.role = 'subtask-of'
           )
         ORDER BY sort_order, created_at`
      )
      .all(date)
      .map(rowToItem)
  }

  /**
   * Tasks blocked onto this day's timeline (a time as well as a date)
   * — open AND done, because a finished block stays on the calendar
   * (faded) as the day's record rather than vanishing.
   */
  scheduledBlocks(date: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status IN ('active', 'done')
           AND scheduled_date = ? AND scheduled_time IS NOT NULL
         ORDER BY scheduled_time`
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
           AND NOT EXISTS (
             SELECT 1 FROM links l
             WHERE l.from_item_id = items.id AND l.role = 'subtask-of'
           )
         ORDER BY scheduled_date, sort_order`
      )
      .all(date, ymdAddDays(date, 7))
      .map(rowToItem)
  }

  /**
   * Roll every unfinished past task forward to today — never styled
   * as overdue, never a triage step (SPEC §6): the day just starts
   * with yesterday's leftovers already on it. Returns how many moved.
   *
   * A missed time block does NOT follow the task: it lands on the new
   * day's list only, off the calendar, until it's re-blocked on
   * purpose. (The estimate is cleared with the time — it only existed
   * as the block's length, same as removeFromCalendar.)
   */
  carryOver(today: string): number {
    return this.db
      .prepare(
        `UPDATE items SET scheduled_date = ?,
           time_estimate_minutes = CASE WHEN scheduled_time IS NOT NULL
             THEN NULL ELSE time_estimate_minutes END,
           scheduled_time = NULL
         WHERE kind = 'task' AND status = 'active' AND scheduled_date < ?`
      )
      .run(today, today).changes
  }

  /** Live (active or inbox) tasks whose deadline is exactly this date. */
  tasksDueOn(date: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status IN ('active', 'inbox') AND due_date = ?
         ORDER BY due_date, created_at`
      )
      .all(date)
      .map(rowToItem)
  }

  /** Live (active or inbox) tasks whose deadline has passed, oldest deadline first. */
  tasksOverdue(date: string): Item[] {
    return this.db
      .prepare(
        `SELECT ${ITEM_COLS} FROM items
         WHERE kind = 'task' AND status IN ('active', 'inbox') AND due_date < ?
         ORDER BY due_date, created_at`
      )
      .all(date)
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

  /** A task's checkbox subtasks, in manual order (creation order until dragged). */
  subtasksOf(parentId: string): Item[] {
    return this.db
      .prepare(
        `SELECT i.* FROM links l JOIN items i ON i.id = l.from_item_id
         WHERE l.to_item_id = ? AND l.role = 'subtask-of' AND i.status != 'dropped'
         ORDER BY i.sort_order, i.rowid`
      )
      .all(parentId)
      .map(rowToItem)
  }

  /**
   * The whole subtask tree under an item, depth-first in creation
   * order — subtasks can themselves have subtasks, to any depth.
   */
  subtaskTreeOf(rootId: string): Array<{ parentId: string; depth: number; item: Item }> {
    // The path orders depth-first; siblings sort by manual order
    // (drag-reorder), with rowid (monotonic) breaking ties in creation
    // order — created_at only has second precision.
    const rows = this.db
      .prepare(
        `WITH RECURSIVE tree(id, parent_id, depth, path) AS (
           SELECT l.from_item_id, l.to_item_id, 1, printf('%012d%012d', i.sort_order, i.rowid)
           FROM links l JOIN items i ON i.id = l.from_item_id
           WHERE l.to_item_id = ? AND l.role = 'subtask-of' AND i.status != 'dropped'
           UNION ALL
           SELECT l.from_item_id, l.to_item_id, t.depth + 1, t.path || '/' || printf('%012d%012d', i.sort_order, i.rowid)
           FROM links l
           JOIN tree t ON l.to_item_id = t.id
           JOIN items i ON i.id = l.from_item_id
           WHERE l.role = 'subtask-of' AND i.status != 'dropped'
         )
         SELECT t.parent_id, t.depth, i.* FROM tree t JOIN items i ON i.id = t.id
         ORDER BY t.path`
      )
      .all(rootId) as any[]
    return rows.map((r) => ({ parentId: r.parent_id, depth: r.depth, item: rowToItem(r) }))
  }

  /**
   * The chain of parents above a subtask, outermost (root) first —
   * empty for a top-level item. Feeds the lineage line in peeks, so a
   * block on the calendar says which task it's a piece of.
   */
  ancestorsOf(itemId: string): Item[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE up(id, depth) AS (
           SELECT l.to_item_id, 1 FROM links l
           WHERE l.from_item_id = ? AND l.role = 'subtask-of'
           UNION ALL
           SELECT l.to_item_id, up.depth + 1
           FROM links l JOIN up ON l.from_item_id = up.id
           WHERE l.role = 'subtask-of'
         )
         SELECT i.* FROM up JOIN items i ON i.id = up.id
         ORDER BY up.depth DESC`
      )
      .all(itemId)
    return rows.map(rowToItem)
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

  /**
   * Subtasks completed on a date, each with its root (top-level) task
   * and its depth below it — so the Done group can show them under
   * their parent's name instead of as orphan cards.
   */
  completedSubtasksOn(
    date: string
  ): Array<{
    rootId: string
    rootTitle: string
    /** True while the root still has unfinished subtasks anywhere in its tree. */
    rootHasOpenSubtasks: boolean
    depth: number
    item: Item
  }> {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE up(start_id, ancestor_id, depth) AS (
           SELECT l.from_item_id, l.to_item_id, 1
           FROM links l WHERE l.role = 'subtask-of'
           UNION ALL
           SELECT up.start_id, l.to_item_id, up.depth + 1
           FROM links l JOIN up ON l.from_item_id = up.ancestor_id
           WHERE l.role = 'subtask-of'
         ),
         roots AS (
           SELECT start_id, ancestor_id AS root_id, depth
           FROM up u
           WHERE depth = (SELECT MAX(depth) FROM up WHERE start_id = u.start_id)
         )
         SELECT r.root_id, p.title AS root_title, r.depth,
           EXISTS (
             SELECT 1 FROM up u2 JOIN items s ON s.id = u2.start_id
             WHERE u2.ancestor_id = r.root_id AND s.status IN ('active', 'inbox')
           ) AS root_has_open,
           i.*
         FROM roots r
         JOIN items i ON i.id = r.start_id
         JOIN items p ON p.id = r.root_id
         WHERE i.status = 'done' AND date(i.completed_at) = ?
         ORDER BY r.root_id, r.depth, i.completed_at`
      )
      .all(date) as any[]
    return rows.map((r) => ({
      rootId: r.root_id,
      rootTitle: r.root_title,
      rootHasOpenSubtasks: !!r.root_has_open,
      depth: r.depth,
      item: rowToItem(r)
    }))
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
    // A prep task is due when its meeting happens — every caller
    // (prep picker, meeting screen, triage, drag-onto-meeting) gets
    // the deadline for free by doing it here.
    if (role === 'prep-for') this.updateItem(fromItemId, { dueDate: event.date })
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

  /**
   * The tasks this one waits on ('blocked-by' links), each with its
   * link so the chip's ✕ can sever it. Finished blockers stay listed
   * (struck through in the UI) — only open ones actually block.
   */
  blockersOf(itemId: string): LinkedItem[] {
    const rows = this.db
      .prepare(
        `SELECT l.id AS link_id, l.from_item_id, l.to_item_id, l.to_event_key,
                l.role, l.event_title, l.event_date, l.created_at AS link_created_at,
                i.*
         FROM links l JOIN items i ON i.id = l.to_item_id
         WHERE l.from_item_id = ? AND l.role = 'blocked-by' AND i.status != 'dropped'
         ORDER BY l.created_at`
      )
      .all(itemId) as any[]
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

  /** Ids of every task still waiting on an unfinished blocker. */
  blockedTaskIds(): string[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT l.from_item_id AS id
           FROM links l JOIN items b ON b.id = l.to_item_id
           WHERE l.role = 'blocked-by' AND b.status IN ('active', 'inbox')`
        )
        .all() as Array<{ id: string }>
    ).map((r) => r.id)
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

  /**
   * "2 of 3 prep items done" for each event, in one query. Counts the
   * prep items and every subtask beneath them (any depth) — checking
   * off a subtask moves the meeting's progress bar.
   */
  prepProgress(eventKeys: string[]): PrepProgress[] {
    if (eventKeys.length === 0) return []
    const placeholders = eventKeys.map(() => '?').join(', ')
    return this.db
      .prepare(
        `WITH RECURSIVE prep(event_key, item_id) AS (
           SELECT l.to_event_key, l.from_item_id
           FROM links l JOIN items i ON i.id = l.from_item_id
           WHERE l.role = 'prep-for' AND i.status != 'dropped'
             AND l.to_event_key IN (${placeholders})
           UNION ALL
           SELECT p.event_key, l.from_item_id
           FROM links l
           JOIN prep p ON l.to_item_id = p.item_id
           JOIN items i ON i.id = l.from_item_id
           WHERE l.role = 'subtask-of' AND i.status != 'dropped'
         )
         SELECT p.event_key AS eventKey,
                SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END) AS done,
                COUNT(*) AS total
         FROM prep p JOIN items i ON i.id = p.item_id
         GROUP BY p.event_key`
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

  /** Batched lookup for the timeline's project tinting — one query, not per-event. */
  meetingsByKeys(eventKeys: string[]): Meeting[] {
    if (eventKeys.length === 0) return []
    const placeholders = eventKeys.map(() => '?').join(', ')
    return this.db
      .prepare(
        `SELECT event_key AS eventKey, project_id AS projectId, title, date
         FROM meetings WHERE event_key IN (${placeholders})`
      )
      .all(...eventKeys) as Meeting[]
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

  // ── Local time blocks (never synced to any calendar provider) ──────

  createLocalEvent(e: {
    title: string
    date: string
    startTime: string
    endTime: string
    projectId?: string | null
    itemId?: string | null
  }): LocalEvent {
    const ev: LocalEvent = {
      id: randomUUID(),
      title: e.title,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime,
      projectId: e.projectId ?? null,
      itemId: e.itemId ?? null
    }
    this.db
      .prepare(
        `INSERT INTO local_events (id, title, date, start_time, end_time, project_id, item_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(ev.id, ev.title, ev.date, ev.startTime, ev.endTime, ev.projectId, ev.itemId, nowStamp())
    return ev
  }

  // itemId is set at creation (a drag) and never edited afterwards.
  updateLocalEvent(id: string, patch: Partial<Omit<LocalEvent, 'id' | 'itemId'>>): LocalEvent | null {
    const colOf: Record<string, string> = {
      title: 'title',
      date: 'date',
      startTime: 'start_time',
      endTime: 'end_time',
      projectId: 'project_id'
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [field, col] of Object.entries(colOf)) {
      const v = (patch as Record<string, unknown>)[field]
      if (v !== undefined) {
        sets.push(`${col} = ?`)
        vals.push(v)
      }
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE local_events SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
    }
    const r = this.db
      .prepare(
        `SELECT id, title, date, start_time AS startTime, end_time AS endTime,
                project_id AS projectId, item_id AS itemId
         FROM local_events WHERE id = ?`
      )
      .get(id)
    return (r as LocalEvent) ?? null
  }

  deleteLocalEvent(id: string): void {
    this.db.prepare('DELETE FROM local_events WHERE id = ?').run(id)
  }

  /**
   * How many times a task sits on the calendar: its own scheduledTime
   * slot plus every linked block — the "are you sure" number for
   * remove-from-calendar.
   */
  calendarInstanceCount(itemId: string): number {
    const item = this.getItem(itemId)
    const blocks = this.db
      .prepare('SELECT COUNT(*) AS n FROM local_events WHERE item_id = ?')
      .get(itemId) as { n: number }
    return blocks.n + (item?.scheduledTime ? 1 : 0)
  }

  /**
   * Total minutes a task holds on the calendar: its own block
   * (timeEstimateMinutes) plus every linked local block's length. A task
   * blocked twice — 30m then 15m — reads 45m, not just its first slot.
   */
  calendarMinutes(itemId: string): number {
    const item = this.getItem(itemId)
    const toMin = (t: string): number => {
      const [h, m] = t.split(':').map(Number)
      return h * 60 + m
    }
    const rows = this.db
      .prepare('SELECT start_time AS s, end_time AS e FROM local_events WHERE item_id = ?')
      .all(itemId) as { s: string; e: string }[]
    const blocks = rows.reduce((sum, r) => sum + Math.max(0, toMin(r.e) - toMin(r.s)), 0)
    return (item?.timeEstimateMinutes ?? 0) + blocks
  }

  /** Take a task off the calendar entirely: slot and linked blocks. */
  removeFromCalendar(itemId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM local_events WHERE item_id = ?').run(itemId)
      // The time estimate only existed as the block's length — off the
      // calendar it has no meaning, so clear it with the time.
      this.db
        .prepare(
          'UPDATE items SET scheduled_time = NULL, time_estimate_minutes = NULL, updated_at = ? WHERE id = ?'
        )
        .run(nowStamp(), itemId)
    })()
  }

  localEventsFor(date: string): LocalEvent[] {
    return this.db
      .prepare(
        `SELECT id, title, date, start_time AS startTime, end_time AS endTime,
                project_id AS projectId, item_id AS itemId
         FROM local_events WHERE date = ? ORDER BY start_time`
      )
      .all(date) as LocalEvent[]
  }

  // ── Danger zone ─────────────────────────────────────────────────────

  /**
   * Wipe every piece of content — items, links, meetings, projects,
   * local timeblocks — while leaving settings (theme, calendar mode,
   * OAuth client) intact. Links go first so no FK fires; the FTS
   * index empties via triggers.
   */
  clearContent(): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM links').run()
      this.db.prepare('DELETE FROM meetings').run()
      this.db.prepare('DELETE FROM items').run()
      this.db.prepare('DELETE FROM projects').run()
      this.db.prepare('DELETE FROM local_events').run()
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
