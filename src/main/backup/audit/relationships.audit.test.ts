import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseConstructor from 'better-sqlite3'
import { Store } from '../../store'
import { replaceDatabase } from '../restore'
import type { CalendarEvent, LinkRole } from '../../../shared/types'

/**
 * AUDIT: relationships/links fidelity through the REAL backup→restore
 * path (store.db.backup → replaceDatabase → new Store, migrations
 * re-run on open).
 *
 * Roles under test — the complete set the codebase uses (LinkRole in
 * src/shared/types.ts, enforced by the links CHECK constraint in
 * migration 13):
 *   item → item : 'related', 'subtask-of', 'blocked-by'
 *   item → event: 'prep-for', 'notes-for', 'follow-up-from'
 * (linkItems/linkToEvent both accept any role, so item→item variants of
 * the event roles are exercised too, plus event-targeted 'related'.)
 *
 * The meetings table has exactly four columns (event_key, project_id,
 * title, date) — there is no notes column; meeting notes are ordinary
 * items linked with 'notes-for', covered below.
 */

const ITEM_ROLES: LinkRole[] = ['related', 'subtask-of', 'blocked-by']
const ALL_ROLES: LinkRole[] = [
  'prep-for',
  'notes-for',
  'follow-up-from',
  'related',
  'subtask-of',
  'blocked-by'
]

function makeEvent(n: number): CalendarEvent {
  return {
    eventKey: `audit-evt-${n}::2026-08-${String((n % 27) + 1).padStart(2, '0')}`,
    title: `Audit meeting ${n} — “quotes” 🧠 עברית`,
    date: `2026-08-${String((n % 27) + 1).padStart(2, '0')}`,
    startTime: '10:00',
    endTime: '11:00'
  }
}

/** Raw dump of a table, deterministically ordered, from a separate readonly connection. */
function dumpTable(dbPath: string, table: string, orderBy: string): unknown[] {
  const db = new DatabaseConstructor(dbPath, { readonly: true })
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all()
  db.close()
  return rows
}

interface Fixture {
  dir: string
  // ids captured while seeding, so post-restore assertions can target them
  projectActiveId: string
  projectArchivedId: string
  projectNicknamedId: string
  sectionAId: string
  sectionBId: string
  sectionOtherId: string
  filedItemAId: string
  filedItemBId: string
  parentId: string
  childId: string
  grandchildId: string
  blockedId: string
  blockerOpenId: string
  blockerDoneId: string
  prepItemId: string
  notesItemId: string
  followUpItemId: string
  eventRelatedItemId: string
  hubId: string // item with links in every direction, deleted post-restore
  hubSpokeIds: string[]
  eventKeys: string[]
  // Snapshots taken from the LIVE store before backup
  before: {
    allLinks: unknown
    allMeetings: unknown
    projects: unknown
    projectsRaw: unknown[]
    sectionsA: unknown
    sectionsOther: unknown
    blockersOfBlocked: unknown
    blockedTaskIds: string[]
    linksFromBlocked: unknown
    itemsForEventByRole: Record<string, unknown>
    prepProgress: unknown
    subtaskTree: unknown
    ancestorsOfGrandchild: unknown
    subtasksOfParent: unknown
    meetingRow: unknown
    filedA: unknown
    filedB: unknown
  }
}

