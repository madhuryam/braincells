import { useState, type CSSProperties } from 'react'
import type { Project } from '@shared/types'
import { useData, useMutate } from '../state/data'
import { randomProjectColor } from '../palette'
import { ProjectDot } from './bits'

/**
 * Mutually-exclusive project chips instead of a dropdown — with the
 * handful of projects in play at any time, one click beats two. With
 * no projects yet it offers to create the first one inline.
 */
export function ProjectPicker({
  value,
  onChange
}: {
  value: string | null
  onChange: (projectId: string | null) => void
}): React.JSX.Element {
  const { projects } = useData()
  const mutate = useMutate()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const create = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) return
    let created: Project | undefined
    await mutate(async () => {
      created = await window.api.createProject(name, randomProjectColor())
    })
    setDraft('')
    setAdding(false)
    if (created) onChange(created.id)
  }

  return (
    <div className="project-picker">
      <button
        className={`project-chip ${value === null ? 'selected' : ''}`}
        onClick={() => onChange(null)}
      >
        no project
      </button>
      {projects.map((p) => (
        <button
          key={p.id}
          className={`project-chip ${value === p.id ? 'selected' : ''}`}
          style={{ '--chip-color': p.color } as CSSProperties}
          onClick={() => onChange(p.id)}
        >
          <ProjectDot color={p.color} /> {p.name}
        </button>
      ))}
      {projects.length === 0 &&
        (adding ? (
          <input
            autoFocus
            placeholder="First project’s name…"
            style={{ fontSize: 12, padding: '3px 10px' }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => setAdding(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') {
                setDraft('')
                setAdding(false)
              }
            }}
          />
        ) : (
          <button className="project-chip" onClick={() => setAdding(true)}>
            ＋ new project
          </button>
        ))}
    </div>
  )
}
