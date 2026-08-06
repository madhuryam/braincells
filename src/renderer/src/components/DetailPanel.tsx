import type { ReactNode } from 'react'

/**
 * The right-hand peek panel: shows a meeting or item beside the list
 * that opened it, so browsing the log never means losing your place.
 * Content that has a fuller home (meetings, pages) gets an
 * "open full page" action in the header.
 */
export function DetailPanel({
  title,
  onOpenFull,
  onClose,
  children
}: {
  title?: string
  onOpenFull?: () => void
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <aside className="detail-panel">
      <div className="detail-panel-header row">
        {title && (
          // The title doubles as the open-full affordance — clicking a
          // thing's name to go to it needs no label.
          <h2
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              cursor: onOpenFull ? 'pointer' : undefined
            }}
            title={onOpenFull ? 'Open full view' : undefined}
            onClick={onOpenFull}
          >
            {title}
          </h2>
        )}
        <span className="row" style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {onOpenFull && (
            <button className="btn ghost icon-btn" title="Open full view" onClick={onOpenFull}>
              ↗
            </button>
          )}
          <button className="btn ghost icon-btn" title="Close panel" onClick={onClose}>
            ✕
          </button>
        </span>
      </div>
      {children}
    </aside>
  )
}
