import type { ReactNode } from 'react'

/** The mini progress bar on meeting cards — satisfying to watch fill. */
export function ProgressBar({ done, total }: { done: number; total: number }): React.JSX.Element {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="progress" title={`${done} of ${total} done`}>
      <div style={{ width: `${pct}%` }} />
    </div>
  )
}

export function ProjectDot({ color }: { color: string }): React.JSX.Element {
  return <span className="project-dot" style={{ background: color }} />
}

export function EmptyState({ art, children }: { art: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="empty-state">
      <span className="art">{art}</span>
      {children}
    </div>
  )
}

/** A toggleable round-rect checkbox used on task and prep cards. */
export function Checkbox({
  checked,
  onToggle
}: {
  checked: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      className={`checkbox ${checked ? 'checked' : ''}`}
      aria-checked={checked}
      role="checkbox"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      ✓
    </button>
  )
}
