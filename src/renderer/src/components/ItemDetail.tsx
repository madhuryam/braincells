import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { ItemBody } from './Markdown'
import { Checkbox, ProjectDot } from './bits'
import { KIND_ICON, prettyDate } from '../format'

/**
 * Read-view of a single item for the detail panel: title (checkable
 * where that makes sense), meta pills, and the rendered body. Pages
 * get an "open full page" action — the panel is a peek, not an editor.
 */
export function ItemDetail({ itemId }: { itemId: string }): React.JSX.Element | null {
  const item = useLiveQuery(() => window.api.getItem(itemId), [itemId])
  const { projects } = useData()
  const { openOverlay } = useNav()
  const mutate = useMutate()
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
        {item.kind === 'page' && (
          <button className="btn ghost" onClick={() => openOverlay({ name: 'page', itemId: item.id })}>
            open full page ↗
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
        {item.completedAt && <span className="pill">✅ {prettyDate(item.completedAt.slice(0, 10))}</span>}
      </div>
      {item.richContent || item.content ? (
        <ItemBody item={item} />
      ) : (
        <p style={{ color: 'var(--text-faint)', margin: 0 }}>No notes on this item.</p>
      )}
    </div>
  )
}
