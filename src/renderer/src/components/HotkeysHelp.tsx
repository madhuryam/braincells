import { useEffect } from 'react'
import { motion } from 'framer-motion'

/**
 * The keyboard cheat-sheet: every shortcut in the app, in one modal.
 * Opened with "?" anywhere (when not typing) or the sidebar's ⌨ button.
 * The list is hand-maintained — add a row when you add a shortcut.
 */

interface Row {
  keys: string[]
  what: string
}
const SECTIONS: Array<{ title: string; rows: Row[] }> = [
  {
    title: 'Anywhere',
    rows: [
      { keys: ['⌥', 'Space'], what: 'Quick capture — even outside the app' },
      { keys: ['⌘', 'N'], what: 'Jump to Today and start capturing' },
      { keys: ['⌘', 'T'], what: 'Go to Today' },
      { keys: ['⌘', 'K'], what: 'Search everything' },
      { keys: ['⌘', ','], what: 'Open Settings' },
      { keys: ['⌘', 'Z'], what: 'Undo (drops, sweeps, check-offs)' },
      { keys: ['Esc'], what: 'Close the floating view / side panel' },
      { keys: ['?'], what: 'This cheat-sheet' }
    ]
  },
  {
    title: 'Editing',
    rows: [
      { keys: ['Enter'], what: 'Save the field / finish the time block' },
      { keys: ['Esc'], what: 'Collapse the open card / cancel a new block' }
    ]
  },
  {
    title: 'Schedule',
    rows: [
      { keys: ['click'], what: '15-minute block on empty timeline' },
      { keys: ['drag'], what: 'Draw a longer block / move a task in' }
    ]
  }
]

export function HotkeysHelp({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null

  return (
    <motion.div
      className="hotkeys-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        className="hotkeys-modal"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Keyboard shortcuts</h2>
          <button className="btn ghost icon-btn" style={{ marginLeft: 'auto' }} title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="hotkeys-grid">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <div className="section-label">{s.title}</div>
              {s.rows.map((r) => (
                <div key={r.what} className="hotkey-row">
                  <span className="hotkey-keys">
                    {r.keys.map((k, i) => (
                      <kbd key={i} className="key">
                        {k}
                      </kbd>
                    ))}
                  </span>
                  <span>{r.what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

/** True when the key press happened while typing somewhere. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t?.closest('input, textarea, select, [contenteditable="true"]')
}
