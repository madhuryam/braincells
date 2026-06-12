import { useEffect, useState } from 'react'
import type { Item, ItemStatus } from '@shared/types'
import { useData, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { shortTitle, useUndo } from '../state/undo'
import { Card } from './Card'
import { Checkbox, ProjectDot } from './bits'
import { Markdown } from './Markdown'
import { KIND_ICON, prettyDate, rollingDays } from './../format'

interface ItemCardProps {
  item: Item
  /** Hide the project pill when the card already sits inside its project page. */
  showProject?: boolean
  /** Carried-over styling: quiet, faded, never red. */
  faded?: boolean
}

/**
 * The standard card for any item: collapsed it shows just enough at a
 * glance (title, project color, dates); clicking expands it inline into
 * a full editor. Edits save on blur — there is no save button to forget.
 */
export function ItemCard({ item, showProject = true, faded }: ItemCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [content, setContent] = useState(item.content)
  const mutate = useMutate()
  const { projects } = useData()
  const { navigate } = useNav()
  const { pushUndo } = useUndo()
  const project = projects.find((p) => p.id === item.projectId)

  // If another screen edits this item, pick up the new values.
  useEffect(() => setTitle(item.title), [item.title])
  useEffect(() => setContent(item.content), [item.content])

  const patch = (p: Parameters<typeof window.api.updateItem>[1]): Promise<void> =>
    mutate(() => window.api.updateItem(item.id, p))

  const isCheckable = item.kind === 'task' || item.kind === 'prep'
  const done = item.status === 'done'

  /**
   * Collapse, flushing any unsaved edits first. Bound to onMouseDown
   * (not onClick): a plain click first blurs the focused field, whose
   * save re-renders the whole list and the click never lands — which
   * made expanded cards impossible to close.
   */
  const closeCard = (): void => {
    const changes: Record<string, string> = {}
    if (title !== item.title) changes.title = title
    if (content !== item.content) changes.content = content
    if (Object.keys(changes).length > 0) patch(changes)
    setOpen(false)
  }

  return (
    <Card accentColor={project?.color} done={done} faded={faded}>
      <div
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation()
            closeCard()
          }
        }}
      >
      <div className="row">
        {isCheckable && (
          <Checkbox
            checked={done}
            onToggle={() => {
              const prev = item.status
              patch({ status: done ? 'active' : ('done' as ItemStatus) })
              if (!done) {
                pushUndo(`Completed “${shortTitle(item.title)}”`, async () => {
                  await window.api.updateItem(item.id, { status: prev })
                })
              }
            }}
          />
        )}
        {!isCheckable && <span aria-hidden>{KIND_ICON[item.kind]}</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          {open ? (
            <div className="row">
              <input
                autoFocus
                value={title}
                style={{ flex: 1 }}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title !== item.title && patch({ title })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <button
                className="btn ghost"
                title="Collapse (Esc)"
                onMouseDown={(e) => {
                  e.preventDefault()
                  closeCard()
                }}
              >
                ▴
              </button>
            </div>
          ) : (
            <button
              className="card-title"
              style={{ display: 'block', width: '100%', textAlign: 'left' }}
              onClick={() =>
                // Pages open as a full document, not an inline editor.
                item.kind === 'page'
                  ? navigate({ name: 'page', itemId: item.id })
                  : setOpen(true)
              }
            >
              {item.title || <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
            </button>
          )}
          <div className="card-meta">
            {showProject && project && (
              <span className="pill">
                <ProjectDot color={project.color} /> {project.name}
              </span>
            )}
            {item.scheduledDate && <span className="pill">📅 {prettyDate(item.scheduledDate)}</span>}
            {item.dueDate && <span className="pill">⏰ due {prettyDate(item.dueDate)}</span>}
            {item.timeEstimateMinutes != null && (
              <span className="pill">~{item.timeEstimateMinutes}m</span>
            )}
            {!open && item.content && <span title="has notes">📄</span>}
          </div>
        </div>
      </div>

      {open && (
        <div className="stack" style={{ marginTop: 12 }}>
          {item.content && <Markdown text={item.content} />}
          <textarea
            rows={4}
            placeholder="Notes — markdown welcome…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={() => content !== item.content && patch({ content })}
          />
          {/* When to do it: the 5-day rolling window, or someday. */}
          {(item.kind === 'task' || item.kind === 'prep') && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {rollingDays().map((d) => (
                <button
                  key={d.date}
                  className={`btn small ${item.scheduledDate === d.date ? 'primary' : ''}`}
                  onClick={() => patch({ scheduledDate: d.date })}
                >
                  {d.chip}
                </button>
              ))}
              <button
                className={`btn small ${item.scheduledDate === null ? 'primary' : ''}`}
                title="No date — lives in the backlog until you pick a day"
                onClick={() => patch({ scheduledDate: null, scheduledTime: null })}
              >
                someday
              </button>
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <select
              value={item.projectId ?? ''}
              onChange={(e) => patch({ projectId: e.target.value || null })}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <label className="pill">
              do
              <input
                type="date"
                value={item.scheduledDate ?? ''}
                onChange={(e) => patch({ scheduledDate: e.target.value || null })}
              />
            </label>
            <label className="pill">
              due
              <input
                type="date"
                value={item.dueDate ?? ''}
                onChange={(e) => patch({ dueDate: e.target.value || null })}
              />
            </label>
            <button
              className="btn ghost"
              title="Drop this item (it goes away, guilt-free)"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                const prev = item.status
                patch({ status: 'dropped' })
                pushUndo(`Dropped “${shortTitle(item.title)}”`, async () => {
                  await window.api.updateItem(item.id, { status: prev })
                })
              }}
            >
              🗑 drop
            </button>
            <button
              className="btn ghost"
              onMouseDown={(e) => {
                e.preventDefault()
                closeCard()
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
      </div>
    </Card>
  )
}
