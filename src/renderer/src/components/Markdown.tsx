import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { useMemo } from 'react'

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
