import { DataProvider } from './state/data'
import { NavProvider, useNav } from './state/nav'
import { Sidebar } from './components/Sidebar'
import { Inbox } from './screens/Inbox'
import { Projects } from './screens/Projects'
import { ProjectPage } from './screens/ProjectPage'
import {
  DailyLogStub,
  MeetingStub,
  SearchStub,
  SettingsStub,
  TodayStub
} from './screens/stubs'

function Screen(): React.JSX.Element {
  const { view } = useNav()
  switch (view.name) {
    case 'today':
      return <TodayStub />
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
      return <SettingsStub />
  }
}

export default function App(): React.JSX.Element {
  return (
    <DataProvider>
      <NavProvider>
        <div className="shell">
          <Sidebar />
          <Screen />
        </div>
      </NavProvider>
    </DataProvider>
  )
}
