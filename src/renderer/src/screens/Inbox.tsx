import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Item } from '@shared/types'
import { todayYmd, ymdAddDays } from '@shared/dates'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useSelection } from '../state/selection'
import { shortTitle, useUndo } from '../state/undo'
import { prettyDate, rollingDays } from '../format'
import { ItemCard } from '../components/ItemCard'
import { Card } from '../components/Card'
import { DraggableCard } from '../components/dnd'
import { BackButton, CheckableInput, EmptyState } from '../components/bits'

// Empty inbox is the app's only "win state" (SPEC §4.2) — celebrate it.
const ZERO_MESSAGES = [
  ['🌲', 'nothing to do here, go hug a tree'],
  ['🪴', 'embrace the calm, and breathe'],
  ['🥂', 'cheers, you\'re on top of things here']
] as const

/** 1–5 schedule into the rolling window; 0 is 'someday' (backlog). */
function keyLegend(): Array<[string, string]> {
  return [
    ['↑↓', 'select'],
    ...rollingDays().map((d, i) => [`${i + 1}`, d.chip] as [string, string]),
    ['0', 'someday'],
    ['P', 'project…'],
    ['M', 'meeting prep…'],
    ['X', 'drop']
  ]
}

export function Inbox(): React.JSX.Element {
  const items = useLiveQuery(() => window.api.inboxItems(), []) ?? []
  const { projects } = useData()
  const mutate = useMutate()
  const { pushUndo } = useUndo()
  const [selected, setSelected] = useState(0)
  // The keyboard-triage cursor stays hidden until the user engages, so
  // the first row isn't ringed the moment the page loads.
  const [touched, setTouched] = useState(false)
  // Which row's inline editor is open — only one at a time.
  const [openId, setOpenId] = useState<string | null>(null)
  const [picking, setPicking] = useState<'project' | 'meeting' | null>(null)
  const [draft, setDraft] = useState('')
  // Upcoming events, so a capture can be attached as meeting prep.
  const events =
    useLiveQuery(() => window.api.calendarEvents(todayYmd(), ymdAddDays(todayYmd(), 7)), []) ?? []
  const backlog = useLiveQuery(() => window.api.backlogTasks(), []) ?? []
  const completed = useLiveQuery(() => window.api.recentCompleted(50), []) ?? []
  const zero = useMemo(() => ZERO_MESSAGES[Math.floor(Math.random() * ZERO_MESSAGES.length)], [])

  const current = items[Math.min(selected, items.length - 1)]
  const { selected: multi, clear: clearMulti } = useSelection()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Don't steal keys while the user is typing somewhere.
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return

      // Every triage key acts on the multi-selection when one exists,
      // else on the keyboard-cursor row. Applying clears the selection.
      const targets =
        multi.size > 0 ? items.filter((i) => multi.has(i.id)) : current ? [current] : []
      const triage = (patch: Parameters<typeof window.api.updateItem>[1]): void => {
        mutate(async () => {
          for (const it of targets) await window.api.updateItem(it.id, patch)
        })
        if (multi.size > 0) clearMulti()
      }

      if (picking) {
        // Second keystroke of "P"/"M": a digit picks the target.
        const idx = Number(e.key) - 1
        if (picking === 'project' && idx >= 0 && idx < projects.length && targets.length > 0) {
          triage({ projectId: projects[idx].id, status: 'active' })
        }
        if (picking === 'meeting' && idx >= 0 && idx < events.length && targets.length > 0) {
          const event = events[idx]
          mutate(async () => {
            for (const it of targets) {
              await window.api.updateItem(it.id, { kind: 'prep', status: 'active' })
              await window.api.linkToEvent(it.id, event, 'prep-for')
            }
          })
          if (multi.size > 0) clearMulti()
        }
        setPicking(null)
        return
      }
      if (targets.length === 0) return

      // 1–5: a task on that day of the rolling window.
      const days = rollingDays()
      const dayIdx = Number(e.key) - 1
      if (e.key >= '1' && e.key <= '5' && days[dayIdx]) {
        triage({ kind: 'task', status: 'active', scheduledDate: days[dayIdx].date })
        return
      }
      switch (e.key) {
        case 'ArrowDown':
        case 'j':
          setTouched(true)
          setSelected((s) => Math.min(s + 1, items.length - 1))
          break
        case 'ArrowUp':
        case 'k':
          setTouched(true)
          setSelected((s) => Math.max(s - 1, 0))
          break
        case '0': // someday: an active task with no date — the backlog
          triage({ kind: 'task', status: 'active' })
          break
        case 'p':
          setPicking('project')
          break
        case 'm':
          setPicking('meeting')
          break
        case 'x': {
          const dropped = [...targets]
          triage({ status: 'dropped' })
          pushUndo(
            dropped.length === 1
              ? `Dropped “${shortTitle(dropped[0].title)}”`
              : `Dropped ${dropped.length} items`,
            async () => {
              for (const it of dropped) await window.api.updateItem(it.id, { status: 'inbox' })
            }
          )
          break
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, items, picking, projects, events, mutate, pushUndo, multi, clearMulti])

  const capture = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    await mutate(() => window.api.createItem({ kind: 'task', title }))
    setDraft('')
  }

  const [sweeping, setSweeping] = useState(false)
  const bankruptcy = (): void => {
    // No grim confirmation — dropping is cheap and recoverable by
    // design. The cards get swept off-screen one after another, then
    // the drop lands in the database (SPEC §7: playful, not grim).
    setSweeping(true)
    const swept = items.map((i) => ({ id: i.id, status: i.status }))
    const duration = Math.min(items.length, 12) * 60 + 450
    setTimeout(async () => {
      await mutate(() => window.api.dropItems(swept.map((s) => s.id)))
      setSweeping(false)
      pushUndo(`Declared bankruptcy on ${swept.length} items`, async () => {
        for (const s of swept) await window.api.updateItem(s.id, { status: s.status })
      })
    }, duration)
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        <BackButton />
        <h1>Inbox</h1>
        {items.length > 0 && (
          <button className="btn ghost" onClick={bankruptcy} title="Drop everything, guilt-free">
            🧹 Declare bankruptcy
          </button>
        )}
      </header>

      <div style={{ marginBottom: 14 }}>
        <CheckableInput
          id="inbox-capture"
          placeholder="Capture anything (⌘N) — it lands here as a task to triage…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && capture()}
        />
      </div>

      {items.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          {keyLegend().map(([key, label]) => (
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
        <div className="item-list">
          <AnimatePresence initial={false}>
            {items.map((item, i) => (
              <div
                key={item.id}
                onClick={() => {
                  setSelected(i)
                  setTouched(true)
                }}
                className={sweeping ? 'sweep-out' : ''}
                style={{
                  // The keyboard-triage cursor: only after the user has
                  // actually engaged, so item 0 isn't marked on load.
                  // An accent edge + wash, not an outline — outlines jut
                  // outside flush rows and clip against the container.
                  ...(touched && i === selected && !sweeping
                    ? { boxShadow: 'inset 3px 0 0 var(--accent)', background: 'var(--accent-soft)' }
                    : {}),
                  ...(sweeping ? { transitionDelay: `${Math.min(i, 12) * 60}ms` } : {})
                }}
              >
                {/* Draggable: drop on a sidebar project or on Today. */}
                <DraggableCard item={item}>
                  {/* Checkbox multi-selects (inbox items are triaged,
                      not completed); a click also bubbles up to target
                      the row for keyboard triage as the editor opens.
                      Controlled open → only one card edits at a time. */}
                  <ItemCard
                    item={item}
                    checkboxSelects
                    open={openId === item.id}
                    onOpenChange={(o) => {
                      setOpenId(o ? item.id : null)
                      if (o) {
                        setSelected(i)
                        setTouched(true)
                      }
                    }}
                  />
                </DraggableCard>
              </div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Triaged-but-unplaced things keep a visible home down here, so
          'someday' is a real backlog you can revisit — never a void. */}
      <ItemSection
        title="Backlog · someday"
        hint="Tasks with no date. Open one to put it on a day, or drag it onto Today."
        items={backlog}
        defaultOpen
      />
      <ItemSection
        title="Completed"
        hint="Everything you've finished, newest first. Uncheck one to bring it back."
        items={completed}
      />
    </div>
  )
}

/** A collapsible card list with a count, used for backlog and done. */
function ItemSection({
  title,
  hint,
  items,
  defaultOpen = false
}: {
  title: string
  hint: string
  items: Item[]
  defaultOpen?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen)
  if (items.length === 0) return null
  return (
    <section style={{ marginTop: 18 }}>
      <button className="section-label day-toggle" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {title}
        <span className="pill">{items.length}</span>
      </button>
      {open && (
        <>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--text-faint)' }}>{hint}</p>
          <div className="item-list">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <DraggableCard key={item.id} item={item}>
                  <ItemCard item={item} />
                </DraggableCard>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </section>
  )
}
