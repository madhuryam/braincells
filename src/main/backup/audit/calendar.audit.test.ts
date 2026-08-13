import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import DatabaseConstructor from 'better-sqlite3'
import { Store } from '../../store'
import { buildExport } from '../export'
import { replaceDatabase } from '../restore'

/**
 * AUDIT: calendar/timeline data through backup → restore.
 *
 * Exercises the exact production code paths:
 *   - Create Backup  = store.db.backup(path)
 *   - Restore        = replaceDatabase(dbPath, backupPath) then new Store(dbPath)
 *
 * Covers: local_events (every column, incl. project- and item-linked
 * blocks), time-blocked tasks (scheduled_date/scheduled_time/
 * time_estimate_minutes), the meetings table, calendar-related settings
 * (timelineBounds, calendarLabels, calendarLabelOrder, google keys) as
 * raw byte-identical JSON, meeting notes (notes-for links with event
 * snapshots), and carryOver() semantics on restored data.
 */

const NASTY_TITLES = [
  'plain block',
  'emoji 🧠🗓️✅ block',
  'quotes "double" \'single\' `back`',
  'newlines\nand\ttabs',
  "Robert'); DROP TABLE local_events;--",
  'ünîcödé — café עברית 中文',
  '   padded   ',
  ''
]

// ── helpers ───────────────────────────────────────────────────────────

interface Fixture {
  dir: string
  livePath: string
  backupPath: string
  targetPath: string
}

function makeDirs(prefix: string): Fixture {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return {
    dir,
    livePath: join(dir, 'live.sqlite3'),
    backupPath: join(dir, 'backup.sqlite3'),
    targetPath: join(dir, 'target.sqlite3')
  }
}

/** The real backup → restore cycle. Closes `live`; returns the restored Store. */
async function backupAndRestore(live: Store, fx: Fixture): Promise<Store> {
  await live.db.backup(fx.backupPath)
  live.close()
  // Restore over a DIFFERENT live db (as the app does), with WAL junk present.
  const other = new Store(fx.targetPath)
  other.createItem({ kind: 'task', title: 'pre-restore junk, must vanish' })
  other.createLocalEvent({ title: 'junk block', date: '2020-01-01', startTime: '01:00', endTime: '02:00' })
  other.close()
  replaceDatabase(fx.targetPath, fx.backupPath)
  return new Store(fx.targetPath) // runs migrate() again — must be a no-op
}

/** Raw rows of a table, deterministic order, via an independent readonly connection. */
function rawRows(store: Store, table: string, orderBy: string): unknown[] {
  store.db.pragma('wal_checkpoint(TRUNCATE)')
  const db = new DatabaseConstructor(store.path, { readonly: true })
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all()
  db.close()
  return rows
}

// ── local_events: every column ────────────────────────────────────────

