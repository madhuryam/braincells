import { useState, type CSSProperties } from 'react'
import type { Project } from '@shared/types'
import { useData, useMutate } from '../state/data'
import { projectLabel } from '../format'
import { randomProjectColor } from '../palette'
import { ProjectDot } from './bits'

/**
 * Mutually-exclusive project chips instead of a dropdown — with the
 * handful of projects in play at any time, one click beats two. Rests
 * as a single badge (the selected project, or "no project") so it
 * never drowns its row; clicking expands the full chip set, and any
 * pick — or focus leaving — collapses it again. With no projects yet
 * it offers to create the first one inline.
 */
export function ProjectPicker({
  value,
  onChange,
  expanded = false,
  dotsOnly = false
}: {
  value: string | null
  onChange: (projectId: string | null) => void
  /** Skip the collapsed single-badge rest state — always show the full
   *  chip set. For roomy contexts like the quick-add row. */
  expanded?: boolean
  /** Chips drop their names and show just the colored dots (name in
   *  the tooltip) — for tight rows sharing a line with other controls. */
  dotsOnly?: boolean
}): React.JSX.Element {
  const { projects } = useData()
  const mutate = useMutate()
  const [open, setOpen] = useState(false)
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

  const pick = (projectId: string | null): void => {
    if (!expanded) setOpen(false)
    onChange(projectId)
  }

  // Zero projects: nothing to collapse — show the create flow directly.
  if (projects.length === 0) {
    return (
      <div className="project-picker">
        {adding ? (
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
        )}
      </div>
    )
  }

  if (!open && !expanded) {
    const selected = projects.find((p) => p.id === value)
    return (
      <div className="project-picker">
        {selected ? (
          <button
            className="project-chip selected"
            style={{ '--chip-color': selected.color } as CSSProperties}
            title="Change project"
            onClick={() => setOpen(true)}
          >
            <ProjectDot color={selected.color} /> {projectLabel(selected)}
          </button>
        ) : (
          <button className="project-chip" title="Assign a project" onClick={() => setOpen(true)}>
            none
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      className="project-picker"
      onBlur={(e) => {
        // Focus left the picker entirely (not moved between chips) → collapse.
        // In expanded mode there's nothing to collapse to.
        if (!expanded && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        className={`project-chip ${value === null ? 'selected' : ''}`}
        title="no project"
        onClick={() => pick(null)}
      >
        {dotsOnly ? (
          // A dashed ring: the "none" of dots.
          <span
            aria-hidden
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              border: '1.5px dashed var(--text-faint)',
              display: 'inline-block'
            }}
          />
        ) : (
          'none'
        )}
      </button>
      {projects.map((p) => (
        <button
          key={p.id}
          className={`project-chip ${value === p.id ? 'selected' : ''}`}
          style={{ '--chip-color': p.color } as CSSProperties}
          title={p.name}
          onClick={() => pick(p.id)}
        >
          <ProjectDot color={p.color} />
          {!dotsOnly && ` ${projectLabel(p)}`}
        </button>
      ))}
    </div>
  )
}
