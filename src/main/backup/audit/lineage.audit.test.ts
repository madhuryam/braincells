import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseConstructor from 'better-sqlite3'
import { Store } from '../../store'
import { replaceDatabase } from '../restore'
import type { Item, ItemKind, ItemStatus } from '../../../shared/types'

/**
 * AUDIT: task lineage & item integrity through backup → restore.
 *
 * Exercises the exact code paths the app uses:
 *   store.db.backup(path)  →  replaceDatabase(dbPath, backupPath)  →  new Store(dbPath)
 *
 * and verifies that lineage structure (deep subtask trees, ancestors,
 * tree order/depths), every item kind/status, every nullable column in
 * both null and non-null form, fractional REAL sort orders, backdated
 * completions, and the done-subtask rollup queries all come back
 * IDENTICALLY — both at the raw-row level (byte-for-byte, including
 * rowids, which the sibling tie-breaks depend on) and through the
 * Store API.
 *
 * All database files live in a fresh mkdtemp dir; nothing here touches
 * any real app data.
 */

const KINDS = ['task', 'note', 'journal', 'prep', 'page'] as const
const STATUSES = ['inbox', 'active', 'done', 'dropped'] as const

// ─── Fixture bookkeeping ──────────────────────────────────────────────
interface Fixture {
  rootId: string
  /** ids of the straight chain root → depth 6, index = depth (0 = root) */
  chainIds: string[]
  /** the three depth-1 siblings under root, in creation order */
  siblingIds: string[]
  droppedChildId: string
  gridIds: Map<string, string> // `${kind}/${status}` -> id
  backdateNoonId: string
  backdateFullId: string
  movedCompletionId: string
  createdDoneDirectlyId: string
  allNullId: string
  allSetId: string
  nulledBackId: string
  fractionalIds: string[] // siblings carrying exact fractional sort orders
  trackedIds: string[]
}

/** Everything we observe through the Store API, captured before and after. */
interface Observations {
  tree: Array<{ parentId: string; depth: number; item: Item }>
  ancestorsOfDeepest: Item[]
  ancestorsOfRoot: Item[]
  subtasksByParent: Record<string, Item[]>
  doneOn0805: unknown
  doneOn0801: unknown
  doneOn0630: unknown
  itemsById: Record<string, Item | null>
  allItems: Item[]
  recentCompleted: Item[]
  starred: Item[]
}

