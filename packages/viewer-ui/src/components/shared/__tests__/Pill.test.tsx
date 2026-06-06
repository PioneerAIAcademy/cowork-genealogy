import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import Pill from '../Pill'

describe('Pill', () => {
  it('renders the provided label text', () => {
    render(<Pill label="PRIMARY" />)
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
  })

  it('applies the primary tone class by default', () => {
    const { container } = render(<Pill label="PRIMARY" />)
    const span = container.querySelector('span')
    expect(span?.className).toMatch(/primary/)
  })

  it('applies the matched tone class when tone="matched"', () => {
    const { container } = render(<Pill label="MATCHED" tone="matched" />)
    const span = container.querySelector('span')
    expect(span?.className).toMatch(/matched/)
  })
})
