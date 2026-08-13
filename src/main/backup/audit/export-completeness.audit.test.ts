import { describe, expect, it } from 'vitest'
import { Store } from '../../store'
import { buildExport } from '../export'

/**
 * AUDIT: "Export as Markdown" completeness (buildExport in ../export.ts).
 *
 * The markdown export is human-readable and explicitly NOT an import
 * path — the .sqlite3 backup is the full-fidelity copy. This suite
 * judges the export by one question: could a user reconstruct / at
 * least SEE all their data from the exported folder?
 *
 * Structure:
 *  - "what IS exported" tests: must pass — regression guard for the
 *    behavior that works today.
 *  - "GAP:" tests use it.fails(...): they assert the DESIRED behavior
 *    (data present in the export) and are expected to fail against the
 *    current implementation. If a gap is ever fixed, vitest flags the
 *    it.fails test so it can be promoted to a plain it(...).
 *
 * Status (verified against migrations.ts schema):
 *  - every table is now represented: sections.json, timeblocks.json
 *    (local_events) and settings.json joined projects/links/meetings.
 *  - settings.json deliberately EXCLUDES 'googleTokens' and
 *    'googleClient' so OAuth secrets never land in a shareable folder.
 *  - item front-matter now carries every items column: section (by
 *    name), scheduledTime, estimateMinutes, starred, sortOrder, updated.
 *  - projects.json now carries sortOrder too — no known gaps remain.
 */

/** Every export file's contents concatenated — "does X appear ANYWHERE". */
function allContents(store: Store): string {
  return buildExport(store)
    .map((f) => f.contents)
    .join('\n \n')
}

/** Pin an item's timestamps so value-based assertions can't collide with wall-clock time. */
function pinTimestamps(store: Store, id: string, createdAt: string, updatedAt: string): void {
  store.db
    .prepare('UPDATE items SET created_at = ?, updated_at = ? WHERE id = ?')
    .run(createdAt, updatedAt, id)
}

function fileFor(store: Store, itemId: string): { md: string; mdPath: string } {
  const files = buildExport(store)
  const f = files.find((x) => x.path.endsWith(`${itemId.slice(0, 8)}.md`))
  expect(f, `no .md exported for item ${itemId}`).toBeDefined()
  return { md: f!.contents, mdPath: f!.path }
}

// ─────────────────────────────────────────────────────────────────────
// Schema enumeration: diff the real tables/columns against the export
// ─────────────────────────────────────────────────────────────────────

