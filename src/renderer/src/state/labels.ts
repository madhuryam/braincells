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
 * The Google label colors merged with the user's overrides (display
 * name, display color, associated project) from Settings. Open-ended:
 * Google now allows labels beyond the classic eleven, so any colorId
 * works — unknown ones display as a neutral gray "Label N" until the
 * user names and colors them in Settings.
 * `of(event)` is the lookup every event view renders from.
 */
export function useLabels(): {
  all: Label[]
  of: (e: { colorId?: string | null }) => Label | undefined
} {
  const overrides = useLiveQuery(
    () => window.api.getSetting<Record<string, LabelOverride>>('calendarLabels'),
    []
  )
  return useMemo(() => {
    const ids = [...new Set([...Object.keys(GOOGLE_EVENT_COLORS), ...Object.keys(overrides ?? {})])]
    const all = ids.map((id) => {
      const base = GOOGLE_EVENT_COLORS[id]
      const o = overrides?.[id]
      return {
        id,
        name: o?.name?.trim() || base?.name || `Label ${id}`,
        hex: o?.hex || base?.hex || UNKNOWN_LABEL_HEX,
        projectId: o?.projectId ?? null
      }
    })
    const byId = new Map(all.map((l) => [l.id, l]))
    return {
      all,
      of: (e) =>
        e.colorId
          ? byId.get(e.colorId) ?? {
              id: e.colorId,
              name: `Label ${e.colorId}`,
              hex: UNKNOWN_LABEL_HEX,
              projectId: null
            }
          : undefined
    }
  }, [overrides])
}
