import { describe, expect, it } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseConstructor from 'better-sqlite3'
import { Store } from '../../store'
import { replaceDatabase } from '../restore'

/**
 * AUDIT: the restore mechanism itself — the risky file-level paths.
 *
 * Exercises the exact code paths the app uses:
 *   Create Backup → `store.db.backup(path)`      (src/main/backup/index.ts:33)
 *   Restore       → `replaceDatabase(dbPath, f)` (src/main/backup/restore.ts)
 *   Reopen        → `new Store(dbPath)`          (migrations run on open)
 *
 * Covered here:
 *   1. Stale -wal/-shm sidecars next to dbPath during a restore
 *      (incl. the counterfactual proving the WAL really would replay).
 *   2. Backups taken mid-use, with writes interleaved.
 *   3. FTS index + triggers after a restore (unicode queries, new writes).
 *   4. PRAGMA user_version: no migration re-run on a current-schema
 *      backup; a genuinely OLD-schema backup migrates forward losslessly.
 *   5. Double restore, restore over an existing (larger) db, restore
 *      into a path with no prior db.
 *   6. Validation + safety copy: invalid restore sources (non-SQLite,
 *      truncated) are refused without touching the live db, and a
 *      successful restore keeps the outgoing db as `<db>.pre-restore`.
 */

const fresh = (): string => mkdtempSync(join(tmpdir(), 'braincells-restore-audit-'))

/** Deterministic full dump of every user table, for exact comparison. */
const USER_TABLES: Array<[table: string, orderBy: string]> = [
  ['projects', 'id'],
  ['sections', 'id'],
  ['items', 'id'],
  ['links', 'id'],
  ['meetings', 'event_key'],
  ['local_events', 'id'],
  ['settings', 'key']
]
function dumpAll(dbPath: string): Record<string, unknown[]> {
  const db = new DatabaseConstructor(dbPath, { readonly: true })
  const out: Record<string, unknown[]> = {}
  for (const [t, order] of USER_TABLES) {
    out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all()
  }
  db.close()
  return out
}

function schemaOf(dbPath: string): unknown[] {
  const db = new DatabaseConstructor(dbPath, { readonly: true })
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
    )
    .all()
  db.close()
  return rows
}

function integrityOk(dbPath: string): string {
  const db = new DatabaseConstructor(dbPath, { readonly: true })
  const r = db.pragma('integrity_check', { simple: true }) as string
  db.close()
  return r
}

// ─────────────────────────────────────────────────────────────────────
// 1. Stale WAL sidecars
// ─────────────────────────────────────────────────────────────────────

