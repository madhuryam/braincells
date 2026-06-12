import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { Store } from './store'
import { registerStoreIpc } from './ipc'

// The main application window. Kept in a variable so macOS can re-show
// it when the dock icon is clicked after all windows were closed.
let mainWindow: BrowserWindow | null = null

// The one database for the whole app. On a Mac this lives at
// ~/Library/Application Support/braincells/braincells.sqlite3.
let store: Store

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'braincells',
    titleBarStyle: 'hiddenInset', // native traffic lights over our own header
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Keep the page sandboxed from Node: everything goes through the
      // preload bridge. `sandbox: false` is required for the preload
      // script itself to use require(), but the page stays isolated.
      sandbox: false,
      contextIsolation: true
    }
  })

  // Open external links in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    // Dev mode: load from the Vite dev server (hot reload).
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  store = new Store(join(app.getPath('userData'), 'braincells.sqlite3'))
  registerStoreIpc(store)

  createMainWindow()

  // macOS convention: clicking the dock icon re-opens the window.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

// macOS convention: the app stays alive with no windows (menu bar +
// global capture hotkey keep working). Other platforms quit.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('quit', () => {
  store?.close()
})
