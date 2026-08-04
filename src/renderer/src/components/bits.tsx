import type { ReactNode } from 'react'
import { useNav } from '../state/nav'

/**
 * "← back" in a screen header. Renders nothing on the first screen of
 * the session, so Today usually stays clean.
 */
export function BackButton(): React.JSX.Element | null {
  const { back, canGoBack } = useNav()
  if (!canGoBack) return null
  return (
    <button className="btn ghost icon-btn back-btn" title="Back" onClick={back}>
      ←
    </button>
  )
}

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

/**
 * An input that visibly creates a *checkable* item: a faded checkbox
 * sits inside the field, so it's obvious before hitting return that
 * the line becomes a task/prep checkbox, not a plain note.
 */
export function CheckableInput(
  props: React.InputHTMLAttributes<HTMLInputElement>
): React.JSX.Element {
  return (
    <div className="check-input">
      <span className="checkbox" aria-hidden />
      <input {...props} />
    </div>
  )
}

/**
 * Same idea for inputs that create something other than a checkbox:
 * a faded icon shows what hitting return produces (📝 = a note in
 * the Inbox, etc.).
 */
export function IconInput({
  icon,
  iconTitle,
  ...props
}: { icon: string; iconTitle?: string } & React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <div className="check-input">
      <span className="input-icon" aria-hidden title={iconTitle}>
        {icon}
      </span>
      <input {...props} />
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
