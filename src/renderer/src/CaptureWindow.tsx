import { useEffect, useState } from 'react'

const THEME_IDS = ['paper', 'slate', 'ocean', 'sunset', 'rose', 'forest', 'plum']

/** Resolve the stored setting (migrating old light/dark/system values)
 *  to a real theme id, mirroring the main window's DataProvider. */
function resolveTheme(stored: string | null): string {
  if (stored && THEME_IDS.includes(stored)) return stored
  if (stored === 'dark') return 'plum'
  if (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    return 'plum'
  return 'slate'
}

/**
 * The entire UI of the floating ⌥Space window: one input. Return
 * captures, Esc dismisses. Styled as a self-contained card because the
 * window itself is transparent and frameless.
 */
export function CaptureWindow(): React.JSX.Element {
  const [text, setText] = useState('')

  // Match the app's selected theme (this little window skips the
  // settings table, so it reads the saved value directly). Re-read on
  // focus so it stays in sync if the theme changed while hidden.
  useEffect(() => {
    const apply = (): void => {
      window.api
        .getSetting<string>('theme')
        .then((t) => (document.documentElement.dataset.theme = resolveTheme(t)))
    }
    apply()
    window.addEventListener('focus', apply)
    return () => window.removeEventListener('focus', apply)
  }, [])

  const submit = async (): Promise<void> => {
    await window.api.submitCapture(text)
    setText('')
  }
  const dismiss = (): void => {
    setText('')
    window.api.dismissCapture()
  }

  return (
    <div className="capture-window">
      <input
        autoFocus
        placeholder="Brain dump → Today’s intake. Return to save."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') dismiss()
        }}
      />
      <div className="capture-hints">
        <span className="pill">#project</span>
        <span className="pill">!today</span>
        <span className="pill">!tomorrow</span>
        <span className="pill">esc to dismiss</span>
      </div>
    </div>
  )
}
