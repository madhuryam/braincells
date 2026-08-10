import { beforeEach, describe, expect, it } from 'vitest'
import { Store } from './index'
import { todayYmd, ymdAddDays } from '../../shared/dates'
import type { CalendarEvent } from '../../shared/types'

let store: Store
const today = todayYmd()

beforeEach(() => {
  store = new Store(':memory:')
})

const demoEvent: CalendarEvent = {
  eventKey: 'ev-123::2026-06-12',
  title: 'Design review',
  date: '2026-06-12',
  startTime: '10:00',
  endTime: '11:00'
}

describe('projects', () => {
  it('creates, lists and archives projects', () => {
    const p = store.createProject('Roadmap', '#e8590c')
    expect(store.listProjects()).toHaveLength(1)

    store.updateProject(p.id, { status: 'archived' })
    expect(store.listProjects()).toHaveLength(0)
    expect(store.listProjects(true)).toHaveLength(1)
  })

  it('sets and clears a nickname (null = back to the full name)', () => {
    const p = store.createProject('Customer Success & DE General', '#e8590c')
    expect(store.listProjects()[0].nickname).toBeNull()

    store.updateProject(p.id, { nickname: 'CS/DE' })
    expect(store.listProjects()[0].nickname).toBe('CS/DE')

    store.updateProject(p.id, { nickname: null })
    expect(store.listProjects()[0].nickname).toBeNull()
  })
})

describe('sections', () => {
  it('creates in order, renames, and reorders', () => {
    const p = store.createProject('Roadmap', '#e8590c')
    const testing = store.createSection(p.id, 'Testing')
    const features = store.createSection(p.id, 'Features')
    expect(store.listSections(p.id).map((s) => s.name)).toEqual(['Testing', 'Features'])

    store.renameSection(testing.id, 'QA')
    expect(store.listSections(p.id)[0].name).toBe('QA')

    store.reorderSections([features.id, testing.id])
    expect(store.listSections(p.id).map((s) => s.name)).toEqual(['Features', 'QA'])
  })

  it('sections are per-project', () => {
    const a = store.createProject('A', '#111111')
    const b = store.createProject('B', '#222222')
    store.createSection(a.id, 'only in A')
    expect(store.listSections(a.id)).toHaveLength(1)
    expect(store.listSections(b.id)).toHaveLength(0)
  })

  it('deleting a section unfiles its tasks — the tasks survive', () => {
    const p = store.createProject('Roadmap', '#e8590c')
    const s = store.createSection(p.id, 'Testing')
    const item = store.createItem({ kind: 'task', title: 't', status: 'active', projectId: p.id })
    store.updateItem(item.id, { sectionId: s.id })
    expect(store.getItem(item.id)!.sectionId).toBe(s.id)

    store.deleteSection(s.id)
    const after = store.getItem(item.id)!
    expect(after.sectionId).toBeNull()
    expect(after.projectId).toBe(p.id)
  })

  it('deleting a project takes its sections with it', () => {
    const p = store.createProject('Roadmap', '#e8590c')
    store.createSection(p.id, 'Testing')
    store.deleteProject(p.id)
    expect(store.listSections(p.id)).toHaveLength(0)
  })

  it('moving an item to another project clears its section', () => {
    const a = store.createProject('A', '#111111')
    const b = store.createProject('B', '#222222')
    const s = store.createSection(a.id, 'Testing')
    const item = store.createItem({ kind: 'task', title: 't', status: 'active', projectId: a.id })
    store.updateItem(item.id, { sectionId: s.id })

    // Plain project move (sidebar drop, picker): section goes.
    const moved = store.updateItem(item.id, { projectId: b.id })!
    expect(moved.sectionId).toBeNull()

    // But a patch that places it in a section explicitly is honored.
    const sB = store.createSection(b.id, 'Inbound')
    store.updateItem(item.id, { projectId: a.id })
    const placed = store.updateItem(item.id, { projectId: b.id, sectionId: sB.id })!
    expect(placed.sectionId).toBe(sB.id)
  })
})