describe('stale WAL sidecars during restore', () => {
  it('replaceDatabase removes a REAL (non-trivial) stale WAL and the reopened db shows exactly the backup state', async () => {
    const dir = fresh()
    const dbPath = join(dir, 'app.sqlite3')

    const store = new Store(dbPath)
    const project = store.createProject('Wal Project', '#845ef7')
    for (let i = 0; i < 30; i++) {
      store.createItem({
        kind: 'task',
        title: `pre-backup ${i}`,
        content: 'kept content',
        status: 'active',
        projectId: project.id
      })
    }
    store.setSetting('theme', 'plum')

    // The REAL backup path the app uses.
    const backupPath = join(dir, 'backup.sqlite3')
    await store.db.backup(backupPath)

    // Post-backup writes — these land in dbPath-wal (WAL mode) and are
    // exactly what a stale WAL would replay over a restored file.
    for (let i = 0; i < 200; i++) {
      store.createItem({
        kind: 'note',
        title: `post-backup ${i}`,
        content: 'should NOT survive the restore ' + 'x'.repeat(300)
      })
    }

    // Capture the live sidecars while the connection is open — this is
    // a genuine WAL full of committed frames, not a synthetic file.
    const staleWal = join(dir, 'stale.wal')
    const staleShm = join(dir, 'stale.shm')
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    expect(statSync(`${dbPath}-wal`).size).toBeGreaterThan(32) // header alone is 32 bytes
    copyFileSync(`${dbPath}-wal`, staleWal)
    copyFileSync(`${dbPath}-shm`, staleShm)

    // Mirror the app: store.close() before replaceDatabase — then
    // recreate the danger (crash leftovers / copy tools) by putting the
    // stale sidecars back next to dbPath.
    store.close()
    copyFileSync(staleWal, `${dbPath}-wal`)
    copyFileSync(staleShm, `${dbPath}-shm`)

    replaceDatabase(dbPath, backupPath)

    // The critical part: sidecars must be gone…
    expect(existsSync(`${dbPath}-wal`)).toBe(false)
    expect(existsSync(`${dbPath}-shm`)).toBe(false)

    // …and the reopened db is exactly the backup, with none of the 200
    // post-backup rows replayed in.
    expect(integrityOk(dbPath)).toBe('ok')
    const restored = new Store(dbPath)
    const titles = restored.allItems().map((i) => i.title)
    expect(titles).toHaveLength(30)
    expect(titles.every((t) => t.startsWith('pre-backup'))).toBe(true)
    expect(restored.getSetting('theme')).toBe('plum')
    restored.close()

    expect(dumpAll(dbPath)).toEqual(dumpAll(backupPath))
  })

  it('counterfactual: leaving the stale WAL in place WOULD replay post-backup writes over the restored file', async () => {
    // This proves the rmSync in replaceDatabase is load-bearing, not
    // superstition: same setup, but the sidecars are left behind.
    const dir = fresh()
    const dbPath = join(dir, 'app.sqlite3')

    const store = new Store(dbPath)
    for (let i = 0; i < 10; i++) store.createItem({ kind: 'task', title: `keep ${i}` })
    const backupPath = join(dir, 'backup.sqlite3')
    await store.db.backup(backupPath)
    for (let i = 0; i < 150; i++) {
      store.createItem({ kind: 'note', title: `ghost ${i}`, content: 'y'.repeat(300) })
    }
    const staleWal = join(dir, 'stale.wal')
    const staleShm = join(dir, 'stale.shm')
    copyFileSync(`${dbPath}-wal`, staleWal)
    copyFileSync(`${dbPath}-shm`, staleShm)
    store.close()

    // A "restore" that only copies the main file (what replaceDatabase
    // would be without its rmSync loop).
    copyFileSync(backupPath, dbPath)
    copyFileSync(staleWal, `${dbPath}-wal`)
    copyFileSync(staleShm, `${dbPath}-shm`)

    // SQLite recovers the stale WAL over the restored file. Depending
    // on how the replayed pages line up with the backup image, that
    // either resurrects the post-backup writes ("ghosts") or corrupts
    // the file outright ("database disk image is malformed") — with
    // this schema it corrupts. Either way the restore is destroyed;
    // the ONLY acceptable outcome for a correct restore would be a
    // clean db holding exactly the 10 'keep' rows, and that never
    // happens with the WAL left behind.
    let outcome: string
    try {
      const reopened = new Store(dbPath)
      const titles = reopened.allItems().map((i) => i.title)
      reopened.close()
      const ghosts = titles.filter((t) => t.startsWith('ghost')).length
      outcome =
        ghosts > 0
          ? 'wal-replayed-ghosts'
          : titles.length === 10
            ? 'clean-backup-state'
            : 'other-damage'
    } catch {
      outcome = 'corrupted'
    }
    expect(['wal-replayed-ghosts', 'corrupted', 'other-damage']).toContain(outcome)
    expect(outcome).not.toBe('clean-backup-state')
  })
})

// ─────────────────────────────────────────────────────────────────────
// 2. Backup taken mid-use
// ─────────────────────────────────────────────────────────────────────