describe('local_events survive backup → restore byte-for-byte', () => {
  it('all columns: id, title, date, start/end times, project_id, item_id, created_at', async () => {
    const fx = makeDirs('bc-audit-localevents-')
    const live = new Store(fx.livePath)

    const project = live.createProject('Timeline Project 🗓️', '#845ef7')
    const task = live.createItem({ kind: 'task', title: 'task with blocks', status: 'active' })

    // Plain block (no project, no item).
    const plain = live.createLocalEvent({
      title: NASTY_TITLES[1],
      date: '2026-08-11',
      startTime: '08:00',
      endTime: '09:30'
    })
    // Project-linked block.
    const projBlock = live.createLocalEvent({
      title: 'deep work',
      date: '2026-08-11',
      startTime: '10:00',
      endTime: '12:00',
      projectId: project.id
    })
    // Item-linked block (a task blocked a second time on the calendar).
    const itemBlock = live.createLocalEvent({
      title: 'task with blocks',
      date: '2026-08-12',
      startTime: '14:15',
      endTime: '15:45',
      itemId: task.id
    })
    // Block linked to BOTH a project and an item.
    const bothBlock = live.createLocalEvent({
      title: NASTY_TITLES[4],
      date: '2026-08-13',
      startTime: '23:00',
      endTime: '23:59',
      projectId: project.id,
      itemId: task.id
    })
    // One block per nasty title, spread over dates.
    for (let i = 0; i < NASTY_TITLES.length; i++) {
      live.createLocalEvent({
        title: NASTY_TITLES[i],
        date: `2026-08-${String(i + 1).padStart(2, '0')}`,
        startTime: '06:05',
        endTime: '07:10',
        projectId: i % 2 === 0 ? project.id : null
      })
    }
    // An edited block: updateLocalEvent touches every editable column.
    live.updateLocalEvent(plain.id, {
      title: 'renamed after the fact',
      date: '2026-08-14',
      startTime: '05:00',
      endTime: '06:00',
      projectId: project.id
    })

    const beforeRaw = rawRows(live, 'local_events', 'id')
    const beforeDay11 = live.localEventsFor('2026-08-11')
    const beforeDay12 = live.localEventsFor('2026-08-12')
    const beforeDay14 = live.localEventsFor('2026-08-14')
    expect(beforeRaw).toHaveLength(4 + NASTY_TITLES.length)

    const restored = await backupAndRestore(live, fx)

    // Raw table byte-for-byte (includes created_at, which the LocalEvent
    // type does not expose — only the raw dump proves it survives).
    expect(rawRows(restored, 'local_events', 'id')).toEqual(beforeRaw)

    // The API the timeline actually calls returns identical shapes.
    expect(restored.localEventsFor('2026-08-11')).toEqual(beforeDay11)
    expect(restored.localEventsFor('2026-08-12')).toEqual(beforeDay12)
    expect(restored.localEventsFor('2026-08-14')).toEqual(beforeDay14)

    // Specific rows keep their links.
    const day12 = restored.localEventsFor('2026-08-12')
    expect(day12.find((e) => e.id === itemBlock.id)?.itemId).toBe(task.id)
    const day13 = restored.localEventsFor('2026-08-13')
    const both = day13.find((e) => e.id === bothBlock.id)!
    expect(both.projectId).toBe(project.id)
    expect(both.itemId).toBe(task.id)
    expect(restored.localEventsFor('2026-08-11').find((e) => e.id === projBlock.id)?.projectId).toBe(
      project.id
    )
    restored.close()
  })

  it('item-linked blocks still cascade correctly after restore (FK behavior intact)', async () => {
    const fx = makeDirs('bc-audit-le-fk-')
    const live = new Store(fx.livePath)
    const task = live.createItem({ kind: 'task', title: 'doomed task', status: 'active' })
    live.createLocalEvent({
      title: 'block of doomed task',
      date: '2026-08-11',
      startTime: '09:00',
      endTime: '10:00',
      itemId: task.id
    })
    const restored = await backupAndRestore(live, fx)
    expect(restored.localEventsFor('2026-08-11')).toHaveLength(1)
    // The restored Store re-enables foreign_keys; deleting the task must
    // still take its block with it (ON DELETE CASCADE travels in the file).
    restored.deleteItem(task.id)
    expect(restored.localEventsFor('2026-08-11')).toHaveLength(0)
    restored.close()
  })
})

// ── time-blocked tasks ────────────────────────────────────────────────

