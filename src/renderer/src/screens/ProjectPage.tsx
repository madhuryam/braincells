import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Item } from '@shared/types'
import { todayYmd, ymdAddDays } from '@shared/dates'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from '../components/Card'
import { DetailPanel } from '../components/DetailPanel'
import { ItemCard } from '../components/ItemCard'
import { ItemDetail } from '../components/ItemDetail'
import { DraggableCard } from '../components/dnd'
import { MeetingRow } from '../components/MeetingRow'
import { Meeting } from './Meeting'
import { BackButton, CheckableInput, EmptyState, ProgressBar, ProjectDot } from '../components/bits'
import { PROJECT_COLORS } from '../palette'
import { mmdd } from '../format'

/** What the right-hand detail panel is showing. */
type Detail =
  | { kind: 'meeting'; eventKey: string; title: string; date: string }
  | { kind: 'item'; itemId: string }

/**
 * One canvas in the project's list. Clicking opens the side panel —
 * no action buttons here: deletion lives on the canvas's full view,
 * where you can see what you're deleting.
 */
function CanvasRow({ item, onOpen }: { item: Item; onOpen: () => void }): React.JSX.Element {
  return (
    <Card interactive onClick={onOpen}>
      <div className="row">
        <span aria-hidden>{item.starred ? '⭐' : '📄'}</span>
        <span className="card-title">{item.title || 'Untitled canvas'}</span>
      </div>
    </Card>
  )
}

