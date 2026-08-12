import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import type { Item, Project } from '@shared/types'

export type ThemeId = 'paper' | 'slate' | 'ocean' | 'sunset' | 'rose' | 'forest' | 'plum'

export interface ThemeDef {
  id: ThemeId
  label: string
  dark: boolean
  /** Accent color for the picker swatch. */
  swatch: string
}

/** Six light moods plus one friendly, colorful dark. */
export const THEMES: ThemeDef[] = [
  { id: 'slate', label: 'Slate', dark: false, swatch: '#364fc7' },
  { id: 'paper', label: 'Paper', dark: false, swatch: '#845ef7' },
  { id: 'ocean', label: 'Ocean', dark: false, swatch: '#1c7ed6' },
  { id: 'sunset', label: 'Sunset', dark: false, swatch: '#f76707' },
  { id: 'rose', label: 'Rose', dark: false, swatch: '#e64980' },
  { id: 'forest', label: 'Forest', dark: false, swatch: '#2f9e44' },
  { id: 'plum', label: 'Plum · dark', dark: true, swatch: '#9775fa' }
]

const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v)

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
  starred: Item[]
  theme: ThemeId
  /** Whether the active theme is a dark one. */
  dark: boolean
  setTheme: (t: ThemeId) => void
  /** Flip into the dark theme and back to the last light one. */
  toggleDark: () => void
  /** Card pills the user can hide: due date, and time-on-calendar. */
  showDuePill: boolean
  showTimePill: boolean
  setShowDuePill: (v: boolean) => void
  setShowTimePill: (v: boolean) => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [version, setVersion] = useState(0)
  const [projects, setProjects] = useState<Project[]>([])
  const [starred, setStarred] = useState<Item[]>([])
  const [theme, setThemeState] = useState<ThemeId>('slate')
  const [dark, setDark] = useState(false)
  // Pills default on; a stored `false` hides them.
  const [showDuePill, setShowDuePillState] = useState(true)
  const [showTimePill, setShowTimePillState] = useState(true)

  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // Items can also arrive from outside this window (the ⌥Space quick
  // capture). The main process tells us; we refresh everything.
  useEffect(() => window.api.onDataChanged(bump), [bump])

  useEffect(() => {
    window.api.listProjects().then(setProjects)
    window.api.starredItems().then(setStarred)
  }, [version])

  // Theme: load once (migrating the old light/dark/system values),
  // then keep the <html data-theme> attribute in sync.
  useEffect(() => {
    window.api.getSetting<string>('theme').then((t) => {
      if (isThemeId(t)) setThemeState(t)
      else if (t === 'dark') setThemeState('plum')
      else if (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
        setThemeState('plum')
      // anything else (old 'light', unset) stays on paper
    })
  }, [])
  // Pill visibility: load once, then live via the setters below.
  useEffect(() => {
    window.api.getSetting<boolean>('showDuePill').then((v) => {
      if (v === false) setShowDuePillState(false)
    })
    window.api.getSetting<boolean>('showTimePill').then((v) => {
      if (v === false) setShowTimePillState(false)
    })
  }, [])
  const setShowDuePill = useCallback((v: boolean) => {
    setShowDuePillState(v)
    window.api.setSetting('showDuePill', v)
  }, [])
  const setShowTimePill = useCallback((v: boolean) => {
    setShowTimePillState(v)
    window.api.setSetting('showTimePill', v)
  }, [])

  // How far a time-blocked task's row fades in day lists (Settings →
  // Task cards). CSS reads it as --timeblocked-fade on <html>; keyed
  // on `version` so the Settings slider applies live.
  useEffect(() => {
    window.api.getSetting<number>('timeblockedFade').then((v) => {
      if (typeof v === 'number') {
        document.documentElement.style.setProperty('--timeblocked-fade', String(v))
      }
    })
  }, [version])

  // Remembered so the sidebar moon can flip back to *your* light theme.
  const lastLight = useRef<ThemeId>('slate')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    const isDark = THEMES.find((t) => t.id === theme)!.dark
    if (!isDark) lastLight.current = theme
    // Mirrored into React state so components (the sidebar toggle)
    // re-render with the right icon — reading the DOM attribute at
    // render time races with this effect and froze the toggle.
    setDark(isDark)
  }, [theme])

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t)
    window.api.setSetting('theme', t)
  }, [])
  const toggleDark = useCallback(() => {
    setThemeState((cur) => {
      const next = THEMES.find((t) => t.id === cur)!.dark ? lastLight.current : 'plum'
      window.api.setSetting('theme', next)
      return next
    })
  }, [])


  return (
    <DataContext.Provider
      value={{
        version,
        bump,
        projects,
        starred,
        theme,
        dark,
        setTheme,
        toggleDark,
        showDuePill,
        showTimePill,
        setShowDuePill,
        setShowTimePill
      }}
    >
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