function seed(store: Store): Fixture {
  const f: Partial<Fixture> = {}
  const track: string[] = []

  // ── 1. Every kind × every status ──────────────────────────────────
  // Two routes on purpose: the grid uses createItem({status}) directly
  // (the raw-capture path), and the backdate items below use the
  // updateItem status transition (the UI path that stamps completedAt).
  const grid = new Map<string, string>()
  for (const kind of KINDS) {
    for (const status of STATUSES) {
      const it = store.createItem({
        kind: kind as ItemKind,
        title: `grid ${kind}/${status} — ünïcødé 🧠 "quoted" \n newline`,
        content: status === 'dropped' ? '' : `body of ${kind}/${status}`,
        richContent: kind === 'page' ? `<h1>${kind}</h1><p>${status}</p>` : null,
        status: status as ItemStatus
      })
      grid.set(`${kind}/${status}`, it.id)
      track.push(it.id)
    }
  }
  f.gridIds = grid
  // NOTE (product quirk, not a backup gap): createItem({status:'done'})
  // leaves completed_at NULL — only the updateItem transition stamps it.
  // The audit asserts that this NULL survives restore identically.
  f.createdDoneDirectlyId = grid.get('task/done')!

  // ── 2. completedAt backdating, all three shapes updateItem allows ──
  const noon = store.createItem({ kind: 'task', title: 'backdated to a day', status: 'active' })
  store.updateItem(noon.id, { status: 'done', completedAt: '2026-08-01' }) // → '2026-08-01 12:00:00'
  f.backdateNoonId = noon.id

  const full = store.createItem({ kind: 'task', title: 'backdated to a timestamp', status: 'active' })
  store.updateItem(full.id, { status: 'done', completedAt: '2026-07-15 09:30:00' })
  f.backdateFullId = full.id

  const moved = store.createItem({ kind: 'task', title: 'completion moved later', status: 'active' })
  store.updateItem(moved.id, { status: 'done' }) // stamps "now"
  store.updateItem(moved.id, { completedAt: '2026-06-30' }) // move while done → noon of 06-30
  f.movedCompletionId = moved.id
  track.push(noon.id, full.id, moved.id)

  // ── 3. Nullable columns: all-null, all-set, and set-then-nulled ────
  const allNull = store.createItem({ kind: 'task', title: 'all nullables null' })
  f.allNullId = allNull.id

  const project = store.createProject('Lineage Audit Project 🚀', '#845ef7')
  const section = store.createSection(project.id, 'Audit Section — ß')
  const allSet = store.createItem({
    kind: 'page',
    title: 'all nullables set',
    content: 'plain mirror',
    richContent: '<h1>rich</h1><ul><li>a</li><li>b</li></ul>',
    status: 'active',
    projectId: project.id,
    sectionId: section.id,
    dueDate: '2026-08-20',
    scheduledDate: '2026-08-11',
    scheduledTime: '09:15',
    timeEstimateMinutes: 45
  })
  store.updateItem(allSet.id, { starred: true, sortOrder: 123.456789 })
  f.allSetId = allSet.id

  const nulledBack = store.createItem({
    kind: 'task',
    title: 'set then nulled back',
    projectId: project.id,
    dueDate: '2026-09-01',
    scheduledDate: '2026-08-12',
    scheduledTime: '14:00',
    timeEstimateMinutes: 30
  })
  store.updateItem(nulledBack.id, {
    projectId: null,
    dueDate: null,
    scheduledDate: null,
    scheduledTime: null,
    timeEstimateMinutes: null,
    richContent: null
  })
  f.nulledBackId = nulledBack.id
  track.push(allNull.id, allSet.id, nulledBack.id)

  // ── 4. Deep subtask tree: 6 levels + branching + a dropped child ───
  const root = store.createItem({ kind: 'task', title: 'lineage root', status: 'active' })
  f.rootId = root.id
  const chain: string[] = [root.id]
  let parent = root
  for (let d = 1; d <= 6; d++) {
    const child = store.createItem({
      kind: 'task',
      title: `chain depth ${d}`,
      status: d % 2 === 0 ? 'done' : 'active'
    })
    if (d % 2 === 0) store.updateItem(child.id, { status: 'active' }) // reset...
    store.linkItems(child.id, parent.id, 'subtask-of')
    chain.push(child.id)
    parent = child
  }
  f.chainIds = chain

  // Three extra siblings directly under the root (besides chain[1]).
  const sibs: string[] = []
  for (let s = 0; s < 3; s++) {
    const sib = store.createItem({ kind: 'task', title: `sibling ${s}`, status: 'active' })
    store.linkItems(sib.id, root.id, 'subtask-of')
    sibs.push(sib.id)
  }
  f.siblingIds = sibs
  // Each sibling gets two children of its own (breadth at depth 2).
  for (const sid of sibs) {
    for (let c = 0; c < 2; c++) {
      const gc = store.createItem({ kind: 'task', title: `grandchild of ${sid.slice(0, 4)} #${c}`, status: 'active' })
      store.linkItems(gc.id, sid, 'subtask-of')
      track.push(gc.id)
    }
  }
  // A dropped child under the root — must be excluded from tree queries
  // identically before and after restore.
  const dropped = store.createItem({ kind: 'task', title: 'dropped child', status: 'active' })
  store.linkItems(dropped.id, root.id, 'subtask-of')
  store.updateItem(dropped.id, { status: 'dropped' })
  f.droppedChildId = dropped.id
  track.push(root.id, ...chain.slice(1), ...sibs, dropped.id)

  // ── 5. Ordering: reorderItems integers, then exact fractional REALs ─
  // The UI's drag-reorder writes 0..n-1; drag-between writes fractions.
  store.reorderItems([sibs[2], sibs[0], sibs[1], chain[1]])
  // Fractions chosen to be non-representable-in-decimal doubles, so an
  // exact double round-trip is really being tested (0.1+0.2 !== 0.3).
  const fractions = [0.1 + 0.2, 1.25, 2.718281828459045, 1e-9, 987654321.123456]
  const fracIds: string[] = []
  fractions.forEach((fr, i) => {
    const it = store.createItem({ kind: 'task', title: `fractional ${i}`, status: 'active' })
    store.linkItems(it.id, sibs[0], 'subtask-of')
    store.updateItem(it.id, { sortOrder: fr })
    fracIds.push(it.id)
  })
  f.fractionalIds = fracIds
  track.push(...fracIds)

  // ── 6. Done subtasks on known dates, for completedSubtasksOn ───────
  // Deepest chain node done on 2026-08-05 (backdated), a grandchild
  // done on 2026-08-01, and the moved-completion date 2026-06-30 is
  // covered by item `moved` (not a subtask — must NOT appear).
  store.updateItem(chain[6], { status: 'done', completedAt: '2026-08-05' })
  store.updateItem(chain[4], { status: 'done', completedAt: '2026-08-05 18:45:00' })
  const gcs = store.subtasksOf(sibs[1])
  store.updateItem(gcs[0].id, { status: 'done', completedAt: '2026-08-01' })

  return { ...(f as Fixture), trackedIds: track }
}

