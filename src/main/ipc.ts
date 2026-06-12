import { ipcMain } from 'electron'
import type { ItemPatch, NewItem, Store } from './store'
import type { CalendarEvent, LinkRole, ProjectStatus } from '../shared/types'

/**
 * Exposes the Store to the UI, one named channel per operation.
 * The other half of each pair lives in src/preload/index.ts — the
 * channel strings must match, so keep both files in the same order.
 */
export function registerStoreIpc(store: Store): void {
  // Projects
  ipcMain.handle('projects:list', (_e, includeArchived: boolean) => store.listProjects(includeArchived))
  ipcMain.handle('projects:create', (_e, name: string, color: string) => store.createProject(name, color))
  ipcMain.handle(
    'projects:update',
    (_e, id: string, patch: { name?: string; color?: string; status?: ProjectStatus }) =>
      store.updateProject(id, patch)
  )

  // Items
  ipcMain.handle('items:create', (_e, item: NewItem) => store.createItem(item))
  ipcMain.handle('items:get', (_e, id: string) => store.getItem(id))
  ipcMain.handle('items:update', (_e, id: string, patch: ItemPatch) => store.updateItem(id, patch))
  ipcMain.handle('items:delete', (_e, id: string) => store.deleteItem(id))
  ipcMain.handle('items:reorder', (_e, ids: string[]) => store.reorderItems(ids))
  ipcMain.handle('items:drop', (_e, ids: string[]) => store.dropItems(ids))
  ipcMain.handle('items:starred', () => store.starredItems())
  ipcMain.handle('items:subtasks', (_e, parentId: string) => store.subtasksOf(parentId))

  // Screen queries
  ipcMain.handle('inbox:items', () => store.inboxItems())
  ipcMain.handle('inbox:count', () => store.inboxCount())
  ipcMain.handle('inbox:backlog', () => store.backlogTasks())
  ipcMain.handle('inbox:unfiledNotes', () => store.unfiledNotes())
  ipcMain.handle('inbox:recentCompleted', (_e, limit?: number) => store.recentCompleted(limit))
  ipcMain.handle('today:tasks', (_e, date: string) => store.tasksFor(date))
  ipcMain.handle('today:week', (_e, date: string) => store.tasksThisWeek(date))
  ipcMain.handle('today:carriedOver', (_e, date: string) => store.carriedOver(date))
  ipcMain.handle('project:items', (_e, projectId: string) => store.projectItems(projectId))
  ipcMain.handle('log:completedOn', (_e, date: string) => store.completedOn(date))
  ipcMain.handle('log:journal', (_e, date: string) => store.journalFor(date))

  // Links / meeting loop
  ipcMain.handle('links:linkItems', (_e, fromId: string, toId: string, role: LinkRole) =>
    store.linkItems(fromId, toId, role)
  )
  ipcMain.handle('links:linkToEvent', (_e, fromId: string, event: CalendarEvent, role: LinkRole) =>
    store.linkToEvent(fromId, event, role)
  )
  ipcMain.handle('links:delete', (_e, id: string) => store.deleteLink(id))
  ipcMain.handle('links:from', (_e, itemId: string) => store.linksFrom(itemId))
  ipcMain.handle('links:itemsForEvent', (_e, eventKey: string, role?: LinkRole) =>
    store.itemsForEvent(eventKey, role)
  )
  ipcMain.handle('links:prepProgress', (_e, eventKeys: string[]) => store.prepProgress(eventKeys))

  // Meetings ↔ projects
  ipcMain.handle('meetings:get', (_e, eventKey: string) => store.getMeeting(eventKey))
  ipcMain.handle(
    'meetings:assignProject',
    (_e, event: { eventKey: string; title: string; date: string }, projectId: string | null) =>
      store.assignMeetingProject(event, projectId)
  )
  ipcMain.handle('meetings:forProject', (_e, projectId: string) => store.meetingsForProject(projectId))

  // Search
  ipcMain.handle('search:query', (_e, query: string) => store.search(query))

  // Settings
  ipcMain.handle('settings:get', (_e, key: string) => store.getSetting(key))
  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => store.setSetting(key, value))
}