describe('backup taken mid-use', () => {
  it('store.db.backup() with interleaved writes produces a clean, consistent point-in-time file', async () => {
    const dir = fresh()
    const store = new Store(join(dir, 'live.sqlite3'))
    const project = store.createProject('Busy', '#20c997')

    // Bulky rows so the online backup spans several event-loop ticks.
    for (let i = 0; i < 1500; i++) {
      store.createItem({
        kind: 'task',
        title: `steady ${i}`,
        content: 'body '.repeat(120),
        status: 'active',
        projectId: project.id
      })
    }
    const all = store.allItems()
    for (let i = 1; i < 100; i++) store.linkItems(all[i].id, all[0].id, 'subtask-of')

    const preCount = store.allItems().length
    const backupPath = join(dir, 'mid-use.sqlite3')

    // Kick off the backup, then keep writing while it's in flight —
    // exactly what "Create Backup" during active use looks like.
    let done = false
    const backupPromise = store.db.backup(backupPath).then(() => {
      done = true
    })
    let interleaved = 0
    while (!done && interleaved < 400) {
      store.createItem({
        kind: 'note',
        title: `mid-flight ${interleaved}`,
        content: 'written during backup',
        projectId: project.id
      })
      interleaved++
      await new Promise((r) => setImmediate(r))
    }
    await backupPromise
    const finalCount = store.allItems().length
    store.close()

    // The backup file must open clean…
    expect(integrityOk(backupPath)).toBe('ok')

    const bk = new DatabaseConstructor(backupPath, { readonly: true })
    // …hold a consistent point-in-time row count (somewhere between the
    // count when the backup started and when it finished)…
    const n = (bk.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n
    expect(n).toBeGreaterThanOrEqual(preCount)
    expect(n).toBeLessThanOrEqual(finalCount)
    // …with referential integrity intact…
    expect(bk.pragma('foreign_key_check')).toEqual([])
    // …and the FTS index exactly in step with the items table (no torn
    // shadow tables from the interleaved writes).
    const ftsN = (bk.prepare('SELECT COUNT(*) AS n FROM items_fts').get() as { n: number }).n
    expect(ftsN).toBe(n)
    bk.close()

    // And it restores + reopens through the real path without drama.
    const targetPath = join(dir, 'target.sqlite3')
    replaceDatabase(targetPath, backupPath)
    const restored = new Store(targetPath)
    expect(restored.allItems().length).toBe(n)
    expect(restored.search('steady').length).toBeGreaterThan(0)
    restored.close()
  })
})

// ─────────────────────────────────────────────────────────────────────
// 3. FTS index and triggers after restore
// ─────────────────────────────────────────────────────────────────────

describe('full-text search across backup → restore', () => {
  it('search results (incl. unicode) are identical after restore, triggers still index new/updated items, and the FTS shadow tables verify clean', async () => {
    const dir = fresh()
    const store = new Store(join(dir, 'live.sqlite3'))

    store.createItem({ kind: 'note', title: 'café résumé notes', content: 'a naïve piñata' })
    store.createItem({ kind: 'note', title: '中文笔记', content: '日本語のメモ 한국어 메모' })
    store.createItem({ kind: 'note', title: 'עברית שלום', content: 'والعربية أهلاً' })
    store.createItem({ kind: 'task', title: 'rocket 🚀 launch plan', content: 'emoji body ✅' })
    store.createItem({ kind: 'task', title: 'meeting agenda draft', content: 'quarterly review' })
    store.createItem({ kind: 'page', title: 'design doc', content: 'plain mirror text café', richContent: '<h1>rich</h1>' })
    // A dropped item — search must keep excluding it after restore.
    const dropped = store.createItem({ kind: 'note', title: 'café dropped secret', content: '' })
    store.updateItem(dropped.id, { status: 'dropped' })

    const QUERIES = ['café', 'cafe', 'résumé', '中文', '日本', '한국', 'עברית', 'والعربية', 'rocket', 'mee', 'quarterly rev']
    const before = new Map(QUERIES.map((q) => [q, store.search(q).map((i) => [i.id, i.title])]))
    // Sanity: the fixture actually hits (diacritic-folded 'cafe' too).
    expect(before.get('café')!.length).toBeGreaterThan(0)
    expect(before.get('cafe')!.length).toBe(before.get('café')!.length)
    expect(before.get('中文')!.length).toBe(1)
    expect(before.get('mee')!.length).toBeGreaterThan(0) // prefix search

    const backupPath = join(dir, 'backup.sqlite3')
    await store.db.backup(backupPath)
    store.close()

    // Restore over a DIFFERENT existing database (the app's real shape:
    // dbPath already exists with other content).
    const other = new Store(join(dir, 'target.sqlite3'))
    other.createItem({ kind: 'task', title: 'café imposter — must vanish' })
    const targetPath = other.path
    other.close()
    replaceDatabase(targetPath, backupPath)

    const restored = new Store(targetPath)
    // Identical results for every query, including the dropped-item filter.
    for (const q of QUERIES) {
      expect(restored.search(q).map((i) => [i.id, i.title]), `query "${q}"`).toEqual(before.get(q))
    }
    expect(restored.search('imposter')).toEqual([])
    expect(restored.search('dropped secret')).toEqual([])

    // The FTS shadow tables themselves verify against the content table.
    expect(() =>
      restored.db.prepare(`INSERT INTO items_fts(items_fts, rank) VALUES ('integrity-check', 1)`).run()
    ).not.toThrow()

    // Triggers survived the file swap: INSERT…
    restored.createItem({ kind: 'note', title: 'freshly added xylophone', content: 'post-restore body' })
    expect(restored.search('xylophone').map((i) => i.title)).toEqual(['freshly added xylophone'])
    // …UPDATE (delete+reinsert against restored shadow tables — proves
    // rowid alignment survived the copy)…
    const target = restored.search('rocket')[0]
    restored.updateItem(target.id, { title: 'rocket renamed zeppelin' })
    expect(restored.search('zeppelin').map((i) => i.id)).toEqual([target.id])
    expect(restored.search('emoji').map((i) => i.id)).toEqual([target.id]) // content still indexed
    // …and DELETE.
    restored.deleteItem(target.id)
    expect(restored.search('zeppelin')).toEqual([])
    expect(() =>
      restored.db.prepare(`INSERT INTO items_fts(items_fts, rank) VALUES ('integrity-check', 1)`).run()
    ).not.toThrow()
    restored.close()
  })
})

// ─────────────────────────────────────────────────────────────────────
// 4. user_version / migrations across restore
// ─────────────────────────────────────────────────────────────────────

/**
 * Schema as it was at migration 2 (verbatim from
 * src/main/store/migrations.ts, MIGRATIONS[0] + MIGRATIONS[1]) — an old
 * backup file from an early app version. Kept literal here on purpose:
 * this is what those bytes on disk actually look like, whatever the
 * current migrations array evolves into.
 */
const OLD_SCHEMA_V2 = `
  CREATE TABLE projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','archived')),
    created_at  TEXT NOT NULL
  );
  CREATE TABLE items (
    id                    TEXT PRIMARY KEY,
    kind                  TEXT NOT NULL
                          CHECK (kind IN ('task','note','journal','prep')),
    title                 TEXT NOT NULL DEFAULT '',
    content               TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL DEFAULT 'inbox'
                          CHECK (status IN ('inbox','active','done','dropped')),
    project_id            TEXT REFERENCES projects(id) ON DELETE SET NULL,
    due_date              TEXT,
    scheduled_date        TEXT,
    scheduled_time        TEXT,
    time_estimate_minutes INTEGER,
    sort_order            REAL NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL,
    completed_at          TEXT
  );
  CREATE INDEX idx_items_status    ON items(status);
  CREATE INDEX idx_items_project   ON items(project_id);
  CREATE INDEX idx_items_scheduled ON items(scheduled_date);
  CREATE TABLE links (
    id            TEXT PRIMARY KEY,
    from_item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    to_item_id    TEXT REFERENCES items(id) ON DELETE CASCADE,
    to_event_key  TEXT,
    role          TEXT NOT NULL
                  CHECK (role IN ('prep-for','notes-for','follow-up-from','related')),
    event_title   TEXT,
    event_date    TEXT,
    created_at    TEXT NOT NULL,
    CHECK ((to_item_id IS NULL) <> (to_event_key IS NULL))
  );
  CREATE INDEX idx_links_from  ON links(from_item_id);
  CREATE INDEX idx_links_event ON links(to_event_key);
  CREATE TABLE meetings (
    event_key  TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    title      TEXT NOT NULL,
    date       TEXT NOT NULL
  );
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE items_fts USING fts5(
    title, content,
    content='items', content_rowid='rowid'
  );
  CREATE TRIGGER items_fts_insert AFTER INSERT ON items BEGIN
    INSERT INTO items_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
  END;
  CREATE TRIGGER items_fts_delete AFTER DELETE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
  END;
  CREATE TRIGGER items_fts_update AFTER UPDATE ON items BEGIN
    INSERT INTO items_fts(items_fts, rowid, title, content)
    VALUES ('delete', old.rowid, old.title, old.content);
    INSERT INTO items_fts(rowid, title, content)
    VALUES (new.rowid, new.title, new.content);
  END;
  INSERT INTO items_fts(rowid, title, content)
  SELECT rowid, title, content FROM items;
`

describe('user_version and migrations across restore', () => {
  it('restoring a current-schema backup does not re-run or break migrations (user_version and schema unchanged)', async () => {
    const dir = fresh()
    const store = new Store(join(dir, 'live.sqlite3'))
    store.createItem({ kind: 'task', title: 'schema stability probe' })
    const backupPath = join(dir, 'backup.sqlite3')
    await store.db.backup(backupPath)
    const liveVersion = store.db.pragma('user_version', { simple: true }) as number
    store.close()

    const backupSchema = schemaOf(backupPath)
    const targetPath = join(dir, 'target.sqlite3')
    replaceDatabase(targetPath, backupPath)

    // Reopen exactly as the app does — migrate() must be a no-op.
    const restored = new Store(targetPath)
    expect(restored.db.pragma('user_version', { simple: true })).toBe(liveVersion)
    expect(restored.allItems().map((i) => i.title)).toEqual(['schema stability probe'])
    restored.close()
    expect(schemaOf(targetPath)).toEqual(backupSchema)
  })

  it('restoring an OLDER-schema backup (user_version=2) migrates it forward losslessly on reopen', () => {
    const dir = fresh()

    // Build the old backup file byte-for-byte like an early version
    // would have left it: schema v2, real rows, user_version=2.
    const oldPath = join(dir, 'old-backup.sqlite3')
    const old = new DatabaseConstructor(oldPath)
    old.pragma('journal_mode = WAL')
    old.exec(OLD_SCHEMA_V2)
    old.exec(`
      INSERT INTO projects (id, name, color, status, created_at) VALUES
        ('p-beta',  'Beta',  '#e64980', 'active',   '2025-01-01 09:00:00'),
        ('p-alpha', 'Alpha', '#845ef7', 'archived', '2025-01-02 09:00:00');
      INSERT INTO items (id, kind, title, content, status, project_id, due_date,
        scheduled_date, scheduled_time, time_estimate_minutes, sort_order, created_at, completed_at)
      VALUES
        ('i-1', 'task', 'old full task', 'körper contents', 'active', 'p-beta',
         '2025-02-01', '2025-01-15', '09:30', 45, 3.5, '2025-01-03 10:00:00', NULL),
        ('i-2', 'note', 'old ünicode note', '中文正文 searchable', 'inbox', NULL,
         NULL, NULL, NULL, NULL, 0, '2025-01-04 11:00:00', NULL),
        ('i-3', 'task', 'old done task', '', 'done', 'p-alpha',
         NULL, NULL, NULL, NULL, 1, '2025-01-05 12:00:00', '2025-01-06 13:00:00');
      INSERT INTO links (id, from_item_id, to_item_id, to_event_key, role, event_title, event_date, created_at)
      VALUES
        ('l-1', 'i-1', 'i-3', NULL, 'related', NULL, NULL, '2025-01-07 08:00:00'),
        ('l-2', 'i-2', NULL, 'evt-9::2025-01-20', 'prep-for', 'Old Meeting', '2025-01-20', '2025-01-07 09:00:00');
      INSERT INTO meetings (event_key, project_id, title, date)
      VALUES ('evt-9::2025-01-20', 'p-beta', 'Old Meeting', '2025-01-20');
      INSERT INTO settings (key, value) VALUES ('theme', '"plum"'), ('timelineBounds', '{"start":7,"end":21}');
    `)
    old.pragma('user_version = 2')
    old.close()

    // The real restore path into an existing, fully-migrated live db.
    const live = new Store(join(dir, 'live.sqlite3'))
    live.createItem({ kind: 'task', title: 'current data to be replaced' })
    const dbPath = live.path
    live.close()
    replaceDatabase(dbPath, oldPath)

    // Reopen as the app would — migrations 3..N must run, losslessly.
    const restored = new Store(dbPath)
    const version = restored.db.pragma('user_version', { simple: true }) as number
    expect(version).toBeGreaterThanOrEqual(13)

    // Every old row, every old column value, byte-for-byte.
    const i1 = restored.getItem('i-1')!
    expect(i1).toMatchObject({
      kind: 'task',
      title: 'old full task',
      content: 'körper contents',
      status: 'active',
      projectId: 'p-beta',
      dueDate: '2025-02-01',
      scheduledDate: '2025-01-15',
      scheduledTime: '09:30',
      timeEstimateMinutes: 45,
      sortOrder: 3.5,
      createdAt: '2025-01-03 10:00:00',
      completedAt: null
    })
    // New columns take their migration-defined values.
    expect(i1.starred).toBe(false) // migration 4 default
    expect(i1.richContent).toBeNull() // migration 3
    expect(i1.sectionId).toBeNull() // migration 12
    expect(i1.updatedAt).toBe(i1.createdAt) // migration 10 backfill
    expect(restored.getItem('i-3')!.completedAt).toBe('2025-01-06 13:00:00')

    const links = restored.allLinks()
    expect(links.map((l) => l.id).sort()).toEqual(['l-1', 'l-2'])
    expect(links.find((l) => l.id === 'l-2')).toMatchObject({
      toEventKey: 'evt-9::2025-01-20',
      role: 'prep-for',
      eventTitle: 'Old Meeting',
      eventDate: '2025-01-20'
    })
    expect(restored.getMeeting('evt-9::2025-01-20')).toMatchObject({ projectId: 'p-beta' })
    expect(restored.getSetting('theme')).toBe('plum')
    expect(restored.getSetting('timelineBounds')).toEqual({ start: 7, end: 21 })

    // Migration 8 seeds project sort_order alphabetically.
    const projects = restored.listProjects(true)
    expect(projects.map((p) => p.name)).toEqual(['Alpha', 'Beta'])

    // FTS was rebuilt by migration 3 and its triggers recreated: old
    // content is searchable, and new post-migration writes index too.
    expect(restored.search('中文正文').map((i) => i.id)).toEqual(['i-2'])
    expect(restored.search('körper').map((i) => i.id)).toEqual(['i-1'])
    restored.createItem({ kind: 'task', title: 'brand new quokka' })
    expect(restored.search('quokka').length).toBe(1)

    // Post-migration schema features work on the migrated file: the
    // 'subtask-of' and 'blocked-by' roles (migrations 5 and 13),
    // sections (12), local events (6/7/9).
    expect(() => restored.linkItems('i-2', 'i-1', 'subtask-of')).not.toThrow()
    expect(() => restored.linkItems('i-1', 'i-3', 'blocked-by')).not.toThrow()
    const section = restored.createSection('p-beta', 'Migrated Section')
    restored.updateItem('i-1', { sectionId: section.id })
    expect(restored.getItem('i-1')!.sectionId).toBe(section.id)
    restored.createLocalEvent({
      title: 'block',
      date: '2026-08-11',
      startTime: '09:00',
      endTime: '10:00',
      projectId: 'p-beta',
      itemId: 'i-1'
    })
    expect(restored.localEventsFor('2026-08-11')).toHaveLength(1)
    expect(restored.db.pragma('foreign_key_check')).toEqual([])
    restored.close()
    expect(integrityOk(dbPath)).toBe('ok')
  })
})

// ─────────────────────────────────────────────────────────────────────
// 5. Double restore / restore-over-existing paths
// ─────────────────────────────────────────────────────────────────────

describe('repeated and edge-shaped restores', () => {
  it('double restore: A → B → A lands exactly on each backup with no residue', async () => {
    const dir = fresh()

    const a = new Store(join(dir, 'a.sqlite3'))
    a.createProject('Only in A', '#1c7ed6')
    a.createItem({ kind: 'task', title: 'alpha task' })
    const backupA = join(dir, 'backup-a.sqlite3')
    await a.db.backup(backupA)
    a.close()

    const b = new Store(join(dir, 'b.sqlite3'))
    b.createItem({ kind: 'note', title: 'bravo note' })
    b.setSetting('theme', 'bravo-theme')
    const backupB = join(dir, 'backup-b.sqlite3')
    await b.db.backup(backupB)
    b.close()

    const dbPath = join(dir, 'live.sqlite3')
    const live = new Store(dbPath)
    live.createItem({ kind: 'task', title: 'original live data' })
    live.close()

    replaceDatabase(dbPath, backupA)
    const r1 = new Store(dbPath)
    expect(r1.allItems().map((i) => i.title)).toEqual(['alpha task'])
    expect(r1.listProjects().map((p) => p.name)).toEqual(['Only in A'])
    r1.close()

    replaceDatabase(dbPath, backupB)
    const r2 = new Store(dbPath)
    expect(r2.allItems().map((i) => i.title)).toEqual(['bravo note'])
    expect(r2.listProjects()).toEqual([]) // A's project fully gone
    expect(r2.getSetting('theme')).toBe('bravo-theme')
    r2.close()

    replaceDatabase(dbPath, backupA)
    const r3 = new Store(dbPath)
    expect(r3.allItems().map((i) => i.title)).toEqual(['alpha task'])
    expect(r3.getSetting('theme')).toBeNull()
    r3.close()
    expect(dumpAll(dbPath)).toEqual(dumpAll(backupA))
  })

  it('restoring a small backup over a much larger live db truncates cleanly (no trailing pages)', async () => {
    const dir = fresh()

    const small = new Store(join(dir, 'small.sqlite3'))
    small.createItem({ kind: 'task', title: 'tiny' })
    const backupPath = join(dir, 'small-backup.sqlite3')
    await small.db.backup(backupPath)
    small.close()

    const dbPath = join(dir, 'live.sqlite3')
    const big = new Store(dbPath)
    for (let i = 0; i < 800; i++) {
      big.createItem({ kind: 'note', title: `bulk ${i}`, content: 'z'.repeat(1000) })
    }
    big.db.pragma('wal_checkpoint(TRUNCATE)')
    big.close()
    expect(statSync(dbPath).size).toBeGreaterThan(statSync(backupPath).size)

    replaceDatabase(dbPath, backupPath)
    expect(statSync(dbPath).size).toBe(statSync(backupPath).size) // full truncation
    expect(integrityOk(dbPath)).toBe('ok')
    const restored = new Store(dbPath)
    expect(restored.allItems().map((i) => i.title)).toEqual(['tiny'])
    restored.close()
  })

  it('restoring into a path with no existing database works (fresh install shape)', async () => {
    const dir = fresh()
    const src = new Store(join(dir, 'src.sqlite3'))
    src.createItem({ kind: 'task', title: 'carried over' })
    const backupPath = join(dir, 'backup.sqlite3')
    await src.db.backup(backupPath)
    src.close()

    const dbPath = join(dir, 'brand-new.sqlite3')
    expect(existsSync(dbPath)).toBe(false)
    replaceDatabase(dbPath, backupPath)
    const restored = new Store(dbPath)
    expect(restored.allItems().map((i) => i.title)).toEqual(['carried over'])
    restored.close()
  })
})

// ─────────────────────────────────────────────────────────────────────
// 6. Validation and the pre-restore safety copy
// ─────────────────────────────────────────────────────────────────────

describe('restore validation: invalid files are refused, valid restores keep a safety copy', () => {
  /**
   * replaceDatabase now runs isHealthyDatabase (read-only open +
   * PRAGMA quick_check) on the source BEFORE touching anything, and —
   * when a live db exists — copies it to `<db>.pre-restore` before
   * installing the source. These tests pin both halves of that fix.
   */
  it('a non-SQLite "backup" is refused: replaceDatabase throws and the live db is untouched, byte for byte', () => {
    const dir = fresh()
    const dbPath = join(dir, 'live.sqlite3')
    const live = new Store(dbPath)
    for (let i = 0; i < 20; i++) live.createItem({ kind: 'task', title: `precious ${i}` })
    live.close()
    const liveBytes = readFileSync(dbPath)

    const fakeBackup = join(dir, 'renamed-word-doc.sqlite3')
    writeFileSync(fakeBackup, 'This was never a SQLite database.')

    // Plant fake sidecars: a refused restore must not clean them up
    // either — nothing at all should happen before validation passes.
    writeFileSync(`${dbPath}-wal`, 'stale wal bytes')
    writeFileSync(`${dbPath}-shm`, 'stale shm bytes')

    expect(() => replaceDatabase(dbPath, fakeBackup)).toThrow(/not a healthy SQLite database/i)

    // The live db is byte-identical, the sidecars were not removed
    // prematurely, and no .pre-restore (or any other) file appeared.
    expect(readFileSync(dbPath).equals(liveBytes)).toBe(true)
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    expect(existsSync(`${dbPath}-shm`)).toBe(true)
    expect(readdirSync(dir).sort()).toEqual([
      'live.sqlite3',
      'live.sqlite3-shm',
      'live.sqlite3-wal',
      'renamed-word-doc.sqlite3'
    ])

    // And the app reopens onto the intact data (drop the fake sidecars
    // first — they were only planted to prove replaceDatabase left them).
    rmSync(`${dbPath}-wal`)
    rmSync(`${dbPath}-shm`)
    const reopened = new Store(dbPath)
    expect(reopened.allItems()).toHaveLength(20)
    reopened.close()
  })

  /**
   * Sharper edge: a TRUNCATED copy of a real backup (half a file — what
   * an interrupted download/copy produces). It has a valid SQLite
   * header, so only a real integrity gate (quick_check) catches it.
   */
  it('a truncated real backup is refused too, leaving the live db intact', async () => {
    const dir = fresh()
    const src = new Store(join(dir, 'src.sqlite3'))
    for (let i = 0; i < 500; i++) src.createItem({ kind: 'task', title: `row ${i}`, content: 'c'.repeat(500) })
    const goodBackup = join(dir, 'good.sqlite3')
    await src.db.backup(goodBackup)
    src.close()

    // Truncate to half — an interrupted copy.
    const whole = statSync(goodBackup).size
    const truncated = join(dir, 'truncated.sqlite3')
    writeFileSync(truncated, readFileSync(goodBackup).subarray(0, Math.floor(whole / 2)))

    const dbPath = join(dir, 'live.sqlite3')
    const live = new Store(dbPath)
    live.createItem({ kind: 'task', title: 'precious current data' })
    live.close()
    const liveBytes = readFileSync(dbPath)

    expect(() => replaceDatabase(dbPath, truncated)).toThrow(/not a healthy SQLite database/i)

    // Live db untouched and still fully healthy; no safety copy was
    // made because nothing was ever at risk.
    expect(readFileSync(dbPath).equals(liveBytes)).toBe(true)
    expect(existsSync(`${dbPath}.pre-restore`)).toBe(false)
    expect(integrityOk(dbPath)).toBe('ok')
    const reopened = new Store(dbPath)
    expect(reopened.allItems().map((i) => i.title)).toEqual(['precious current data'])
    reopened.close()
  })

  it('a successful restore keeps the outgoing db as <db>.pre-restore, byte-identical to the pre-restore live file', async () => {
    const dir = fresh()
    const src = new Store(join(dir, 'src.sqlite3'))
    src.createItem({ kind: 'task', title: 'from the backup' })
    const backupPath = join(dir, 'backup.sqlite3')
    await src.db.backup(backupPath)
    src.close()

    const dbPath = join(dir, 'live.sqlite3')
    const live = new Store(dbPath)
    live.createItem({ kind: 'note', title: 'about to be replaced — but recoverable' })
    live.close()
    const preRestoreBytes = readFileSync(dbPath)

    replaceDatabase(dbPath, backupPath)

    // The restore itself landed…
    const restored = new Store(dbPath)
    expect(restored.allItems().map((i) => i.title)).toEqual(['from the backup'])
    restored.close()

    // …and the outgoing db sits beside it, byte for byte, so a
    // regretted restore is one file-copy away from undone.
    const safetyPath = `${dbPath}.pre-restore`
    expect(existsSync(safetyPath)).toBe(true)
    expect(readFileSync(safetyPath).equals(preRestoreBytes)).toBe(true)
    const recovered = new DatabaseConstructor(safetyPath, { readonly: true })
    const titles = recovered.prepare('SELECT title FROM items ORDER BY id').all() as Array<{ title: string }>
    recovered.close()
    expect(titles.map((t) => t.title)).toEqual(['about to be replaced — but recoverable'])
  })
})
