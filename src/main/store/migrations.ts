import type { Database } from 'better-sqlite3'

// Plain-SQL migrations, applied in order. The database remembers how
// many it has run via SQLite's built-in `user_version` counter, so
// adding a new entry to this array is all a future schema change needs.
const MIGRATIONS: string[] = [
  // 1: the core model — projects, items, links, per-meeting metadata,
  // and a key/value settings table (theme, calendar config, tokens).
  `
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

  -- A link points from an item to either another item or a calendar
  -- event (exactly one). Calendar targets carry a title/date snapshot
  -- so notes survive event deletion (SPEC §3).
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

  -- App-side data about a calendar event (the event itself is never
  -- stored): currently just its optional project assignment.
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
  `,

  // 2: full-text search over titles and markdown content (SPEC §8).
  // An "external content" FTS5 table: the text lives only in items;
  // triggers keep the search index in step with every write.
  `
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

  -- Index whatever already exists.
  INSERT INTO items_fts(rowid, title, content)
  SELECT rowid, title, content FROM items;
  `,

  // 3: rich-text Pages. Two schema changes that SQLite can't ALTER in
  // place (the kind CHECK gains 'page', and rich_content is added), so
  // this follows the official table-rebuild recipe: new table, copy
  // rows (keeping rowids — FTS points at them), swap, recreate the
  // indexes and FTS triggers that dropped with the old table.
  // For pages, `content` holds a plain-text mirror (search/export) and
  // `rich_content` holds the editor's HTML.
  `
  CREATE TABLE items_new (
    id                    TEXT PRIMARY KEY,
    kind                  TEXT NOT NULL
                          CHECK (kind IN ('task','note','journal','prep','page')),
    title                 TEXT NOT NULL DEFAULT '',
    content               TEXT NOT NULL DEFAULT '',
    rich_content          TEXT,
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

  INSERT INTO items_new (rowid, id, kind, title, content, status, project_id,
    due_date, scheduled_date, scheduled_time, time_estimate_minutes,
    sort_order, created_at, completed_at)
  SELECT rowid, id, kind, title, content, status, project_id,
    due_date, scheduled_date, scheduled_time, time_estimate_minutes,
    sort_order, created_at, completed_at FROM items;

  DROP TABLE items;
  ALTER TABLE items_new RENAME TO items;

  CREATE INDEX idx_items_status    ON items(status);
  CREATE INDEX idx_items_project   ON items(project_id);
  CREATE INDEX idx_items_scheduled ON items(scheduled_date);

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

  INSERT INTO items_fts(items_fts) VALUES ('rebuild');
  `,

  // 4: starred items — quick-access favorites shown in the sidebar.
  `
  ALTER TABLE items ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
  `,

  // 5: subtasks. A subtask is an ordinary task item linked to its
  // parent with role 'subtask-of' — the Items+Links model at work.
  // The role lives in a CHECK constraint, which SQLite can't ALTER,
  // so links gets the same rebuild recipe items got in migration 3.
  `
  CREATE TABLE links_new (
    id            TEXT PRIMARY KEY,
    from_item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    to_item_id    TEXT REFERENCES items(id) ON DELETE CASCADE,
    to_event_key  TEXT,
    role          TEXT NOT NULL
                  CHECK (role IN ('prep-for','notes-for','follow-up-from','related','subtask-of')),
    event_title   TEXT,
    event_date    TEXT,
    created_at    TEXT NOT NULL,
    CHECK ((to_item_id IS NULL) <> (to_event_key IS NULL))
  );

  INSERT INTO links_new SELECT * FROM links;
  DROP TABLE links;
  ALTER TABLE links_new RENAME TO links;

  CREATE INDEX idx_links_from  ON links(from_item_id);
  CREATE INDEX idx_links_event ON links(to_event_key);
  `,

  // 6: timeblocking. Local calendar events drawn on the Today
  // timeline — purely local, never synced to any calendar provider.
  `
  CREATE TABLE local_events (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL DEFAULT '',
    date       TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time   TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_local_events_date ON local_events(date);
  `,

  // 7: project-assignable time blocks. Deleting a project just
  // unassigns its blocks (same SET NULL convention as items/meetings).
  `
  ALTER TABLE local_events ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
  `,

  // 8: user-orderable projects (drag to reorder in the sidebar). Seed
  // each project's order from the current alphabetical listing so the
  // sidebar doesn't reshuffle the first time this runs.
  `
  ALTER TABLE projects ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
  UPDATE projects SET sort_order = (
    SELECT COUNT(*) FROM projects p2 WHERE p2.name < projects.name
  );
  `,

  // 9: a time block can point back at the task it schedules, so one
  // task can appear as several blocks on the timeline. Deleting the
  // task takes its blocks with it (unlike projects' SET NULL — a block
  // for a task that no longer exists means nothing).
  `
  ALTER TABLE local_events ADD COLUMN item_id TEXT REFERENCES items(id) ON DELETE CASCADE;
  `,

  // 10: edit recency. Nullable — rows from before this migration fall
  // back to created_at, which is the honest answer for them anyway.
  `
  ALTER TABLE items ADD COLUMN updated_at TEXT;
  UPDATE items SET updated_at = created_at;
  `,

  // 11: project nicknames — an optional shorter label that card pills
  // display in place of the full name. NULL means "use the name".
  `
  ALTER TABLE projects ADD COLUMN nickname TEXT;
  `,

  // 12: sections — named, reorderable buckets inside one project that
  // tasks file into on the project page. Deleting a section unfiles
  // its tasks (SET NULL — the tasks survive); deleting a project takes
  // its sections with it (CASCADE — a section is meaningless without
  // its project).
  `
  CREATE TABLE sections (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_sections_project ON sections(project_id);

  ALTER TABLE items ADD COLUMN section_id TEXT REFERENCES sections(id) ON DELETE SET NULL;
  `,

  // 13: the 'blocked-by' link role — a task waiting on another task.
  // Same rebuild recipe as migration 5 (the role list lives in a CHECK
  // constraint, which SQLite can't ALTER).
  `
  CREATE TABLE links_new (
    id            TEXT PRIMARY KEY,
    from_item_id  TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    to_item_id    TEXT REFERENCES items(id) ON DELETE CASCADE,
    to_event_key  TEXT,
    role          TEXT NOT NULL
                  CHECK (role IN ('prep-for','notes-for','follow-up-from','related','subtask-of','blocked-by')),
    event_title   TEXT,
    event_date    TEXT,
    created_at    TEXT NOT NULL,
    CHECK ((to_item_id IS NULL) <> (to_event_key IS NULL))
  );

  INSERT INTO links_new SELECT * FROM links;
  DROP TABLE links;
  ALTER TABLE links_new RENAME TO links;

  CREATE INDEX idx_links_from  ON links(from_item_id);
  CREATE INDEX idx_links_event ON links(to_event_key);
  `
]

export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current >= MIGRATIONS.length) return
  // Table rebuilds (migration 3) drop a table other tables reference;
  // FK enforcement must be off while that happens. The Store turns it
  // back on right after migrating.
  db.pragma('foreign_keys = OFF')
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