describe('item lifecycle', () => {
  it('captures default to the inbox with no required decisions', () => {
    const item = store.createItem({ kind: 'task', title: 'call dentist' })
    expect(item.status).toBe('inbox')
    expect(item.projectId).toBeNull()
    expect(store.inboxCount()).toBe(1)
  })

  it('stamps completedAt on done, clears it when reopened', () => {
    const item = store.createItem({ kind: 'task', title: 't', status: 'active' })
    const done = store.updateItem(item.id, { status: 'done' })!
    expect(done.completedAt).not.toBeNull()

    const reopened = store.updateItem(item.id, { status: 'active' })!
    expect(reopened.completedAt).toBeNull()
  })

  it('completed tasks show up in that day’s log', () => {
    const item = store.createItem({ kind: 'task', title: 't', status: 'active' })
    store.updateItem(item.id, { status: 'done' })
    expect(store.completedOn(today).map((i) => i.id)).toEqual([item.id])
    expect(store.completedOn(ymdAddDays(today, -1))).toHaveLength(0)
  })

  it('backdates a completion: explicit completedAt lands (at noon) on that day', () => {
    const yesterday = ymdAddDays(today, -1)
    const item = store.createItem({ kind: 'task', title: 't', status: 'active' })

    // Done "as of" yesterday — one patch, the past-day checkbox path.
    const done = store.updateItem(item.id, { status: 'done', completedAt: yesterday })!
    expect(done.completedAt).toBe(`${yesterday} 12:00:00`)
    expect(store.completedOn(yesterday).map((i) => i.id)).toEqual([item.id])
    expect(store.completedOn(today)).toHaveLength(0)

    // Moving an existing completion — the "done on" editor path.
    const moved = store.updateItem(item.id, { completedAt: today })!
    expect(moved.completedAt).toBe(`${today} 12:00:00`)
    expect(store.completedOn(yesterday)).toHaveLength(0)

    // completedAt on a non-done item is ignored, and reopening still clears.
    const reopened = store.updateItem(item.id, { status: 'active', completedAt: yesterday })!
    expect(reopened.completedAt).toBeNull()
    const untouched = store.updateItem(item.id, { completedAt: yesterday })!
    expect(untouched.completedAt).toBeNull()
  })
})

describe('Today / This Week / carried over', () => {
  it('scheduledBlocks keeps done tasks on the day’s timeline (untimed ones stay off)', () => {
    const blocked = store.createItem({
      kind: 'task', title: 'blocked', status: 'active', scheduledDate: today, scheduledTime: '09:00'
    })
    store.createItem({ kind: 'task', title: 'no time', status: 'active', scheduledDate: today })
    store.updateItem(blocked.id, { status: 'done' })
    expect(store.scheduledBlocks(today).map((i) => i.id)).toEqual([blocked.id])
  })


  it('splits tasks by scheduled date relative to today', () => {
    const yesterday = store.createItem({
      kind: 'task', title: 'old', status: 'active', scheduledDate: ymdAddDays(today, -1)
    })
    const todayTask = store.createItem({
      kind: 'task', title: 'now', status: 'active', scheduledDate: today
    })
    const soon = store.createItem({
      kind: 'task', title: 'soon', status: 'active', scheduledDate: ymdAddDays(today, 3)
    })
    store.createItem({
      kind: 'task', title: 'far', status: 'active', scheduledDate: ymdAddDays(today, 30)
    })

    expect(store.tasksFor(today).map((i) => i.id)).toEqual([todayTask.id])
    expect(store.tasksThisWeek(today).map((i) => i.id)).toEqual([soon.id])
    expect(store.carriedOver(today).map((i) => i.id)).toEqual([yesterday.id])
  })

  it('done and dropped tasks never appear as carried over', () => {
    const a = store.createItem({
      kind: 'task', title: 'a', status: 'active', scheduledDate: ymdAddDays(today, -2)
    })
    store.updateItem(a.id, { status: 'done' })
    expect(store.carriedOver(today)).toHaveLength(0)
  })

  it('manual reorder persists', () => {
    const a = store.createItem({ kind: 'task', title: 'a', status: 'active', scheduledDate: today })
    const b = store.createItem({ kind: 'task', title: 'b', status: 'active', scheduledDate: today })
    expect(store.tasksFor(today).map((i) => i.title)).toEqual(['a', 'b'])

    store.reorderItems([b.id, a.id])
    expect(store.tasksFor(today).map((i) => i.title)).toEqual(['b', 'a'])
  })

  it('declare bankruptcy drops a batch in one go', () => {
    const a = store.createItem({ kind: 'task', title: 'a' })
    const b = store.createItem({ kind: 'task', title: 'b' })
    store.dropItems([a.id, b.id])
    expect(store.inboxCount()).toBe(0)
    expect(store.getItem(a.id)!.status).toBe('dropped')
  })
})

