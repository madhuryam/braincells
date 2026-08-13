import { describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseConstructor from 'better-sqlite3'
import { Store } from '../../store'
import { buildExport } from '../export'
import { replaceDatabase } from '../restore'

/**
 * End-to-end backup → restore fidelity audit over a COPY of the user's
 * REAL database (a snapshot taken 2026-08-11; 79 items, 3 projects,
 * 3 sections, 31 links, 186 meetings, 2 timeblocks, 13 settings).
 *
 * Exercises the exact code paths the app uses:
 *   Create Backup  = store.db.backup(path)
 *   Restore        = replaceDatabase(dbPath, backupPath) then new Store(dbPath)
 *
 * SAFETY: the snapshot file is only ever READ (copyFileSync source);
 * every database that gets opened lives in a fresh temp dir. The live
 * database under Application Support is never touched.
 */

const SNAPSHOT = '/Users/mmahajan/Documents/braincells-audit-backup-2026-08-11/braincells-snapshot.sqlite3'

/** Copy the snapshot (and any non-empty WAL sidecar) into a fresh temp dir. */
function copySnapshot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'braincells-realdata-audit-'))
  const copy = join(dir, 'realdata.sqlite3')
  copyFileSync(SNAPSHOT, copy)
  // The snapshot's WAL is empty (checkpointed), so the main file alone is
  // the complete database — but copy a non-empty WAL along if one ever
  // exists, so the copy stays faithful.
  for (const suffix of ['-wal', '-shm']) {
    const side = SNAPSHOT + suffix
    if (existsSync(side) && statSync(side).size > 0) copyFileSync(side, copy + suffix)
  }
  return copy
}

/**
 * Every user table, discovered dynamically from sqlite_master so a new
 * table can never silently escape the audit. Virtual tables (FTS) and
 * their shadow tables are excluded: FTS content is derived from items
 * and is verified functionally via search() instead.
 */
