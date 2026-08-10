import { useLiveQuery, useMutate } from '../state/data'
import { ItemBody } from './Markdown'
import { Checkbox } from './bits'
import { ProjectPicker } from './ProjectPicker'
import { ampm } from '../format'

const DURATIONS = [15, 30, 45, 60, 90, 120] // minutes, matching the 15-min grid
const durLabel = (m: number): string => (m < 60 ? `${m} min` : `${m / 60} hr`)

/**
 * The peek body for a time-blocked task, shown beside the schedule when
 * you click its block. It's a glance with quick controls — check it off,
 * retime it, repoint the project, or drop it off the calendar — not a
 * second notes editor: notes render read-only here and are edited in the
 * full page, so the item has exactly one editing surface (no clobbering
 * between the list card and a second editor).
 */
export function TaskPeek({
  itemId,
  onClose
}: {
  itemId: string
  /** Called when the task leaves the calendar — the block this peek
   *  belongs to is gone, so the panel goes with it. */
  onClose?: () => void
}): React.JSX.Element | null {
  const item = useLiveQuery(() => window.api.getItem(itemId), [itemId])
  const mutate = useMutate()
  if (!item) return null

  const done = item.status === 'done'
  const dur = item.timeEstimateMinutes ?? 30
  const patch = (p: Parameters<typeof window.api.updateItem>[1]): Promise<void> =>
    mutate(() => window.api.updateItem(item.id, p))

  return (
    <div className="stack">
      <div className="row">
        <Checkbox checked={done} onToggle={() => patch({ status: done ? 'active' : 'done' })} />
        <h2 style={{ flex: 1, minWidth: 0, textDecoration: done ? 'line-through' : undefined }}>
          {item.title || <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
        </h2>
      </div>

      {/* When it sits on the calendar and for how long. */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label className="pill">
          ⏱
          <input
            type="time"
            step={900}
            value={item.scheduledTime ?? ''}
            onChange={(e) => e.target.value && patch({ scheduledTime: e.target.value })}
          />
        </label>
        <label className="pill">
          for
          <select value={dur} onChange={(e) => patch({ timeEstimateMinutes: Number(e.target.value) })}>
            {DURATIONS.map((m) => (
              <option key={m} value={m}>
                {durLabel(m)}
              </option>
            ))}
          </select>
        </label>
        {item.scheduledTime && (
          <span className="pill" style={{ color: 'var(--text-soft)' }}>
            {ampm(item.scheduledTime)}
          </span>
        )}
        <button
          className="btn ghost small"
          style={{ marginLeft: 'auto' }}
          title="Keep the task, take it off the calendar"
          onClick={() => {
            void patch({ scheduledTime: null, timeEstimateMinutes: null })
            onClose?.()
          }}
        >
          ✕ off calendar
        </button>
      </div>

      <ProjectPicker value={item.projectId} onChange={(projectId) => patch({ projectId })} />

      {item.richContent || item.content ? (
        <ItemBody item={item} />
      ) : (
        <p style={{ color: 'var(--text-faint)', margin: 0 }}>
          No notes yet — “open full view” to write some.
        </p>
      )}
    </div>
  )
}
