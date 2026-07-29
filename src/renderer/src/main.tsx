import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { CaptureWindow } from './CaptureWindow'
import '@fontsource-variable/open-sans'
import './styles/tokens.css'
import './styles/base.css'
import './styles/app.css'

// The same bundle serves two windows: the full app, and the tiny
// floating quick-capture window (opened with '#capture' in its URL).
const isCaptureWindow = window.location.hash === '#capture'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isCaptureWindow ? <CaptureWindow /> : <App />}</React.StrictMode>
)
