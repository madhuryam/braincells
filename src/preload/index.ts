import { contextBridge } from 'electron'

// The single, typed surface the UI can use to reach the main process.
// Grows alongside the IPC handlers in src/main — see src/preload/api.d.ts
// for the type the renderer sees.
const api = {
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
