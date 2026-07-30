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
})

describe('Today / This Week / carried over', () => {
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
    store.setSetting('theme', 'dark')

    store.clearContent()

    expect(store.listProjects(true)).toHaveLength(0)
    expect(store.allItems()).toHaveLength(0)
    expect(store.allLinks()).toHaveLength(0)
    expect(store.allMeetings()).toHaveLength(0)
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
