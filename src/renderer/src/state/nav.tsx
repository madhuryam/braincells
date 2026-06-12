import { createContext, useContext, useState, type ReactNode } from 'react'

/**
 * Client-side "routing" without a router: the app is four-and-a-bit
 * screens behind a single switch, and nothing needs URLs or history.
 */
export type View =
  | { name: 'today' }
  | { name: 'inbox' }
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'meeting'; eventKey: string; title: string; date: string }
  | { name: 'log' }
  | { name: 'search' }
  | { name: 'settings' }

interface NavContextValue {
  view: View
  navigate: (v: View) => void
}

const NavContext = createContext<NavContextValue | null>(null)

export function NavProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // SPEC §4.1: the app always opens on Today.
  const [view, navigate] = useState<View>({ name: 'today' })
  return <NavContext.Provider value={{ view, navigate }}>{children}</NavContext.Provider>
}

export function useNav(): NavContextValue {
  const ctx = useContext(NavContext)
  if (!ctx) throw new Error('useNav outside NavProvider')
  return ctx
}
