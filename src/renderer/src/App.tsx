import { useEffect } from 'react'
import { DataProvider } from './state/data'
import { NavProvider, useNav } from './state/nav'
import { Sidebar } from './components/Sidebar'
import { AppDnd } from './components/dnd'
import { Today } from './screens/Today'
import { Inbox } from './screens/Inbox'
import { Projects } from './screens/Projects'
import { ProjectPage } from './screens/ProjectPage'
import { Settings } from './screens/Settings'
import { DailyLogStub, MeetingStub, SearchStub } from './screens/stubs'

function Screen(): React.JSX.Element {
  const { view } = useNav()
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
      return <MeetingStub />
    case 'log':
      return <DailyLogStub />
    case 'search':
      return <SearchStub />
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