describe('due dates', () => {
  it('splits live tasks into due-today and overdue, never done or dropped', () => {
    const overdue = store.createItem({
      kind: 'task', title: 'late', status: 'active', dueDate: ymdAddDays(today, -2)
    })
    const lateCapture = store.createItem({ // still in the inbox — still counts
      kind: 'task', title: 'late capture', dueDate: ymdAddDays(today, -1)
    })
    const dueToday = store.createItem({
      kind: 'task', title: 'now', status: 'active', dueDate: today
    })
    store.createItem({ kind: 'task', title: 'future', status: 'active', dueDate: ymdAddDays(today, 1) })
    store.createItem({ kind: 'note', title: 'not a task', status: 'active', dueDate: today })
    const finished = store.createItem({
      kind: 'task', title: 'handled', status: 'active', dueDate: ymdAddDays(today, -3)
    })
    store.updateItem(finished.id, { status: 'done' })

    expect(store.tasksDueOn(today).map((i) => i.id)).toEqual([dueToday.id])
    // Ordered by due date (oldest deadline first), then creation.
    expect(store.tasksOverdue(today).map((i) => i.id)).toEqual([overdue.id, lateCapture.id])
  })
})

describe('links and the meeting loop', () => {
  it('attaches prep items to an event and reports progress', () => {
    const p1 = store.createItem({ kind: 'prep', title: 'read doc', status: 'active' })
    const p2 = store.createItem({ kind: 'prep', title: 'prepare questions', status: 'active' })
    store.linkToEvent(p1.id, demoEvent, 'prep-for')
    store.linkToEvent(p2.id, demoEvent, 'prep-for')
    store.updateItem(p1.id, { status: 'done' })

    const [progress] = store.prepProgress([demoEvent.eventKey])
    expect(progress).toMatchObject({ eventKey: demoEvent.eventKey, done: 1, total: 2 })

    const preps = store.itemsForEvent(demoEvent.eventKey, 'prep-for')
    expect(preps.map((li) => li.item.title)).toEqual(['read doc', 'prepare questions'])
  })

  it('prep progress counts subtasks at any depth', () => {
    const prep = store.createItem({ kind: 'prep', title: 'prep deck', status: 'active' })
    store.linkToEvent(prep.id, demoEvent, 'prep-for')
    const sub = store.createItem({ kind: 'task', title: 'collect numbers', status: 'active' })
    store.linkItems(sub.id, prep.id, 'subtask-of')
    const subsub = store.createItem({ kind: 'task', title: 'ask finance', status: 'done' })
    store.linkItems(subsub.id, sub.id, 'subtask-of')
    const dropped = store.createItem({ kind: 'task', title: 'nope', status: 'dropped' })
    store.linkItems(dropped.id, prep.id, 'subtask-of')

    // prep + sub + subsub (dropped excluded); only subsub is done.
    const [progress] = store.prepProgress([demoEvent.eventKey])
    expect(progress).toMatchObject({ eventKey: demoEvent.eventKey, done: 1, total: 3 })
  })

  it('prep links stamp the meeting date as the due date; other roles don’t', () => {
    const prep = store.createItem({ kind: 'prep', title: 'read doc', status: 'active' })
    store.linkToEvent(prep.id, demoEvent, 'prep-for')
    expect(store.getItem(prep.id)!.dueDate).toBe(demoEvent.date)

    const note = store.createItem({ kind: 'note', title: 'notes', status: 'active' })
    store.linkToEvent(note.id, demoEvent, 'notes-for')
    expect(store.getItem(note.id)!.dueDate).toBeNull()

    const followUp = store.createItem({ kind: 'task', title: 'recap', status: 'active' })
    store.linkToEvent(followUp.id, demoEvent, 'follow-up-from')
    expect(store.getItem(followUp.id)!.dueDate).toBeNull()
  })

  it('keeps the snapshot so notes survive event deletion', () => {
    const note = store.createItem({ kind: 'note', title: 'meeting notes', status: 'active' })
    const link = store.linkToEvent(note.id, demoEvent, 'notes-for')
    // Even with the calendar gone, the link still knows what it pointed at.
    expect(link.eventTitle).toBe('Design review')
    expect(link.eventDate).toBe('2026-06-12')
  })

  it('refreshes snapshots when the event is seen again (reschedule)', () => {
    const note = store.createItem({ kind: 'note', title: 'n', status: 'active' })
    store.linkToEvent(note.id, demoEvent, 'notes-for')

    store.refreshEventSnapshots([{ ...demoEvent, title: 'Design review (moved)', date: '2026-06-13' }])
    const [link] = store.linksFrom(note.id)
    expect(link.eventTitle).toBe('Design review (moved)')
    expect(link.eventDate).toBe('2026-06-13')
  })

  it('links between items power follow-ups', () => {
    const notes = store.createItem({ kind: 'note', title: 'notes', status: 'active' })
    const followUp = store.createItem({ kind: 'task', title: 'send recap', status: 'active' })
    store.linkItems(followUp.id, notes.id, 'follow-up-from')
    expect(store.linksFrom(followUp.id)[0].role).toBe('follow-up-from')
  })

  it('deleting an item removes its links (cascade)', () => {
    const note = store.createItem({ kind: 'note', title: 'n', status: 'active' })
    store.linkToEvent(note.id, demoEvent, 'notes-for')
    store.deleteItem(note.id)
    expect(store.itemsForEvent(demoEvent.eventKey)).toHaveLength(0)
  })
})