describe('time-blocked tasks survive backup → restore', () => {
  it('scheduled_date + scheduled_time + time_estimate_minutes; scheduledBlocks() and calendarMinutes() identical', async () => {
    const fx = makeDirs('bc-audit-blocks-')
    const live = new Store(fx.livePath)
    const day = '2026-08-11'

    // Active block with an estimate.
    const a = live.createItem({
      kind: 'task',
      title: 'morning block',
      status: 'active',
      scheduledDate: day,
      scheduledTime: '09:00',
      timeEstimateMinutes: 90
    })
    // Done block — stays on the calendar (faded) so must survive too.
    const b = live.createItem({
      kind: 'task',
      title: 'finished block ✅',
      status: 'active',
      scheduledDate: day,
      scheduledTime: '11:30',
      timeEstimateMinutes: 45
    })
    live.updateItem(b.id, { status: 'done' })
    // Block with a time but NO estimate (drawn without a length).
    const c = live.createItem({
      kind: 'task',
      title: 'no-estimate block',
      status: 'active',
      scheduledDate: day,
      scheduledTime: '23:45'
    })
    // Scheduled but not time-blocked — must NOT appear in scheduledBlocks.
    live.createItem({ kind: 'task', title: 'list-only task', status: 'active', scheduledDate: day })
    // Task blocked multiple times: own slot + two linked local blocks.
    live.createLocalEvent({ title: 'morning block', date: day, startTime: '14:00', endTime: '14:30', itemId: a.id })
    live.createLocalEvent({ title: 'morning block', date: day, startTime: '16:00', endTime: '16:15', itemId: a.id })

    const beforeBlocks = live.scheduledBlocks(day)
    const beforeMinutesA = live.calendarMinutes(a.id)
    const beforeMinutesB = live.calendarMinutes(b.id)
    const beforeMinutesC = live.calendarMinutes(c.id)
    const beforeCountA = live.calendarInstanceCount(a.id)
    expect(beforeBlocks.map((i) => i.id)).toEqual([a.id, b.id, c.id]) // ordered by time
    expect(beforeMinutesA).toBe(90 + 30 + 15)
    expect(beforeMinutesB).toBe(45)
    expect(beforeMinutesC).toBe(0)
    expect(beforeCountA).toBe(3)

    const restored = await backupAndRestore(live, fx)

    expect(restored.scheduledBlocks(day)).toEqual(beforeBlocks)
    expect(restored.calendarMinutes(a.id)).toBe(beforeMinutesA)
    expect(restored.calendarMinutes(b.id)).toBe(beforeMinutesB)
    expect(restored.calendarMinutes(c.id)).toBe(beforeMinutesC)
    expect(restored.calendarInstanceCount(a.id)).toBe(beforeCountA)

    // Field-level checks on the restored rows, incl. completed_at on the
    // done block (its calendar record keeps its completion stamp).
    const rb = restored.getItem(b.id)!
    expect(rb.status).toBe('done')
    expect(rb.scheduledDate).toBe(day)
    expect(rb.scheduledTime).toBe('11:30')
    expect(rb.timeEstimateMinutes).toBe(45)
    expect(rb.completedAt).toBeTruthy()
    const rc = restored.getItem(c.id)!
    expect(rc.scheduledTime).toBe('23:45')
    expect(rc.timeEstimateMinutes).toBeNull()
    restored.close()
  })
})

// ── meetings + meeting notes + label overrides ────────────────────────

describe('meetings table and calendar-event metadata survive backup → restore', () => {
  it('meetings rows (event_key, project_id, title, date) byte-for-byte; lookups identical', async () => {
    const fx = makeDirs('bc-audit-meetings-')
    const live = new Store(fx.livePath)
    const p1 = live.createProject('Meetings Project', '#1c7ed6')
    const p2 = live.createProject('Other Project', '#e64980')

    // With project, without project (explicit null), unicode titles.
    live.assignMeetingProject(
      { eventKey: 'gcal-abc::2026-08-11', title: 'Standup 🧠', date: '2026-08-11' },
      p1.id
    )
    live.assignMeetingProject(
      { eventKey: 'gcal-def::2026-08-12', title: "Robert'); DROP TABLE meetings;--", date: '2026-08-12' },
      null
    )
    live.assignMeetingProject(
      { eventKey: 'gcal-ghi::2026-08-13', title: 'עברית review —中文', date: '2026-08-13' },
      p2.id
    )
    // Re-assignment (upsert path) — last write wins and must survive.
    live.assignMeetingProject(
      { eventKey: 'gcal-abc::2026-08-11', title: 'Standup 🧠 (renamed)', date: '2026-08-11' },
      p2.id
    )
    // Snapshot refresh (what happens when Google sends fresh events).
    live.refreshEventSnapshots([
      { eventKey: 'gcal-ghi::2026-08-13', title: 'moved review', date: '2026-08-14', startTime: null, endTime: null }
    ])

    // Meeting notes: an item linked to the event with its survival snapshot.
    const note = live.createItem({ kind: 'note', title: 'notes for standup', content: 'agenda…', status: 'active' })
    live.linkToEvent(
      note.id,
      { eventKey: 'gcal-abc::2026-08-11', title: 'Standup 🧠 (renamed)', date: '2026-08-11', startTime: null, endTime: null },
      'notes-for'
    )
    const prep = live.createItem({ kind: 'prep', title: 'prep the deck', status: 'active' })
    live.linkToEvent(
      prep.id,
      { eventKey: 'gcal-ghi::2026-08-13', title: 'moved review', date: '2026-08-14', startTime: null, endTime: null },
      'prep-for'
    )

    const beforeMeetings = rawRows(live, 'meetings', 'event_key')
    const beforeAll = live.allMeetings()
    const beforeByKeys = live.meetingsByKeys(['gcal-abc::2026-08-11', 'gcal-ghi::2026-08-13'])
    const beforeForP2 = live.meetingsForProject(p2.id)
    const beforeNotes = live.itemsForEvent('gcal-abc::2026-08-11', 'notes-for')
    const beforePrep = live.prepProgress(['gcal-ghi::2026-08-13'])

    const restored = await backupAndRestore(live, fx)

    expect(rawRows(restored, 'meetings', 'event_key')).toEqual(beforeMeetings)
    expect(restored.allMeetings()).toEqual(beforeAll)
    expect(restored.meetingsByKeys(['gcal-abc::2026-08-11', 'gcal-ghi::2026-08-13'])).toEqual(beforeByKeys)
    expect(restored.meetingsForProject(p2.id)).toEqual(beforeForP2)
    expect(restored.getMeeting('gcal-abc::2026-08-11')).toEqual({
      eventKey: 'gcal-abc::2026-08-11',
      projectId: p2.id,
      title: 'Standup 🧠 (renamed)',
      date: '2026-08-11',
      links: []
    })
    // Meeting notes: link + snapshot + prep deadline all intact.
    expect(restored.itemsForEvent('gcal-abc::2026-08-11', 'notes-for')).toEqual(beforeNotes)
    expect(restored.getItem(prep.id)?.dueDate).toBe('2026-08-14') // prep-for stamped the due date
    expect(restored.prepProgress(['gcal-ghi::2026-08-13'])).toEqual(beforePrep)
    restored.close()
  })
})

