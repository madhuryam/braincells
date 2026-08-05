import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * A single viewport-level hover tooltip, shown instantly (unlike the
 * native `title`, which lags ~1s). It renders at the app root, so it
 * escapes `overflow` clipping — the calendar's scrolling day cells clip
 * a CSS `::after` tooltip, which is why chips there had no fast label
 * hover. Use it via `useTip(text)` spread onto any element.
 */
interface TipState {
  text: string
  x: number
  y: number
}
const TipContext = createContext<{
  show: (text: string, el: HTMLElement) => void
  hide: () => void
} | null>(null)

export function TooltipProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [tip, setTip] = useState<TipState | null>(null)
  const show = useCallback((text: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    // Centered on the anchor, but kept clear of the window edges so a
    // wide tip (e.g. a chip in the last calendar column) can't clip off.
    const half = 150 // matches the tip's max-width / 2
    const x = Math.min(Math.max(r.left + r.width / 2, half + 4), window.innerWidth - half - 4)
    setTip({ text, x, y: r.bottom + 6 })
  }, [])
  const hide = useCallback(() => setTip(null), [])

  // Any scroll or click can slide the anchor out from under the tip
  // (e.g. opening a meeting overlay) — dismiss on both, capture-phase
  // so it fires even inside the calendar's own scroll container.
  useEffect(() => {
    if (!tip) return
    const off = (): void => setTip(null)
    window.addEventListener('scroll', off, true)
    window.addEventListener('pointerdown', off, true)
    return () => {
      window.removeEventListener('scroll', off, true)
      window.removeEventListener('pointerdown', off, true)
    }
  }, [tip])

  return (
    <TipContext.Provider value={{ show, hide }}>
      {children}
      {tip && (
        <div className="hovertip" style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.text}
        </div>
      )}
    </TipContext.Provider>
  )
}

/**
 * Compose a multi-line tip: each truthy part becomes its own line
 * (the tip renders `\n` as a line break and never truncates).
 */
export function tipLines(...parts: Array<string | null | undefined | false>): string {
  return parts.filter(Boolean).join('\n')
}

/**
 * Handlers to spread onto an element to give it a fast tooltip:
 * `<button {...useTip('Deep work')}>`. A null/empty text opts out
 * (returns no handlers), so callers can conditionally enable it.
 */
export function useTip(
  text: string | null | undefined
): { onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void; onMouseLeave?: () => void } {
  const ctx = useContext(TipContext)
  if (!ctx || !text) return {}
  return {
    onMouseEnter: (e) => ctx.show(text, e.currentTarget),
    onMouseLeave: ctx.hide
  }
}
