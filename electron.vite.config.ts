import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // The Node-side entry: creates windows, owns the SQLite database,
  // registers global shortcuts. Native modules (better-sqlite3) stay
  // external so they load from node_modules at runtime.
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  // The bridge script: the only code that can talk to both the main
  // process and the page. Exposes a typed `window.api`.
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  // The React UI.
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
