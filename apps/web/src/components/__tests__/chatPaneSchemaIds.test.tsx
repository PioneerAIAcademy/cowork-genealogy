import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, within, act, cleanup, fireEvent } from '@testing-library/react'
import { ResearchDataContext, type ResearchDataState } from '@genealogy/viewer-ui'
import ChatPane from '../ChatPane'
import type { SessionConnection, Listener, WsMessage } from '../../transport/SessionConnection'

// Schema ids in chat prose, through the real ChatPane with research data above it.
// SchemaIdText alone cannot show either half: that a click reaches the entry and not
// only its tab, and that an id the project does not hold is not offered as a link.

class FakeConn implements SessionConnection {
  private listeners = new Set<Listener>()
  connect(): void {}
  on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  send(): void {}
  close(): void {}
  emit(msg: WsMessage): void {
    act(() => {
      for (const l of this.listeners) l(msg)
    })
  }
}

const HELD = new Set(['a_001', 'src_002'])

function mount(text: string): {
  container: HTMLElement
  setActiveSection: ReturnType<typeof vi.fn>
} {
  const setActiveSection = vi.fn()
  const ctx = {
    research: null,
    gedcomx: null,
    setActiveSection,
    hasId: (id: string) => HELD.has(id),
    getById: () => null
  } as unknown as ResearchDataState
  const conn = new FakeConn()
  const { container } = render(
    <ResearchDataContext.Provider value={ctx}>
      <ChatPane conn={conn} sessionId="sess_1" isNew={false} />
    </ResearchDataContext.Provider>
  )
  conn.emit({ type: 'status', state: 'chat_ready' })
  conn.emit({ type: 'agent_event', event: { kind: 'text', text } })
  return { container, setActiveSection }
}

let scrolled: Element[]
beforeEach(() => {
  scrolled = []
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this)
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe.each([
  ['a paragraph', 'Linked a_001 and a_099 here.'],
  ['a list item', '- Linked a_001 and a_099 here.']
])('schema ids in %s', (_shape, text) => {
  it('links only the ids the project holds', () => {
    const { container } = mount(text)
    const w = within(container)
    expect(w.getByRole('button', { name: 'a_001' })).toBeTruthy()
    expect(w.queryByRole('button', { name: 'a_099' })).toBeNull()
    expect(container.textContent).toContain('a_099')
  })

  it('opens the section and scrolls to the entry itself', () => {
    const target = document.createElement('div')
    target.id = 'a_001'
    document.body.appendChild(target)
    try {
      const { container, setActiveSection } = mount(text)
      fireEvent.click(within(container).getByRole('button', { name: 'a_001' }))
      expect(setActiveSection).toHaveBeenCalledWith('assertions')
      expect(scrolled).toContain(target)
    } finally {
      target.remove()
    }
  })
})