describe('meetings ↔ projects', () => {
  it('assigns a meeting to a project and lists it there', () => {
    const p = store.createProject('Q3 launch', '#1971c2')
    store.assignMeetingProject(demoEvent, p.id)

    const meetings = store.meetingsForProject(p.id)
    expect(meetings).toHaveLength(1)
    expect(meetings[0]).toMatchObject({ eventKey: demoEvent.eventKey, title: 'Design review' })

    store.assignMeetingProject(demoEvent, null) // unassign
    expect(store.meetingsForProject(p.id)).toHaveLength(0)
  })
})

describe('journal', () => {
  it('creates one journal item per day, on first access', () => {
    const j1 = store.journalFor(today)
    const j2 = store.journalFor(today)
    expect(j1.id).toBe(j2.id)
    expect(j1.kind).toBe('journal')
  })
})

describe('search (FTS5)', () => {
  it('finds items by title and content, with prefix matching', () => {
    store.createItem({ kind: 'note', title: 'Quarterly planning', content: 'discuss the budget' })
    store.createItem({ kind: 'task', title: 'water the plants' })

    expect(store.search('quarter').map((i) => i.title)).toEqual(['Quarterly planning'])
    expect(store.search('budget')).toHaveLength(1)
    expect(store.search('plan')).toHaveLength(2) // planning + plants
  })

  it('stays in sync with edits and never surfaces dropped items', () => {
    const item = store.createItem({ kind: 'note', title: 'alpha' })
    store.updateItem(item.id, { title: 'omega' })
    expect(store.search('alpha')).toHaveLength(0)
    expect(store.search('omega')).toHaveLength(1)

    store.dropItems([item.id])
    expect(store.search('omega')).toHaveLength(0)
  })

  it('operator-ish input is treated as plain text', () => {
    store.createItem({ kind: 'note', title: 'a AND b' })
    expect(() => store.search('AND OR NOT "')).not.toThrow()
    expect(store.search('a AND')).toHaveLength(1)
  })
})

