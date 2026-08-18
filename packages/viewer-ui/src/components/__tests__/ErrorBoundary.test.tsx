import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '../ErrorBoundary'

function Boom(): React.JSX.Element {
  throw new Error('render exploded')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // The boundary logs the caught error; silence it so the test output is clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a contained fallback instead of letting the error escape', () => {
    render(
      <ErrorBoundary label="the conflicts section">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Couldn’t display the conflicts section/)).toBeInTheDocument()
  })

  it('renders its children when they do not throw', () => {
    render(
      <ErrorBoundary>
        <div>healthy content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('healthy content')).toBeInTheDocument()
  })

  it('clears the error when resetKey changes (navigating to another section)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="conflicts">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()

    rerender(
      <ErrorBoundary resetKey="questions">
        <div>next section</div>
      </ErrorBoundary>
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('next section')).toBeInTheDocument()
  })
})
