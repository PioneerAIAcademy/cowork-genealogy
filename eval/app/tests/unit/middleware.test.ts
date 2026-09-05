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
    // The ORIGIN comparison does not apply to GET: a cross-site GET from
    // <script>/<img> carries no Origin, so comparing it would either break the
    // app's own page loads or pass anyway. The loopback pin still applies — see
    // the Host tests below. (#2000 is path containment, a different attack:
    // it stops `../` traversal at the filesystem, not a cross-origin read.)
    const res = middleware(req('GET', { host: '127.0.0.1:3000' }))
    expect(res.status).toBe(200)
  })

  it('refuses a GET whose Host is not loopback', () => {
    // The rebinding pin has to run before the method gate, not after it. A page
    // on a rebound domain issues a plain GET: it carries no Origin, so the
    // Origin reasoning genuinely does not apply — but `isLoopbackHost` needs no
    // Origin, and the operator's own page loads always satisfy it, since they
    // arrive as 127.0.0.1 or localhost. Refusing here cannot break the app and
    // closes the read half of the same attack the POST path already refuses.
    const res = middleware(req('GET', { host: 'evil.example:3000' }))
    expect(res.status).toBe(403)
  })

  it('refuses a HEAD whose Host is not loopback', () => {
    const res = middleware(req('HEAD', { host: 'evil.example:3000' }))
    expect(res.status).toBe(403)
  })

  it('still lets a loopback GET through', () => {
    // The pin must not cost the app its own reads.
    expect(middleware(req('GET', { host: 'localhost:3000' })).status).toBe(200)
    expect(middleware(req('GET', { host: '127.0.0.1:3000' })).status).toBe(200)
  })

  it('refuses a Host carrying userinfo', () => {
    // `evil.com@127.0.0.1:3000` parsed as a URL authority is userinfo plus a
    // loopback host, so it was allowed on the read path. A Host header has no
    // userinfo under RFC 7230 and no browser sends one, so this is not a
    // reachable attack — it is the parse accepting a shape the grammar forbids.
    expect(middleware(req('GET', { host: 'evil.com@127.0.0.1:3000' })).status).toBe(403)
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

/**
 * The loopback allow-list is an EQUALITY check, and nothing held it to that
 * (#1999 review). Relaxing `hostname === '127.0.0.1'` to `.startsWith(...)`
 * left all 185 tests green, while accepting `127.0.0.1.nip.io` — a DNS name an
 * attacker registers and points wherever they like, which is precisely the
 * rebinding case the pin exists to refuse.
 *
 * It is the same prefix bug `wiring.test.ts` already guards for the bind flag
 * (`--hostname 127.0.0.10`); the middleware's own check was the copy nobody
 * pinned.
 */
describe('middleware — the loopback check is equality, not a prefix', () => {
  for (const host of ['127.0.0.1.nip.io:3000', '127.0.0.10:3000', '127.0.0.1x:3000']) {
    it(`refuses a host that merely begins with 127.0.0.1: ${host}`, () => {
      expect(middleware(req('GET', { host })).status).toBe(403)
      expect(
        middleware(req('POST', { origin: `http://${host}`, host })).status,
      ).toBe(403)
    })
  }

  it('still allows the two real loopback spellings', () => {
    expect(middleware(req('GET', { host: '127.0.0.1:3000' })).status).toBe(200)
    expect(middleware(req('GET', { host: 'localhost:3000' })).status).toBe(200)
  })
})

/**
 * `isLoopbackHost`'s URL-parse catch (#1999 review). Flipping it to
 * `return true` left all 17 guards green, and it is reachable: these Host values
 * arrive at the middleware from a real client and are refused only by that
 * branch.
 */
describe('middleware — an unparseable Host is refused', () => {
  for (const host of ['127.0.0.1:abc', '[::1', 'a[b]c:3000']) {
    it(`refuses a Host that does not parse: ${host}`, () => {
      expect(middleware(req('GET', { host })).status).toBe(403)
    })
  }
})

