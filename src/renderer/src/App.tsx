import { DataProvider } from './state/data'
import { NavProvider, useNav } from './state/nav'
import { Sidebar } from './components/Sidebar'
import {
  DailyLogStub,
  InboxStub,
  MeetingStub,
  ProjectPageStub,
  ProjectsStub,
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
      return <InboxStub />
    case 'projects':
      return <ProjectsStub />
    case 'project':
      return <ProjectPageStub />
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
