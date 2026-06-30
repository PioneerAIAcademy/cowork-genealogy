import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Linkify from '../Linkify'
import { setOpenExternal } from '../../../lib/external'

describe('Linkify', () => {
  beforeEach(() => setOpenExternal(() => {}))

  it('renders plain text with no links when there is no URL', () => {
    const { container } = render(<Linkify text="No links here, just prose." />)
    expect(container.textContent).toBe('No links here, just prose.')
    expect(container.querySelector('a')).toBeNull()
  })

  it('turns an embedded URL into a clickable link', () => {
    render(<Linkify text="See https://www.familysearch.org/ark:/61903/1:1:ABC for details." />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'https://www.familysearch.org/ark:/61903/1:1:ABC')
    expect(link).toHaveTextContent('https://www.familysearch.org/ark:/61903/1:1:ABC')
  })

  it('peels a trailing period off the URL (not into the href)', () => {
    const { container } = render(
      <Linkify text="URL: https://www.familysearch.org/ark:/61903/3:1:S3HT-XKR9-NXF?i=353. Next." />
    )
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute(
      'href',
      'https://www.familysearch.org/ark:/61903/3:1:S3HT-XKR9-NXF?i=353'
    )
    // The period and following sentence remain as text.
    expect(container.textContent).toContain('?i=353. Next.')
  })

  it('clicking a link routes through openExternal with the URL', async () => {
    const spy = vi.fn()
    setOpenExternal(spy)
    render(<Linkify text="Go to https://example.com/page now" />)
    await userEvent.click(screen.getByRole('link'))
    expect(spy).toHaveBeenCalledWith('https://example.com/page')
  })

  it('linkifies multiple URLs in one string', () => {
    render(<Linkify text="A https://a.example.com and B https://b.example.com end" />)
    const links = screen.getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      'https://a.example.com',
      'https://b.example.com'
    ])
  })

  it('keeps a balanced closing paren inside the URL', () => {
    render(<Linkify text="See https://en.wikipedia.org/wiki/Foo_(disambiguation) here" />)
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Foo_(disambiguation)'
    )
  })
})
