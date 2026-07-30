import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from '../components/Card'
import { ItemCard } from '../components/ItemCard'
import { DraggableCard } from '../components/dnd'
import { MeetingRow } from '../components/MeetingRow'
import { BackButton, CheckableInput, EmptyState, ProjectDot } from '../components/bits'

export function ProjectPage({ projectId }: { projectId: string }): React.JSX.Element {
  const { projects } = useData()
  const { navigate } = useNav()
  const mutate = useMutate()
  const project = projects.find((p) => p.id === projectId)
  const items = useLiveQuery(() => window.api.projectItems(projectId), [projectId])
  const meetings = useLiveQuery(() => window.api.meetingsForProject(projectId), [projectId]) ?? []
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState<'task' | 'note'>('task')
  const [showDone, setShowDone] = useState(false)
  // Calendar color labels: attach one to this project and meetings
  // wearing that label file themselves here automatically.
  const labels = useLiveQuery(() => window.api.calendarLabels(), []) ?? []
  const labelMap =
    useLiveQuery(() => window.api.getSetting<Record<string, string>>('labelProjects'), []) ?? {}

  if (!project) return <div className="canvas">Project not found.</div>

  const open = (items ?? []).filter((i) => i.status === 'active' || i.status === 'inbox')
  const pages = open.filter((i) => i.kind === 'page')
  const todos = open.filter((i) => i.kind === 'task' || i.kind === 'prep')
  const notes = open.filter((i) => i.kind === 'note' || i.kind === 'journal')
  const done = (items ?? []).filter((i) => i.status === 'done' && i.kind !== 'page')

  const add = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    await mutate(() =>
      window.api.createItem({ kind: draftKind, title, status: 'active', projectId })
    )
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
    navigate({ name: 'page', itemId: item.id })
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        <BackButton />
        <ProjectDot color={project.color} />
        <h1>{project.name}</h1>
      </header>

      {labels.length > 0 && (
        <div className="row label-row">
          <span className="label-caption" title="Meetings wearing an attached label file into this project automatically. Rename labels in Settings.">
            Auto-file labels
          </span>
          {labels.map((l) => {
            const mine = labelMap[l.id] === projectId
            const elsewhere = !mine && !!labelMap[l.id]
            return (
              <button
                key={l.id}
                className={`label-chip ${mine ? 'on' : ''}`}
                title={
                  mine
                    ? `Meetings labeled “${l.name}” file here — click to detach`
                    : `${elsewhere ? 'Currently attached to another project. ' : ''}Click to file “${l.name}” meetings into ${project.name}`
                }
                onClick={() =>
                  mutate(() => window.api.assignLabelProject(l.id, mine ? null : projectId))
                }
              >
                <span className="label-dot" style={{ background: l.color }} />
                {l.name}
              </button>
            )
          })}
        </div>
      )}

      <div className="row" style={{ marginBottom: 18 }}>
        <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as 'task' | 'note')}>
          <option value="task">Task</option>
          <option value="note">Note</option>
        </select>
        {/* Tasks get the checkbox-flavored input so it's obvious the
            line becomes a checkable card, not a plain note. */}
        {draftKind === 'task' ? (
          <CheckableInput
            placeholder={`Add a task to ${project.name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        ) : (
          <input
            style={{ flex: 1 }}
            placeholder={`Add a note to ${project.name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        )}
      </div>

      {open.length === 0 && done.length === 0 && meetings.length === 0 && (
        <EmptyState art="🌱">Nothing here yet. Add a task or note above.</EmptyState>
      )}

      {/* Pages: full writing surfaces (rich text, tables) per project. */}
      <div className="section-label row">
        Pages
        <button className="btn ghost" onClick={newPage}>
          ＋ new page
        </button>
      </div>
      <div className="stack project-section">
        {pages.map((p) => (
          <Card key={p.id} interactive onClick={() => navigate({ name: 'page', itemId: p.id })}>
            <div className="row">
              <span aria-hidden>📄</span>
              <span className="card-title">{p.title || 'Untitled page'}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-soft)' }}>
                open ↗
              </span>
            </div>
          </Card>
        ))}
        {pages.length === 0 && (
          <span style={{ color: 'var(--text-faint)', fontSize: 13 }}>
            No pages yet — a page is a full document for brain-dumping knowledge.
          </span>
        )}
      </div>

      {/* One vertical section per kind of thing — no masonry mixing. */}
      {todos.length > 0 && (
        <>
          <div className="section-label">To-dos</div>
          <div className="stack project-section">
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

      {notes.length > 0 && (
        <>
          <div className="section-label">Notes</div>
          <div className="stack project-section">
            <AnimatePresence initial={false}>
              {notes.map((item) => (
                <DraggableCard key={item.id} item={item}>
                  <ItemCard item={item} showProject={false} />
                </DraggableCard>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}

      {meetings.length > 0 && (
        <>
          <div className="section-label">Meetings</div>
          <div className="stack project-section">
            {meetings.map((m) => (
              <MeetingRow key={m.eventKey} meeting={m} />
            ))}
          </div>
        </>
      )}

      {done.length > 0 && (
        <>
          <button className="section-label day-toggle" onClick={() => setShowDone(!showDone)}>
            {showDone ? '▾' : '▸'} Done <span className="pill">{done.length}</span>
          </button>
          {showDone && (
            <div className="stack project-section">
              {done.map((item) => (
                <ItemCard key={item.id} item={item} showProject={false} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
