import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { join } from 'node:path'
import { parseShorthand } from '../shared/shorthand'
import type { Store } from './store'

export const CAPTURE_HOTKEY = 'Alt+Space' // ⌥Space on a Mac

let captureWindow: BrowserWindow | null = null

function createCaptureWindow(): BrowserWindow {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize
  const win = new BrowserWindow({
    width: 620,
    height: 150,
    x: Math.round((screenWidth - 620) / 2),
    y: 160,
    frame: false,
    transparent: true, // the page draws its own rounded card
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  // '#capture' makes the renderer mount the tiny capture UI instead of
  // the full app (see src/renderer/src/main.tsx).
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#capture`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'capture' })
  }

  win.on('blur', () => win.hide()) // clicking elsewhere dismisses it
  win.on('closed', () => {
    captureWindow = null
  })
  return win
}

/**
 * Quick capture (SPEC §5): ⌥Space from anywhere on the Mac opens a
 * floating field; return sends the text to the inbox; the window
 * vanishes. Sub-2-seconds, no required fields, no decisions.
 */
export function setUpQuickCapture(store: Store, onItemCaptured: () => void): void {
  globalShortcut.register(CAPTURE_HOTKEY, () => {
    if (!captureWindow) captureWindow = createCaptureWindow()
    if (captureWindow.isVisible()) {
      captureWindow.hide()
    } else {
      captureWindow.show()
      captureWindow.focus()
    }
  })

  ipcMain.handle('capture:submit', (_e, raw: string) => {
    const text = raw.trim()
    if (text) {
      const parsed = parseShorthand(text, store.listProjects())
      store.createItem({
        kind: parsed.isTask ? 'task' : 'note',
        title: parsed.title,
        projectId: parsed.projectId,
        scheduledDate: parsed.scheduledDate,
        // Shorthand-scheduled captures are ready-to-go tasks; everything
        // else waits in the inbox for triage.
        status: parsed.scheduledDate ? 'active' : 'inbox'
      })
      onItemCaptured()
    }
    captureWindow?.hide()
  })

  ipcMain.handle('capture:dismiss', () => {
    captureWindow?.hide()
  })
}

export function tearDownQuickCapture(): void {
  globalShortcut.unregisterAll()
}
