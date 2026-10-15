import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/** A labelled cluster of ribbon controls. */
export function RGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rgroup" role="group" aria-label={label}>
      <div className="rgroup-items">{children}</div>
      <div className="rgroup-label">{label}</div>
    </div>
  )
}

/** Small ribbon buttons stacked in a column. */
export function RStack({ children }: { children: ReactNode }) {
  return <div className="rstack">{children}</div>
}

interface RBProps {
  icon: LucideIcon
  label: ReactNode
  onClick?: () => void
  disabled?: boolean
  /** Toggle state; omit for plain buttons. */
  pressed?: boolean
  title?: string
  ariaLabel?: string
  /** Large: icon above the label. Small: icon beside it. */
  big?: boolean
  /** An accent dot, for example the unsaved marker on Save. */
  badge?: boolean
}

export function RB({ icon: Icon, label, onClick, disabled, pressed, title, ariaLabel, big, badge }: RBProps) {
  return (
    <button
      type="button"
      className={big ? 'rb big' : 'rb'}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={title}
      aria-label={ariaLabel}
    >
      <span className="rb-icon">
        <Icon size={big ? 22 : 16} strokeWidth={big ? 1.6 : 1.8} aria-hidden />
        {badge && <span className="rb-badge" aria-hidden />}
      </span>
      <span className="rb-label">{label}</span>
    </button>
  )
}

/** A compact icon-only button for bars (status bar, find bar, tab strip). */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  pressed,
  title,
  className
}: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  disabled?: boolean
  pressed?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      className={className ? `icon-btn ${className}` : 'icon-btn'}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={title ?? label}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden />
    </button>
  )
}
