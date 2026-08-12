import { useState } from 'react'
import { useLiveQuery, useMutate } from '../state/data'
import { ItemBody } from './Markdown'
import { Checkbox } from './bits'
import { ProjectPicker } from './ProjectPicker'
import { ampm } from '../format'

const DURATIONS = [5, 10, 15, 30, 45, 60, 90, 120] // minutes
// Non-preset lengths (a custom end time) read plainly in minutes.
const durLabel = (m: number): string => (m < 60 || m % 30 !== 0 ? `${m} min` : `${m / 60} hr`)

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
const toHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * A time input you can actually type into. While focused it owns a
 * local draft (typing the hour, then the minutes, fires interim change
 * events) and commits once, on blur or Enter. Wiring `value` straight
 * to the store meant every half-typed segment patched the DB and the
 * live-query re-render snapped the field back mid-keystroke.
 */
function TimeField({
  value,
  onCommit
}: {
  value: string
  onCommit: (v: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="time"
      step={60}
      value={draft ?? value}
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={() => {
        // An empty draft (cleared field) reverts, same as before.
        if (draft && draft !== value) onCommit(draft)
        setDraft(null)
      }}
    />
  )
}

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
  // A subtask's block only says its own title — the lineage line adds
  // which task (and chain of parents) it's a piece of.
  const ancestors = useLiveQuery(() => window.api.ancestorsOf(itemId), [itemId]) ?? []
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

      {/* Where this piece belongs: the whole chain, outermost first. */}
      {ancestors.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-soft)', marginTop: -4 }}>
          ↳ part of{' '}
          {ancestors.map((a, i) => (
            <span key={a.id}>
              {i > 0 && <span style={{ color: 'var(--text-faint)' }}> › </span>}
              <span style={{ fontWeight: 600 }}>{a.title || 'Untitled'}</span>
            </span>
          ))}
        </div>
      )}

      {/* When it sits on the calendar and for how long. Start and end
          edit to the minute (the 15-min grid is only the drag default);
          the end field writes back as the duration. The preset list
          gains the block's current length when it's a non-standard one,
          so the select never lies about what's set. */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <label className="pill">
          ⏱
          <TimeField
            value={item.scheduledTime ?? ''}
            onCommit={(v) => patch({ scheduledTime: v })}
          />
        </label>
        {item.scheduledTime && (
          <label className="pill">
            –
            <TimeField
              value={toHHMM(Math.min(toMin(item.scheduledTime) + dur, 23 * 60 + 59))}
              onCommit={(v) => {
                // An end at or before the start would be a zero/negative
                // block — ignored, and the field snaps back on blur.
                const mins = toMin(v) - toMin(item.scheduledTime!)
                if (mins > 0) patch({ timeEstimateMinutes: mins })
              }}
            />
          </label>
        )}
        <label className="pill">
          for
          <select value={dur} onChange={(e) => patch({ timeEstimateMinutes: Number(e.target.value) })}>
            {(DURATIONS.includes(dur) ? DURATIONS : [...DURATIONS, dur].sort((a, b) => a - b)).map((m) => (
              <option key={m} value={m}>
                {durLabel(m)}
              </option>
            ))}
          </select>
        </label>
        {item.scheduledTime && (
          <span className="pill" style={{ color: 'var(--text-soft)' }}>
            {ampm(item.scheduledTime)}–{ampm(toHHMM(Math.min(toMin(item.scheduledTime) + dur, 23 * 60 + 59)))}
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
