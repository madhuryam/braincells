import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useMemo } from 'react'
import type { Item } from '@shared/types'

/**
 * Read-view for item content. Editing stays a plain textarea (SPEC §10);
 * this renders the saved markdown like a comfortable blog post.
 * DOMPurify strips anything dangerous before it touches the DOM.
 */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false })),
    [text]
  )
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

/**
 * Read-view for any item's body: rich-editor HTML when it has one,
 * otherwise the legacy markdown content.
 */
export function ItemBody({ item }: { item: Item }): React.JSX.Element {
  const rich = useMemo(
    () => (item.richContent ? DOMPurify.sanitize(item.richContent) : null),
    [item.richContent]
  )
  if (rich) return <div className="markdown" dangerouslySetInnerHTML={{ __html: rich }} />
  return <Markdown text={item.content} />
}
