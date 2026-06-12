import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useData } from './data'

/**
 * Undo for the actions that make things vanish: dropping an item,
 * declaring bankruptcy, letting carried-over tasks go, and checking
 * something off. Each action pushes an inverse operation; a toast
 * offers it for a few seconds, and ⌘Z (outside text fields) walks
 * back through the stack.
 *
 * This isn't a general editor-undo — text edits already have the
 * native ⌘Z inside their fields. It's a safety net for clicks.
 */
interface UndoEntry {
  label: string
  undo: () => Promise<void>
}

interface UndoContextValue {
  pushUndo: (label: string, undo: () => Promise<void>) => void
}

const UndoContext = createContext<UndoContextValue | null>(null)

const TOAST_MS = 7000
const MAX_STACK = 20

export function UndoProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { bump } = useData()
  const stack = useRef<UndoEntry[]>([])
  const [toast, setToast] = useState<UndoEntry | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const pushUndo = useCallback((label: string, undo: () => Promise<void>) => {
    const entry = { label, undo }
    stack.current.push(entry)
    if (stack.current.length > MAX_STACK) stack.current.shift()
    setToast(entry)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const undoLast = useCallback(async () => {
    const entry = stack.current.pop()
    if (!entry) return
    await entry.undo()
    bump()
    setToast(null)
  }, [bump])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'z')) return
      // Inside a text field, ⌘Z stays the native text undo.
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return
      e.preventDefault()
      undoLast()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undoLast])

  return (
    <UndoContext.Provider value={{ pushUndo }}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="undo-toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
          >
            <span>{toast.label}</span>
            <button className="btn small primary" onClick={undoLast}>
              Undo&ensp;⌘Z
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </UndoContext.Provider>
  )
}

export function useUndo(): UndoContextValue {
  const ctx = useContext(UndoContext)
  if (!ctx) throw new Error('useUndo outside UndoProvider')
  return ctx
}

/** Trim long titles so toast labels stay one line. */
export function shortTitle(title: string): string {
  const t = title || 'Untitled'
  return t.length > 36 ? `${t.slice(0, 36)}…` : t
}
