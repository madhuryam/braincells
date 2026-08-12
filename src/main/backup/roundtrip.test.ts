import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseConstructor from 'better-sqlite3'
import { Store } from '../store'
import { buildExport } from './export'
import { replaceDatabase } from './restore'

/**
 * A full backup → restore round-trip over high-volume, high-variety
 * data. Exercises the SAME code paths the app uses:
 *   - `store.db.backup(path)`  (Create Backup / auto-backup)
 *   - `replaceDatabase(...)`   (Restore from Backup)
 * then asserts every user table is byte-for-byte identical afterwards.
 *
 * The point is to catch any column or table that a backup might miss.
 * Because the backup copies the whole SQLite file, "capture" is total
 * by construction — this test is the proof, and a guard against future
 * regressions (e.g. a new table that some other export path forgets).
 */

// A tiny seeded PRNG so the (large) fixture is deterministic and any
// failure reproduces exactly.
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]

// Nasty strings that have bitten serializers before: unicode, emoji,
// RTL, quotes, newlines, markdown, HTML, SQL-ish payloads, zero-width.
const NASTY = [
  'plain title',
  'emoji 🧠✅🎉🗓️ and more 🚀',
  'quotes "double" \'single\' `back`',
  'newlines\nand\ttabs',
  'markdown **bold** _em_ `code` [link](http://x)',
  '<script>alert(1)</script> & <b>html</b>',
  "Robert'); DROP TABLE items;--",
  'ünîcödé ñ ç ß ø å  —  café résumé',
  'עברית والعربية 中文 日本語 한국어',
  'zero​width​joiners',
  '   leading/trailing spaces   ',
  ''
]

