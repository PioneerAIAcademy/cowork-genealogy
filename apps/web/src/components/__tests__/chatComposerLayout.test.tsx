import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import ChatPane from '../ChatPane'
import type { SessionConnection, Listener, WsMessage } from '../../transport/SessionConnection'

// Reported from the screen: dragging the splitter to widen the viewer squeezed the typing
// box until the placeholder wrapped onto three lines ("Messa / ge the / agent"), while the
// Reasoning checkbox, the attach icon and Send kept their full width.
//
// The composer was ONE flex row, and the textarea was its only flexible item -- so every
// pixel the composer lost came out of the box you type into and none out of the three
// fixed-width controls. The box now has a row to itself.
//
// Asserted STRUCTURALLY. jsdom performs no layout, so every width here is 0 and a
// geometric assertion would pass just as happily on the broken single-row markup. The
// structure is what guarantees the behaviour; the widths were measured in a real browser.

class FakeConn implements SessionConnection {
  private listeners = new Set<Listener>()
  connect(): void {}
  on(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l) }
  send(): void {}
  close(): void {}
  emit(msg: WsMessage): void { act(() => { for (const l of this.listeners) l(msg) }) }
}

function mount() {
  Element.prototype.scrollTo = vi.fn()
  const conn = new FakeConn()
  const r = render(<ChatPane conn={conn} sessionId="sess_1" isNew={false} />)
  conn.emit({ type: 'status', state: 'chat_ready' })
  return r
}

afterEach(cleanup)

describe('chat composer layout', () => {
  it('gives the typing box a row of its own, with the controls beneath', () => {
    const { container } = mount()
    const bar = container.querySelector('.chatInputBar')
    const textarea = container.querySelector('.chatTextarea')
    const controls = container.querySelector('.chatControls')

    expect(bar).not.toBeNull()
    expect(controls).not.toBeNull()
    // Siblings, not nested: the textarea must not be inside the controls row, or it is
    // sharing width with them again under a different name.
    expect(textarea?.parentElement).toBe(bar)
    expect(controls?.parentElement).toBe(bar)
    // And the box comes FIRST, which is both the visual order and the tab order.
    expect(textarea).not.toBeNull()
    expect(textarea!.compareDocumentPosition(controls!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
  })

  it('puts all three controls in that row, not beside the box', () => {
    const { container } = mount()
    const controls = container.querySelector('.chatControls')!
    expect(controls.querySelector('.chatAdvanced')).not.toBeNull()   // Reasoning
    expect(controls.querySelector('.chatAttach')).not.toBeNull()     // upload
    expect(controls.querySelector('.chatSend')).not.toBeNull()       // Send
    // Nothing left stranded beside the textarea.
    const bar = container.querySelector('.chatInputBar')!
    for (const cls of ['.chatAdvanced', '.chatAttach', '.chatSend']) {
      expect(bar.querySelector(`:scope > ${cls}`)).toBeNull()
    }
  })

  it('keeps Stop in the controls row too, when a turn is running', () => {
    // Stop appears mid-turn. If it were still a direct child of the bar it would become a
    // third row the moment the agent started working.
    const conn = new FakeConn()
    Element.prototype.scrollTo = vi.fn()
    const { container } = render(<ChatPane conn={conn} sessionId="sess_1" isNew={false} />)
    conn.emit({ type: 'status', state: 'chat_ready' })
    conn.emit({ type: 'status', state: 'turn_active' })
    const stop = container.querySelector('.chatStop')
    expect(stop).not.toBeNull()
    expect(stop?.closest('.chatControls')).not.toBeNull()
  })
})
