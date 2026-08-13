import { useState } from 'react'
import type { AttachedLink } from '@shared/types'
import { hostLabel, normalizeUrl } from '../links'

/**
 * Attached links, shown by NAME (the 🔗 marks them as links; the URL
 * itself stays in the tooltip). One shared element for meetings and
 * tasks — the owner just says how to save.
 *
 * Editing: each chip's ✎ opens the inline editor (name + URL), and
 * deleting lives ONLY there — a bare ✕ on the chip made removal one
 * misclick away. ＋ opens the same editor empty; a blank name falls
 * back to the URL's hostname.
 *
 * `derived` chips are the hyperlinks found in the notes body — they
 * ride along at the end, read-only: their home is the notes text, so
 * they're edited (or removed) by editing the notes.
 */
export function LinkChips({
  links,
  derived = [],
  onSave
}: {
  links: AttachedLink[]
  derived?: AttachedLink[]
  onSave: (next: AttachedLink[]) => void
}): React.JSX.Element {
  // Which link is being edited: an index into `links`, or 'new'.
  const [editing, setEditing] = useState<number | 'new' | null>(null)

  // Notes links that duplicate a stored link stay hidden — one chip
  // per destination.
  const stored = new Set(links.map((l) => l.url))
  const fromNotes = derived.filter((d) => !stored.has(d.url))

  const closeEditor = (): void => setEditing(null)
  const save = (link: AttachedLink): void => {
    const next = editing === 'new' ? [...links, link] : links.map((l, i) => (i === editing ? link : l))
    onSave(next)
    closeEditor()
  }
  const remove = (): void => {
    if (editing === 'new') return
    onSave(links.filter((_, i) => i !== editing))
    closeEditor()
  }

  return (
    <div className="row meeting-links">
      {links.map((l, i) => (
        <span key={`${l.url}-${i}`} className="url-chip" title={l.url}>
          <a href={l.url} target="_blank" rel="noreferrer">
            🔗 {l.title || hostLabel(l.url)}
          </a>
          <button
            className="url-chip-edit"
            title="Edit this link"
            onClick={() => setEditing(i)}
          >
            ✎
          </button>
        </span>
      ))}
      {fromNotes.map((l) => (
        <span key={l.url} className="url-chip from-notes" title={`${l.url} — linked in the notes`}>
          <a href={l.url} target="_blank" rel="noreferrer">
            🔗 {l.title}
          </a>
        </span>
      ))}
      {editing !== null ? (
        <LinkEditor
          initial={editing === 'new' ? null : links[editing]}
          onSave={save}
          onDelete={editing === 'new' ? undefined : remove}
          onClose={closeEditor}
        />
      ) : (
        <button
          className="btn ghost small"
          title="Attach a link — Slack, doc, anything"
          onClick={() => setEditing('new')}
        >
          🔗 add link
        </button>
      )}
    </div>
  )
}

/** The chip editor: name + URL, Enter saves, Esc closes, Delete lives here. */
function LinkEditor({
  initial,
  onSave,
  onDelete,
  onClose
}: {
  initial: AttachedLink | null
  onSave: (link: AttachedLink) => void
  onDelete?: () => void
  onClose: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')

  const save = (): void => {
    const u = url.trim()
    if (!u) {
      onClose()
      return
    }
    const full = normalizeUrl(u)
    onSave({ title: title.trim() || hostLabel(full), url: full })
  }

  return (
    <span
      className="row link-editor"
      onKeyDown={(e) => {
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') onClose()
      }}
    >
      <input
        autoFocus={!initial}
        className="url-input"
        style={{ width: 130 }}
        placeholder="Name"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        autoFocus={!!initial}
        className="url-input"
        placeholder="Paste a link…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      {onDelete && (
        <button className="btn ghost small" title="Remove this link" onClick={onDelete}>
          🗑
        </button>
      )}
      <button className="btn small primary" onClick={save}>
        Done
      </button>
    </span>
  )
}