// ── settings round-trip ───────────────────────────────────────────────

describe('settings survive backup → restore byte-identically', () => {
  it('every calendar/google/UI settings key, raw JSON text unchanged', async () => {
    const fx = makeDirs('bc-audit-settings-')
    const live = new Store(fx.livePath)
    const p = live.createProject('Labelled', '#20c997')

    // Every key the app writes (grepped from main + renderer):
    live.setSetting('theme', 'plum')
    live.setSetting('timeZone', 'America/New_York')
    live.setSetting('timelineBounds', { start: 6, end: 22 })
    live.setSetting('calendarMode', 'google')
    live.setSetting('hideWorkLocation', true)
    live.setSetting('showDuePill', false)
    live.setSetting('showTimePill', true)
    live.setSetting('projectScratch', { [p.id]: 'scratch text 🧠\nline two' })
    live.setSetting('googleClient', { clientId: 'abc.apps.googleusercontent.com', clientSecret: 's3cr3t' })
    live.setSetting('googleTokens', { accessToken: 'ya29.xyz', refreshToken: '1//refresh', expiresAt: 1785200000000 })
    // Calendar label overrides — the sparse per-color map (LabelOverride).
    live.setSetting('calendarLabels', {
      '1': { name: 'Deep work 🧠', hex: '#123456', projectId: p.id },
      '7': { name: 'ünîcödé ñame', hex: '#abcdef', projectId: null },
      '11': { hex: '#ff0000' } // partial override — name omitted
    })
    live.setSetting('calendarLabelOrder', ['7', '1', '11', '2'])
    // Edge values JSON must carry losslessly.
    live.setSetting('edge:null', null)
    live.setSetting('edge:emptyString', '')
    live.setSetting('edge:zero', 0)
    live.setSetting('edge:false', false)
    live.setSetting('edge:nested', { a: [1, 'two', { three: null }], b: 'quote " backslash \\ end' })

    const beforeRaw = rawRows(live, 'settings', 'key') as Array<{ key: string; value: string }>
    expect(beforeRaw).toHaveLength(17)

    const restored = await backupAndRestore(live, fx)

    // Raw TEXT column byte-identical — not merely deep-equal after parse.
    const afterRaw = rawRows(restored, 'settings', 'key') as Array<{ key: string; value: string }>
    expect(afterRaw).toEqual(beforeRaw)
    for (let i = 0; i < beforeRaw.length; i++) {
      expect(afterRaw[i].value).toBe(beforeRaw[i].value)
    }

    // And the parsed API returns the same objects.
    expect(restored.getSetting('timelineBounds')).toEqual({ start: 6, end: 22 })
    expect(restored.getSetting('calendarLabels')).toEqual({
      '1': { name: 'Deep work 🧠', hex: '#123456', projectId: p.id },
      '7': { name: 'ünîcödé ñame', hex: '#abcdef', projectId: null },
      '11': { hex: '#ff0000' }
    })
    expect(restored.getSetting('calendarLabelOrder')).toEqual(['7', '1', '11', '2'])
    expect(restored.getSetting('googleTokens')).toEqual({
      accessToken: 'ya29.xyz',
      refreshToken: '1//refresh',
      expiresAt: 1785200000000
    })
    expect(restored.getSetting('edge:emptyString')).toBe('')
    expect(restored.getSetting('edge:zero')).toBe(0)
    expect(restored.getSetting('edge:false')).toBe(false)
    // NOTE: getSetting cannot distinguish a stored JSON `null` from a
    // missing key (both return null) — but the raw row comparison above
    // proves the `null` VALUE itself survives the backup byte-for-byte,
    // so this is an API quirk, not a fidelity gap.
    expect(restored.getSetting('edge:null')).toBeNull()
    restored.close()
  })
})

