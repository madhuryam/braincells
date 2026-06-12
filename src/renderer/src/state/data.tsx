import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode
} from 'react'
import type { Project } from '@shared/types'

type Theme = 'light' | 'dark' | 'system'

/**
 * Data freshness works with one global "version" counter: every
 * mutation bumps it, and every query made through useLiveQuery()
 * re-runs when it changes. Crude but perfect for a local app where
 * every query is a sub-millisecond SQLite call.
 */
interface DataContextValue {
  version: number
  bump: () => void
  /** Loaded centrally because the sidebar shows them on every screen. */
  projects: Project[]
  inboxCount: number
  theme: Theme
  setTheme: (t: Theme) => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [version, setVersion] = useState(0)
  const [projects, setProjects] = useState<Project[]>([])
  const [inboxCount, setInboxCount] = useState(0)
  const [theme, setThemeState] = useState<Theme>('system')

  const bump = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    window.api.listProjects().then(setProjects)
    window.api.inboxCount().then(setInboxCount)
  }, [version])

  // Theme: load once, then keep the <html data-theme> attribute in sync.
  useEffect(() => {
    window.api.getSetting<Theme>('theme').then((t) => t && setThemeState(t))
  }, [])
  useEffect(() => {
    const apply = (): void => {
      const dark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    window.api.setSetting('theme', t)
  }, [])

  return (
    <DataContext.Provider value={{ version, bump, projects, inboxCount, theme, setTheme }}>
      {children}
    </DataContext.Provider>
  )
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData outside DataProvider')
  return ctx
}

/** Run a query now and again after every mutation anywhere in the app. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: unknown[]): T | undefined {
  const { version } = useData()
  const [data, setData] = useState<T>()
  useEffect(() => {
    let alive = true
    query().then((d) => {
      if (alive) setData(d)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])
  return data
}

/** Wrap a mutation so the whole UI refreshes once it lands. */
export function useMutate(): (mutation: () => Promise<unknown>) => Promise<void> {
  const { bump } = useData()
  return useCallback(
    async (mutation) => {
      await mutation()
      bump()
    },
    [bump]
  )
}