function seedEverything(store: Store): void {
  const r = rng(20260804)

  // ── Projects: active + archived, unicode names, varied colors ──────
  const projects = Array.from({ length: 40 }, (_, i) =>
    store.createProject(`Project ${i} ${pick(r, ['🚀', 'α', 'Ω', '✦', ''])}`.trim() + ` #${i}`, pick(r, ['#845ef7', '#e64980', '#20c997', '#f76707', '#1c7ed6']))
  )
  // Archive a third of them.
  for (const p of projects) if (r() < 0.33) store.updateProject(p.id, { status: 'archived' })

  // ── Sections: a few buckets on some projects ───────────────────────
  const sections = projects
    .filter(() => r() < 0.3)
    .map((p) => store.createSection(p.id, pick(r, NASTY)))

  const kinds = ['task', 'note', 'journal', 'prep', 'page'] as const
  const statuses = ['inbox', 'active', 'done', 'dropped'] as const

  // ── Items: 2000, spanning every kind/status and every nullable
  //    field in both its null and non-null form ───────────────────────
  const items = Array.from({ length: 2000 }, (_, i) => {
    const kind = pick(r, kinds)
    const hasProject = r() < 0.7
    const created = store.createItem({
      kind,
      title: pick(r, NASTY) + ` #${i}`,
      content: r() < 0.1 ? pick(r, NASTY).repeat(200) /* long */ : pick(r, NASTY),
      richContent: kind === 'page' ? `<h1>${pick(r, NASTY)}</h1><p>${pick(r, NASTY)}</p><ul><li>a</li><li>b</li></ul>` : null,
      status: pick(r, statuses),
      projectId: hasProject ? pick(r, projects).id : null,
      dueDate: r() < 0.4 ? '2026-08-10' : null,
      scheduledDate: r() < 0.5 ? '2026-08-04' : null,
      scheduledTime: r() < 0.3 ? pick(r, ['09:00', '14:30', '23:45']) : null,
      timeEstimateMinutes: r() < 0.3 ? pick(r, [15, 30, 90, 480]) : null
    })
    // Mutate a slice so starred / sortOrder / completedAt get exercised.
    if (r() < 0.2) store.updateItem(created.id, { starred: true })
    if (r() < 0.15 && sections.length > 0) {
      // File into a section of the item's own project (when it has one).
      const s = sections.find((sec) => sec.projectId === created.projectId)
      if (s) store.updateItem(created.id, { sectionId: s.id })
    }
    if (r() < 0.3) store.updateItem(created.id, { sortOrder: r() * 1000 })
    if (created.status === 'done' || r() < 0.15)
      store.updateItem(created.id, { status: 'done' }) // sets completedAt
    return store.getItem(created.id)!
  })

  // ── Links: every role, item→item (incl. deep subtask trees) and
  //    item→event (with snapshots) ─────────────────────────────────────
  for (let i = 0; i < 1200; i++) {
    const from = pick(r, items)
    if (r() < 0.5) {
      const to = pick(r, items)
      if (to.id !== from.id)
        store.linkItems(from.id, to.id, pick(r, ['related', 'subtask-of']))
    } else {
      store.linkToEvent(
        from.id,
        {
          eventKey: `evt-${i % 200}::2026-08-${String((i % 27) + 1).padStart(2, '0')}`,
          title: pick(r, NASTY) + ' meeting',
          date: `2026-08-${String((i % 27) + 1).padStart(2, '0')}`,
          startTime: null,
          endTime: null
        },
        pick(r, ['prep-for', 'notes-for', 'follow-up-from'])
      )
    }
  }
  // A few explicit multi-level subtask chains.
  for (let c = 0; c < 30; c++) {
    let parent = store.createItem({ kind: 'task', title: `chain-root-${c}`, status: 'active' })
    for (let d = 0; d < 5; d++) {
      const child = store.createItem({ kind: 'task', title: `chain-${c}-${d}`, status: r() < 0.5 ? 'done' : 'active' })
      store.linkItems(child.id, parent.id, 'subtask-of')
      parent = child
    }
  }

  // ── Meetings: with and without project, unicode titles ──────────────
  for (let i = 0; i < 250; i++) {
    store.assignMeetingProject(
      {
        eventKey: `evt-${i}::2026-08-${String((i % 27) + 1).padStart(2, '0')}`,
        title: pick(r, NASTY) + ` meeting ${i}`,
        date: `2026-08-${String((i % 27) + 1).padStart(2, '0')}`
      },
      r() < 0.6 ? pick(r, projects).id : null
    )
  }

  // ── Local timeblocks: with and without project ──────────────────────
  for (let i = 0; i < 400; i++) {
    store.createLocalEvent({
      title: pick(r, NASTY) + ` block ${i}`,
      date: `2026-08-${String((i % 27) + 1).padStart(2, '0')}`,
      startTime: pick(r, ['08:00', '11:15', '16:45']),
      endTime: pick(r, ['09:00', '12:00', '17:30']),
      projectId: r() < 0.5 ? pick(r, projects).id : null
    })
  }

  // A sentinel with a unique token, so a post-restore FTS probe is
  // unambiguous (ordinary fixture words appear in many places).
  store.createItem({ kind: 'note', title: 'zqxsentinel token here', content: 'searchable body zqxsentinel', status: 'active' })

  // ── Settings: every key the app uses, incl. nested JSON blobs ───────
  store.setSetting('theme', 'plum')
  store.setSetting('timeZone', 'America/New_York')
  store.setSetting('timelineBounds', { start: 6, end: 22 })
  store.setSetting('calendarMode', 'google')
  store.setSetting('hideWorkLocation', true)
  store.setSetting('googleClient', { clientId: 'abc.apps.googleusercontent.com', clientSecret: 's3cr3t' })
  store.setSetting('googleTokens', { accessToken: 'ya29.xyz', refreshToken: '1//refresh', expiresAt: 1785200000000 })
  store.setSetting('calendarLabels', {
    '1': { name: 'Deep work 🧠', hex: '#123456', projectId: projects[0].id },
    '7': { name: 'unicode ñáme', hex: '#abcdef', projectId: null },
    '99': { name: 'beyond-eleven label', hex: '#fedcba' }
  })
}

