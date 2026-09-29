import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '../StatusBadge'

describe('StatusBadge', () => {
  it('renders the value with underscores replaced by spaces', () => {
    render(<StatusBadge value="in_progress" />)
    expect(screen.getByText('in progress')).toBeInTheDocument()
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