describe('schema coverage census', () => {
  it('the schema contains exactly the tables this audit accounts for', () => {
    // If a migration ever adds a table, this fails and the audit below
    // must be revisited — that is the point.
    const store = new Store(':memory:')
    const tables = (
      store.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'items_fts%'`
        )
        .all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .sort()
    expect(tables).toEqual([
      'items',
      'links',
      'local_events',
      'meetings',
      'projects',
      'sections',
      'settings'
    ])
    store.close()
  })

  it('every table is represented in the export (regression pin)', () => {
    const store = new Store(':memory:')
    const p = store.createProject('P', '#123456')
    store.createSection(p.id, 'a section')
    store.createItem({ kind: 'task', title: 't', projectId: p.id })
    store.setSetting('theme', 'plum')
    store.createLocalEvent({ title: 'block', date: '2026-08-01', startTime: '09:00', endTime: '10:00' })

    const paths = new Set(buildExport(store).map((f) => f.path))
    expect(paths.has('manifest.json')).toBe(true)
    expect(paths.has('projects.json')).toBe(true)
    expect(paths.has('links.json')).toBe(true)
    expect(paths.has('meetings.json')).toBe(true)
    // local_events export as timeblocks.json (the user-facing name).
    expect(paths.has('sections.json')).toBe(true)
    expect(paths.has('timeblocks.json')).toBe(true)
    expect(paths.has('settings.json')).toBe(true)
    store.close()
  })

  it('every items column is represented somewhere in the export (regression pin)', () => {
    const store = new Store(':memory:')
    const cols = (store.db.pragma('table_info(items)') as Array<{ name: string }>)
      .map((c) => c.name)
      .sort()
    // Columns buildExport writes somewhere (front-matter, body, .html
    // sibling, or the file path).
    const represented = new Set([
      'id',
      'kind',
      'title',
      'content',
      'rich_content',
      'status',
      'project_id',
      'section_id',
      'created_at',
      'updated_at',
      'scheduled_date',
      'scheduled_time',
      'time_estimate_minutes',
      'due_date',
      'completed_at',
      'starred',
      'sort_order',
      'links'
    ])
    const missing = cols.filter((c) => !represented.has(c))
    // If a migration adds an items column, this fails → extend the
    // export (and the front-matter tests below) to cover it.
    expect(missing).toEqual([])
    store.close()
  })
})

// ─────────────────────────────────────────────────────────────────────
// What IS exported — must all pass
// ─────────────────────────────────────────────────────────────────────

describe('what the export captures (must keep working)', () => {
  it('every item lands as exactly one .md file — all kinds, all statuses, dropped included', () => {
    const store = new Store(':memory:')
    const kinds = ['task', 'note', 'journal', 'prep', 'page'] as const
    const statuses = ['inbox', 'active', 'done', 'dropped'] as const
    for (const kind of kinds)
      for (const status of statuses)
        store.createItem({ kind, title: `${kind}-${status}`, status })

    const files = buildExport(store)
    const mds = files.filter((f) => f.path.endsWith('.md'))
    expect(mds).toHaveLength(20)
    // Each kind gets its own folder.
    for (const kind of kinds)
      expect(mds.filter((f) => f.path.startsWith(`items/${kind}/`))).toHaveLength(4)
    // Dropped items are NOT silently omitted.
    expect(mds.filter((f) => f.contents.includes('status: dropped'))).toHaveLength(5)
    store.close()
  })

  it('front-matter fields are present and correct; null fields are omitted', () => {
    const store = new Store(':memory:')
    const p = store.createProject('Alpha', '#20c997')
    const full = store.createItem({
      kind: 'task',
      title: 'Fully Loaded',
      content: 'body text with **markdown**',
      status: 'active',
      projectId: p.id,
      dueDate: '2026-02-01',
      scheduledDate: '2026-01-20'
    })
    pinTimestamps(store, full.id, '2026-01-15 08:00:00', '2026-01-15 08:00:00')

    const bare = store.createItem({ kind: 'note', title: 'Bare' })

    const done = store.createItem({ kind: 'task', title: 'Finished', status: 'active' })
    store.updateItem(done.id, { status: 'done', completedAt: '2026-03-03' })

    const { md, mdPath } = fileFor(store, full.id)
    expect(mdPath).toBe(`items/task/2026-01-15-fully-loaded-${full.id.slice(0, 8)}.md`)
    expect(md).toContain(`id: ${full.id}`)
    expect(md).toContain('kind: task')
    expect(md).toContain('status: active')
    expect(md).toContain('project: Alpha') // by name, not id
    expect(md).toContain('created: 2026-01-15 08:00:00')
    expect(md).toContain('updated: 2026-01-15 08:00:00')
    expect(md).toContain('scheduled: 2026-01-20')
    expect(md).toContain('due: 2026-02-01')
    expect(md).toContain('# Fully Loaded')
    expect(md).toContain('body text with **markdown**')

    const bareMd = fileFor(store, bare.id).md
    expect(bareMd).not.toContain('project:')
    expect(bareMd).not.toContain('section:')
    expect(bareMd).not.toContain('scheduled:')
    expect(bareMd).not.toContain('scheduledTime:')
    expect(bareMd).not.toContain('estimateMinutes:')
    expect(bareMd).not.toContain('due:')
    expect(bareMd).not.toContain('completed:')
    expect(bareMd).not.toContain('starred:')

    const doneMd = fileFor(store, done.id).md
    expect(doneMd).toContain('status: done')
    expect(doneMd).toContain('completed: 2026-03-03 12:00:00')
    store.close()
  })

  it('richContent writes a .html sibling with identical bytes — for ANY kind that has it', () => {
    const store = new Store(':memory:')
    const richHtml = '<h1>Canvas 🎨</h1><table><tr><td>kept</td></tr></table>'
    const page = store.createItem({
      kind: 'page',
      title: 'Canvas',
      content: 'plain mirror',
      richContent: richHtml
    })
    // Card notes / meeting notes can carry richContent too (not just pages).
    const note = store.createItem({ kind: 'note', title: 'Rich note', richContent: '<p>note html</p>' })
    const plain = store.createItem({ kind: 'note', title: 'Plain note' })

    const files = buildExport(store)
    const htmls = files.filter((f) => f.path.endsWith('.html'))
    expect(htmls).toHaveLength(2)

    const pageMd = files.find((f) => f.path.endsWith(`${page.id.slice(0, 8)}.md`))!
    const pageHtml = files.find((f) => f.path === pageMd.path.replace(/\.md$/, '.html'))!
    expect(pageHtml.contents).toBe(richHtml)

    const noteMd = files.find((f) => f.path.endsWith(`${note.id.slice(0, 8)}.md`))!
    expect(files.some((f) => f.path === noteMd.path.replace(/\.md$/, '.html'))).toBe(true)

    const plainMd = files.find((f) => f.path.endsWith(`${plain.id.slice(0, 8)}.md`))!
    expect(files.some((f) => f.path === plainMd.path.replace(/\.md$/, '.html'))).toBe(false)
    store.close()
  })

  it('filename collision guard: same date + same slug + same id prefix still yields distinct files', () => {
    const store = new Store(':memory:')
    // Force the collision the guard exists for: identical created date,
    // identical title, identical first-8 id chars. randomUUID can never
    // hand us this, so insert directly.
    const insert = store.db.prepare(
      `INSERT INTO items (id, kind, title, content, status, created_at, updated_at)
       VALUES (?, 'task', 'Same Title', ?, 'active', '2026-08-01 10:00:00', '2026-08-01 10:00:00')`
    )
    insert.run('aaaaaaaa-0000-4000-8000-000000000001', 'first body')
    insert.run('aaaaaaaa-0000-4000-8000-000000000002', 'second body')
    insert.run('aaaaaaaa-0000-4000-8000-000000000003', 'third body')

    const files = buildExport(store)
    const mds = files.filter((f) => f.path.endsWith('.md'))
    expect(mds).toHaveLength(3)
    const paths = mds.map((f) => f.path).sort()
    // All unique — nothing overwritten.
    expect(new Set(paths).size).toBe(3)
    expect(paths).toEqual([
      'items/task/2026-08-01-same-title-aaaaaaaa.md',
      'items/task/2026-08-01-same-title-aaaaaaaa_.md',
      'items/task/2026-08-01-same-title-aaaaaaaa__.md'
    ])
    // Every body survives in some file.
    const bodies = mds.map((f) => f.contents).join('\n')
    expect(bodies).toContain('first body')
    expect(bodies).toContain('second body')
    expect(bodies).toContain('third body')
    store.close()
  })

  it('nasty unicode / hostile titles produce valid, unique, traversal-free paths', () => {
    const store = new Store(':memory:')
    const titles = [
      '中文日本語한국어', // no ascii at all → 'untitled'
      'עברית والعربية rtl',
      'emoji 🧠🚀🎉 only mid',
      '../../etc/passwd', // path traversal attempt
      '..\\..\\windows\\system32',
      'CON', // windows reserved-ish
      'slashes / in / title',
      'null byte',
      'zero​width​space',
      '   spaces   everywhere   ',
      '"quotes" <html> & `ticks`',
      'x'.repeat(300), // very long
      '' // empty
    ]
    for (const title of titles) store.createItem({ kind: 'note', title })

    const files = buildExport(store)
    const mds = files.filter((f) => f.path.endsWith('.md'))
    expect(mds).toHaveLength(titles.length)
    const safe = /^items\/note\/\d{4}-\d{2}-\d{2}-[a-z0-9-]+-[0-9a-f]{8}_*\.md$/
    for (const f of mds) {
      expect(f.path, `unsafe path: ${JSON.stringify(f.path)}`).toMatch(safe)
      expect(f.path).not.toContain('..')
      // Slug capped at 40 chars.
      const slug = f.path.split('/')[2]
      expect(slug.length).toBeLessThanOrEqual(10 + 1 + 40 + 1 + 8 + 3 + 2)
    }
    expect(new Set(mds.map((f) => f.path)).size).toBe(titles.length)
    // Empty / non-ascii titles fall back to 'untitled', never a bare '-'.
    expect(mds.some((f) => f.path.includes('-untitled-'))).toBe(true)
    store.close()
  })

  it('archived projects are included in projects.json and items still resolve their names', () => {
    const store = new Store(':memory:')
    const arch = store.createProject('Old Glory', '#845ef7')
    const item = store.createItem({ kind: 'task', title: 'in archived', projectId: arch.id, status: 'active' })
    store.updateProject(arch.id, { status: 'archived' })

    const files = buildExport(store)
    const projects = JSON.parse(files.find((f) => f.path === 'projects.json')!.contents)
    expect(projects).toHaveLength(1)
    expect(projects[0]).toMatchObject({ id: arch.id, name: 'Old Glory', status: 'archived', color: '#845ef7' })
    expect(projects[0]).toHaveProperty('nickname')
    expect(projects[0]).toHaveProperty('createdAt')

    expect(fileFor(store, item.id).md).toContain('project: Old Glory')
    store.close()
  })

  it('manifest counts match reality; links.json and meetings.json carry every column', () => {
    const store = new Store(':memory:')
    const p = store.createProject('P1', '#111111')
    store.updateProject(p.id, { status: 'archived' })
    store.createProject('P2', '#222222')
    const a = store.createItem({ kind: 'task', title: 'a' })
    const b = store.createItem({ kind: 'task', title: 'b' })
    const itemLink = store.linkItems(a.id, b.id, 'blocked-by')
    const evLink = store.linkToEvent(
      b.id,
      { eventKey: 'ev1::2026-08-11', title: 'Standup 🌀', date: '2026-08-11', startTime: '09:00', endTime: '09:15' },
      'prep-for'
    )
    store.assignMeetingProject({ eventKey: 'ev1::2026-08-11', title: 'Standup 🌀', date: '2026-08-11' }, p.id)
    store.setMeetingLinks(
      { eventKey: 'ev1::2026-08-11', title: 'Standup 🌀', date: '2026-08-11' },
      [{ title: 'doc', url: 'https://docs.example.com/x' }]
    )
    store.createSection(p.id, 'a section')
    store.createLocalEvent({ title: 'block', date: '2026-08-11', startTime: '09:00', endTime: '10:00' })
    store.setSetting('theme', 'plum')

    const files = buildExport(store, new Date('2026-08-11T12:00:00Z'))
    const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.contents)
    expect(manifest.app).toBe('braincells')
    expect(manifest.exportedAt).toBe('2026-08-11T12:00:00.000Z')
    expect(manifest.counts).toEqual({
      projects: 2,
      items: 2,
      links: 2,
      meetings: 1,
      sections: 1,
      timeblocks: 1,
      settings: 1
    })

    const links = JSON.parse(files.find((f) => f.path === 'links.json')!.contents)
    expect(links).toHaveLength(2)
    const li = links.find((l: { id: string }) => l.id === itemLink.id)
    expect(li).toEqual({
      id: itemLink.id,
      fromItemId: a.id,
      toItemId: b.id,
      toEventKey: null,
      role: 'blocked-by',
      eventTitle: null,
      eventDate: null,
      createdAt: itemLink.createdAt
    })
    const le = links.find((l: { id: string }) => l.id === evLink.id)
    expect(le).toMatchObject({
      fromItemId: b.id,
      toItemId: null,
      toEventKey: 'ev1::2026-08-11',
      role: 'prep-for',
      eventTitle: 'Standup 🌀', // survival snapshot exported
      eventDate: '2026-08-11'
    })

    const meetings = JSON.parse(files.find((f) => f.path === 'meetings.json')!.contents)
    expect(meetings).toEqual([
      {
        eventKey: 'ev1::2026-08-11',
        projectId: p.id,
        title: 'Standup 🌀',
        date: '2026-08-11',
        links: [{ title: 'doc', url: 'https://docs.example.com/x' }]
      }
    ])
    store.close()
  })

  it('item body content is preserved verbatim, including hostile strings', () => {
    const store = new Store(':memory:')
    const nasty =
      'quotes "d" \'s\' `b`\nnewlines\ttabs\n<script>alert(1)</script>\n' +
      "Robert'); DROP TABLE items;--\nעברית والعربية 中文\nzero​width"
    const item = store.createItem({ kind: 'note', title: 'nasty body', content: nasty })
    expect(fileFor(store, item.id).md).toContain(nasty)
    store.close()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Tables that used to be missing — sections, timeblocks, settings
// ─────────────────────────────────────────────────────────────────────

describe('exported tables: sections, timeblocks, settings', () => {
  it('sections export to sections.json with full shape — board layouts survive', () => {
    const store = new Store(':memory:')
    const p = store.createProject('Boarded', '#123123')
    store.createSection(p.id, 'SECTIONSENTINEL-bucket')
    const s = store.listSections(p.id)[0]
    store.createItem({ kind: 'task', title: 'filed', projectId: p.id, sectionId: s.id })

    expect(allContents(store)).toContain('SECTIONSENTINEL')

    const sections = JSON.parse(
      buildExport(store)
        .find((f) => f.path === 'sections.json')!
        .contents
    ) as Array<Record<string, unknown>>
    expect(sections).toHaveLength(1)
    expect(sections[0]).toMatchObject({
      id: s.id,
      projectId: p.id,
      name: 'SECTIONSENTINEL-bucket'
    })
    expect(sections[0]).toHaveProperty('sortOrder')
    expect(sections[0]).toHaveProperty('createdAt')
    store.close()
  })

  it('local_events (drawn time blocks) export to timeblocks.json, ordered by date then start time', () => {
    const store = new Store(':memory:')
    // Created out of chronological order on purpose.
    store.createLocalEvent({
      title: 'LOCALEVENTSENTINEL later',
      date: '2026-08-12',
      startTime: '09:00',
      endTime: '10:00'
    })
    store.createLocalEvent({
      title: 'LOCALEVENTSENTINEL deep work',
      date: '2026-08-11',
      startTime: '09:00',
      endTime: '11:00'
    })
    store.createLocalEvent({
      title: 'LOCALEVENTSENTINEL earlier same day',
      date: '2026-08-11',
      startTime: '08:00',
      endTime: '08:30'
    })

    expect(allContents(store)).toContain('LOCALEVENTSENTINEL')

    const blocks = JSON.parse(
      buildExport(store)
        .find((f) => f.path === 'timeblocks.json')!
        .contents
    ) as Array<Record<string, unknown>>
    expect(blocks).toHaveLength(3)
    expect(blocks.map((b) => b.title)).toEqual([
      'LOCALEVENTSENTINEL earlier same day',
      'LOCALEVENTSENTINEL deep work',
      'LOCALEVENTSENTINEL later'
    ])
    expect(blocks[0]).toMatchObject({
      date: '2026-08-11',
      startTime: '08:00',
      endTime: '08:30'
    })
    // Full column shape: id + optional project/item associations.
    expect(blocks[0]).toHaveProperty('id')
    expect(blocks[0]).toHaveProperty('projectId')
    expect(blocks[0]).toHaveProperty('itemId')
    store.close()
  })

  it('settings export to settings.json as parsed key→value — but OAuth secrets are excluded', () => {
    const store = new Store(':memory:')
    // calendarLabels is genuinely user-authored data (custom label
    // names + project mappings), not just app config.
    store.setSetting('calendarLabels', { '1': { name: 'SETTINGSENTINEL label', hex: '#123456' } })
    store.setSetting('theme', 'plum')
    // Credentials share the settings table but must NEVER land in a
    // shareable export folder.
    store.setSetting('googleTokens', { refresh_token: 'SECRETTOKENSENTINEL' })
    store.setSetting('googleClient', { client_secret: 'SECRETCLIENTSENTINEL' })

    const everything = allContents(store)
    expect(everything).toContain('SETTINGSENTINEL')
    expect(everything).not.toContain('SECRETTOKENSENTINEL')
    expect(everything).not.toContain('SECRETCLIENTSENTINEL')

    const settings = JSON.parse(
      buildExport(store)
        .find((f) => f.path === 'settings.json')!
        .contents
    ) as Record<string, unknown>
    // Values come back parsed (real JSON), not double-encoded strings.
    expect(settings.theme).toBe('plum')
    expect(settings.calendarLabels).toEqual({
      '1': { name: 'SETTINGSENTINEL label', hex: '#123456' }
    })
    expect(Object.keys(settings).sort()).toEqual(['calendarLabels', 'theme'])
    expect(settings).not.toHaveProperty('googleTokens')
    expect(settings).not.toHaveProperty('googleClient')
    store.close()
  })
})

// ─────────────────────────────────────────────────────────────────────
// Front-matter completeness — every items column, nulls omitted
// ─────────────────────────────────────────────────────────────────────

describe('front-matter carries every item field', () => {
  /** One item with every once-omitted field set to an unmistakable value. */
  function probeItem(store: Store): string {
    const p = store.createProject('GapProj', '#654321')
    const sec = store.createSection(p.id, 'GapSection')
    const item = store.createItem({
      kind: 'task',
      title: 'gap probe',
      status: 'active',
      projectId: p.id,
      sectionId: sec.id,
      scheduledDate: '2026-01-20',
      scheduledTime: '13:37', // a calendar time block
      timeEstimateMinutes: 45
    })
    store.updateItem(item.id, {
      starred: true,
      sortOrder: 777.5,
      links: [{ title: 'gap doc', url: 'https://gap.example.com/doc' }]
    })
    // Pin timestamps so '13:37' etc. cannot leak in via wall-clock created_at.
    pinTimestamps(store, item.id, '2026-01-15 08:00:00', '2026-01-16 09:30:00')
    return item.id
  }

  it('probe item exports normally with its base fields', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    const { md } = fileFor(store, id)
    expect(md).toContain('# gap probe')
    expect(md).toContain('project: GapProj')
    expect(md).toContain('scheduled: 2026-01-20')
    expect(md).toContain('created: 2026-01-15 08:00:00')
    store.close()
  })

  it('scheduledTime (the time-block slot) is in the front-matter', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    expect(fileFor(store, id).md).toContain('scheduledTime: 13:37')
    store.close()
  })

  it('estimateMinutes is in the front-matter', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    expect(fileFor(store, id).md).toContain('estimateMinutes: 45')
    store.close()
  })

  it('starred flag is in the front-matter (literal true, only when starred)', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    expect(fileFor(store, id).md).toContain('starred: true')
    store.close()
  })

  it('attached links are in the front-matter (JSON, only when present)', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    expect(fileFor(store, id).md).toContain(
      'links: [{"title":"gap doc","url":"https://gap.example.com/doc"}]'
    )
    const bare = store.createItem({ kind: 'note', title: 'no links here' })
    expect(fileFor(store, bare.id).md).not.toContain('links:')
    store.close()
  })

  it('section is in the front-matter, by NAME (not raw id)', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    expect(fileFor(store, id).md).toContain('section: GapSection')
    store.close()
  })

  it('manual sortOrder is in the front-matter', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    expect(fileFor(store, id).md).toContain('sortOrder: 777.5')
    store.close()
  })

  it('updated (edit recency) is in the front-matter', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    expect(fileFor(store, id).md).toContain('updated: 2026-01-16 09:30:00')
    store.close()
  })

  it('front-matter keys appear in the documented order', () => {
    const store = new Store(':memory:')
    const id = probeItem(store)
    const { md } = fileFor(store, id)
    const block = md.split('---')[1].trim()
    const keys = block.split('\n').map((line) => line.split(':')[0])
    // Full canonical order is: id, kind, status, project, section,
    // created, updated, scheduled, scheduledTime, estimateMinutes, due,
    // completed, starred, sortOrder, links — probe has no due/completed.
    expect(keys).toEqual([
      'id',
      'kind',
      'status',
      'project',
      'section',
      'created',
      'updated',
      'scheduled',
      'scheduledTime',
      'estimateMinutes',
      'starred',
      'sortOrder',
      'links'
    ])
    store.close()
  })
})

// ─────────────────────────────────────────────────────────────────────
// GAPS — each it.fails asserts the DESIRED behavior and is expected to
// fail against the current export. Fixing a gap makes vitest flag the
// test ("expected to fail, but passed") → promote it to plain it(...).
// ─────────────────────────────────────────────────────────────────────

describe('exported project fields', () => {
  it('projects.json names sortOrder, so one row alone shows its sidebar position', () => {
    const store = new Store(':memory:')
    const a = store.createProject('A', '#111111')
    const b = store.createProject('B', '#222222')
    store.reorderProjects([b.id, a.id]) // user dragged B above A
    const projects = JSON.parse(
      buildExport(store)
        .find((f) => f.path === 'projects.json')!
        .contents
    ) as Array<Record<string, unknown>>
    expect(Object.keys(projects[0])).toContain('sortOrder')
    // The array comes back in sidebar order with the field to prove it.
    expect(projects.map((p) => p.name)).toEqual(['B', 'A'])
    expect(projects.map((p) => p.sortOrder)).toEqual([0, 1])
    store.close()
  })
})
