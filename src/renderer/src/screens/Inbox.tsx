import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { todayYmd, ymdAddDays } from '@shared/dates'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { prettyDate } from '../format'
import { ItemCard } from '../components/ItemCard'
import { Card } from '../components/Card'
import { DraggableCard } from '../components/dnd'
import { EmptyState } from '../components/bits'

// Empty inbox is the app's only "win state" (SPEC §4.2) — celebrate it.
const ZERO_MESSAGES = [
  ['🌿', 'Nothing here. Go touch grass.'],
  ['🔥', 'Inbox clear. You’re dangerous today.'],
  ['🫖', 'All triaged. Put the kettle on.'],
  ['🧹', 'Swept clean. The chaos fears you.'],
  ['🌅', 'Zero. As the universe intended.']
] as const

const KEY_LEGEND: Array<[string, string]> = [
  ['↑↓', 'select'],
  ['1', 'task · today'],
  ['2', 'task · tomorrow'],
  ['3', 'task · someday'],
  ['N', 'make note'],
  ['P', 'project…'],
  ['M', 'meeting prep…'],
  ['X', 'drop']
]

export function Inbox(): React.JSX.Element {
  const items = useLiveQuery(() => window.api.inboxItems(), []) ?? []
  const { projects } = useData()
  const mutate = useMutate()
  const [selected, setSelected] = useState(0)
  const [picking, setPicking] = useState<'project' | 'meeting' | null>(null)
  const [draft, setDraft] = useState('')
  // Upcoming events, so a capture can be attached as meeting prep.
  const events =
    useLiveQuery(() => window.api.calendarEvents(todayYmd(), ymdAddDays(todayYmd(), 7)), []) ?? []
  const zero = useMemo(() => ZERO_MESSAGES[Math.floor(Math.random() * ZERO_MESSAGES.length)], [])

  const current = items[Math.min(selected, items.length - 1)]

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Don't steal keys while the user is typing somewhere.
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return

      if (picking) {
        // Second keystroke of "P"/"M": a digit picks the target.
        const idx = Number(e.key) - 1
        if (picking === 'project' && idx >= 0 && idx < projects.length && current) {
          mutate(() =>
            window.api.updateItem(current.id, { projectId: projects[idx].id, status: 'active' })
          )
        }
        if (picking === 'meeting' && idx >= 0 && idx < events.length && current) {
          const event = events[idx]
          mutate(async () => {
            await window.api.updateItem(current.id, { kind: 'prep', status: 'active' })
            await window.api.linkToEvent(current.id, event, 'prep-for')
          })
        }
        setPicking(null)
        return
      }
      if (!current) return

      const triage = (patch: Parameters<typeof window.api.updateItem>[1]): void => {
        mutate(() => window.api.updateItem(current.id, patch))
      }
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          setSelected((s) => Math.min(s + 1, items.length - 1))
          break
        case 'ArrowUp':
        case 'k':
          setSelected((s) => Math.max(s - 1, 0))
          break
        case '1':
          triage({ kind: 'task', status: 'active', scheduledDate: todayYmd() })
          break
        case '2':
          triage({ kind: 'task', status: 'active', scheduledDate: ymdAddDays(todayYmd(), 1) })
          break
        case '3': // someday: an active task with no date — lives in its project
          triage({ kind: 'task', status: 'active' })
          break
        case 'n':
          triage({ kind: 'note', status: 'active' })
          break
        case 'p':
          setPicking('project')
          break
        case 'm':
          setPicking('meeting')
          break
        case 'x':
          triage({ status: 'dropped' })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, items.length, picking, projects, events, mutate])

  const capture = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    await mutate(() => window.api.createItem({ kind: 'note', title }))
    setDraft('')
  }

  const [sweeping, setSweeping] = useState(false)
  const bankruptcy = (): void => {
    // No grim confirmation — dropping is cheap and recoverable by
    // design. The cards get swept off-screen one after another, then
    // the drop lands in the database (SPEC §7: playful, not grim).
    setSweeping(true)
    const duration = Math.min(items.length, 12) * 60 + 450
    setTimeout(async () => {
      await mutate(() => window.api.dropItems(items.map((i) => i.id)))
      setSweeping(false)
    }, duration)
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        <h1>Inbox</h1>
        {items.length > 0 && (
          <button className="btn ghost" onClick={bankruptcy} title="Drop everything, guilt-free">
            🧹 Declare bankruptcy
          </button>
        )}
      </header>

      <input
        style={{ width: '100%', marginBottom: 14 }}
        placeholder="Capture anything — sort it out later…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && capture()}
      />

      {items.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          {KEY_LEGEND.map(([key, label]) => (
            <span key={key} className="pill">
              <b>{key}</b> {label}
            </span>
          ))}
        </div>
      )}

      {picking === 'project' && (
        <Card className="stack" accentColor="var(--accent)">
          <b>Assign to which project?</b>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {projects.map((p, i) => (
              <span key={p.id} className="pill">
                <b>{i + 1}</b> {p.name}
              </span>
            ))}
            {projects.length === 0 && <span>No projects yet — press any key.</span>}
          </div>
        </Card>
      )}
      {picking === 'meeting' && (
        <Card className="stack" accentColor="var(--accent)">
          <b>Prep for which meeting?</b>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {events.slice(0, 9).map((ev, i) => (
              <span key={ev.eventKey} className="pill">
                <b>{i + 1}</b> {ev.title} · {prettyDate(ev.date)}
              </span>
            ))}
            {events.length === 0 && <span>No upcoming meetings — press any key.</span>}
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState art={zero[0]}>{zero[1]}</EmptyState>
      ) : (
        <div className="stack">
          <AnimatePresence>
            {items.map((item, i) => (
              <div
                key={item.id}
                onClick={() => setSelected(i)}
                className={sweeping ? 'sweep-out' : ''}
                style={{
                  ...(i === selected && !sweeping
                    ? { outline: '2px solid var(--accent)', borderRadius: 'var(--radius-card)' }
                    : {}),
                  ...(sweeping ? { transitionDelay: `${Math.min(i, 12) * 60}ms` } : {})
                }}
              >
                {/* Draggable: drop on a sidebar project or on Today. */}
                <DraggableCard item={item}>
                  <ItemCard item={item} />
                </DraggableCard>
              </div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