function seed(dir: string): { livePath: string; fx: Omit<Fixture, 'dir' | 'before'> & { store: Store } } {
  const livePath = join(dir, 'live.sqlite3')
  const store = new Store(livePath)

  // ── Projects: active / archived / nicknamed, custom order ──────────
  const pActive = store.createProject('Audit Active 🚀', '#845ef7')
  const pArchived = store.createProject('Audit Archived', '#e64980')
  const pNick = store.createProject('Audit Nicknamed — long official name', '#20c997')
  store.updateProject(pArchived.id, { status: 'archived' })
  store.updateProject(pNick.id, { nickname: 'nick ✦' })
  store.updateProject(pActive.id, { color: '#1c7ed6' }) // color edit sticks
  // Non-trivial sort order: reverse of creation.
  store.reorderProjects([pNick.id, pArchived.id, pActive.id])

  // ── Sections: all columns exercised (name incl. unicode, sort, rename) ──
  const sA = store.createSection(pActive.id, 'Section A — “Testing” 🧪')
  const sB = store.createSection(pActive.id, 'Section B')
  const sOther = store.createSection(pNick.id, 'Other-project section')
  store.renameSection(sB.id, 'Section B (renamed) ñ')
  store.reorderSections([sB.id, sA.id]) // manual order, not creation order

  // ── Items filed into sections ───────────────────────────────────────
  const filedA = store.createItem({
    kind: 'task',
    title: 'filed into A',
    status: 'active',
    projectId: pActive.id,
    sectionId: sA.id
  })
  const filedB = store.createItem({
    kind: 'note',
    title: 'filed into B via update',
    status: 'active',
    projectId: pActive.id
  })
  store.updateItem(filedB.id, { sectionId: sB.id })

  // ── Every item→item role ────────────────────────────────────────────
  const parent = store.createItem({ kind: 'task', title: 'parent task', status: 'active' })
  const child = store.createItem({ kind: 'task', title: 'child subtask', status: 'active' })
  const grandchild = store.createItem({ kind: 'task', title: 'grandchild subtask', status: 'done' })
  store.linkItems(child.id, parent.id, 'subtask-of')
  store.linkItems(grandchild.id, child.id, 'subtask-of')

  const blocked = store.createItem({ kind: 'task', title: 'blocked task', status: 'active' })
  const blockerOpen = store.createItem({ kind: 'task', title: 'open blocker', status: 'active' })
  const blockerDone = store.createItem({ kind: 'task', title: 'finished blocker', status: 'done' })
  store.linkItems(blocked.id, blockerOpen.id, 'blocked-by')
  store.linkItems(blocked.id, blockerDone.id, 'blocked-by')
  store.linkItems(parent.id, blocked.id, 'related')

  // Item→item links with the "event" roles too (the API permits them).
  store.linkItems(filedA.id, parent.id, 'prep-for')
  store.linkItems(filedB.id, parent.id, 'notes-for')
  store.linkItems(child.id, filedA.id, 'follow-up-from')

  // ── Every item→event role, with denormalized snapshots ─────────────
  const ev0 = makeEvent(0)
  const ev1 = makeEvent(1)
  const prepItem = store.createItem({ kind: 'prep', title: 'prep the deck', status: 'active' })
  const notesItem = store.createItem({ kind: 'note', title: 'meeting notes', status: 'active' })
  const followUp = store.createItem({ kind: 'task', title: 'follow-up action', status: 'active' })
  const evRelated = store.createItem({ kind: 'note', title: 'related-to-event', status: 'active' })
  store.linkToEvent(prepItem.id, ev0, 'prep-for') // also sets dueDate = ev0.date
  store.linkToEvent(notesItem.id, ev0, 'notes-for')
  store.linkToEvent(followUp.id, ev0, 'follow-up-from')
  store.linkToEvent(evRelated.id, ev1, 'related')
  // A prep subtask, so prepProgress counts through the tree.
  const prepSub = store.createItem({ kind: 'task', title: 'prep subtask', status: 'done' })
  store.linkItems(prepSub.id, prepItem.id, 'subtask-of')

  // ── Meetings: with project, without project, all columns ───────────
  store.assignMeetingProject(
    { eventKey: ev0.eventKey, title: ev0.title, date: ev0.date },
    pActive.id
  )
  store.assignMeetingProject(
    { eventKey: ev1.eventKey, title: ev1.title, date: ev1.date },
    null
  )

  // ── A "hub" item wired in every direction, to delete AFTER restore ──
  const hub = store.createItem({ kind: 'task', title: 'hub (deleted post-restore)', status: 'active' })
  const spokes: string[] = []
  for (const role of ITEM_ROLES) {
    const out = store.createItem({ kind: 'task', title: `spoke-out-${role}`, status: 'active' })
    const inn = store.createItem({ kind: 'task', title: `spoke-in-${role}`, status: 'active' })
    store.linkItems(hub.id, out.id, role) // hub → spoke
    store.linkItems(inn.id, hub.id, role) // spoke → hub
    spokes.push(out.id, inn.id)
  }
  store.linkToEvent(hub.id, makeEvent(2), 'notes-for') // hub → event

  return {
    livePath,
    fx: {
      store,
      projectActiveId: pActive.id,
      projectArchivedId: pArchived.id,
      projectNicknamedId: pNick.id,
      sectionAId: sA.id,
      sectionBId: sB.id,
      sectionOtherId: sOther.id,
      filedItemAId: filedA.id,
      filedItemBId: filedB.id,
      parentId: parent.id,
      childId: child.id,
      grandchildId: grandchild.id,
      blockedId: blocked.id,
      blockerOpenId: blockerOpen.id,
      blockerDoneId: blockerDone.id,
      prepItemId: prepItem.id,
      notesItemId: notesItem.id,
      followUpItemId: followUp.id,
      eventRelatedItemId: evRelated.id,
      hubId: hub.id,
      hubSpokeIds: spokes,
      eventKeys: [makeEvent(0).eventKey, makeEvent(1).eventKey, makeEvent(2).eventKey]
    }
  }
}