describe('settings', () => {
  it('round-trips JSON values', () => {
    store.setSetting('theme', 'dark')
    expect(store.getSetting<string>('theme')).toBe('dark')
    store.setSetting('theme', 'light')
    expect(store.getSetting<string>('theme')).toBe('light')
    expect(store.getSetting('missing')).toBeNull()
  })
})

describe('backlog and unfiled notes', () => {
  it('someday tasks (no date) appear in the backlog until scheduled', () => {
    const t = store.createItem({ kind: 'task', title: 'learn sqlite', status: 'active' })
    expect(store.backlogTasks().map((i) => i.id)).toEqual([t.id])

    store.updateItem(t.id, { scheduledDate: today })
    expect(store.backlogTasks()).toHaveLength(0)
  })

  it('unfiled notes are active notes without a project', () => {
    const n = store.createItem({ kind: 'note', title: 'an idea', status: 'active' })
    store.createItem({ kind: 'note', title: 'still in inbox' }) // status inbox — not unfiled yet
    expect(store.unfiledNotes().map((i) => i.id)).toEqual([n.id])

    const p = store.createProject('Ideas', '#cc5de8')
    store.updateItem(n.id, { projectId: p.id })
    expect(store.unfiledNotes()).toHaveLength(0)
  })
})

describe('pages (rich text)', () => {
  it('stores HTML alongside a searchable plain-text mirror', () => {
    const page = store.createItem({
      kind: 'page',
      title: 'Architecture braindump',
      richContent: '<h1>Plan</h1><table><tr><td>quarterly budget</td></tr></table>',
      content: 'Plan quarterly budget', // what the editor's getText() returns
      status: 'active'
    })
    expect(store.getItem(page.id)!.richContent).toContain('<table>')

    // Search hits the plain text, not the HTML tags.
    expect(store.search('budget').map((i) => i.id)).toEqual([page.id])
    expect(store.search('table')).toHaveLength(0)
  })
})

describe('completed history', () => {
  it('lists completions newest first, capped', () => {
    const a = store.createItem({ kind: 'task', title: 'first', status: 'active' })
    const b = store.createItem({ kind: 'task', title: 'second', status: 'active' })
    store.updateItem(a.id, { status: 'done' })
    store.updateItem(b.id, { status: 'done' })

    const recent = store.recentCompleted(10)
    expect(recent.map((i) => i.id)).toContain(a.id)
    expect(recent.map((i) => i.id)).toContain(b.id)
    expect(store.recentCompleted(1)).toHaveLength(1)
  })
})

describe('starred items', () => {
  it('round-trips the star and lists favorites (never dropped ones)', () => {
    const note = store.createItem({ kind: 'note', title: 'cheatsheet', status: 'active' })
    expect(note.starred).toBe(false)

    store.updateItem(note.id, { starred: true })
    expect(store.getItem(note.id)!.starred).toBe(true)
    expect(store.starredItems().map((i) => i.id)).toEqual([note.id])

    store.dropItems([note.id])
    expect(store.starredItems()).toHaveLength(0)
  })
})

