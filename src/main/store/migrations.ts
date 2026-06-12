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
  `
]

export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}
