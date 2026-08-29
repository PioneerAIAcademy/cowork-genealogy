import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'

/**
 * The eval app has no authentication and no session. That is defensible only
 * while every state-changing request provably comes from the operator's own tab.
 * Before this middleware nothing enforced it, so any page the operator visited
 * while the annotation UI was open could drive every write route.
 *
 * These assert behaviour, not existence: each one fails if the corresponding
 * branch is removed.
 */

function req(method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest('http://127.0.0.1:3000/api/tests', { method, headers })
}

describe('middleware — cross-origin state-changing requests', () => {
  it('refuses a cross-origin POST', () => {
    const res = middleware(
      req('POST', { origin: 'http://evil.example', host: '127.0.0.1:3000' }),
    )
    expect(res.status).toBe(403)
  })

  it('allows a same-origin POST', () => {
    const res = middleware(
      req('POST', { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' }),
    )
    expect(res.status).toBe(200)
  })

  it('allows the app on either loopback spelling', () => {
    // Reached as both 127.0.0.1:3000 and localhost:3000; pinning one would
    // reject the operator's own tab on the other.
    const res = middleware(
      req('POST', { origin: 'http://localhost:3000', host: 'localhost:3000' }),
    )
    expect(res.status).toBe(200)
  })

  it('refuses a state-changing request with NO Origin at all', () => {
    // The easiest header state for an attacker to produce — a non-browser
    // client simply omits it. Treating absence as trusted would make the whole
    // check decorative.
    const res = middleware(req('POST', { host: '127.0.0.1:3000' }))
    expect(res.status).toBe(403)
    // Asserting the REASON, not just the status. With the absent-Origin branch
    // removed the request still 403s — `new URL(null)` throws into the
    // malformed-Origin catch below it — so a status-only assertion passes
    // whether or not the branch exists, and pins nothing.
    return res.json().then((body: { error: string }) => {
      expect(body.error).toContain('Origin header required')
    })
  })

  it('refuses a malformed Origin rather than throwing', () => {
    const res = middleware(req('POST', { origin: 'not a url', host: '127.0.0.1:3000' }))
    expect(res.status).toBe(403)
  })

  it('covers every state-changing method, not just POST', () => {
    // The write surface is not POST-only: run-log delete and annotation write
    // are DELETE and PUT.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = middleware(
        req(method, { origin: 'http://evil.example', host: '127.0.0.1:3000' }),
      )
      expect(res.status, `${method} must be refused cross-origin`).toBe(403)
    }
  })

  it('lets GET through', () => {
    // Read routes are guarded by path containment instead: a cross-site GET
    // from <script>/<img> carries no Origin, so a check here would either break
    // the app's own page loads or pass anyway.
    const res = middleware(req('GET', { host: '127.0.0.1:3000' }))
    expect(res.status).toBe(200)
  })

  it('refuses a matched Origin/Host pair that is not loopback', () => {
    // DNS rebinding: a page at evil.example:3000 rebound to 127.0.0.1 sends
    // BOTH headers as evil.example:3000, so `Origin === Host` holds and the
    // comparison alone lets it through — reproduced as a 200 before the fix.
    // Every other `host:` in this file is loopback, and `evil.example` only
    // ever appears as a MISMATCHED origin, which is exactly why the suite
    // could not see this.
    const res = middleware(
      req('POST', { origin: 'http://evil.example:3000', host: 'evil.example:3000' }),
    )
    expect(res.status).toBe(403)
  })
})
