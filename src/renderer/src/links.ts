import type { AttachedLink } from '@shared/types'

/** Scheme-less pastes still open somewhere sensible. */
export function normalizeUrl(raw: string): string {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
}

/** A link's default name: the hostname, minus the noise. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' '
}
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m])

/**
 * Every hyperlink in a notes body (the editor's HTML), as attached
 * links — named by the anchor's text, or the hostname when the text IS
 * the URL (a bare pasted link needs no second copy of itself).
 * Regex, not DOMParser, so it runs (and tests) outside a browser; the
 * HTML is TipTap's own serialization, not wild-web markup.
 */
export function extractLinksFromHtml(html: string): AttachedLink[] {
  const out: AttachedLink[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gis)) {
    const url = decode(m[1])
    if (!/^https?:/i.test(url) || seen.has(url)) continue
    seen.add(url)
    const text = decode(m[2].replace(/<[^>]*>/g, '')).trim()
    out.push({ title: !text || text === url ? hostLabel(url) : text, url })
  }
  return out
}
