import { describe, it, expect } from 'vitest'
import { sameOriginLoopback } from '../sameOriginLoopback'

// Twice now, a tester has had the chat sit on "Chat unavailable: the socket closed without
// reaching the server" while every HTTP request succeeded. Both times the page was served
// from `localhost` and the sandbox socket pointed at `127.0.0.1` — different origins to a
// browser, so the WebSocket was refused while the proxied API calls went through fine.

describe('sameOriginLoopback', () => {
  it('points a loopback socket at the hostname the page is actually served from', () => {
    expect(sameOriginLoopback('ws://127.0.0.1:41723', 'localhost')).toBe('ws://localhost:41723')
    expect(sameOriginLoopback('ws://localhost:41723', '127.0.0.1')).toBe('ws://127.0.0.1:41723')
  })

  it('keeps the port, which is assigned per connect and is not guessable', () => {
    expect(sameOriginLoopback('ws://127.0.0.1:53207', 'localhost')).toContain(':53207')
  })

  it('leaves a REAL deployment host alone', () => {
    // THE case that must not regress. Rewriting this would aim the socket at the browser's
    // own hostname instead of the sandbox, breaking every hosted session.
    const e2b = 'wss://abc123-49982.e2b.app'
    expect(sameOriginLoopback(e2b, 'localhost')).toBe(e2b)
    expect(sameOriginLoopback(e2b, 'genealogy-workbench.fly.dev')).toBe(e2b)
  })

  it('does not rewrite when the page itself is not local', () => {
    // A loopback socket served to a remote page is already broken; pointing it at the
    // remote hostname would merely break it differently, and hide the real fault.
    expect(sameOriginLoopback('ws://127.0.0.1:41723', 'genealogy-workbench.fly.dev'))
      .toBe('ws://127.0.0.1:41723')
  })

  it('returns a bare origin with no trailing slash', () => {
    // The caller builds `${url}/?token=…`. A trailing slash makes `//?token=` and the
    // handshake 404s -- which would look exactly like the bug this fixes.
    expect(sameOriginLoopback('ws://127.0.0.1:41723', 'localhost')).not.toMatch(/\/$/)
  })

  it('hands back anything it cannot parse', () => {
    for (const junk of ['', 'not a url', '://nope']) {
      expect(sameOriginLoopback(junk, 'localhost')).toBe(junk)
    }
  })

  it('is a no-op when the hosts already agree', () => {
    expect(sameOriginLoopback('ws://127.0.0.1:41723', '127.0.0.1')).toBe('ws://127.0.0.1:41723')
  })
})
