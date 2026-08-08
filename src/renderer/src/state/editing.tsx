import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Which inline editor is open — app-wide, at most one. Opening a card
 * anywhere collapses whichever other card was open, so screens never
 * fill up with half-edited editors. Keys are opaque slot tokens, not
 * item ids: each card instance brings its own (useId), so a task
 * rendered in two places (Today's list and a meeting's prep list)
 * expands only where it was clicked.
 */
interface EditingContextValue {
  openId: string | null
  setOpenId: (id: string | null) => void
}

const EditingContext = createContext<EditingContextValue | null>(null)

export function EditingProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const value = useMemo(() => ({ openId, setOpenId }), [openId])
  return <EditingContext.Provider value={value}>{children}</EditingContext.Provider>
}

export function useEditing(): EditingContextValue {
  const ctx = useContext(EditingContext)
  if (!ctx) throw new Error('useEditing outside EditingProvider')
  return ctx
}
