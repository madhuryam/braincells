import { useEffect, useRef, useState } from 'react'
import type { Item, ItemStatus } from '@shared/types'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { shortTitle, useUndo } from '../state/undo'
import { Card } from './Card'
import { CheckableInput, Checkbox, ProjectDot } from './bits'
import { RichEditor } from './RichEditor'
import { itemBodyHtml } from '../richtext'
import { KIND_ICON, prettyDate, rollingDays } from './../format'

interface ItemCardProps {
  item: Item
  /** Hide the project pill when the card already sits inside its project page. */
  showProject?: boolean
  /** Hide the scheduled-date pill when the surrounding group names the day. */
  showDate?: boolean
  /** Carried-over styling: quiet, faded, never red. */
  faded?: boolean
}

/**
 * The standard card for any item: collapsed it shows just enough at a
 * glance (title, project color, dates); clicking expands it inline into
 * a full editor. Edits save on blur — there is no save button to forget.
 */
export function ItemCard({
  item,
  showProject = true,
  showDate = true,
  faded
}: ItemCardProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(item.title)
  const mutate = useMutate()
  const { projects } = useData()
  const { navigate } = useNav()
  const { pushUndo } = useUndo()
  const project = projects.find((p) => p.id === item.projectId)

  // If another screen edits this item, pick up the new values.
  useEffect(() => setTitle(item.title), [item.title])

  // Notes autosave: the rich editor owns the text while typing; saves
  // land 600ms after the last keystroke, and flush on close/unmount.
  const pendingBody = useRef<{ html: string; text: string } | null>(null)
  const bodyTimer = useRef<number | undefined>(undefined)
  const flushBody = (): void => {
    window.clearTimeout(bodyTimer.current)
    const p = pendingBody.current
    pendingBody.current = null
    if (p) patch({ richContent: p.html, content: p.text })
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
      if (p) window.api.updateItem(item.id, { richContent: p.html, content: p.text })
    },
    [item.id]
  )

  const patch = (p: Parameters<typeof window.api.updateItem>[1]): Promise<void> =>
    mutate(() => window.api.updateItem(item.id, p))

  const isCheckable = item.kind === 'task' || item.kind === 'prep'
  const done = item.status === 'done'

  // Checkbox subtasks: ordinary task items linked 'subtask-of' this one.
  const subtasks =
    useLiveQuery(() => (isCheckable ? window.api.subtasksOf(item.id) : Promise.resolve([])), [
      item.id,
      isCheckable
    ]) ?? []
  const subtasksDone = subtasks.filter((s) => s.status === 'done').length
  const [subDraft, setSubDraft] = useState('')
  const addSubtask = async (): Promise<void> => {
    const t = subDraft.trim()
    if (!t) return
    await mutate(async () => {
      const sub = await window.api.createItem({
        kind: 'task',
        title: t,
        status: 'active',
        projectId: item.projectId
      })
      await window.api.linkItems(sub.id, item.id, 'subtask-of')
    })
    setSubDraft('')
  }

  /**
   * Collapse, flushing any unsaved edits first. Bound to onMouseDown
   * (not onClick): a plain click first blurs the focused field, whose
   * save re-renders the whole list and the click never lands — which
   * made expanded cards impossible to close.
   */
  const closeCard = (): void => {
    if (title !== item.title) patch({ title })
    flushBody()
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
            {item.starred && <span title="Starred — pinned in the sidebar">⭐</span>}
            {showProject && project && (
              <span className="pill">
                <ProjectDot color={project.color} /> {project.name}
              </span>
            )}
            {showDate && item.scheduledDate && (
              <span className="pill">📅 {prettyDate(item.scheduledDate)}</span>
            )}
            {item.dueDate && <span className="pill">⏰ due {prettyDate(item.dueDate)}</span>}
            {item.timeEstimateMinutes != null && (
              <span className="pill">~{item.timeEstimateMinutes}m</span>
            )}
            {subtasks.length > 0 && (
              <span className="pill" title="subtasks">
                ☑ {subtasksDone}/{subtasks.length}
              </span>
            )}
            {!open && item.content && <span title="has notes">📄</span>}
          </div>
        </div>
      </div>

      {open && (
        <div className="stack" style={{ marginTop: 12 }}>
          {/* One notes surface that formats as you type (no separate
              preview): markdown shortcuts become real formatting. */}
          <RichEditor
            key={item.id}
            variant="compact"
            initialHtml={itemBodyHtml(item)}
            placeholder="Notes — type **bold**, # headings, - lists…"
            onChange={onBodyChange}
          />
          {/* Checkbox subtasks. */}
          {isCheckable && (
            <div className="subtasks">
              {subtasks.map((sub) => (
                <div key={sub.id} className="subtask-row">
                  <Checkbox
                    checked={sub.status === 'done'}
                    onToggle={() =>
                      mutate(() =>
                        window.api.updateItem(sub.id, {
                          status: sub.status === 'done' ? 'active' : 'done'
                        })
                      )
                    }
                  />
                  <span className={`subtask-title ${sub.status === 'done' ? 'done' : ''}`}>
                    {sub.title}
                  </span>
                  <button
                    className="btn ghost small"
                    title="Drop this subtask"
                    onClick={() => {
                      mutate(() => window.api.updateItem(sub.id, { status: 'dropped' }))
                      pushUndo(`Dropped “${shortTitle(sub.title)}”`, async () => {
                        await window.api.updateItem(sub.id, { status: 'active' })
                      })
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <CheckableInput
                placeholder="Add a subtask…"
                value={subDraft}
                onChange={(e) => setSubDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addSubtask()
                }}
              />
            </div>
          )}
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
            {(item.kind === 'note' || item.kind === 'page') && (
              <button
                className="btn ghost"
                title={item.starred ? 'Unstar' : 'Star — pin it to the sidebar'}
                onClick={() => patch({ starred: !item.starred })}
              >
                {item.starred ? '⭐ starred' : '☆ star'}
              </button>
            )}
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
