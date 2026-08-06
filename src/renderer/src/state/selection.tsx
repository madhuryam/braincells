import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * Multi-select for bulk triage: ⌘-click rows to gather a set, then the
 * SelectionBar assigns a day or project to all of them in one click.
 */
interface SelectionContextValue {
  selected: Set<string>
  toggle: (id: string) => void
  clear: () => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

export function SelectionProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clear = useCallback(() => setSelected(new Set()), [])
  const value = useMemo(() => ({ selected, toggle, clear }), [selected, toggle, clear])
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('useSelection outside SelectionProvider')
  return ctx
}
