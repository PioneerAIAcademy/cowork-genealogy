import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '../StatusBadge'

describe('StatusBadge', () => {
  it('renders the value with underscores replaced by spaces', () => {
    render(<StatusBadge value="in_progress" />)
    expect(screen.getByText('in progress')).toBeInTheDocument()
  })

  it('renders a mapped value as its researcher-facing label', () => {
    render(<StatusBadge value="not_proved" />)
    expect(screen.getByText('not established')).toBeInTheDocument()
    expect(screen.queryByText('not proved')).toBeNull()
  })

  it.each([
    ['proved', 'well established'],
    ['probable', 'likely'],
    ['possible', 'tentative'],
    ['not_proved', 'not established'],
    ['disproved', 'ruled out'],
    ['original', 'Record image'],
    ['derivative', 'Index or transcript'],
    ['authored', 'Compiled work'],
    ['exhaustive_declared', 'all reachable searched'],
    ['ceiling', 'limit of online records'],
    ['gap', 'evidence missing'],
    ['conflict', 'conflicting evidence']
  ])('labels %s as "%s"', (value, label) => {
    render(<StatusBadge value={value} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('labels probable "likely" in both enums that store it', () => {
    render(<StatusBadge value="probable" />)
    expect(screen.getByText('likely')).toBeInTheDocument()
  })

  it('renders nothing when value is undefined', () => {
    const { container } = render(<StatusBadge value={undefined} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when value is null', () => {
    const { container } = render(<StatusBadge value={null} />)
    expect(container.innerHTML).toBe('')
  })
})
