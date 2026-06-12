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
 * (SPEC §7 "Cards everywhere"). `layout` makes cards glide with spring
 * physics when lists reorder around them.
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
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      // The satisfying exit: completing/dropping physically removes the
      // card from the list (SPEC §7 micro-interactions).
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.16 } }}
      transition={{ type: 'spring', stiffness: 500, damping: 38 }}
      className={classes}
      style={accentColor ? ({ '--card-accent': accentColor } as CSSProperties) : undefined}
      onClick={onClick}
    >
      {children}
    </motion.div>
  )
}
