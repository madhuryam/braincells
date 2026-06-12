import { useEffect, useState } from 'react'

/**
 * The entire UI of the floating ⌥Space window: one input. Return
 * captures, Esc dismisses. Styled as a self-contained card because the
 * window itself is transparent and frameless.
 */
export function CaptureWindow(): React.JSX.Element {
  const [text, setText] = useState('')

  // Match the system theme (this little window skips the settings table).
  useEffect(() => {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
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
        placeholder="Brain dump → inbox. Return to save."
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