// Dump every user table as raw rows, ordered deterministically, so two
// databases can be compared column-for-column.
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
  for (const [t, order] of USER_TABLES) out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY ${order}`).all()
  db.close()
  return out
}

describe('backup → restore round-trip (high volume, all data types)', () => {
  it('restores every table byte-for-byte after a full backup', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'braincells-roundtrip-'))
    const livePath = join(dir, 'live.sqlite3')
    const backupPath = join(dir, 'backup.sqlite3')

    // 1. Seed a big, varied database.
    const live = new Store(livePath)
    seedEverything(live)

    // Sanity: the fixture really is high-volume across every table.
    // Checkpoint first so the on-disk file (read by a separate readonly
    // connection) reflects everything still sitting in the WAL.
    live.db.pragma('wal_checkpoint(TRUNCATE)')
    const beforeSnap = dumpAll(livePath)
    expect(beforeSnap.projects.length).toBe(40)
    expect(beforeSnap.items.length).toBeGreaterThan(2000)
    expect(beforeSnap.links.length).toBeGreaterThan(1000)
    expect(beforeSnap.meetings.length).toBe(250)
    expect(beforeSnap.local_events.length).toBe(400)
    expect(beforeSnap.settings.length).toBe(8)

    // 2. The REAL backup path the app uses.
    await live.db.backup(backupPath)
    live.close()

    // 3. The REAL restore path: replace a (different) live db, drop WAL.
    const other = new Store(join(dir, 'target.sqlite3'))
    other.createItem({ kind: 'task', title: 'to be overwritten' })
    const targetPath = other.path
    other.close()
    replaceDatabase(targetPath, backupPath)

    // 4. Reopen exactly as the app would (runs migrate() again — must be
    //    a no-op on an already-migrated file) and compare every table.
    const restored = new Store(targetPath)
    restored.db.pragma('wal_checkpoint(TRUNCATE)')
    const after = dumpAll(targetPath)
    for (const [t] of USER_TABLES) {
      expect(after[t], `table ${t} row count`).toHaveLength(beforeSnap[t].length)
      expect(after[t], `table ${t} contents`).toEqual(beforeSnap[t])
    }

    // 5. Derived state (FTS index) must work post-restore, not just the
    //    base tables — the FTS5 shadow tables travel in the file copy.
    const hits = restored.search('zqxsentinel')
    expect(hits.length).toBe(1)
    expect(hits[0].title).toBe('zqxsentinel token here')
    expect(restored.allItems().length).toBe(beforeSnap.items.length)

    // 6. Nested JSON settings parse back intact (the raw settings rows
    //    are already compared byte-for-byte in step 4; this proves the
    //    JSON blobs deserialize to the same objects too).
    const labels = restored.getSetting<Record<string, { name: string; hex: string }>>('calendarLabels')!
    expect(Object.keys(labels).sort()).toEqual(['1', '7', '99'])
    expect(labels['1'].name).toBe('Deep work 🧠') // unicode survives
    expect(labels['99']).toEqual({ name: 'beyond-eleven label', hex: '#fedcba' })
    expect(restored.getSetting('timelineBounds')).toEqual({ start: 6, end: 22 })
    expect(restored.getSetting('googleTokens')).toEqual({
      accessToken: 'ya29.xyz',
      refreshToken: '1//refresh',
      expiresAt: 1785200000000
    })
    restored.close()
  })

  it('markdown export covers items/projects/links/meetings/sections/timeblocks/settings — and documents what it omits', () => {
    const store = new Store(':memory:')
    seedEverything(store)
    const files = buildExport(store)
    const byPath = new Map(files.map((f) => [f.path, f.contents]))

    // Every structure file is present.
    for (const p of [
      'manifest.json',
      'projects.json',
      'links.json',
      'meetings.json',
      'sections.json',
      'timeblocks.json',
      'settings.json'
    ])
      expect(byPath.has(p), p).toBe(true)
    expect(files.filter((f) => f.path.endsWith('.md')).length).toBe(store.allItems().length)
    expect(files.some((f) => f.path.endsWith('.html'))).toBe(true) // rich pages

    // Manifest counts line up with the seeded fixture.
    const manifest = JSON.parse(byPath.get('manifest.json')!)
    expect(manifest.counts).toEqual({
      projects: 40,
      items: store.allItems().length,
      links: store.allLinks().length,
      meetings: 250,
      sections: store.allSections().length,
      timeblocks: 400,
      settings: 6 // 8 seeded minus the two credential keys
    })

    // The JSON dumps carry the same rows the counts advertise.
    expect(JSON.parse(byPath.get('sections.json')!)).toHaveLength(manifest.counts.sections)
    expect(JSON.parse(byPath.get('timeblocks.json')!)).toHaveLength(400)

    // Settings export deliberately excludes Google credentials, keeps
    // everything else.
    const settings = JSON.parse(byPath.get('settings.json')!)
    expect(settings).not.toHaveProperty('googleTokens')
    expect(settings).not.toHaveProperty('googleClient')
    expect(Object.keys(settings).sort()).toEqual([
      'calendarLabels',
      'calendarMode',
      'hideWorkLocation',
      'theme',
      'timeZone',
      'timelineBounds'
    ])
    expect(settings.theme).toBe('plum')

    // Item front matter now carries the richer fields the fixture sets.
    const allMd = files
      .filter((f) => f.path.endsWith('.md'))
      .map((f) => f.contents)
      .join('\n')
    for (const key of [
      'section: ',
      'updated: ',
      'scheduledTime: ',
      'estimateMinutes: ',
      'starred: true',
      'sortOrder: '
    ])
      expect(allMd, key).toContain(key)
    store.close()
  })
})
