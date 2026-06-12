import { useState } from 'react'
import { useData, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from '../components/Card'
import { EmptyState, ProjectDot } from '../components/bits'
import { PROJECT_COLORS, randomProjectColor } from '../palette'

export function Projects(): React.JSX.Element {
  const { projects } = useData()
  const { navigate } = useNav()
  const mutate = useMutate()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(randomProjectColor())

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    await mutate(() => window.api.createProject(trimmed, color))
    setName('')
    setColor(randomProjectColor())
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        <h1>Projects</h1>
      </header>

      <Card className="stack">
        <div className="row">
          <input
            style={{ flex: 1 }}
            placeholder="New project name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="btn primary" onClick={create}>
            Create
          </button>
        </div>
        <div className="row">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => setColor(c)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                border: c === color ? '3px solid var(--text)' : '3px solid transparent'
              }}
            />
          ))}
        </div>
      </Card>

      <div className="section-label">Active</div>
      {projects.length === 0 && (
        <EmptyState art="🗂️">No projects yet. They’re just buckets — make one above.</EmptyState>
      )}
      <div className="stack">
        {projects.map((p) => (
          <Card
            key={p.id}
            accentColor={p.color}
            interactive
            onClick={() => navigate({ name: 'project', projectId: p.id })}
          >
            <div className="row">
              <ProjectDot color={p.color} />
              <span className="card-title">{p.name}</span>
              <button
                className="btn ghost"
                style={{ marginLeft: 'auto' }}
                title="Archive project"
                onClick={(e) => {
                  e.stopPropagation()
                  mutate(() => window.api.updateProject(p.id, { status: 'archived' }))
                }}
              >
                Archive
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