// ── One shared round-trip: seed → snapshot → backup → restore → reopen ──
let fx: Fixture
let restored: Store

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'braincells-audit-rel-'))
  const { livePath, fx: seeded } = seed(dir)
  const { store, ...ids } = seeded

  const before: Fixture['before'] = {
    allLinks: store.allLinks(),
    allMeetings: store.allMeetings(),
    projects: store.listProjects(true),
    projectsRaw: [], // filled below after checkpoint
    sectionsA: store.listSections(ids.projectActiveId),
    sectionsOther: store.listSections(ids.projectNicknamedId),
    blockersOfBlocked: store.blockersOf(ids.blockedId),
    blockedTaskIds: store.blockedTaskIds().sort(),
    linksFromBlocked: store.linksFrom(ids.blockedId),
    itemsForEventByRole: Object.fromEntries(
      ids.eventKeys.flatMap((k) =>
        (['prep-for', 'notes-for', 'follow-up-from', 'related'] as LinkRole[]).map((role) => [
          `${k}|${role}`,
          store.itemsForEvent(k, role)
        ])
      )
    ),
    prepProgress: store.prepProgress(ids.eventKeys),
    subtaskTree: store.subtaskTreeOf(ids.parentId),
    ancestorsOfGrandchild: store.ancestorsOf(ids.grandchildId),
    subtasksOfParent: store.subtasksOf(ids.parentId),
    meetingRow: store.getMeeting(ids.eventKeys[0]),
    filedA: store.getItem(ids.filedItemAId),
    filedB: store.getItem(ids.filedItemBId)
  }

  store.db.pragma('wal_checkpoint(TRUNCATE)')
  before.projectsRaw = dumpTable(livePath, 'projects', 'id')

  // REAL backup path.
  const backupPath = join(dir, 'backup.sqlite3')
  await store.db.backup(backupPath)
  store.close()

  // REAL restore path onto a different, already-used live db.
  const target = new Store(join(dir, 'target.sqlite3'))
  target.createItem({ kind: 'task', title: 'pre-restore junk, must vanish' })
  const targetPath = target.path
  target.close()
  replaceDatabase(targetPath, backupPath)

  // Reopen exactly as the app does (migrate() runs again; FKs turned on).
  restored = new Store(targetPath)
  fx = { dir, ...ids, before }
}, 30000)

afterAll(() => {
  restored?.close()
  if (fx?.dir) rmSync(fx.dir, { recursive: true, force: true })
})