function observe(store: Store, f: Fixture): Observations {
  const subtasksByParent: Record<string, Item[]> = {}
  for (const pid of [f.rootId, ...f.chainIds.slice(1, 6), ...f.siblingIds]) {
    subtasksByParent[pid] = store.subtasksOf(pid)
  }
  const itemsById: Record<string, Item | null> = {}
  for (const id of f.trackedIds) itemsById[id] = store.getItem(id)
  return {
    tree: store.subtaskTreeOf(f.rootId),
    ancestorsOfDeepest: store.ancestorsOf(f.chainIds[6]),
    ancestorsOfRoot: store.ancestorsOf(f.rootId),
    subtasksByParent,
    doneOn0805: store.completedSubtasksOn('2026-08-05'),
    doneOn0801: store.completedSubtasksOn('2026-08-01'),
    doneOn0630: store.completedSubtasksOn('2026-06-30'),
    itemsById,
    allItems: store.allItems(),
    recentCompleted: store.recentCompleted(200),
    starred: store.starredItems()
  }
}

/** Raw rows incl. rowid — rowids are load-bearing (sibling tie-breaks). */
function dumpRaw(dbPath: string): { items: unknown[]; links: unknown[] } {
  const db = new DatabaseConstructor(dbPath, { readonly: true })
  const items = db.prepare('SELECT rowid, * FROM items ORDER BY id').all()
  const links = db.prepare('SELECT rowid, * FROM links ORDER BY id').all()
  db.close()
  return { items, links }
}

// ─── One backup → restore round-trip shared by every assertion ───────
let fixture: Fixture
let before: Observations
let after: Observations
let rawBefore: { items: unknown[]; links: unknown[] }
let rawAfter: { items: unknown[]; links: unknown[] }
let bytesIdentical: boolean
let restored: Store

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'braincells-lineage-audit-'))
  const livePath = join(dir, 'live.sqlite3')
  const backupPath = join(dir, 'backup.sqlite3')
  const targetPath = join(dir, 'target.sqlite3')

  const live = new Store(livePath)
  fixture = seed(live)
  before = observe(live, fixture)
  live.db.pragma('wal_checkpoint(TRUNCATE)')
  rawBefore = dumpRaw(livePath)

  // The REAL backup path.
  await live.db.backup(backupPath)
  live.close()

  // The REAL restore path, onto a pre-existing (different) database.
  const other = new Store(targetPath)
  other.createItem({ kind: 'task', title: 'junk to be overwritten' })
  other.close()
  replaceDatabase(targetPath, backupPath)
  bytesIdentical = readFileSync(backupPath).equals(readFileSync(targetPath))

  // Reopen exactly as the app relaunch does (migrations re-run: no-op).
  restored = new Store(targetPath)
  after = observe(restored, fixture)
  restored.db.pragma('wal_checkpoint(TRUNCATE)')
  rawAfter = dumpRaw(targetPath)
})

