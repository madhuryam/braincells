import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { DataProvider } from './state/data'
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
import { Search } from './screens/Search'

function Screen(): React.JSX.Element {
  const { view } = useNav()
  // A keyed wrapper makes each screen glide in with a soft spring.
  const screenKey =
    'projectId' in view ? view.projectId : 'eventKey' in view ? view.eventKey : view.name
  return (
    <motion.div
      key={`${view.name}-${screenKey}`}
      className="screen-enter"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
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
      <NavProvider>
        <Shortcuts />
        <AppDnd>
          <div className="shell">
            <Sidebar />
            <Screen />
          </div>
        </AppDnd>
      </NavProvider>
    </DataProvider>
  )
}
