import { useEffect, useRef, useState } from 'react'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { useNav } from '../state/nav'
import { Checkbox, ProjectDot } from './bits'
import { KIND_ICON, prettyDate, projectLabel } from '../format'
import { RichEditor } from './RichEditor'
import { itemBodyHtml } from '../richtext'

/**
 * Single-item view for the detail panel: a single header row (title,
 * star, open-canvas, close), meta pills, and editable notes. Canvas
 * titles edit in place. Note the full page and this peek are two
 * editing surfaces for the same item; last save wins, acceptable
 * because the peek and full view are rarely edited together.
 */
export function ItemDetail({
  itemId,
  onClose
}: {
  itemId: string
  /** Renders a ✕ in the header row — pass it here instead of to DetailPanel. */
  onClose?: () => void
}): React.JSX.Element | null {
  const item = useLiveQuery(() => window.api.getItem(itemId), [itemId])
  const { projects, bump } = useData()
  const { openOverlay } = useNav()
  const mutate = useMutate()

  // Reseed on outside edits: the editor seeds once per mount, so when
  // the stored body comes back different from what this editor last
  // saw — e.g. the full canvas was opened over this peek, edited, and
  // closed — remount it via an epoch in the key. Our own saves
  // round-trip byte-identical and never trigger it.
  const lastHtml = useRef<string | null>(null)
  const [epoch, setEpoch] = useState(0)

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
    lastHtml.current = html
    pendingBody.current = { html, text }
    window.clearTimeout(bodyTimer.current)
    bodyTimer.current = window.setTimeout(flushBody, 600)
  }
  useEffect(
    () => () => {
      // Unmount flush goes straight to the API, then bumps so the
      // surfaces still on screen (list cards) show the edit.
      const p = pendingBody.current
      pendingBody.current = null
      window.clearTimeout(bodyTimer.current)
      if (p)
        window.api.updateItem(itemId, { richContent: p.html, content: p.text }).then(bump)
    },
    [itemId, bump]
  )

  const bodyHtml = item ? itemBodyHtml(item) : null
  useEffect(() => {
    if (bodyHtml === null) return
    if (lastHtml.current === null) {
      lastHtml.current = bodyHtml // first load — the editor seeds with this
    } else if (bodyHtml !== lastHtml.current && !pendingBody.current) {
      lastHtml.current = bodyHtml
      setEpoch((e) => e + 1)
    }
  }, [bodyHtml])

  // Canvas title: local draft only while focused; idle, the input
  // mirrors item.title so renames made on the full canvas land here.
  const [titleDraft, setTitleDraft] = useState<string | null>(null)

  if (!item) return null

  const project = projects.find((p) => p.id === item.projectId)
  const checkable = item.kind === 'task' || item.kind === 'prep'
  const done = item.status === 'done'
  const isPage = item.kind === 'page'

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
          !isPage && <span aria-hidden>{KIND_ICON[item.kind]}</span>
        )}
        {isPage ? (
          <input
            className="peek-title"
            value={titleDraft ?? item.title}
            placeholder="Untitled canvas"
            onFocus={() => setTitleDraft(item.title)}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const t = titleDraft
              setTitleDraft(null)
              if (t !== null && t !== item.title)
                mutate(() => window.api.updateItem(item.id, { title: t }))
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <h2 style={{ flex: 1, minWidth: 0, textDecoration: done ? 'line-through' : undefined }}>
            {item.title || <span style={{ color: 'var(--text-faint)' }}>Untitled</span>}
          </h2>
        )}
        <button
          className="btn ghost icon-btn"
          title={item.starred ? 'Unstar' : 'Star — pin it to the sidebar'}
          onClick={() => mutate(() => window.api.updateItem(item.id, { starred: !item.starred }))}
        >
          {item.starred ? '⭐' : '☆'}
        </button>
        {isPage && (
          <button
            className="btn ghost icon-btn"
            title="Open canvas"
            onClick={() => openOverlay({ name: 'page', itemId: item.id })}
          >
            ↗
          </button>
        )}
        {onClose && (
          <button className="btn ghost icon-btn" title="Close panel" onClick={onClose}>
            ✕
          </button>
        )}
      </div>
      <div className="card-meta">
        {project && (
          <span className="pill" title={project.name}>
            <ProjectDot color={project.color} /> {projectLabel(project)}
          </span>
        )}
        {item.scheduledDate && <span className="pill">📅 {prettyDate(item.scheduledDate)}</span>}
        {item.dueDate && <span className="pill">⏰ due {prettyDate(item.dueDate)}</span>}
        {item.completedAt && <span className="pill">✓ {prettyDate(item.completedAt.slice(0, 10))}</span>}
      </div>
      {/* Toolbar-less: markdown shortcuts (`# `, `**`, `- `) format as
          you type, and the placeholder replaces the old "no notes" dead-end. */}
      <RichEditor
        key={`${item.id}:${epoch}`}
        variant="compact"
        toolbar={false}
        initialHtml={itemBodyHtml(item)}
        placeholder="Notes — type **bold**, # headings, - lists…"
        onChange={onBodyChange}
      />
    </div>
  )
}