describe('subtasks', () => {
  it('lists a task’s subtasks and keeps them out of other lists', () => {
    const p = store.createProject('Launch', '#339af0')
    const parent = store.createItem({
      kind: 'task', title: 'ship v2', status: 'active', projectId: p.id
    })
    const sub = store.createItem({
      kind: 'task', title: 'write changelog', status: 'active', projectId: p.id
    })
    store.linkItems(sub.id, parent.id, 'subtask-of')

    expect(store.subtasksOf(parent.id).map((i) => i.id)).toEqual([sub.id])
    // Subtasks live inside their parent's card, not in the backlog
    // or the project page lists.
    expect(store.backlogTasks().map((i) => i.id)).toEqual([parent.id])
    expect(store.projectItems(p.id).map((i) => i.id)).toEqual([parent.id])

    store.updateItem(sub.id, { status: 'dropped' })
    expect(store.subtasksOf(parent.id)).toHaveLength(0)
  })
})

describe('clear database', () => {
  it('wipes all content but preserves settings', () => {
    const p = store.createProject('Roadmap', '#339af0')
    const item = store.createItem({ kind: 'task', title: 'call dentist', projectId: p.id })
    store.linkToEvent(item.id, demoEvent, 'prep-for')
    store.assignMeetingProject(demoEvent, p.id)
    store.createLocalEvent({ title: 'block', date: today, startTime: '09:00', endTime: '10:00' })
    store.setSetting('theme', 'dark')

    store.clearContent()

    expect(store.listProjects(true)).toHaveLength(0)
    expect(store.allItems()).toHaveLength(0)
    expect(store.allLinks()).toHaveLength(0)
    expect(store.allMeetings()).toHaveLength(0)
    expect(store.localEventsFor(today)).toHaveLength(0)
    expect(store.search('dentist')).toHaveLength(0) // FTS emptied too
    expect(store.getSetting('theme')).toBe('dark')
  })
})

describe('project name uniqueness', () => {
  it('rejects duplicate names, even against archived projects', () => {
    const p = store.createProject('Roadmap', '#339af0')
    expect(() => store.createProject('roadmap', '#ff6b6b')).toThrow(/already exists/)

    // The archive → recreate → un-archive trap: recreating while the
    // original is archived must fail, so restoring can never collide.
    store.updateProject(p.id, { status: 'archived' })
    expect(() => store.createProject('Roadmap', '#ff6b6b')).toThrow(/archived/)
    store.updateProject(p.id, { status: 'active' })
    expect(store.listProjects()).toHaveLength(1)
  })

  it('rejects renaming onto an existing name, but allows self-rename', () => {
    store.createProject('Roadmap', '#339af0')
    const other = store.createProject('Launch', '#ff6b6b')
    expect(() => store.updateProject(other.id, { name: 'ROADMAP' })).toThrow(/already exists/)
    store.updateProject(other.id, { name: 'Launch' }) // same name on itself is fine
    store.updateProject(other.id, { name: 'Launch v2' })
    expect(store.listProjects().map((p) => p.name).sort()).toEqual(['Launch v2', 'Roadmap'])
  })
})

describe('local time blocks', () => {
  it('creates, lists, edits and deletes local events per day', () => {
    const ev = store.createLocalEvent({
      title: 'deep work', date: today, startTime: '09:00', endTime: '10:30'
    })
    store.createLocalEvent({
      title: 'other day', date: ymdAddDays(today, 1), startTime: '09:00', endTime: '09:30'
    })

    expect(store.localEventsFor(today).map((e) => e.title)).toEqual(['deep work'])

    const edited = store.updateLocalEvent(ev.id, { title: 'writing', endTime: '11:00' })
    expect(edited).toMatchObject({ title: 'writing', startTime: '09:00', endTime: '11:00' })

    store.deleteLocalEvent(ev.id)
    expect(store.localEventsFor(today)).toHaveLength(0)
  })

  it('a block can point at its task, and dies with it (cascade)', () => {
    const task = store.createItem({ kind: 'task', title: 'deep work', status: 'active' })
    store.createLocalEvent({
      title: 'deep work', date: today, startTime: '09:00', endTime: '09:30', itemId: task.id
    })
    expect(store.localEventsFor(today)[0].itemId).toBe(task.id)

    store.deleteItem(task.id)
    expect(store.localEventsFor(today)).toHaveLength(0)
  })
})

