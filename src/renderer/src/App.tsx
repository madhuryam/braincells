import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { DataProvider } from './state/data'
import { UndoProvider } from './state/undo'
import { NavProvider, useNav } from './state/nav'
import { Sidebar } from './components/Sidebar'
import { AppDnd } from './components/dnd'
import { Today } from './screens/Today'
import { Inbox } from './screens/Inbox'
import { Projects } from './screens/Projects'
import { ProjectPage } from './screens/ProjectPage'
import { Settings } from './screens/Settings'
import { Meeting } from './screens/Meeting'
import { DailyLog } from './screens/DailyLog'
import { CalendarScreen } from './screens/CalendarScreen'
import { Page } from './screens/Page'
import { Search } from './screens/Search'

function Screen(): React.JSX.Element {
  const { view } = useNav()
  // A keyed wrapper eases each screen in — quick and directional, no
  // spring overshoot.
  const screenKey =
    'projectId' in view
      ? view.projectId
      : 'eventKey' in view
        ? view.eventKey
        : 'itemId' in view
          ? view.itemId
          : view.name
  return (
    <motion.div
      key={`${view.name}-${screenKey}`}
      className="screen-enter"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <ScreenBody view={view} />
    </motion.div>
  )
}

function ScreenBody({ view }: { view: ReturnType<typeof useNav>['view'] }): React.JSX.Element {
  switch (view.name) {
    case 'today':
      return <Today />
    case 'inbox':
      return <Inbox />
    case 'projects':
      return <Projects />
    case 'project':
      return <ProjectPage key={view.projectId} projectId={view.projectId} />
    case 'meeting':
      return <Meeting key={view.eventKey} eventKey={view.eventKey} title={view.title} date={view.date} />
    case 'page':
      return <Page key={view.itemId} itemId={view.itemId} />
    case 'calendar':
      return <CalendarScreen />
    case 'log':
      return <DailyLog />
    case 'search':
      return <Search />
    case 'settings':
      return <Settings />
  }
}

/** App-wide shortcuts. ⌘N: jump to Today and focus quick capture. */
function Shortcuts(): null {
  const { navigate } = useNav()
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        navigate({ name: 'today' })
        // Focus after the Today screen has rendered.
        requestAnimationFrame(() => document.getElementById('quick-capture')?.focus())
      }
      if (e.metaKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        navigate({ name: 'search' })
        requestAnimationFrame(() => document.getElementById('search-input')?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
  return null
}

export default function App(): React.JSX.Element {
  return (
    <DataProvider>
      <UndoProvider>
        <NavProvider>
          <Shortcuts />
          <AppDnd>
            <div className="shell">
              <Sidebar />
              <Screen />
            </div>
          </AppDnd>
        </NavProvider>
      </UndoProvider>
    </DataProvider>
  )
}