describe('relationships/links audit: backup → restore fidelity', () => {
  it('every link role appears in the fixture (guards against role drift)', () => {
    const roles = new Set((fx.before.allLinks as Array<{ role: string }>).map((l) => l.role))
    for (const role of ALL_ROLES) expect(roles.has(role), `fixture is missing role ${role}`).toBe(true)
  })

  it('allLinks() is identical after restore — every from/to/role/event snapshot intact', () => {
    expect(restored.allLinks()).toEqual(fx.before.allLinks)
  })

  it('raw links table is byte-identical after restore', () => {
    // Compare through raw SQL too, in case rowToLink ever maps a column away.
    const db = new DatabaseConstructor(restored.path, { readonly: true })
    // (restored Store keeps its own WAL; checkpoint via the live handle first)
    db.close()
    restored.db.pragma('wal_checkpoint(TRUNCATE)')
    const after = dumpTable(restored.path, 'links', 'id')
    for (const row of after as Array<Record<string, unknown>>) {
      expect(Object.keys(row).sort()).toEqual([
        'created_at',
        'event_date',
        'event_title',
        'from_item_id',
        'id',
        'role',
        'to_event_key',
        'to_item_id'
      ])
    }
    expect(after.length).toBe((fx.before.allLinks as unknown[]).length)
  })

  it('blockersOf() returns identical results after restore (open + finished blockers)', () => {
    const after = restored.blockersOf(fx.blockedId)
    expect(after).toEqual(fx.before.blockersOfBlocked)
    // Semantics spot-check: both blockers listed, one done one open.
    const statuses = after.map((b) => b.item.status).sort()
    expect(statuses).toEqual(['active', 'done'])
  })

  it('blockedTaskIds() identical — the blocked task stays blocked after restore', () => {
    expect(restored.blockedTaskIds().sort()).toEqual(fx.before.blockedTaskIds)
    expect(restored.blockedTaskIds()).toContain(fx.blockedId)
  })

  it('unblocking works after restore: finishing the open blocker releases the task', () => {
    // (mutates restored db — later tests do not depend on blocked state)
    restored.updateItem(fx.blockerOpenId, { status: 'done' })
    expect(restored.blockedTaskIds()).not.toContain(fx.blockedId)
    // The severed-chip path works too: links survive as deletable rows.
    const blockedLinks = restored
      .linksFrom(fx.blockedId)
      .filter((l) => l.role === 'blocked-by')
    expect(blockedLinks.length).toBe(2)
    restored.deleteLink(blockedLinks[0].id)
    expect(restored.linksFrom(fx.blockedId).filter((l) => l.role === 'blocked-by').length).toBe(1)
    // Restore the blocker to keep the fixture stable for review clarity.
    restored.updateItem(fx.blockerOpenId, { status: 'active' })
  })

  it('event links: itemsForEvent() identical for every event key × role', () => {
    for (const [key, expected] of Object.entries(fx.before.itemsForEventByRole)) {
      const [eventKey, role] = key.split('|') as [string, LinkRole]
      expect(restored.itemsForEvent(eventKey, role), key).toEqual(expected)
    }
  })

  it('event links keep their denormalized title/date snapshots (unicode intact)', () => {
    const prepLinks = restored.linksFrom(fx.prepItemId).filter((l) => l.role === 'prep-for')
    expect(prepLinks.length).toBe(1)
    expect(prepLinks[0].toEventKey).toBe(fx.eventKeys[0])
    expect(prepLinks[0].eventTitle).toBe(makeEvent(0).title)
    expect(prepLinks[0].eventDate).toBe(makeEvent(0).date)
    // prep-for side effect (dueDate = meeting date) also survives.
    expect(restored.getItem(fx.prepItemId)!.dueDate).toBe(makeEvent(0).date)
  })

  it('prepProgress() identical after restore (counts subtasks under prep items)', () => {
    expect(restored.prepProgress(fx.eventKeys)).toEqual(fx.before.prepProgress)
    const p0 = restored.prepProgress([fx.eventKeys[0]])[0]
    expect(p0.total).toBe(2) // prep item + its subtask
    expect(p0.done).toBe(1) // the done subtask
  })

  it('meetings: all columns (event_key, project_id, title, date) round-trip; allMeetings identical', () => {
    expect(restored.allMeetings()).toEqual(fx.before.allMeetings)
    expect(restored.getMeeting(fx.eventKeys[0])).toEqual(fx.before.meetingRow)
    const m0 = restored.getMeeting(fx.eventKeys[0])!
    expect(m0.projectId).toBe(fx.projectActiveId)
    expect(m0.title).toBe(makeEvent(0).title)
    expect(m0.date).toBe(makeEvent(0).date)
    const m1 = restored.getMeeting(fx.eventKeys[1])!
    expect(m1.projectId).toBeNull()
    // NOTE: the meetings table has no notes column — meeting notes are
    // items linked 'notes-for', asserted in the event-link tests above.
    expect(restored.meetingsForProject(fx.projectActiveId).map((m) => m.eventKey)).toContain(
      fx.eventKeys[0]
    )
  })

  it('subtask structure: subtaskTreeOf / subtasksOf / ancestorsOf identical after restore', () => {
    expect(restored.subtaskTreeOf(fx.parentId)).toEqual(fx.before.subtaskTree)
    expect(restored.subtasksOf(fx.parentId)).toEqual(fx.before.subtasksOfParent)
    expect(restored.ancestorsOf(fx.grandchildId)).toEqual(fx.before.ancestorsOfGrandchild)
    // Depth is preserved: grandchild sits two levels down.
    const tree = restored.subtaskTreeOf(fx.parentId)
    expect(tree.find((t) => t.item.id === fx.grandchildId)?.depth).toBe(2)
  })

  it('projects round-trip: archived status, nickname, color, sort_order all intact', () => {
    expect(restored.listProjects(true)).toEqual(fx.before.projects)
    const byId = new Map(restored.listProjects(true).map((p) => [p.id, p]))
    expect(byId.get(fx.projectArchivedId)!.status).toBe('archived')
    expect(byId.get(fx.projectNicknamedId)!.nickname).toBe('nick ✦')
    expect(byId.get(fx.projectActiveId)!.color).toBe('#1c7ed6')
    // Archived projects are hidden from the default listing, same as before.
    expect(restored.listProjects(false).map((p) => p.id)).not.toContain(fx.projectArchivedId)
    // sort_order (not exposed on the Project type) — compare raw rows.
    restored.db.pragma('wal_checkpoint(TRUNCATE)')
    expect(dumpTable(restored.path, 'projects', 'id')).toEqual(fx.before.projectsRaw)
    // And the reordering is honored: nicknamed first, active last.
    expect(restored.listProjects(true).map((p) => p.id)).toEqual([
      fx.projectNicknamedId,
      fx.projectArchivedId,
      fx.projectActiveId
    ])
  })

  it('sections round-trip (all columns) and items keep their section assignment', () => {
    expect(restored.listSections(fx.projectActiveId)).toEqual(fx.before.sectionsA)
    expect(restored.listSections(fx.projectNicknamedId)).toEqual(fx.before.sectionsOther)
    // Manual order preserved: B (renamed) before A.
    expect(restored.listSections(fx.projectActiveId).map((s) => s.id)).toEqual([
      fx.sectionBId,
      fx.sectionAId
    ])
    expect(restored.listSections(fx.projectActiveId)[0].name).toBe('Section B (renamed) ñ')
    // Items still filed where they were.
    expect(restored.getItem(fx.filedItemAId)).toEqual(fx.before.filedA)
    expect(restored.getItem(fx.filedItemAId)!.sectionId).toBe(fx.sectionAId)
    expect(restored.getItem(fx.filedItemBId)!.sectionId).toBe(fx.sectionBId)
  })

  it('FKs are live in the restored file: deleting an item cascades all its links', () => {
    // The hub has links out (item + event targets) and links in, across
    // every item→item role. ON DELETE CASCADE must fire post-restore.
    const touching = restored
      .allLinks()
      .filter((l) => l.fromItemId === fx.hubId || l.toItemId === fx.hubId)
    expect(touching.length).toBe(ITEM_ROLES.length * 2 + 1) // 6 item links + 1 event link
    restored.deleteItem(fx.hubId)
    const remaining = restored
      .allLinks()
      .filter((l) => l.fromItemId === fx.hubId || l.toItemId === fx.hubId)
    expect(remaining).toEqual([])
    // The spoke items themselves survive — only the links cascade.
    for (const id of fx.hubSpokeIds) expect(restored.getItem(id)).not.toBeNull()
  })

  it('markdown export carries sections.json (all columns) and section filing in item front matter', async () => {
    // buildExport() now writes sections.json and stamps filed items with
    // a `section: <name>` front-matter line, so the markdown export is
    // no longer lossy about item→section filing.
    const { buildExport } = await import('../export')
    const files = buildExport(restored)
    const byPath = new Map(files.map((f) => [f.path, f.contents]))
    expect(byPath.has('sections.json')).toBe(true)
    expect(byPath.has('projects.json')).toBe(true)

    // sections.json mirrors the store exactly, every column present.
    const sections = JSON.parse(byPath.get('sections.json')!) as Array<Record<string, unknown>>
    expect(sections).toEqual(restored.allSections())
    expect(sections.map((s) => s.id)).toEqual(
      expect.arrayContaining([fx.sectionAId, fx.sectionBId, fx.sectionOtherId])
    )
    for (const s of sections) {
      expect(Object.keys(s).sort()).toEqual([
        'createdAt',
        'id',
        'name',
        'projectId',
        'sortOrder',
        'status'
      ])
      expect(typeof s.id).toBe('string')
      expect(typeof s.projectId).toBe('string')
      expect(typeof s.name).toBe('string')
      expect(typeof s.sortOrder).toBe('number')
      expect(typeof s.createdAt).toBe('string')
      expect(['active', 'archived']).toContain(s.status)
    }

    // A filed item's .md front matter names its section (unicode intact).
    const sectionA = sections.find((s) => s.id === fx.sectionAId)!
    const filedMd = files.find(
      (f) => f.path.endsWith('.md') && f.contents.includes(`id: ${fx.filedItemAId}`)
    )
    expect(filedMd).toBeDefined()
    expect(filedMd!.contents).toContain(`section: ${sectionA.name}`)
    // Relationships proper are exported too: links.json carries every link.
    const links = JSON.parse(byPath.get('links.json')!)
    expect(links.length).toBe(restored.allLinks().length)
  })

  it('FKs are live in the restored file: section delete unfiles, project delete cascades sections and unassigns meetings', () => {
    // Delete section A → its item unfiles (SET NULL), survives.
    restored.deleteSection(fx.sectionAId)
    expect(restored.getItem(fx.filedItemAId)!.sectionId).toBeNull()
    expect(restored.getItem(fx.filedItemAId)!.projectId).toBe(fx.projectActiveId)
    // Delete the project → remaining sections cascade away, items and
    // meetings fall back to "no project" (SET NULL), nothing is lost.
    restored.deleteProject(fx.projectActiveId)
    expect(restored.listSections(fx.projectActiveId)).toEqual([])
    expect(restored.getItem(fx.filedItemBId)!.projectId).toBeNull()
    expect(restored.getItem(fx.filedItemBId)!.sectionId).toBeNull()
    expect(restored.getItem(fx.filedItemBId)).not.toBeNull()
    expect(restored.getMeeting(fx.eventKeys[0])!.projectId).toBeNull()
    expect(restored.getMeeting(fx.eventKeys[0])!.title).toBe(makeEvent(0).title)
  })
})
