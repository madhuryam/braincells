import { useEffect, useState } from 'react'

/**
 * Two-step destructive action: the first click arms the button (it
 * turns into its confirm label), the second actually fires. Arms
 * disarm after 3s or when focus leaves — no modal, no accidental
 * deletes.
 */
export function ConfirmButton({
  label,
  confirmLabel = 'sure?',
  title,
  className = 'btn ghost',
  onConfirm
}: {
  label: string
  confirmLabel?: string
  title?: string
  className?: string
  onConfirm: () => void
}): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <button
      className={`${className} ${armed ? 'confirm-armed' : ''}`}
      title={title}
      onBlur={() => setArmed(false)}
      onClick={(e) => {
        e.stopPropagation()
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