describe('project deletion', () => {
  it('unfiles items and meeting assignments instead of deleting them', () => {
    const p = store.createProject('Doomed', '#ff6b6b')
    const item = store.createItem({ kind: 'task', title: 'survives', projectId: p.id })
    store.assignMeetingProject(demoEvent, p.id)

    store.deleteProject(p.id)

    expect(store.listProjects(true)).toHaveLength(0)
    expect(store.getItem(item.id)!.projectId).toBeNull()
    expect(store.getMeeting(demoEvent.eventKey)!.projectId).toBeNull()
  })
})

describe('project-assigned time blocks', () => {
  it('keeps the block, unassigned, when its project is deleted', () => {
    const p = store.createProject('Focus', '#20c997')
    const ev = store.createLocalEvent({
      title: 'deep work', date: today, startTime: '09:00', endTime: '10:00', projectId: p.id
    })
    expect(store.localEventsFor(today)[0].projectId).toBe(p.id)

    store.deleteProject(p.id)

    const survived = store.localEventsFor(today)
    expect(survived).toHaveLength(1)
    expect(survived[0]).toMatchObject({ id: ev.id, title: 'deep work', projectId: null })
  })
})

describe('nested subtasks', () => {
  it('returns the whole tree depth-first with depths', () => {
    const parent = store.createItem({ kind: 'task', title: 'ship v2', status: 'active' })
    const a = store.createItem({ kind: 'task', title: 'a', status: 'active' })
    const b = store.createItem({ kind: 'task', title: 'b', status: 'active' })
    const a1 = store.createItem({ kind: 'task', title: 'a1', status: 'active' })
    store.linkItems(a.id, parent.id, 'subtask-of')
    store.linkItems(b.id, parent.id, 'subtask-of')
    store.linkItems(a1.id, a.id, 'subtask-of')

    const tree = store.subtaskTreeOf(parent.id)
    expect(tree.map((t) => [t.item.title, t.depth])).toEqual([
      ['a', 1],
      ['a1', 2],
      ['b', 1]
    ])

    // Dropping a mid-level subtask hides its whole branch.
    store.updateItem(a.id, { status: 'dropped' })
    expect(store.subtaskTreeOf(parent.id).map((t) => t.item.title)).toEqual(['b'])
  })
})

describe('completed subtasks grouping', () => {
  it('walks each done subtask up to its root task with depth', () => {
    const root = store.createItem({ kind: 'task', title: 'ship v2', status: 'active' })
    const a = store.createItem({ kind: 'task', title: 'a', status: 'active' })
    const a1 = store.createItem({ kind: 'task', title: 'a1', status: 'active' })
    store.linkItems(a.id, root.id, 'subtask-of')
    store.linkItems(a1.id, a.id, 'subtask-of')
    store.updateItem(a.id, { status: 'done' })
    store.updateItem(a1.id, { status: 'done' })
    // A completed top-level task is not a subtask of anything.
    const solo = store.createItem({ kind: 'task', title: 'solo', status: 'active' })
    store.updateItem(solo.id, { status: 'done' })

    const grouped = store.completedSubtasksOn(today)
    expect(grouped.map((g) => [g.item.title, g.rootTitle, g.depth])).toEqual([
      ['a', 'ship v2', 1],
      ['a1', 'ship v2', 2]
    ])
  })
})
