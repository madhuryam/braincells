import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { todayYmd } from '../../shared/dates'
import type { Store } from '../store'
import { buildExport } from './export'
import { replaceDatabase } from './restore'

/** Where backups live by default: ~/.config/braincells. */
const BACKUP_DIR = join(homedir(), '.config', 'braincells')

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
  mkdirSync(BACKUP_DIR, { recursive: true })
  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Create Backup',
    defaultPath: join(BACKUP_DIR, `braincells-backup-${todayYmd()}.sqlite3`)
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
  replaceDatabase(dbPath, filePaths[0])
  app.relaunch()
  app.exit(0)
}

/**
 * "Clear Database": a fresh start that can't lose data. A full backup
 * is written automatically (no dialog) before anything is deleted;
 * settings survive; the app relaunches on the empty database.
 * (In dev the relaunched process loses the Vite dev-server URL and
 * comes up blank — quirk of `npm run dev`, fine in the packaged app.)
 */
export async function clearDatabase(store: Store, win: BrowserWindow): Promise<void> {
  mkdirSync(BACKUP_DIR, { recursive: true })
  const backupPath = join(BACKUP_DIR, `braincells-pre-clear-${todayYmd()}-${Date.now()}.sqlite3`)

  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Back up, clear, and relaunch', 'Cancel'],
    defaultId: 1,
    message: 'Clear the database?',
    detail:
      `Every item, note, project, link, and meeting is deleted. Settings are kept.\n\n` +
      `A full backup is saved first to:\n${backupPath}`
  })
  if (response !== 0) return

  await store.db.backup(backupPath)
  store.clearContent()
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
  ipcMain.handle('backup:clearDatabase', async () => {
    const win = getWindow()
    if (win) await clearDatabase(store, win)
  })
}
