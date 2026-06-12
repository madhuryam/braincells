import type { Api } from './index'

// Makes `window.api` typed inside the renderer without importing
// preload code (which can't run in the page).
declare global {
  interface Window {
    api: Api
  }
}

export {}
