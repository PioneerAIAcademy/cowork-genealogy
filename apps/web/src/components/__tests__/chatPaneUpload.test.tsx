import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import ChatPane from '../ChatPane'
import { api, ApiError } from '../../api'
import type { SessionConnection, Listener, WsMessage } from '../../transport/SessionConnection'

// Issue #2490, ruling 7. A tester offering four pages had to press Stop to add each
// one, because the composer took one file and sent at once. These assert what reached
// `conn.send`, and how many times, since one message per set is the whole fix.

class FakeConn implements SessionConnection {
  sent: WsMessage[] = []
  private listeners = new Set<Listener>()
  connect(): void {}
  on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  send(obj: WsMessage): void {
    this.sent.push(obj)
  }
  close(): void {}
  emit(msg: WsMessage): void {
    act(() => {
      for (const l of this.listeners) l(msg)
    })
  }
}

function mount(): { conn: FakeConn; input: HTMLInputElement } {
  const conn = new FakeConn()
  const { container } = render(<ChatPane conn={conn} sessionId="sess_1" isNew={false} />)
  conn.emit({ type: 'status', state: 'chat_ready' })
  return { conn, input: container.querySelector('input[type="file"]') as HTMLInputElement }
}

const file = (name: string): File => new File(['x'], name, { type: 'image/jpeg' })

const pick = (input: HTMLInputElement, files: File[]): void => {
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => {
  vi.restoreAllMocks()
  Element.prototype.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

describe('attaching files', () => {
  it('the file input allows several files', () => {
    expect(mount().input.multiple).toBe(true)
  })

  it('several files upload in order and send one message naming every path', async () => {
    const upload = vi
      .spyOn(api, 'uploadSessionFile')
      .mockImplementation(async (_id, f) => ({ path: `uploads/${f.name}`, sizeBytes: 1 }))
    const { conn, input } = mount()
    pick(input, [file('p1.jpg'), file('p2.jpg'), file('p3.jpg')])
    await waitFor(() => expect(conn.sent).toHaveLength(1))
    expect(upload.mock.calls.map(([, f]) => f.name)).toEqual(['p1.jpg', 'p2.jpg', 'p3.jpg'])
    expect(conn.sent[0]).toEqual({
      type: 'user_msg',
      text: "I've uploaded 3 files: `uploads/p1.jpg`, `uploads/p2.jpg`, `uploads/p3.jpg`. Please read them and use them in this research."
    })
  })

  it('one file keeps the single-file message', async () => {
    vi.spyOn(api, 'uploadSessionFile').mockResolvedValue({ path: 'uploads/p1.jpg', sizeBytes: 1 })
    const { conn, input } = mount()
    pick(input, [file('p1.jpg')])
    await waitFor(() => expect(conn.sent).toHaveLength(1))
    expect(conn.sent[0]).toEqual({
      type: 'user_msg',
      text: "I've uploaded a file to `uploads/p1.jpg`. Please read it and use it in this research."
    })
  })

  it('a failed file does not end the set, and the error names it', async () => {
    vi.spyOn(api, 'uploadSessionFile').mockImplementation(async (_id, f) => {
      if (f.name === 'p2.jpg') throw new ApiError(413, 'too large')
      return { path: `uploads/${f.name}`, sizeBytes: 1 }
    })
    const { conn, input } = mount()
    pick(input, [file('p1.jpg'), file('p2.jpg'), file('p3.jpg')])
    await waitFor(() => expect(conn.sent).toHaveLength(1))
    const text = String(conn.sent[0].text)
    expect(text).toContain('`uploads/p1.jpg`')
    expect(text).toContain('`uploads/p3.jpg`')
    expect(text).not.toContain('p2.jpg')
    expect(await screen.findByText(/p2\.jpg: too large/)).toBeTruthy()
  })

  it('sends nothing when no file landed', async () => {
    vi.spyOn(api, 'uploadSessionFile').mockRejectedValue(new ApiError(413, 'too large'))
    const { conn, input } = mount()
    pick(input, [file('p1.jpg')])
    expect(await screen.findByText(/p1\.jpg: too large/)).toBeTruthy()
    expect(conn.sent).toHaveLength(0)
  })
})
