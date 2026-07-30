import { motion } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  /** Project accent color: tints the left edge + a soft background wash. */
  accentColor?: string | null
  interactive?: boolean
  /** Done cards strike through; faded cards (carried-over) go quiet. */
  done?: boolean
  faded?: boolean
  onClick?: () => void
  className?: string
}

/**
 * The card: the one tactile unit everything in the app renders as
 * (SPEC §7 "Cards everywhere"). Deliberately no `layout` animation:
 * it scale-warped an expanding card and rippled every neighbor —
 * expand/collapse should be instant, only enter/exit animate.
 */
export function Card({
  children,
  accentColor,
  interactive,
  done,
  faded,
  onClick,
  className = ''
}: CardProps): React.JSX.Element {
  const classes = [
    'card',
    accentColor ? 'accented' : '',
    interactive || onClick ? 'interactive' : '',
    done ? 'done' : '',
    faded ? 'faded' : '',
    className
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // The satisfying exit: completing/dropping physically collapses
      // the card out of the list (SPEC §7 micro-interactions) — not a
      // checkbox toggle, an actual departure.
      exit={{
        opacity: 0,
        scale: 0.92,
        height: 0,
        paddingTop: 0,
        paddingBottom: 0,
        overflow: 'hidden',
        transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] }
      }}
      transition={{ duration: 0.16, ease: [0.25, 0.1, 0.25, 1] }}
      className={classes}
      style={accentColor ? ({ '--card-accent': accentColor } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {children}
    </motion.div>
  )
}
