import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { ItemCard } from '../components/ItemCard'
import { DraggableCard } from '../components/dnd'
import { MeetingRow } from '../components/MeetingRow'
import { BackButton, CheckableInput, EmptyState, ProjectDot } from '../components/bits'

export function ProjectPage({ projectId }: { projectId: string }): React.JSX.Element {
  const { projects } = useData()
  const mutate = useMutate()
  const project = projects.find((p) => p.id === projectId)
  const items = useLiveQuery(() => window.api.projectItems(projectId), [projectId])
  const meetings = useLiveQuery(() => window.api.meetingsForProject(projectId), [projectId]) ?? []
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState<'task' | 'note'>('task')
  const [showDone, setShowDone] = useState(false)

  if (!project) return <div className="canvas">Project not found.</div>

  const open = (items ?? []).filter((i) => i.status === 'active' || i.status === 'inbox')
  const todos = open.filter((i) => i.kind === 'task' || i.kind === 'prep')
  const notes = open.filter((i) => i.kind === 'note' || i.kind === 'journal')
  const done = (items ?? []).filter((i) => i.status === 'done')

  const add = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    await mutate(() =>
      window.api.createItem({ kind: draftKind, title, status: 'active', projectId })
    )
    setDraft('')
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        <BackButton />
        <ProjectDot color={project.color} />
        <h1>{project.name}</h1>
      </header>

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
