import { contextBridge, ipcRenderer } from 'electron'
import type {
  CalendarEvent,
  Item,
  ItemKind,
  ItemStatus,
  Link,
  LinkRole,
  Meeting,
  PrepProgress,
  Project,
  ProjectStatus
} from '../shared/types'

// Re-declared here (rather than imported from src/main) because preload
// must not pull in main-process code. Shapes match src/main/store.
export interface NewItem {
  kind: ItemKind
  title: string
  content?: string
  status?: ItemStatus
  projectId?: string | null
  dueDate?: string | null
  scheduledDate?: string | null
  scheduledTime?: string | null
  timeEstimateMinutes?: number | null
}
export type ItemPatch = Partial<Omit<Item, 'id' | 'createdAt' | 'completedAt'>>
export interface LinkedItem {
  link: Link
  item: Item
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

// The single, typed surface the UI can use to reach the main process.
// Each method pairs with an ipcMain.handle() in src/main/ipc.ts.
const api = {
  platform: process.platform,

  // Projects
  listProjects: (includeArchived = false): Promise<Project[]> =>
    invoke('projects:list', includeArchived),
  createProject: (name: string, color: string): Promise<Project> =>
    invoke('projects:create', name, color),
  updateProject: (
    id: string,
    patch: { name?: string; color?: string; status?: ProjectStatus }
  ): Promise<void> => invoke('projects:update', id, patch),

  // Items
  createItem: (item: NewItem): Promise<Item> => invoke('items:create', item),
  getItem: (id: string): Promise<Item | null> => invoke('items:get', id),
  updateItem: (id: string, patch: ItemPatch): Promise<Item | null> =>
    invoke('items:update', id, patch),
  deleteItem: (id: string): Promise<void> => invoke('items:delete', id),
  reorderItems: (ids: string[]): Promise<void> => invoke('items:reorder', ids),
  dropItems: (ids: string[]): Promise<void> => invoke('items:drop', ids),

  // Screen queries
  inboxItems: (): Promise<Item[]> => invoke('inbox:items'),
  inboxCount: (): Promise<number> => invoke('inbox:count'),
  tasksFor: (date: string): Promise<Item[]> => invoke('today:tasks', date),
  tasksThisWeek: (date: string): Promise<Item[]> => invoke('today:week', date),
  carriedOver: (date: string): Promise<Item[]> => invoke('today:carriedOver', date),
  projectItems: (projectId: string): Promise<Item[]> => invoke('project:items', projectId),
  completedOn: (date: string): Promise<Item[]> => invoke('log:completedOn', date),
  journalFor: (date: string): Promise<Item> => invoke('log:journal', date),

  // Links / meeting loop
  linkItems: (fromId: string, toId: string, role: LinkRole): Promise<Link> =>
    invoke('links:linkItems', fromId, toId, role),
  linkToEvent: (fromId: string, event: CalendarEvent, role: LinkRole): Promise<Link> =>
    invoke('links:linkToEvent', fromId, event, role),
  deleteLink: (id: string): Promise<void> => invoke('links:delete', id),
  linksFrom: (itemId: string): Promise<Link[]> => invoke('links:from', itemId),
  itemsForEvent: (eventKey: string, role?: LinkRole): Promise<LinkedItem[]> =>
    invoke('links:itemsForEvent', eventKey, role),
  prepProgress: (eventKeys: string[]): Promise<PrepProgress[]> =>
    invoke('links:prepProgress', eventKeys),

  // Meetings ↔ projects
  getMeeting: (eventKey: string): Promise<Meeting | null> => invoke('meetings:get', eventKey),
  assignMeetingProject: (
    event: { eventKey: string; title: string; date: string },
    projectId: string | null
  ): Promise<void> => invoke('meetings:assignProject', event, projectId),
  meetingsForProject: (projectId: string): Promise<Meeting[]> =>
    invoke('meetings:forProject', projectId),

  // Settings
  getSetting: <T,>(key: string): Promise<T | null> => invoke('settings:get', key),
  setSetting: (key: string, value: unknown): Promise<void> => invoke('settings:set', key, value),

  // Quick capture window
  submitCapture: (text: string): Promise<void> => invoke('capture:submit', text),
  dismissCapture: (): Promise<void> => invoke('capture:dismiss'),

  /** Fired by the main process when data changed outside this window. */
  onDataChanged: (cb: () => void): (() => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('data-changed', listener)
    return () => ipcRenderer.removeListener('data-changed', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
