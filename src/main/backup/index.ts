import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { todayYmd } from '../../shared/dates'
import type { Store } from '../store'
import { buildExport } from './export'

/**
 * Local backups, on demand, no cloud (SPEC §2 goal 6, §8):
 *
 * - Create Backup  → copies the SQLite file wherever the user picks
 *                    (uses SQLite's online-backup API, safe mid-use)
 * - Export         → a folder of human-readable .md files + JSON
 * - Restore        → pick a backup file; it replaces the database and
 *                    the app relaunches on it
 *
 * Reachable from both the Settings screen (via these IPC handlers)
 * and the File menu (which calls the same functions).
 */

export async function createBackup(store: Store, win: BrowserWindow): Promise<string | null> {
  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Create Backup',
    defaultPath: `braincells-backup-${todayYmd()}.sqlite3`
  })
  if (!filePath) return null
  await store.db.backup(filePath)
  return filePath
}

export async function exportMarkdown(store: Store, win: BrowserWindow): Promise<string | null> {
  const { filePaths } = await dialog.showOpenDialog(win, {
    title: 'Export as Markdown — choose a destination folder',
    properties: ['openDirectory', 'createDirectory']
  })
  if (filePaths.length === 0) return null
  const root = join(filePaths[0], `braincells-export-${todayYmd()}`)
  for (const file of buildExport(store)) {
    const target = join(root, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.contents)
  }
  return root
}

export async function restoreBackup(store: Store, win: BrowserWindow): Promise<void> {
  const { filePaths } = await dialog.showOpenDialog(win, {
    title: 'Restore from Backup',
    filters: [{ name: 'braincells backup', extensions: ['sqlite3'] }],
    properties: ['openFile']
  })
  if (filePaths.length === 0) return

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Restore and relaunch', 'Cancel'],
    defaultId: 1,
    message: 'Replace the current database with this backup?',
    detail: 'The app restarts on the restored data. The current database is overwritten.'
  })
  if (response !== 0) return

  const dbPath = store.path
  store.close()
  copyFileSync(filePaths[0], dbPath)
  app.relaunch()
  app.exit(0)
}

export function registerBackupIpc(store: Store, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('backup:create', async () => {
    const win = getWindow()
    return win ? createBackup(store, win) : null
  })
  ipcMain.handle('backup:exportMarkdown', async () => {
    const win = getWindow()
    return win ? exportMarkdown(store, win) : null
  })
  ipcMain.handle('backup:restore', async () => {
    const win = getWindow()
    if (win) await restoreBackup(store, win)
  })
}
