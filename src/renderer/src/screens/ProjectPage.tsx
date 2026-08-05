import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import type { Item } from '@shared/types'
import { todayYmd } from '@shared/dates'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from '../components/Card'
import { DetailPanel } from '../components/DetailPanel'
import { ItemCard } from '../components/ItemCard'
import { ItemDetail } from '../components/ItemDetail'
import { DraggableCard } from '../components/dnd'
import { MeetingRow } from '../components/MeetingRow'
import { Meeting } from './Meeting'
import { BackButton, CheckableInput, EmptyState, ProjectDot } from '../components/bits'
import { PROJECT_COLORS } from '../palette'

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
  // Meetings stay out of the way: collapsed by default, and each group
  // (upcoming/previous) reveals a page at a time.
  const [meetingsOpen, setMeetingsOpen] = useState(false)
  const [upcomingShown, setUpcomingShown] = useState(5)
  const [previousShown, setPreviousShown] = useState(5)

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
  const pages = open.filter((i) => i.kind === 'page')
  // Starred canvases get their own section up top — the ones worth
  // keeping within reach shouldn't hide among the rest.
  const starredPages = pages.filter((p) => p.starred)
  const plainPages = pages.filter((p) => !p.starred)
  const todos = open.filter((i) => i.kind === 'task' || i.kind === 'prep')
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

      {/* Starred canvases: pinned above the rest for quick access. */}
      {starredPages.length > 0 && (
        <>
          <div className="section-label">⭐ Starred</div>
          <div className="stack project-section">
            {starredPages.map((p) => (
              <CanvasRow key={p.id} item={p} onOpen={() => setDetail({ kind: 'item', itemId: p.id })} />
            ))}
          </div>
        </>
      )}

      {/* Canvases: full writing surfaces (rich text, tables) per project. */}
      <div className="section-label row">
        Canvases
        <button className="btn ghost" onClick={newPage}>
          ＋ new canvas
        </button>
      </div>
      <div className="stack project-section">
        {plainPages.map((p) => (
          <CanvasRow key={p.id} item={p} onOpen={() => setDetail({ kind: 'item', itemId: p.id })} />
        ))}
        {pages.length === 0 && (
          <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>
            No canvases yet — a canvas is a full document for brain-dumping knowledge.
          </span>
        )}
      </div>

      {/* One vertical section per kind of thing — no masonry mixing. */}
      {todos.length > 0 && (
        <>
          <div className="section-label">To-dos</div>
          <div className="item-list project-section">
            <AnimatePresence initial={false}>
              {todos.map((item) => (
                <DraggableCard key={item.id} item={item}>
                  <ItemCard item={item} showProject={false} />
                </DraggableCard>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* Meetings: collapsed until asked for, split around today, and
          revealed a handful at a time — a busy project accumulates far
          more meetings than anyone wants to scroll past. */}
      {meetings.length > 0 && (
        <>
          <button className="section-label day-toggle" onClick={() => setMeetingsOpen(!meetingsOpen)}>
            {meetingsOpen ? '▾' : '▸'} Meetings <span className="pill">{meetings.length}</span>
          </button>
          {meetingsOpen && (
            <div className="stack project-section">
              {upcoming.length > 0 && (
                <>
                  <div className="section-sublabel">Upcoming · {upcoming.length}</div>
                  {upcoming.slice(0, upcomingShown).map((m) => (
                    <MeetingRow
                      key={m.eventKey}
                      meeting={m}
                      onPeek={(mtg) =>
                        setDetail({ kind: 'meeting', eventKey: mtg.eventKey, title: mtg.title, date: mtg.date })
                      }
                    />
                  ))}
                  {upcoming.length > upcomingShown && (
                    <button className="btn ghost small" onClick={() => setUpcomingShown(upcomingShown + 10)}>
                      show {Math.min(10, upcoming.length - upcomingShown)} more of {upcoming.length}
                    </button>
                  )}
                </>
              )}
              {previous.length > 0 && (
                <>
                  <div className="section-sublabel">Previous · {previous.length}</div>
                  {previous.slice(0, previousShown).map((m) => (
                    <MeetingRow
                      key={m.eventKey}
                      meeting={m}
                      onPeek={(mtg) =>
                        setDetail({ kind: 'meeting', eventKey: mtg.eventKey, title: mtg.title, date: mtg.date })
                      }
                    />
                  ))}
                  {previous.length > previousShown && (
                    <button className="btn ghost small" onClick={() => setPreviousShown(previousShown + 10)}>
                      show {Math.min(10, previous.length - previousShown)} more of {previous.length}
                    </button>
                  )}
                </>
              )}
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

      {detail && (
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
      )}
      </div>
    </div>
  )
}
