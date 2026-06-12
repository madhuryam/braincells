import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/**
 * Client-side "routing" without a router: a handful of screens behind
 * a single switch — but with a history stack, so opening a meeting
 * from a project page (or notes from the daily log) can go *back* to
 * where you were.
 */
export type View =
  | { name: 'today' }
  | { name: 'inbox' }
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'meeting'; eventKey: string; title: string; date: string }
  | { name: 'calendar' }
  | { name: 'log' }
  | { name: 'search' }
  | { name: 'settings' }

interface NavContextValue {
  view: View
  navigate: (v: View) => void
  back: () => void
  canGoBack: boolean
}

const NavContext = createContext<NavContextValue | null>(null)

const MAX_HISTORY = 50

export function NavProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // SPEC §4.1: the app always opens on Today.
  const [stack, setStack] = useState<View[]>([{ name: 'today' }])

  const navigate = useCallback((v: View) => {
    setStack((s) => {
      // Re-clicking the current screen shouldn't grow the history.
      if (JSON.stringify(s[s.length - 1]) === JSON.stringify(v)) return s
      return [...s.slice(-MAX_HISTORY), v]
    })
  }, [])

  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }, [])

  const view = stack[stack.length - 1]
  return (
    <NavContext.Provider value={{ view, navigate, back, canGoBack: stack.length > 1 }}>
      {children}
    </NavContext.Provider>
  )
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav outside NavProvider')
  return ctx
}
