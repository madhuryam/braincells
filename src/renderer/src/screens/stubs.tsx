import { EmptyState } from '../components/bits'

// Placeholder screens, replaced one by one in the upcoming commits.
// Each real screen gets its own file in this directory.

function Stub({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="canvas">
      <header className="canvas-header">
        <h1>{title}</h1>
      </header>
      <EmptyState art="🚧">This screen lands in an upcoming commit.</EmptyState>
    </div>
  )
}

export const TodayStub = (): React.JSX.Element => <Stub title="Today" />
export const InboxStub = (): React.JSX.Element => <Stub title="Inbox" />
export const MeetingStub = (): React.JSX.Element => <Stub title="Meeting" />
export const DailyLogStub = (): React.JSX.Element => <Stub title="Daily Log" />
export const SearchStub = (): React.JSX.Element => <Stub title="Search" />
export const SettingsStub = (): React.JSX.Element => <Stub title="Settings" />
