import { useEffect } from 'react'
import { useMutate } from '../state/data'
import { useSelection } from '../state/selection'
import { rollingDays } from '../format'
import { ProjectPicker } from './ProjectPicker'
import { isTyping } from './HotkeysHelp'

/**
 * A fixed bar that appears while a multi-selection is live: one click
 * schedules or files every ⌘-selected item at once, then the selection
 * dissolves — it's a triage gesture, not a persistent mode.
 */
export function SelectionBar(): React.JSX.Element | null {
  const { selected, clear } = useSelection()
  const mutate = useMutate()

  // Escape drops the whole selection — but never while typing.
  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !isTyping(e)) clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size, clear])

  if (selected.size === 0) return null

  // One mutate wraps the whole batch, so the UI refreshes exactly once.
  const applyAll = (patch: Parameters<typeof window.api.updateItem>[1]): void => {
    const ids = [...selected]
    void mutate(async () => {
      for (const id of ids) await window.api.updateItem(id, patch)
    })
    clear()
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 45,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        boxShadow: 'var(--shadow-lift)'
      }}
    >
      <b style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{selected.size} selected</b>
      {rollingDays().map((d) => (
        <button
          key={d.date}
          className="btn small"
          onClick={() => applyAll({ scheduledDate: d.date, status: 'active' })}
        >
          {d.chip}
        </button>
      ))}
      <button
        className="btn small"
        title="No date — they live in the backlog until you pick a day"
        onClick={() => applyAll({ scheduledDate: null, status: 'active' })}
      >
        someday
      </button>
      <ProjectPicker value={null} onChange={(projectId) => applyAll({ projectId })} />
      <button className="btn ghost small" title="Clear selection (Esc)" onClick={clear}>
        ✕
      </button>
    </div>
  )
}
