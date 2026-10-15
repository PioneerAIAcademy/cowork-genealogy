import { describe, it, expect } from 'vitest'
import { sameOriginLoopback, devSandboxTunnel } from '../sameOriginLoopback'

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

describe('devSandboxTunnel', () => {
  const DEV = true
  const PAGE = 'http://127.0.0.1:5173'

  it('routes a local sandbox socket through the dev server’s own port', () => {
    // The port is the part that gets blocked. A browser happy with every proxied HTTP
    // request can still refuse a direct ws:// to a different local port -- measured: a
    // clean Chromium opened it while the reporter's browser could not, same origin, same
    // machine, same sandbox.
    expect(devSandboxTunnel('ws://127.0.0.1:53481', DEV, PAGE))
      .toBe('ws://127.0.0.1:5173/sandbox-ws/53481')
  })

  it('keeps the page’s own host and scheme', () => {
    expect(devSandboxTunnel('ws://127.0.0.1:53481', DEV, 'http://localhost:5173'))
      .toBe('ws://localhost:5173/sandbox-ws/53481')
    expect(devSandboxTunnel('ws://127.0.0.1:53481', DEV, 'https://example.test'))
      .toBe('wss://example.test/sandbox-ws/53481')
  })

  it('does NOTHING outside dev', () => {
    // THE guard that matters. In a build there is no tunnel listening, so rewriting here
    // would turn a working socket into a 404 on the control plane.
    expect(devSandboxTunnel('ws://127.0.0.1:53481', false, PAGE)).toBe('ws://127.0.0.1:53481')
  })

  it('never touches a hosted wss:// sandbox', () => {
    // Rewriting this would aim the socket at the viewer's own machine instead of E2B.
    const e2b = 'wss://abc123-49982.e2b.app'
    expect(devSandboxTunnel(e2b, DEV, PAGE)).toBe(e2b)
    expect(devSandboxTunnel(e2b, DEV, 'https://genealogy-workbench.fly.dev')).toBe(e2b)
  })

  it('leaves a non-loopback ws:// host alone', () => {
    expect(devSandboxTunnel('ws://10.0.0.5:53481', DEV, PAGE)).toBe('ws://10.0.0.5:53481')
  })

  it('leaves a portless url alone', () => {
    // Without a port there is nothing to tunnel to, and inventing one would be worse
    // than leaving a broken url broken.
    expect(devSandboxTunnel('ws://127.0.0.1', DEV, PAGE)).toBe('ws://127.0.0.1')
  })

  it('hands back anything it cannot parse', () => {
    for (const junk of ['', 'not a url', '://nope']) {
      expect(devSandboxTunnel(junk, DEV, PAGE)).toBe(junk)
    }
  })

  it('composes with the host fix: localhost page, 127.0.0.1 sandbox', () => {
    const sameHost = sameOriginLoopback('ws://127.0.0.1:53481', 'localhost')
    expect(devSandboxTunnel(sameHost, DEV, 'http://localhost:5173'))
      .toBe('ws://localhost:5173/sandbox-ws/53481')
  })
})
