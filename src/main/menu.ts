import { Menu, type BrowserWindow } from 'electron'
import type { Store } from './store'
import { createBackup, exportMarkdown, restoreBackup } from './backup'
import { CAPTURE_HOTKEY } from './capture'

/**
 * The macOS application menu. Mostly the standard roles (so ⌘C/⌘V/⌘Q
 * behave), plus the backup commands under File (SPEC §8).
 */
export function setUpMenu(store: Store, getWindow: () => BrowserWindow | null): void {
  const withWindow = (fn: (store: Store, win: BrowserWindow) => unknown) => (): void => {
    const win = getWindow()
    if (win) void fn(store, win)
  }

  const menu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Create Backup…', click: withWindow(createBackup) },
        { label: 'Export as Markdown…', click: withWindow(exportMarkdown) },
        { type: 'separator' },
        { label: 'Restore from Backup…', click: withWindow(restoreBackup) },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: `Quick capture from anywhere: ${CAPTURE_HOTKEY.replace('Alt', '⌥')}`, enabled: false }
      ]
    }
  ])
  Menu.setApplicationMenu(menu)
}
