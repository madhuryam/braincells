import { useEffect, useState } from 'react'

// Temporary smoke-test UI: proves the renderer can reach the database
// through the preload bridge. Replaced by the real screens next.
export default function App(): React.JSX.Element {
  const [inboxCount, setInboxCount] = useState<number | null>(null)

  useEffect(() => {
    window.api.inboxCount().then(setInboxCount)
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui', padding: '4rem', textAlign: 'center' }}>
      <h1>braincells</h1>
      <p>{inboxCount === null ? 'Connecting to database…' : `Inbox items: ${inboxCount}`}</p>
    </main>
  )
}
