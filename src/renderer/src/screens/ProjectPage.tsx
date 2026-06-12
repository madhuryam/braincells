import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { ItemCard } from '../components/ItemCard'
import { EmptyState, ProjectDot } from '../components/bits'

export function ProjectPage({ projectId }: { projectId: string }): React.JSX.Element {
  const { projects } = useData()
  const mutate = useMutate()
  const project = projects.find((p) => p.id === projectId)
  const items = useLiveQuery(() => window.api.projectItems(projectId), [projectId])
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState<'task' | 'note'>('task')
  const [showDone, setShowDone] = useState(false)

  if (!project) return <div className="canvas">Project not found.</div>

  const open = (items ?? []).filter((i) => i.status === 'active' || i.status === 'inbox')
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
        <ProjectDot color={project.color} />
        <h1>{project.name}</h1>
      </header>

      <div className="row" style={{ marginBottom: 18 }}>
        <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as 'task' | 'note')}>
          <option value="task">Task</option>
          <option value="note">Note</option>
        </select>
        <input
          style={{ flex: 1 }}
          placeholder={`Add a ${draftKind} to ${project.name}…`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </div>

      {open.length === 0 && done.length === 0 && (
        <EmptyState art="🌱">Nothing here yet. Add a task or note above.</EmptyState>
      )}

      <div className="masonry">
        <AnimatePresence>
          {open.map((item) => (
            <ItemCard key={item.id} item={item} showProject={false} />
          ))}
        </AnimatePresence>
      </div>

      {done.length > 0 && (
        <>
          <button className="section-label btn ghost" onClick={() => setShowDone(!showDone)}>
            {showDone ? '▾' : '▸'} Done ({done.length})
          </button>
          {showDone && (
            <div className="masonry">
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
