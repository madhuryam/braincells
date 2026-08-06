import { useEffect, useRef } from 'react'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Checkbox, ProjectDot } from './bits'
import { KIND_ICON, prettyDate } from '../format'
import { RichEditor } from './RichEditor'
import { itemBodyHtml } from '../richtext'

/**
 * Single-item view for the detail panel: title (checkable where that
 * makes sense), meta pills, and editable notes. Pages get an "open
 * full page" action — note the full page and this peek are two editing
 * surfaces for the same item; last save wins, acceptable because the
 * peek and full view are rarely open together.
 */
export function ItemDetail({ itemId }: { itemId: string }): React.JSX.Element | null {
  const item = useLiveQuery(() => window.api.getItem(itemId), [itemId])
  const { projects } = useData()
  const { openOverlay } = useNav()
  const mutate = useMutate()

  // Notes autosave: the rich editor owns the text while typing; saves
  // land 600ms after the last keystroke, and flush on close/unmount.
  const pendingBody = useRef<{ html: string; text: string } | null>(null)
  const bodyTimer = useRef<number | undefined>(undefined)
  const flushBody = (): void => {
    window.clearTimeout(bodyTimer.current)
    const p = pendingBody.current
    pendingBody.current = null
    if (p) mutate(() => window.api.updateItem(itemId, { richContent: p.html, content: p.text }))
  }
  const onBodyChange = (html: string, text: string): void => {
    pendingBody.current = { html, text }
    window.clearTimeout(bodyTimer.current)
    bodyTimer.current = window.setTimeout(flushBody, 600)
  }
  useEffect(
    () => () => {
      // Unmount flush goes straight to the API (no re-render needed).
      const p = pendingBody.current
      pendingBody.current = null
      window.clearTimeout(bodyTimer.current)
      if (p) window.api.updateItem(itemId, { richContent: p.html, content: p.text })
    },
    [itemId]
  )

  if (!item) return null

  const project = projects.find((p) => p.id === item.projectId)
  const checkable = item.kind === 'task' || item.kind === 'prep'
  const done = item.status === 'done'

  return (
    <div className="stack">
      <div className="row">
        {checkable ? (
          <Checkbox
            checked={done}
            onToggle={() =>
              mutate(() => window.api.updateItem(item.id, { status: done ? 'active' : 'done' }))
            }
          />
        ) : (
          <span aria-hidden>{KIND_ICON[item.kind]}</span>
        )}
        <h2 style={{ flex: 1, minWidth: 0, textDecoration: done ? 'line-through' : undefined }}>
          {item.title || <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
        </h2>
        <button
          className="btn ghost icon-btn"
          title={item.starred ? 'Unstar' : 'Star — pin it to the sidebar'}
          onClick={() => mutate(() => window.api.updateItem(item.id, { starred: !item.starred }))}
        >
          {item.starred ? '⭐' : '☆'}
        </button>
        {item.kind === 'page' && (
          <button className="btn ghost" onClick={() => openOverlay({ name: 'page', itemId: item.id })}>
            open canvas ↗
          </button>
        )}
      </div>
      <div className="card-meta">
        {project && (
          <span className="pill">
            <ProjectDot color={project.color} /> {project.name}
          </span>
        )}
        {item.scheduledDate && <span className="pill">📅 {prettyDate(item.scheduledDate)}</span>}
        {item.dueDate && <span className="pill">⏰ due {prettyDate(item.dueDate)}</span>}
        {item.completedAt && <span className="pill">✓ {prettyDate(item.completedAt.slice(0, 10))}</span>}
      </div>
      {/* Toolbar-less: markdown shortcuts (`# `, `**`, `- `) format as
          you type, and the placeholder replaces the old "no notes" dead-end. */}
      <RichEditor
        key={item.id}
        variant="compact"
        toolbar={false}
        initialHtml={itemBodyHtml(item)}
        placeholder="Notes — type **bold**, # headings, - lists…"
        onChange={onBodyChange}
      />
    </div>
  )
}
