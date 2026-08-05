import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Project } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Card } from '../components/Card'
import { BackButton, EmptyState, ProjectDot } from '../components/bits'
import { PROJECT_COLORS, randomProjectColor } from '../palette'

/**
 * GitHub-style delete guard: the destructive button stays disabled
 * until the project's exact name is typed. Clicks alone can never
 * delete — archiving stays one click because it's reversible.
 */
function DeleteProjectModal({
  project,
  onCancel,
  onDelete
}: {
  project: Project
  onCancel: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [typed, setTyped] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Trim so a stray space doesn't block, but match case like GitHub.
  const matches = typed.trim() === project.name

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  useEffect(() => inputRef.current?.focus(), [])

  return (
    <motion.div
      className="hotkeys-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <motion.div
        className="hotkeys-modal"
        style={{ width: 'min(420px, 92vw)' }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
      >
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Delete “{project.name}”?</h2>
          <button
            className="btn ghost icon-btn"
            style={{ marginLeft: 'auto' }}
            title="Close (Esc)"
            onClick={onCancel}
          >
            ✕
          </button>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-soft)' }}>
          Its tasks, notes, and meetings still exist, but float under ‘No project’. Archive
          instead to keep them associated.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          <input
            ref={inputRef}
            placeholder="type the project name to confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches) onDelete()
            }}
          />
          <button
            className="btn"
            disabled={!matches}
            style={
              matches
                ? { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }
                : undefined
            }
            onClick={onDelete}
          >
            Delete project
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export function Projects(): React.JSX.Element {
  const { projects } = useData()
  const { navigate } = useNav()
  const mutate = useMutate()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(randomProjectColor())
  const [nameError, setNameError] = useState<string | null>(null)
  // The project awaiting type-to-confirm deletion (active or archived).
  const [deleting, setDeleting] = useState<Project | null>(null)
  // Archived projects stay reachable — a project is a bucket, not a bin.
  const allProjects = useLiveQuery(() => window.api.listProjects(true), []) ?? []
  const archived = allProjects.filter((p) => p.status === 'archived')

  const create = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) return
    // Names are unique across active and archived projects (the store
    // enforces it too) — otherwise un-archiving could collide.
    const clash = allProjects.find((p) => p.name.toLowerCase() === trimmed.toLowerCase())
    if (clash) {
      setNameError(
        clash.status === 'archived'
          ? `“${clash.name}” already exists as an archived project — restore it below instead.`
          : `A project named “${clash.name}” already exists.`
      )
      return
    }
    try {
      await mutate(() => window.api.createProject(trimmed, color))
    } catch {
      setNameError(`A project named “${trimmed}” already exists.`)
      return
    }
    setName('')
    setColor(randomProjectColor())
  }

  return (
    <div className="canvas">
      <header className="canvas-header">
        <BackButton />
        <h1>Projects</h1>
      </header>

      <Card className="stack">
        <div className="row">
          <input
            style={{ flex: 1 }}
            placeholder="New project name…"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className="btn primary" onClick={create}>
            Create
          </button>
        </div>
        {nameError && <p style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>{nameError}</p>}
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
        <EmptyState art="📁">No projects yet. They’re just buckets — make one above.</EmptyState>
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
                className="btn ghost tooltip"
                style={{ marginLeft: 'auto' }}
                data-tooltip="Archive: hides the project but keeps everything filed under it. Restore anytime."
                onClick={(e) => {
                  e.stopPropagation()
                  mutate(() => window.api.updateProject(p.id, { status: 'archived' }))
                }}
              >
                Archive
              </button>
              <button
                className="btn ghost tooltip"
                data-tooltip="Delete: its tasks, notes, and meetings still exist, but float under 'No project'. Archive instead to keep them associated."
                onClick={(e) => {
                  e.stopPropagation()
                  setDeleting(p)
                }}
              >
                🗑
              </button>
            </div>
          </Card>
        ))}
      </div>

      {archived.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 24 }}>
            Archived
          </div>
          <div className="stack">
            {archived.map((p) => (
              <Card
                key={p.id}
                interactive
                onClick={() => navigate({ name: 'project', projectId: p.id })}
              >
                <div className="row" style={{ opacity: 0.7 }}>
                  <ProjectDot color={p.color} />
                  <span className="card-title">{p.name}</span>
                  <button
                    className="btn ghost tooltip"
                    style={{ marginLeft: 'auto' }}
                    data-tooltip="Bring it back to the sidebar — everything is still filed under it."
                    onClick={(e) => {
                      e.stopPropagation()
                      mutate(() => window.api.updateProject(p.id, { status: 'active' }))
                    }}
                  >
                    Restore
                  </button>
                  <button
                    className="btn ghost tooltip"
                    data-tooltip="Delete: its tasks, notes, and meetings still exist, but float under 'No project'."
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleting(p)
                    }}
                  >
                    🗑
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {deleting && (
        <DeleteProjectModal
          project={deleting}
          onCancel={() => setDeleting(null)}
          onDelete={async () => {
            await mutate(() => window.api.deleteProject(deleting.id))
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
