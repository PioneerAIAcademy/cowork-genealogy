import { describe, it, expect, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaIdText } from '../SchemaIdText'

// Phase 2 item 1, rendering half. Additive by construction: an id that cannot be
// resolved must render EXACTLY as it does today, so nothing regresses when the
// viewer is absent or the section is unknown.
//
// Queries are scoped to each render's own container, matching chatMarkdown.test.tsx:
// these tests share a jsdom document, so a global `screen` query sees the previous
// test's buttons and a "no button" assertion passes or fails for the wrong reason.

describe('SchemaIdText', () => {
  it('renders plain text unchanged when there are no ids', () => {
    const { container } = render(<SchemaIdText text="no identifiers here" onOpen={vi.fn()} />)
    expect(container.textContent).toBe('no identifiers here')
  })

  it('turns an id into a button and keeps the surrounding words intact', () => {
    const { container } = render(<SchemaIdText text="see a_001 for detail" onOpen={vi.fn()} />)
    expect(within(container).getByRole('button', { name: 'a_001' })).toBeTruthy()
    expect(container.textContent).toBe('see a_001 for detail')
  })

  it('opens the section the id belongs to', async () => {
    const onOpen = vi.fn()
    const { container } = render(<SchemaIdText text="check src_012" onOpen={onOpen} />)
    await userEvent.click(within(container).getByRole('button', { name: 'src_012' }))
    expect(onOpen).toHaveBeenCalledWith('src_012', 'sources')
  })

  it('leaves an id it cannot place as PLAIN TEXT, not a dead button', () => {
    const { container } = render(<SchemaIdText text="mystery zz_001 here" onOpen={vi.fn()} />)
    expect(within(container).queryByRole('button')).toBeNull()
    expect(container.textContent).toBe('mystery zz_001 here')
  })

  it('renders every id in a slash-separated pair — the shape the capture contains', () => {
    const { container } = render(<SchemaIdText text="resolve a_105/a_022." onOpen={vi.fn()} />)
    const w = within(container)
    expect(w.getByRole('button', { name: 'a_105' })).toBeTruthy()
    expect(w.getByRole('button', { name: 'a_022' })).toBeTruthy()
    expect(container.textContent).toBe('resolve a_105/a_022.')
  })

  it('does not linkify an id inside a URL', () => {
    const { container } = render(<SchemaIdText text="https://x.test/a_001" onOpen={vi.fn()} />)
    expect(within(container).queryByRole('button')).toBeNull()
    expect(container.textContent).toBe('https://x.test/a_001')
  })

  it('renders nothing clickable when no handler is supplied', () => {
    // No provider above the chat -> no resolver -> the prose must still read right.
    const { container } = render(<SchemaIdText text="see a_001" onOpen={undefined} />)
    expect(within(container).queryByRole('button')).toBeNull()
    expect(container.textContent).toBe('see a_001')
  })
})