export function ProjectPage({ projectId }: { projectId: string }): React.JSX.Element {
  const { projects } = useData()
  const { openOverlay } = useNav()
  const mutate = useMutate()
  const project = projects.find((p) => p.id === projectId)
  const items = useLiveQuery(() => window.api.projectItems(projectId), [projectId])
  const meetings = useLiveQuery(() => window.api.meetingsForProject(projectId), [projectId]) ?? []
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(false)
  // Canvases and To-dos collapse like Meetings/Done, but start open —
  // they're the reason you came to the project.
  const [canvasesOpen, setCanvasesOpen] = useState(true)
  const [todosOpen, setTodosOpen] = useState(true)
  // Canvases paginate: freshest 5 first, then +10 per "show more".
  const [canvasesShown, setCanvasesShown] = useState(5)
  // Meetings show one tab at a time (upcoming first — that's what
  // planning needs), revealed a handful at a time.
  const [meetingsOpen, setMeetingsOpen] = useState(true)
  const [meetingsTab, setMeetingsTab] = useState<'upcoming' | 'previous'>('upcoming')
  const [meetingsShown, setMeetingsShown] = useState<number | null>(null)

  // Inline header editing: click the name to rename, the dot to recolor.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [pickingColor, setPickingColor] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)

  if (!project) return <div className="canvas">Project not found.</div>

  const saveName = async (): Promise<void> => {
    const trimmed = nameDraft.trim()
    setEditingName(false)
    if (!trimmed || trimmed === project.name) return
    try {
      await mutate(() => window.api.updateProject(projectId, { name: trimmed }))
      setNameError(null)
    } catch {
      setNameError(`Couldn’t rename — another project is already called “${trimmed}”.`)
    }
  }

  const open = (items ?? []).filter((i) => i.status === 'active' || i.status === 'inbox')
  // Freshest canvas first — updatedAt is null on pre-migration rows,
  // where createdAt is the best "last touched" we have.
  const pages = open
    .filter((i) => i.kind === 'page')
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
  // Starred canvases stay in the main list (every canvas listed once);
  // the overview keeps quick links to the starred ones.
  const starredPages = pages.filter((p) => p.starred)
  // Ordered by when they're due to be done: today (and anything
  // overdue) first, then tomorrow, then later — undated "someday" tasks
  // sink to the bottom. Stable, so manual order is kept within a day.
  const todos = open
    .filter((i) => i.kind === 'task' || i.kind === 'prep')
    .sort((a, b) => (a.scheduledDate ?? '9999-99-99').localeCompare(b.scheduledDate ?? '9999-99-99'))
  const done = (items ?? []).filter((i) => i.status === 'done' && i.kind !== 'page')

  // Meetings split around today: upcoming soonest-first, previous
  // most-recent-first — each browseable on its own.
  const today = todayYmd()
  const upcoming = meetings
    .filter((m) => m.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
  const previous = meetings
    .filter((m) => m.date < today)
    .sort((a, b) => b.date.localeCompare(a.date))
  // The first page never cuts off today: every meeting happening today
  // shows, and at least a handful beyond.
  const firstPage = Math.max(5, upcoming.filter((m) => m.date === today).length)
  const shown = meetingsShown ?? firstPage

  // Projects hold tasks and pages — a longer thought belongs on a
  // page, so the quick-add only makes tasks.
  const add = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    await mutate(() => window.api.createItem({ kind: 'task', title, status: 'active', projectId }))
    setDraft('')
  }

  const newPage = async (): Promise<void> => {
    const item = await window.api.createItem({
      kind: 'page',
      title: '',
      status: 'active',
      projectId
    })
    await mutate(() => Promise.resolve())
    openOverlay({ name: 'page', itemId: item.id })
  }

  return (
    <div className="canvas" style={{ '--canvas-max': '1500px' } as React.CSSProperties}>
      <header className="canvas-header">
        <BackButton />
        <button
          className="project-color-btn"
          title="Change project color"
          onClick={() => setPickingColor(!pickingColor)}
        >
          <ProjectDot color={project.color} />
        </button>
        {editingName ? (
          <input
            className="project-name-input"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setNameDraft(project.name)
                setEditingName(false)
              }
            }}
          />
        ) : (
          <h1
            title="Rename project"
            style={{ cursor: 'text' }}
            onClick={() => {
              setNameDraft(project.name)
              setEditingName(true)
            }}
          >
            {project.name}
          </h1>
        )}
      </header>

      {pickingColor && (
        <div className="row" style={{ marginBottom: 14 }}>
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => {
                mutate(() => window.api.updateProject(projectId, { color: c }))
                setPickingColor(false)
              }}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                border: c === project.color ? '3px solid var(--text)' : '3px solid transparent'
              }}
            />
          ))}
        </div>
      )}
      {nameError && (
        <p style={{ margin: '0 0 12px', color: 'var(--danger)', fontSize: 13 }}>{nameError}</p>
      )}

      <div className="log-split">
      <div className="log-main">
      <div className="row" style={{ marginBottom: 18 }}>
        <CheckableInput
          placeholder={`Add a task to ${project.name}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </div>

      {open.length === 0 && done.length === 0 && meetings.length === 0 && (
        <EmptyState art="🌱">Nothing here yet. Add a task or note above.</EmptyState>
      )}

      {/* Canvases: full writing surfaces (rich text, tables) per project.
          "＋ new canvas" is a sibling of the toggle, not a child — so
          clicking it never collapses the section. */}
      <div className="row">
        <button
          className="section-label day-toggle"
          style={{ width: 'auto' }} // sit beside the ＋ button, not over it
          onClick={() => setCanvasesOpen(!canvasesOpen)}
        >
          {canvasesOpen ? '▾' : '▸'} Canvases
        </button>
        <button className="btn ghost" onClick={newPage}>
          ＋ new canvas
        </button>
      </div>
      {canvasesOpen && (
        <>
          <div className="item-list project-section">
            {pages.slice(0, canvasesShown).map((p) => (
              <CanvasRow key={p.id} item={p} onOpen={() => setDetail({ kind: 'item', itemId: p.id })} />
            ))}
          </div>
          {pages.length > canvasesShown && (
            <button className="btn ghost small" onClick={() => setCanvasesShown(canvasesShown + 10)}>
              show more
            </button>
          )}
          {pages.length === 0 && (
            <span className="project-section" style={{ color: 'var(--text-faint)', fontSize: 13, display: 'block' }}>
              No canvases yet — a canvas is a full document for brain-dumping knowledge.
            </span>
          )}
        </>
      )}

      {/* One vertical section per kind of thing — no masonry mixing. */}
      {todos.length > 0 && (
        <>
          <button className="section-label day-toggle" onClick={() => setTodosOpen(!todosOpen)}>
            {todosOpen ? '▾' : '▸'} To-dos
          </button>
          {todosOpen && (
            <div className="item-list project-section">
              <AnimatePresence initial={false}>
                {todos.map((item) => (
                  <DraggableCard key={item.id} item={item}>
                    <ItemCard item={item} showProject={false} />
                  </DraggableCard>
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {/* Meetings: collapsed until asked for, one tab at a time —
          a busy project accumulates far more meetings than anyone
          wants to scroll past. */}
      {meetings.length > 0 && (
        <>
          <button className="section-label day-toggle" onClick={() => setMeetingsOpen(!meetingsOpen)}>
            {meetingsOpen ? '▾' : '▸'} Meetings
          </button>
          {meetingsOpen && (
            <div className="stack project-section">
              <div className="row">
                {(
                  [
                    ['upcoming', 'Upcoming'],
                    ['previous', 'Previous']
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    className={`btn small ${meetingsTab === tab ? 'primary' : 'ghost'}`}
                    onClick={() => {
                      setMeetingsTab(tab)
                      setMeetingsShown(null) // each tab starts back at its first page
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {(() => {
                const list = meetingsTab === 'upcoming' ? upcoming : previous
                return (
                  <>
                    <div className="item-list">
                      {list.slice(0, shown).map((m) => (
                        <MeetingRow
                          key={m.eventKey}
                          meeting={m}
                          onPeek={(mtg) =>
                            setDetail({ kind: 'meeting', eventKey: mtg.eventKey, title: mtg.title, date: mtg.date })
                          }
                        />
                      ))}
                    </div>
                    {list.length === 0 && (
                      <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>
                        no {meetingsTab} meetings
                      </span>
                    )}
                    {list.length > shown && (
                      <button className="btn ghost small" onClick={() => setMeetingsShown(shown + 10)}>
                        show more
                      </button>
                    )}
                  </>
                )
              })()}
            </div>
          )}
        </>
      )}

      {done.length > 0 && (
        <>
          <button className="section-label day-toggle" onClick={() => setShowDone(!showDone)}>
            {showDone ? '▾' : '▸'} Done <span className="pill">{done.length}</span>
          </button>
          {showDone && (
            <div className="item-list project-section">
              {done.map((item) => (
                <ItemCard key={item.id} item={item} showProject={false} />
              ))}
            </div>
          )}
        </>
      )}
      </div>

      {detail ? (
        <DetailPanel
          title={detail.kind === 'meeting' ? detail.title : undefined}
          onOpenFull={
            detail.kind === 'meeting'
              ? () =>
                  openOverlay({
                    name: 'meeting',
                    eventKey: detail.eventKey,
                    title: detail.title,
                    date: detail.date
                  })
              : undefined
          }
          onClose={() => setDetail(null)}
        >
          {detail.kind === 'meeting' ? (
            <Meeting
              key={detail.eventKey}
              embedded
              eventKey={detail.eventKey}
              title={detail.title}
              date={detail.date}
            />
          ) : (
            <ItemDetail key={detail.itemId} itemId={detail.itemId} />
          )}
        </DetailPanel>
      ) : (
        <ProjectOverview
          projectId={projectId}
          openTodos={todos.length}
          done={done}
          meetings={meetings}
          starred={starredPages}
          onPeekMeeting={(m) =>
            setDetail({ kind: 'meeting', eventKey: m.eventKey, title: m.title, date: m.date })
          }
          onPeekItem={(id) => setDetail({ kind: 'item', itemId: id })}
        />
      )}
      </div>
    </div>
  )
}

type MeetingLite = { eventKey: string; title: string; date: string }

/**
 * The right half when nothing is peeked: a glanceable summary instead
 * of dead space — a browseable meeting widget, task progress, weekly
 * activity, starred canvases, and a scratchpad. Clicks peek.
 */
function ProjectOverview({
  projectId,
  openTodos,
  done,
  meetings,
  starred,
  onPeekMeeting,
  onPeekItem
}: {
  projectId: string
  openTodos: number
  done: Item[]
  meetings: MeetingLite[]
  starred: Item[]
  onPeekMeeting: (m: MeetingLite) => void
  onPeekItem: (id: string) => void
}): React.JSX.Element {
  const doneCount = done.length
  // One chronological line for the widget's arrows to walk.
  const timeline = [...meetings].sort((a, b) => a.date.localeCompare(b.date))
  const hasMeetings = timeline.length > 0
  // Ruled partitions between blocks; the first block skips the rule
  // (nothing above it to divide from).
  const section = (first = false): React.CSSProperties => ({
    borderTop: first ? 'none' : '1px solid var(--border)',
    paddingTop: 12,
    marginTop: 2
  })

  return (
    <aside className="detail-panel quiet">
      <div className="section-label">At a glance</div>
      <div className="stack" style={{ gap: 6, marginTop: 4 }}>
        {hasMeetings && (
          <div style={section(true)}>
            <MeetingWidget meetings={timeline} onPeek={onPeekMeeting} />
          </div>
        )}

        <div style={section(!hasMeetings)}>
          <div className="section-sublabel">Tasks</div>
          <div className="stack" style={{ gap: 6, marginTop: 4 }}>
            <ProgressBar done={doneCount} total={doneCount + openTodos} />
            <span style={{ fontSize: 12.5, color: 'var(--text-soft)' }}>
              {openTodos} open · {doneCount} done
            </span>
          </div>
        </div>

        <div style={section()}>
          <div className="section-sublabel">Activity</div>
          <ActivitySparkline done={done} />
        </div>

        {starred.length > 0 && (
          <div style={section()}>
            <div className="section-sublabel">⭐ Starred canvases</div>
            {starred.map((p) => (
              <button key={p.id} className="nav-item" onClick={() => onPeekItem(p.id)}>
                <span aria-hidden>📄</span>
                <span>{p.title || 'Untitled canvas'}</span>
              </button>
            ))}
          </div>
        )}

        <div style={section()}>
          <div className="section-sublabel">Scratchpad</div>
          <Scratchpad projectId={projectId} />
        </div>
      </div>
    </aside>
  )
}

/**
 * One meeting at a time with ‹ › arrows over the project's whole
 * timeline. Starts on the next upcoming meeting (or the most recent
 * one), and previews its notes/prep/follow-up state at a glance.
 * Caller guarantees a non-empty list.
 */
function MeetingWidget({
  meetings,
  onPeek
}: {
  meetings: MeetingLite[]
  onPeek: (m: MeetingLite) => void
}): React.JSX.Element {
  const firstUpcoming = meetings.findIndex((m) => m.date >= todayYmd())
  const [idx, setIdx] = useState(firstUpcoming === -1 ? meetings.length - 1 : firstUpcoming)
  // Clamp in case the meeting list shrinks under a live refresh.
  const i = Math.max(0, Math.min(idx, meetings.length - 1))
  const m = meetings[i]

  // Temporal status readable without parsing the date: accent = today,
  // faint = already happened, green = still ahead.
  const when = m.date === todayYmd() ? 'today' : m.date < todayYmd() ? 'past' : 'future'
  const statusColor =
    when === 'today' ? 'var(--accent)' : when === 'past' ? 'var(--text-faint)' : '#2f9e44'

  const linked = useLiveQuery(async () => {
    const [notes, prep, followUps] = await Promise.all([
      window.api.itemsForEvent(m.eventKey, 'notes-for'),
      window.api.itemsForEvent(m.eventKey, 'prep-for'),
      window.api.itemsForEvent(m.eventKey, 'follow-up-from')
    ])
    return { hasNotes: notes.length > 0, prep, followUps }
  }, [m.eventKey])

  const preview = (label: string, rows: { item: Item }[]): React.JSX.Element | null => {
    if (rows.length === 0) return null
    const doneCount = rows.filter((r) => r.item.status === 'done').length
    return (
      <div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-faint)' }}>
          {label} {doneCount}/{rows.length}
        </div>
        {rows.slice(0, 3).map((r) => (
          <div
            key={r.item.id}
            style={{
              fontSize: 12.5,
              color: 'var(--text-soft)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {r.item.status === 'done' && (
              <span aria-hidden style={{ color: 'var(--text-faint)', fontWeight: 700 }}>
                ✓{' '}
              </span>
            )}
            {r.item.title || 'Untitled'}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <div
        className="section-sublabel"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <span>Meetings</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button className="btn ghost small" disabled={i === 0} onClick={() => setIdx(i - 1)}>
            ‹
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
            {i + 1}/{meetings.length}
          </span>
          <button
            className="btn ghost small"
            disabled={i === meetings.length - 1}
            onClick={() => setIdx(i + 1)}
          >
            ›
          </button>
        </span>
      </div>
      <button
        className="nav-item"
        onClick={() => onPeek(m)}
        style={{
          // Today gets a soft accent wash; past meetings recede.
          background: when === 'today' ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined,
          opacity: when === 'past' ? 0.75 : undefined
        }}
      >
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
            display: 'inline-block'
          }}
        />
        <span className="meeting-date" style={{ color: statusColor }}>
          {mmdd(m.date)}
        </span>
        <span>{m.title}</span>
        {linked &&
          (linked.hasNotes ? (
            <span aria-hidden title="Has notes">
              📝
            </span>
          ) : (
            <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>no notes</span>
          ))}
      </button>
      {linked && (linked.prep.length > 0 || linked.followUps.length > 0) && (
        <div className="stack" style={{ gap: 6, marginTop: 4, paddingLeft: 4 }}>
          {preview('Prep', linked.prep)}
          {preview('Follow-ups', linked.followUps)}
        </div>
      )}
    </div>
  )
}

/**
 * Pure bucketing for the sparkline (kept side-effect free so it's
 * unit-testable). Returns 8 Monday-start weeks, oldest first; the
 * LAST bucket is the current — possibly partial — week.
 *
 * How it buckets: this week's Monday = today minus (getDay()+6)%7
 * days, because getDay() is 0=Sunday…6=Saturday, so Monday→0 back,
 * Sunday→6 back (the classic off-by-one is forgetting Sunday belongs
 * to the PREVIOUS Monday). starts[i] = thisMonday − (7−i) weeks. An
 * item lands in week i when starts[i] ≤ completedAt.slice(0,10) <
 * starts[i]+7d — plain string compare works because completedAt is
 * 'YYYY-MM-DD HH:MM:SS' local and starts are 'YYYY-MM-DD'.
 */
function weeklyDoneCounts(done: Item[], today: string): { starts: string[]; counts: number[] } {
  const [y, mo, d] = today.split('-').map(Number)
  const daysSinceMonday = (new Date(y, mo - 1, d).getDay() + 6) % 7 // Mon=0 … Sun=6
  const thisMonday = ymdAddDays(today, -daysSinceMonday)
  const starts = Array.from({ length: 8 }, (_, i) => ymdAddDays(thisMonday, (i - 7) * 7))
  const counts = starts.map((start) => {
    const end = ymdAddDays(start, 7)
    return done.filter((it) => {
      const day = it.completedAt?.slice(0, 10)
      return !!day && day >= start && day < end
    }).length
  })
  return { starts, counts }
}

/**
 * Tasks completed per Monday-start week, last 8 weeks — a heartbeat,
 * not a report, so it stays tiny. The rightmost bar is THIS (partial)
 * week, drawn at full accent; past weeks sit back at 0.55.
 */
function ActivitySparkline({ done }: { done: Item[] }): React.JSX.Element {
  const { starts, counts } = weeklyDoneCounts(done, todayYmd())
  const thisWeek = counts[counts.length - 1]
  const total = counts.reduce((a, b) => a + b, 0)
  const max = Math.max(...counts, 1)
  const W = 120
  const H = 28

  return (
    <div className="stack" style={{ gap: 4, marginTop: 4 }}>
      <svg width={W} height={H} role="img" aria-label="Tasks completed per week, last 8 weeks">
        {counts.map((c, wk) => {
          // Zero weeks keep a faint 2px stub so the baseline reads flat.
          const h = c === 0 ? 2 : Math.max(2, Math.round((c / max) * (H - 2)))
          const current = wk === counts.length - 1
          return (
            <rect
              key={starts[wk]}
              x={wk * 15}
              y={H - h}
              width={11}
              height={h}
              rx={1.5}
              fill="var(--accent)"
              opacity={current ? 1 : c === 0 ? 0.25 : 0.55}
            />
          )
        })}
      </svg>
      <span
        style={{ fontSize: 12, color: 'var(--text-faint)' }}
        title={`${total} done in the last 8 weeks`}
      >
        {thisWeek} this week
      </span>
    </div>
  )
}

/**
 * Free-form per-project notes in a plain textarea. Local state owns
 * the text while typing (the LocalEventEditor pattern — seeded once
 * per project); saves debounce 600ms and flush on unmount. All
 * projects share one 'projectScratch' settings record.
 */
function Scratchpad({ projectId }: { projectId: string }): React.JSX.Element | null {
  const [text, setText] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<{ value: string; dirty: boolean }>({ value: '', dirty: false })

  // Read-modify-write the shared record so sibling projects' notes survive.
  const persist = (value: string): void => {
    latest.current.dirty = false
    void window.api
      .getSetting<Record<string, string>>('projectScratch')
      .then((all) => window.api.setSetting('projectScratch', { ...(all ?? {}), [projectId]: value }))
  }

  useEffect(() => {
    setText(null)
    latest.current = { value: '', dirty: false }
    let alive = true
    window.api.getSetting<Record<string, string>>('projectScratch').then((all) => {
      if (!alive) return
      const v = all?.[projectId] ?? ''
      latest.current.value = v
      setText(v)
    })
    return () => {
      alive = false
    }
  }, [projectId])

  // Flush a pending edit when the overview unmounts or projects switch.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (latest.current.dirty) persist(latest.current.value)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  if (text === null) return null // wait for the seed — see LocalEventEditor pattern

  return (
    <textarea
      value={text}
      placeholder="Jot anything…"
      onChange={(e) => {
        const v = e.target.value
        setText(v)
        latest.current = { value: v, dirty: true }
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => persist(v), 600)
      }}
      style={{
        width: '100%',
        minHeight: 110,
        marginTop: 4,
        padding: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text)',
        borderRadius: 7,
        font: 'inherit',
        fontSize: 13,
        resize: 'vertical'
      }}
    />
  )
}
