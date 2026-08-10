import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/**
 * Client-side "routing" without a router: a handful of screens behind
 * a single switch — but with a history stack, so opening a meeting
 * from a project page (or notes from the daily log) can go *back* to
 * where you were.
 */
export type View =
  | { name: 'today' }
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'meeting'; eventKey: string; title: string; date: string }
  | { name: 'calendar' }
  | { name: 'page'; itemId: string }
  | { name: 'log' }
  | { name: 'search' }
  | { name: 'settings' }

interface NavContextValue {
  view: View
  /** A screen floated over the current one ("open full page"). */
  overlay: View | null
  navigate: (v: View) => void
  openOverlay: (v: View) => void
  closeOverlay: () => void
  back: () => void
  canGoBack: boolean
}

const NavContext = createContext<NavContextValue | null>(null)

const MAX_HISTORY = 50

export function NavProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // SPEC §4.1: the app always opens on Today.
  const [stack, setStack] = useState<View[]>([{ name: 'today' }])
  // "Open full page" floats a screen over the current one instead of
  // replacing it — closing lands exactly where you were.
  const [overlay, setOverlay] = useState<View | null>(null)

  const navigate = useCallback((v: View) => {
    // A link followed inside the overlay takes over the main screen.
    setOverlay(null)
    setStack((s) => {
      // Re-clicking the current screen shouldn't grow the history.
      if (JSON.stringify(s[s.length - 1]) === JSON.stringify(v)) return s
      return [...s.slice(-MAX_HISTORY), v]
    })
  }, [])

  const openOverlay = useCallback((v: View) => setOverlay(v), [])
  const closeOverlay = useCallback(() => setOverlay(null), [])

  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const view = stack[stack.length - 1]
  return (
    <NavContext.Provider
      value={{ view, overlay, navigate, openOverlay, closeOverlay, back, canGoBack: stack.length > 1 }}
    >
      {children}
    </NavContext.Provider>
  )
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav outside NavProvider')
  return ctx
}
