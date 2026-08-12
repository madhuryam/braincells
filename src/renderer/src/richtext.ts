import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { Item } from '@shared/types'

/**
 * Items written before the rich editor existed store markdown in
 * `content`. This converts it once so the editor can pick it up;
 * from then on the item carries HTML in `richContent` (plus the
 * plain-text mirror in `content` for search/export).
 */
export function markdownToHtml(md: string): string {
  if (!md.trim()) return ''
  return DOMPurify.sanitize(marked.parse(md, { async: false }))
}

/** What the rich editor should be seeded with for any item. */
export function itemBodyHtml(item: Item): string {
  return item.richContent ?? markdownToHtml(item.content)
}

/**
 * Body HTML for read-only previews (canvas cards). The editor renders
 * richContent through TipTap's schema, but previews inject it straight
 * into the DOM — so sanitize on the way out, every time.
 */
export function itemPreviewHtml(item: Item): string {
  return DOMPurify.sanitize(itemBodyHtml(item))
}
