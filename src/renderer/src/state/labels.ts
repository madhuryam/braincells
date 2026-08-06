import { useMemo } from 'react'
import { GOOGLE_EVENT_COLORS, type LabelOverride } from '@shared/types'
import { useLiveQuery } from './data'

/** A Google label color as it should display: overrides applied. */
export interface Label {
  id: string
  name: string
  hex: string
  /** Associated project — labeled events borrow its color on the schedule. */
  projectId: string | null
}

/** Stand-in color for label ids beyond Google's classic eleven. */
export const UNKNOWN_LABEL_HEX = '#9aa0a6'

/**
 * Custom event-label ids arrive with inconsistent casing (the events
 * API lowercases them; older saved overrides may not be) — one label
 * must resolve to one key, or its color silently stops applying.
 */
export const normLabelId = (id: string): string => id.toLowerCase()

// Google's API exposes no color for new-style event labels, so an
// uncustomized one gets a stable color hashed from its id — arbitrary
// but consistent, and always overridable in Settings. (Muted tones,
// deliberately distinct from the classic-eleven palette.)
const FALLBACK_HUES = [
  '#e8590c', '#5c940d', '#0b7285', '#5f3dc4', '#c2255c', '#0ca678',
  '#e67700', '#1971c2', '#9c36b5', '#862e9c', '#3b5bdb', '#087f5b'
]
export function fallbackLabelHex(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return FALLBACK_HUES[h % FALLBACK_HUES.length]
}

/**
 * The Google label colors merged with the user's overrides (display
 * name, display color, associated project) from Settings. Open-ended:
 * beyond the classic eleven, any label id works — unknown ones get a
 * stable hashed color and a "Label N" name until customized.
 * `of(event)` is the lookup every event view renders from.
 */
export function useLabels(): {
  all: Label[]
  of: (e: { colorId?: string | null; eventLabelId?: string | null }) => Label | undefined
} {
  const overridesRaw = useLiveQuery(
    () => window.api.getSetting<Record<string, LabelOverride>>('calendarLabels'),
    []
  )
  return useMemo(() => {
    // Consolidate override keys case-insensitively (see normLabelId).
    const overrides: Record<string, LabelOverride> = {}
    for (const [k, v] of Object.entries(overridesRaw ?? {})) {
      overrides[normLabelId(k)] = { ...overrides[normLabelId(k)], ...v }
    }
    const ids = [...new Set([...Object.keys(GOOGLE_EVENT_COLORS), ...Object.keys(overrides)])]
    const all = ids.map((id) => {
      const base = GOOGLE_EVENT_COLORS[id]
      const o = overrides[id]
      return {
        id,
        name: o?.name?.trim() || base?.name || `Label ${id}`,
        hex: o?.hex || base?.hex || fallbackLabelHex(id),
        projectId: o?.projectId ?? null
      }
    })
    const byId = new Map(all.map((l) => [l.id, l]))
    return {
      all,
      // Prefer the standard color id (the classic eleven Just Work);
      // fall back to the custom event-label id for events colored with a
      // label outside that palette — those carry an eventLabelId only.
      of: (e) => {
        const raw = e.colorId ?? e.eventLabelId
        if (!raw) return undefined
        const id = normLabelId(raw)
        return (
          byId.get(id) ?? { id, name: `Label ${id}`, hex: fallbackLabelHex(id), projectId: null }
        )
      }
    }
  }, [overridesRaw])
}