// ── carryOver on restored data ────────────────────────────────────────

describe('carryOver() behaves correctly on a restored database', () => {
  it('moves exactly the right rows, clears times/estimates per spec, leaves the rest alone', async () => {
    const fx = makeDirs('bc-audit-carryover-')
    const live = new Store(fx.livePath)
    const today = '2026-08-11'

    // Should move: active past task WITHOUT a time (estimate kept).
    const plainPast = live.createItem({
      kind: 'task', title: 'past plain', status: 'active',
      scheduledDate: '2026-08-09', timeEstimateMinutes: 30
    })
    // Should move: active past task WITH a time (time AND estimate cleared —
    // a missed block lands on the list, off the calendar).
    const blockedPast = live.createItem({
      kind: 'task', title: 'past blocked', status: 'active',
      scheduledDate: '2026-08-10', scheduledTime: '09:00', timeEstimateMinutes: 60
    })
    // Should NOT move: done in the past (history stays put).
    const donePast = live.createItem({
      kind: 'task', title: 'past done', status: 'active',
      scheduledDate: '2026-08-08', scheduledTime: '10:00', timeEstimateMinutes: 15
    })
    live.updateItem(donePast.id, { status: 'done' })
    // Should NOT move: inbox task with a past date (not yet triaged).
    const inboxPast = live.createItem({
      kind: 'task', title: 'past inbox', status: 'inbox', scheduledDate: '2026-08-05'
    })
    // Should NOT move: non-task kinds (journal pinned to its day).
    const journalPast = live.journalFor('2026-08-09')
    // Should NOT move: today's and future tasks.
    const todayTask = live.createItem({
      kind: 'task', title: 'today task', status: 'active', scheduledDate: today, scheduledTime: '14:00'
    })
    const futureTask = live.createItem({
      kind: 'task', title: 'future task', status: 'active', scheduledDate: '2026-08-12'
    })

    const restored = await backupAndRestore(live, fx)

    const moved = restored.carryOver(today)
    expect(moved).toBe(2)

    const rPlain = restored.getItem(plainPast.id)!
    expect(rPlain.scheduledDate).toBe(today)
    expect(rPlain.scheduledTime).toBeNull()
    expect(rPlain.timeEstimateMinutes).toBe(30) // kept — it never had a time slot

    const rBlocked = restored.getItem(blockedPast.id)!
    expect(rBlocked.scheduledDate).toBe(today)
    expect(rBlocked.scheduledTime).toBeNull() // block does not follow the task
    expect(rBlocked.timeEstimateMinutes).toBeNull() // estimate goes with the time

    expect(restored.getItem(donePast.id)!.scheduledDate).toBe('2026-08-08')
    expect(restored.getItem(donePast.id)!.scheduledTime).toBe('10:00')
    expect(restored.getItem(inboxPast.id)!.scheduledDate).toBe('2026-08-05')
    expect(restored.getItem(journalPast.id)!.scheduledDate).toBe('2026-08-09')
    expect(restored.getItem(todayTask.id)!.scheduledDate).toBe(today)
    expect(restored.getItem(todayTask.id)!.scheduledTime).toBe('14:00')
    expect(restored.getItem(futureTask.id)!.scheduledDate).toBe('2026-08-12')

    // The carried-over tasks now appear on today's list; running again is a no-op.
    const ids = restored.tasksFor(today).map((i) => i.id)
    expect(ids).toContain(plainPast.id)
    expect(ids).toContain(blockedPast.id)
    expect(restored.carryOver(today)).toBe(0)
    restored.close()
  })
})