function userTables(db: InstanceType<typeof DatabaseConstructor>): string[] {
  const rows = db
    .prepare(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all() as Array<{ name: string; sql: string | null }>
  const virtual = rows.filter((r) => /CREATE VIRTUAL TABLE/i.test(r.sql ?? '')).map((r) => r.name)
  return rows
    .map((r) => r.name)
    .filter((n) => !virtual.includes(n) && !virtual.some((v) => n.startsWith(v + '_')))
}

/** Dump every user table's rows, sorted deterministically by full-row JSON. */
function dumpAll(dbPath: string): Record<string, string[]> {
  const db = new DatabaseConstructor(dbPath, { readonly: true })
  const out: Record<string, string[]> = {}
  for (const t of userTables(db)) {
    const rows = db.prepare(`SELECT * FROM ${t}`).all() as Record<string, unknown>[]
    out[t] = rows.map((r) => JSON.stringify(r)).sort()
  }
  db.close()
  return out
}

/** All dates the snapshot could plausibly have local events on (broad range). */
function datesAugust2026(): string[] {
  return Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
}

describe.runIf(existsSync(SNAPSHOT))('real-data backup → restore audit', () => {
  it('opening the snapshot copy migrates it forward without touching any user value', () => {
    const copy = copySnapshot()

    // Raw look before the app touches it.
    const raw = new DatabaseConstructor(copy, { readonly: true })
    const versionBefore = raw.pragma('user_version', { simple: true }) as number
    raw.close()
    const before = dumpAll(copy)

    // The snapshot must contain every table the app knows about.
    expect(Object.keys(before).sort()).toEqual(
      ['items', 'links', 'local_events', 'meetings', 'projects', 'sections', 'settings'].sort()
    )

    // Open exactly as the app does (runs migrate()), then close — close
    // checkpoints the WAL back into the main file.
    const store = new Store(copy)
    const versionAfter = store.db.pragma('user_version', { simple: true }) as number
    expect(store.allItems().length).toBe(79)
    store.close()

    // The snapshot predates migrations 14 (sections.status), 15
    // (meetings.links) and 16 (items.links). Opening it migrates
    // forward; the only permitted changes are those new defaulted
    // columns — every pre-existing value must survive.
    expect(versionBefore).toBe(13)
    expect(versionAfter).toBe(16)
    const after = dumpAll(copy)
    for (const table of Object.keys(before)) {
      if (table === 'sections' || table === 'meetings' || table === 'items') continue
      expect(after[table]).toEqual(before[table])
    }
    // dumpAll rows are JSON strings — re-add the defaulted column to
    // each pre-migration row and the sets must match exactly.
    expect(after.sections.map((row) => JSON.parse(row))).toEqual(
      before.sections.map((row) => ({ ...JSON.parse(row), status: 'active' }))
    )
    expect(after.meetings.map((row) => JSON.parse(row))).toEqual(
      before.meetings.map((row) => ({ ...JSON.parse(row), links: '[]' }))
    )
    expect(after.items.map((row) => JSON.parse(row))).toEqual(
      before.items.map((row) => ({ ...JSON.parse(row), links: '[]' }))
    )
  })

  it('full app-path round-trip: backup → replaceDatabase → new Store keeps every user table byte-identical', async () => {
    const copy = copySnapshot()
    const dir = mkdtempSync(join(tmpdir(), 'braincells-realdata-restore-'))
    const backupPath = join(dir, 'backup.sqlite3')
    const freshPath = join(dir, 'fresh.sqlite3')

    // 1. Open the real data and capture the pre-backup truth, both as
    //    raw rows and through the Store API the screens use.
    const source = new Store(copy)
    const beforeItems = source.allItems()
    const beforeLinks = source.allLinks()
    const beforeLocalEvents = datesAugust2026().flatMap((d) => source.localEventsFor(d))
    const beforeSearch = source.search('python')
    expect(beforeItems.length).toBe(79)
    expect(beforeLocalEvents.length).toBeGreaterThan(0)
    expect(beforeSearch.length).toBeGreaterThan(0)

    // 2. Create Backup — the real code path.
    await source.db.backup(backupPath)
    source.close()
    const beforeSnap = dumpAll(copy)

    // 3. Restore — the real code path: a different "live" DB (with junk
    //    in it and a live WAL) gets replaced, then the app reopens it.
    const decoy = new Store(freshPath)
    decoy.createItem({ kind: 'task', title: 'decoy task that must vanish on restore' })
    decoy.setSetting('theme', 'decoy-theme')
    decoy.close()
    replaceDatabase(freshPath, backupPath)

    const restored = new Store(freshPath)

    // 4. Restored file is healthy and complete.
    expect(restored.db.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(restored.allItems().length).toBe(79)

    // 5. Store API spot checks agree exactly with the pre-backup values.
    expect(restored.allItems()).toEqual(beforeItems)
    expect(restored.allLinks()).toEqual(beforeLinks)
    expect(datesAugust2026().flatMap((d) => restored.localEventsFor(d))).toEqual(beforeLocalEvents)
    expect(restored.search('python')).toEqual(beforeSearch)
    expect(restored.search('decoy')).toEqual([]) // the decoy DB is fully gone
    expect(restored.getSetting('theme')).not.toBe('decoy-theme')

    // 6. Byte-for-byte: every user table identical (tables enumerated
    //    dynamically so a future table can't dodge the audit).
    restored.db.pragma('wal_checkpoint(TRUNCATE)')
    restored.close()
    const afterSnap = dumpAll(freshPath)
    expect(Object.keys(afterSnap).sort()).toEqual(Object.keys(beforeSnap).sort())
    for (const t of Object.keys(beforeSnap)) {
      expect(afterSnap[t], `table ${t} row count`).toHaveLength(beforeSnap[t].length)
      expect(afterSnap[t], `table ${t} contents`).toEqual(beforeSnap[t])
    }
  })

  it('buildExport() runs clean over the real data: one .md per item, .html for every rich page', () => {
    const store = new Store(copySnapshot())

    const files = buildExport(store) // must not throw on real titles (emoji, unicode, em-dashes)
    const paths = files.map((f) => f.path)

    // One markdown file per item — real titles include '💭 …' and
    // 'Journal — 2026-08-04'; the slug/collision guard must hold.
    const mdFiles = paths.filter((p) => p.endsWith('.md'))
    expect(mdFiles.length).toBe(store.allItems().length)
    expect(new Set(paths).size).toBe(paths.length) // no path collisions

    // Every item with rich content also exports its .html sibling.
    const richCount = store
      .allItems()
      .filter((i) => i.richContent !== null && i.richContent !== undefined).length
    expect(paths.filter((p) => p.endsWith('.html')).length).toBe(richCount)
    expect(richCount).toBeGreaterThan(0)

    // Structure files are present and parse.
    const structureFiles = [
      'manifest.json',
      'projects.json',
      'links.json',
      'meetings.json',
      'sections.json',
      'timeblocks.json',
      'settings.json'
    ]
    for (const name of structureFiles) {
      const f = files.find((x) => x.path === name)
      expect(f, name).toBeDefined()
      expect(() => JSON.parse(f!.contents)).not.toThrow()
    }

    // Total file count: 7 structure JSON files + one .md per item + one
    // .html per rich item.
    expect(files.length).toBe(structureFiles.length + store.allItems().length + richCount)

    // Manifest counts everything, settings minus the excluded credential keys.
    const exportedSettingsCount = Object.keys(
      JSON.parse(files.find((f) => f.path === 'settings.json')!.contents)
    ).length
    const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.contents)
    expect(manifest.counts).toEqual({
      projects: 3,
      items: 79,
      links: 31,
      meetings: 186,
      sections: 3,
      timeblocks: 2,
      settings: exportedSettingsCount
    })

    store.close()
  })

  it('export carries the real sections, timeblocks and settings (credentials excluded) plus full item front matter', () => {
    const store = new Store(copySnapshot())

    // The real data this export must carry.
    const sectionCount = (store.db.prepare('SELECT COUNT(*) AS n FROM sections').get() as { n: number }).n
    const localEventCount = (
      store.db.prepare('SELECT COUNT(*) AS n FROM local_events').get() as { n: number }
    ).n
    const settingsCount = (store.db.prepare('SELECT COUNT(*) AS n FROM settings').get() as { n: number }).n
    expect(sectionCount).toBe(3)
    expect(localEventCount).toBe(2)
    expect(settingsCount).toBe(13)

    const files = buildExport(store)
    const byPath = new Map(files.map((f) => [f.path, f.contents]))

    // 1. sections.json holds all 3 real sections, names intact.
    const sections = JSON.parse(byPath.get('sections.json')!) as Array<{ id: string; name: string }>
    const sectionNames = (store.db.prepare('SELECT name FROM sections').all() as { name: string }[]).map(
      (r) => r.name
    )
    expect(sections).toHaveLength(3)
    expect(sections.map((s) => s.name).sort()).toEqual([...sectionNames].sort())

    // …and every item filed into a section names it in its front matter.
    const sectionNameById = new Map(sections.map((s) => [s.id, s.name]))
    const mdFor = (itemId: string): string => {
      const f = files.find((x) => x.path.endsWith('.md') && x.contents.includes(`id: ${itemId}\n`))
      expect(f, `md file for item ${itemId}`).toBeDefined()
      return f!.contents
    }
    const filed = store.allItems().filter((i) => i.sectionId != null)
    expect(filed.length).toBeGreaterThan(0)
    for (const item of filed) {
      expect(mdFor(item.id)).toContain(`section: ${sectionNameById.get(item.sectionId!)}`)
    }

    // 2. timeblocks.json holds both drawn timeblocks, exactly as the store sees them.
    const timeblocks = JSON.parse(byPath.get('timeblocks.json')!)
    expect(timeblocks).toHaveLength(2)
    expect(timeblocks).toEqual(store.allLocalEvents())

    // 3. settings.json holds every real setting EXCEPT the credential keys.
    const settings = JSON.parse(byPath.get('settings.json')!) as Record<string, unknown>
    const allSettingKeys = (store.db.prepare('SELECT key FROM settings').all() as { key: string }[]).map(
      (r) => r.key
    )
    const expectedKeys = allSettingKeys.filter((k) => k !== 'googleTokens' && k !== 'googleClient')
    expect(Object.keys(settings).sort()).toEqual([...expectedKeys].sort())
    expect(Object.keys(settings)).not.toContain('googleTokens')
    expect(Object.keys(settings)).not.toContain('googleClient')

    // …and the manifest counts agree with what actually got written.
    const manifest = JSON.parse(byPath.get('manifest.json')!)
    expect(manifest.counts.sections).toBe(3)
    expect(manifest.counts.timeblocks).toBe(2)
    expect(manifest.counts.settings).toBe(expectedKeys.length)

    // 4. Per-item flags/scheduling detail is in the front matter for every
    //    real item that has it (front matter only writes non-null fields).
    for (const item of store.allItems()) {
      const md = mdFor(item.id)
      if (item.updatedAt != null) expect(md).toContain(`updated: ${item.updatedAt}`)
      if (item.scheduledTime != null) expect(md).toContain(`scheduledTime: ${item.scheduledTime}`)
      if (item.timeEstimateMinutes != null)
        expect(md).toContain(`estimateMinutes: ${item.timeEstimateMinutes}`)
      if (item.starred) expect(md).toContain('starred: true')
      if (item.sortOrder != null) expect(md).toContain(`sortOrder: ${item.sortOrder}`)
    }

    store.close()
  })
})