afterAll(() => {
  restored?.close()
})

describe('lineage & item integrity: backup → replaceDatabase → new Store', () => {
  it('replaceDatabase leaves the restored file byte-identical to the backup', () => {
    expect(bytesIdentical).toBe(true)
  })

  it('items table is row-for-row identical, including rowids', () => {
    expect(rawAfter.items).toHaveLength(rawBefore.items.length)
    expect(rawAfter.items).toEqual(rawBefore.items)
  })

  it('links table is row-for-row identical, including rowids', () => {
    expect(rawAfter.links).toHaveLength(rawBefore.links.length)
    expect(rawAfter.links).toEqual(rawBefore.links)
  })

  it('every kind × status item reads back identically via getItem', () => {
    for (const kind of KINDS) {
      for (const status of STATUSES) {
        const id = fixture.gridIds.get(`${kind}/${status}`)!
        expect(after.itemsById[id], `${kind}/${status}`).toEqual(before.itemsById[id])
        expect(after.itemsById[id]!.kind).toBe(kind)
        expect(after.itemsById[id]!.status).toBe(status)
      }
    }
  })

  it('deep subtask tree (6 levels) is identical: order, depths, parentIds', () => {
    expect(after.tree).toHaveLength(before.tree.length)
    expect(after.tree).toEqual(before.tree)
    // The straight chain really is 6 levels deep.
    const depths = after.tree.filter((n) => fixture.chainIds.includes(n.item.id)).map((n) => n.depth)
    expect(Math.max(...depths)).toBe(6)
    // And the dropped child is excluded on both sides.
    expect(before.tree.some((n) => n.item.id === fixture.droppedChildId)).toBe(false)
    expect(after.tree.some((n) => n.item.id === fixture.droppedChildId)).toBe(false)
  })

  it('ancestorsOf the deepest node returns the identical root-first chain', () => {
    expect(after.ancestorsOfDeepest).toEqual(before.ancestorsOfDeepest)
    expect(after.ancestorsOfDeepest.map((i) => i.id)).toEqual(fixture.chainIds.slice(0, 6))
    expect(after.ancestorsOfRoot).toEqual([]) // top-level item: empty both sides
  })

  it('subtasksOf every parent returns identical ordered lists', () => {
    for (const [pid, list] of Object.entries(before.subtasksByParent)) {
      expect(after.subtasksByParent[pid], `parent ${pid}`).toEqual(list)
    }
  })

  it('reorderItems integer sort orders are preserved exactly', () => {
    const [s2, s0, s1] = [fixture.siblingIds[2], fixture.siblingIds[0], fixture.siblingIds[1]]
    expect(after.itemsById[s2]!.sortOrder).toBe(0)
    expect(after.itemsById[s0]!.sortOrder).toBe(1)
    expect(after.itemsById[s1]!.sortOrder).toBe(2)
    expect(after.itemsById[fixture.chainIds[1]]!.sortOrder).toBe(3)
  })

  it('fractional REAL sort orders survive as exact IEEE doubles', () => {
    const expected = [0.1 + 0.2, 1.25, 2.718281828459045, 1e-9, 987654321.123456]
    fixture.fractionalIds.forEach((id, i) => {
      const b = before.itemsById[id]!.sortOrder
      const a = after.itemsById[id]!.sortOrder
      expect(Object.is(a, b), `fractional #${i} bit-exact`).toBe(true)
      expect(a).toBe(expected[i])
    })
  })

  it('backdated completions survive: noon-normalized, full timestamp, and moved', () => {
    expect(after.itemsById[fixture.backdateNoonId]!.completedAt).toBe('2026-08-01 12:00:00')
    expect(after.itemsById[fixture.backdateFullId]!.completedAt).toBe('2026-07-15 09:30:00')
    expect(after.itemsById[fixture.movedCompletionId]!.completedAt).toBe('2026-06-30 12:00:00')
    for (const id of [fixture.backdateNoonId, fixture.backdateFullId, fixture.movedCompletionId]) {
      expect(after.itemsById[id]).toEqual(before.itemsById[id])
    }
    // Product quirk carried faithfully: createItem({status:'done'})
    // never stamped completedAt — the NULL must survive restore too.
    expect(before.itemsById[fixture.createdDoneDirectlyId]!.completedAt).toBeNull()
    expect(after.itemsById[fixture.createdDoneDirectlyId]!.completedAt).toBeNull()
  })

  it('created_at and updated_at are unchanged on every tracked item', () => {
    for (const id of fixture.trackedIds) {
      expect(after.itemsById[id]!.createdAt, id).toBe(before.itemsById[id]!.createdAt)
      expect(after.itemsById[id]!.updatedAt, id).toBe(before.itemsById[id]!.updatedAt)
    }
  })

  it('nullable columns identical in both null and non-null form', () => {
    const an = after.itemsById[fixture.allNullId]!
    expect(an).toEqual(before.itemsById[fixture.allNullId])
    expect(an.projectId).toBeNull()
    expect(an.sectionId).toBeNull()
    expect(an.dueDate).toBeNull()
    expect(an.scheduledDate).toBeNull()
    expect(an.scheduledTime).toBeNull()
    expect(an.timeEstimateMinutes).toBeNull()
    expect(an.richContent).toBeNull()
    expect(an.completedAt).toBeNull()
    expect(an.starred).toBe(false)
    expect(an.content).toBe('') // NOT NULL default, not null

    const as_ = after.itemsById[fixture.allSetId]!
    expect(as_).toEqual(before.itemsById[fixture.allSetId])
    expect(as_.projectId).not.toBeNull()
    expect(as_.sectionId).not.toBeNull()
    expect(as_.dueDate).toBe('2026-08-20')
    expect(as_.scheduledDate).toBe('2026-08-11')
    expect(as_.scheduledTime).toBe('09:15')
    expect(as_.timeEstimateMinutes).toBe(45)
    expect(as_.richContent).toContain('<h1>rich</h1>')
    expect(as_.starred).toBe(true)
    expect(as_.sortOrder).toBe(123.456789)

    const nb = after.itemsById[fixture.nulledBackId]!
    expect(nb).toEqual(before.itemsById[fixture.nulledBackId])
    expect(nb.projectId).toBeNull()
    expect(nb.dueDate).toBeNull()
    expect(nb.scheduledDate).toBeNull()
    expect(nb.scheduledTime).toBeNull()
    expect(nb.timeEstimateMinutes).toBeNull()
  })

  it('completedSubtasksOn returns identical rollups for every probed date', () => {
    expect(after.doneOn0805).toEqual(before.doneOn0805)
    expect(after.doneOn0801).toEqual(before.doneOn0801)
    expect(after.doneOn0630).toEqual(before.doneOn0630)
    // Shape sanity: 08-05 has the two chain completions rooted at root.
    const d5 = after.doneOn0805 as Array<{ rootId: string; depth: number; item: Item }>
    const chainDone = d5.filter((r) => r.rootId === fixture.rootId)
    expect(chainDone.map((r) => r.item.id).sort()).toEqual([fixture.chainIds[4], fixture.chainIds[6]].sort())
    expect(chainDone.map((r) => r.depth).sort()).toEqual([4, 6])
    // 06-30's completion belongs to a non-subtask — absent on both sides.
    expect((before.doneOn0630 as unknown[]).length).toBe(0)
    expect((after.doneOn0630 as unknown[]).length).toBe(0)
  })

  it('whole-store views (allItems, recentCompleted, starred) are identical', () => {
    expect(after.allItems).toHaveLength(before.allItems.length)
    expect(after.allItems).toEqual(before.allItems)
    expect(after.recentCompleted).toEqual(before.recentCompleted)
    expect(after.starred).toEqual(before.starred)
  })
})