// ── export coverage (gap fixed: timeblocks + settings now export) ─────

describe('markdown export: calendar-domain coverage', () => {
  it('timeblocks.json, settings.json (sans credentials), and time-block front matter are all in the export tree', () => {
    const store = new Store(':memory:')
    const p = store.createProject('P', '#845ef7')
    const block = store.createLocalEvent({ title: 'exported block', date: '2026-08-11', startTime: '08:00', endTime: '09:00', projectId: p.id })
    store.setSetting('timelineBounds', { start: 6, end: 22 })
    store.setSetting('calendarLabels', { '1': { name: 'Deep work', hex: '#123456' } })
    store.setSetting('googleClient', { clientId: 'abc.apps.googleusercontent.com', clientSecret: 's3cr3t' })
    store.setSetting('googleTokens', { accessToken: 'ya29.xyz', refreshToken: '1//refresh' })
    store.assignMeetingProject({ eventKey: 'k::2026-08-11', title: 'M', date: '2026-08-11' }, p.id)

    const files = buildExport(store)
    const paths = new Set(files.map((f) => f.path))

    // Meetings ARE exported.
    expect(paths.has('meetings.json')).toBe(true)
    const meetings = JSON.parse(files.find((f) => f.path === 'meetings.json')!.contents)
    expect(meetings).toHaveLength(1)

    // Time blocks: timeblocks.json carries every local event with the
    // full LocalEvent shape (id, title, date, times, project/item links).
    expect(paths.has('timeblocks.json')).toBe(true)
    const timeblocks = JSON.parse(files.find((f) => f.path === 'timeblocks.json')!.contents)
    expect(timeblocks).toEqual([
      {
        id: block.id,
        title: 'exported block',
        date: '2026-08-11',
        startTime: '08:00',
        endTime: '09:00',
        projectId: p.id,
        itemId: null
      }
    ])

    // Settings: settings.json round-trips every key…
    expect(paths.has('settings.json')).toBe(true)
    const settings = JSON.parse(files.find((f) => f.path === 'settings.json')!.contents)
    expect(settings.timelineBounds).toEqual({ start: 6, end: 22 })
    expect(settings.calendarLabels).toEqual({ '1': { name: 'Deep work', hex: '#123456' } })
    // …EXCEPT credentials: OAuth client + tokens must never land in a
    // human-readable, shareable export folder.
    expect(settings).not.toHaveProperty('googleClient')
    expect(settings).not.toHaveProperty('googleTokens')
    const blob = files.map((f) => f.contents).join('\n')
    expect(blob).not.toContain('s3cr3t')
    expect(blob).not.toContain('ya29.xyz')
    expect(blob).not.toContain('1//refresh')

    // The manifest counts the new files' rows.
    const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.contents)
    expect(manifest.counts.timeblocks).toBe(1)
    expect(manifest.counts.settings).toBe(2) // credentials excluded from the count too

    // Item front matter now carries the time-block fields: a time-blocked
    // task exports its slot and estimate, not just its date.
    const t = store.createItem({
      kind: 'task', title: 'blocked task', status: 'active',
      scheduledDate: '2026-08-11', scheduledTime: '09:00', timeEstimateMinutes: 45
    })
    const files2 = buildExport(store)
    const md = files2.find((f) => f.path.includes(t.id.slice(0, 8)))!.contents
    expect(md).toContain('scheduled: 2026-08-11')
    expect(md).toContain('scheduledTime: 09:00')
    expect(md).toContain('estimateMinutes: 45')
    // An un-timed task still omits the time keys entirely.
    const plain = store.createItem({
      kind: 'task', title: 'plain task', status: 'active', scheduledDate: '2026-08-11'
    })
    const files3 = buildExport(store)
    const mdPlain = files3.find((f) => f.path.includes(plain.id.slice(0, 8)))!.contents
    expect(mdPlain).toContain('scheduled: 2026-08-11')
    expect(mdPlain).not.toContain('scheduledTime:')
    expect(mdPlain).not.toContain('estimateMinutes:')
    store.close()
  })
})
