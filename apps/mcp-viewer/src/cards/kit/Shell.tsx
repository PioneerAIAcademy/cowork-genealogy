import type { ReactNode } from 'react'

export interface Point {
  label: string
  body: ReactNode
}

export interface ShellProps {
  title: ReactNode
  points?: Point[]
  /** A closing line, such as "2 more in the case file." */
  footer?: ReactNode
  /** At most two; a third is not drawn. */
  actions?: ReactNode[]
  /** The host's height limit in pixels. The card never scrolls inside itself. */
  heightLimit?: number | null
}

/** The frame every card draws in: a title, a few labelled points, at most two actions. */
export function Shell({ title, points = [], footer, actions = [], heightLimit }: ShellProps) {
  return (
    <article className="card" style={heightLimit ? { maxHeight: heightLimit } : undefined}>
      <h1>{title}</h1>
      {points.length > 0 && (
        <dl className="points">
          {points.map((point) => (
            <div key={point.label} className="point">
              <dt>{point.label}</dt>
              <dd>{point.body}</dd>
            </div>
          ))}
        </dl>
      )}
      {footer && <p className="footer">{footer}</p>}
      {actions.length > 0 && <div className="actions">{actions.slice(0, 2)}</div>}
    </article>
  )
}
