import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Changing this resets the boundary — e.g. the active section, so navigating
   *  away from a section that threw shows the next section rather than the
   *  fallback. */
  resetKey?: string
  /** Overridable so callers can name what failed. */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Contains a render error to its subtree instead of blanking the whole viewer.
 *
 * A single malformed item in research.json (a conflict missing an array field, a
 * question missing exhaustive_declaration) previously threw during render and,
 * with no boundary anywhere in the tree, white-screened the entire app — the
 * user saw nothing, not even the other sections (issue #1317). This renders a
 * contained message instead so the rest of the viewer stays usable.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Viewer section failed to render', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div role="alert" style={{ padding: '1.5rem', lineHeight: 1.5 }}>
          <h2 style={{ margin: '0 0 0.5rem' }}>
            Couldn’t display {this.props.label ?? 'this section'}
          </h2>
          <p style={{ margin: 0 }}>
            Its data in <code>research.json</code> is malformed or incomplete. The rest of the
            project is still shown — switch to another section from the sidebar.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
