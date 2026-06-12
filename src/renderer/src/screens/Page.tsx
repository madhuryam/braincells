import { useEffect, useRef, useState } from 'react'
import { useData, useLiveQuery, useMutate } from '../state/data'
import { RichEditor } from '../components/RichEditor'
import { BackButton, ProjectDot } from '../components/bits'

/**
 * A Page: a full-fledged writing surface attached to a project — the
 * brain-dump-and-reference document (think Slack canvas). The editor
 * emits HTML (stored in richContent) plus a plain-text mirror (stored
 * in content) that powers full-text search and the markdown export.
 */
export function Page({ itemId }: { itemId: string }): React.JSX.Element {
  const item = useLiveQuery(() => window.api.getItem(itemId), [itemId])
  const { projects } = useData()
  const mutate = useMutate()

  // Title: seeded once per page, saved on blur (same pattern as cards).
  const [title, setTitle] = useState('')
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (item && seededFor.current !== item.id) {
      seededFor.current = item.id
      setTitle(item.title)
    }
  }, [item])

  // Body: debounced autosave. The editor is the source of truth while
  // typing; saves happen 600ms after the last keystroke and on leave.
  const pending = useRef<{ html: string; text: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const onEditorChange = (html: string, text: string): void => {
    pending.current = { html, text }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const p = pending.current
      pending.current = null
      if (p) mutate(() => window.api.updateItem(itemId, { richContent: p.html, content: p.text }))
    }, 600)
  }
  useEffect(
    () => () => {
      // Flush whatever is still pending when navigating away.
      window.clearTimeout(timer.current)
      const p = pending.current
      pending.current = null
      if (p) window.api.updateItem(itemId, { richContent: p.html, content: p.text })
    },
    [itemId]
  )

  if (!item) return <div className="canvas">Page not found.</div>
  const project = projects.find((p) => p.id === item.projectId)

  return (
    <div className="canvas" style={{ maxWidth: 860 }}>
      <header className="canvas-header">
        <BackButton />
        <input
          className="page-title"
          value={title}
          placeholder="Untitled page"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== item.title && mutate(() => window.api.updateItem(itemId, { title }))}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {project && (
          <span className="pill">
            <ProjectDot color={project.color} /> {project.name}
          </span>
        )}
      </header>

      {/* Keyed by id: the editor seeds once per page and owns the
          content from there (no cursor-jumping re-seeds on save). */}
      <RichEditor
        key={item.id}
        initialHtml={item.richContent ?? ''}
        placeholder="Brain dump here — headings, tables, checklists, whatever helps later-you."
        onChange={onEditorChange}
      />
    </div>
  )
}
