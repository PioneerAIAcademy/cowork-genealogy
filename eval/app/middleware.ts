import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Reject state-changing requests that did not come from this app's own pages.
 *
 * This app has no authentication and no session by design — it is a local
 * annotation tool. That is defensible only while every request provably
 * originates from the operator's own browser tab. Nothing enforced that: there
 * was no middleware here at all, and no route checked `Origin`.
 *
 * Why an `Origin` check specifically, and not a token. `req.json()` parses a
 * body regardless of its `Content-Type`, so a cross-site `text/plain` POST is a
 * CORS-*simple* request: no preflight is sent, the browser delivers it, and the
 * attacker never needs to read the response to have caused the write. A CSRF
 * token would also work but needs state this app deliberately does not keep;
 * `Origin` is sent by every browser on exactly the requests that matter and
 * cannot be forged by page script.
 *
 * The two halves apply to different surfaces, and the difference matters. The
 * `Origin` comparison covers state-changing methods only: a same-origin `GET` is
 * how the app's own pages load, and a `<script>`/`<img>` cross-site GET carries
 * no `Origin` at all, so comparing it would either break the app or pass anyway.
 * The loopback pin has no such limit — it needs no `Origin`, and the operator's
 * own requests always satisfy it — so it runs on EVERY method. Scoping it to
 * writes, as this originally did, closed rebinding for writes and left every
 * read open: a rebound page could `GET /api/runlogs` and read the whole
 * annotation corpus. Reported and reproduced in review (#1999).
 *
 * The other half of this control is the loopback binding in `package.json`.
 * `Origin` reasoning only covers a browser; binding is what keeps the app off
 * the LAN, where a request can be sent by anything. Neither is sufficient alone.
 */

// `Origin` and `Host` are attacker-controlled TOGETHER, so comparing them to
// each other proves nothing on its own. A page served from evil.example:3000
// whose DNS is rebound to 127.0.0.1 sends `Origin: http://evil.example:3000`
// and `Host: evil.example:3000`: they match, so the comparison passes and the
// request reaches the route handler. Reproduced on this branch before the fix —
// a matched attacker pair returned 200. Pinning the host to loopback is what
// makes the comparison mean something, and it is why the dev-server ecosystem
// ships host allowlists rather than an origin-equals-host test.
function isLoopbackHost(hostHeader: string): boolean {
  // A Host header is `uri-host [":" port]` (RFC 7230) — it has no userinfo. But
  // this parses it as a URL authority, so `evil.com@127.0.0.1:3000` would be
  // read as userinfo plus a loopback host and allowed. No browser can produce
  // that (userinfo is stripped before the Host is sent), so this is closing an
  // ambiguity in the parse rather than a reachable attack — but the parse should
  // not accept a shape the grammar forbids.
  if (hostHeader.includes('@')) return false
  let hostname: string
  try {
    hostname = new URL(`http://${hostHeader}`).hostname
  } catch {
    return false
  }
  // `[::1]` is defensive only: the server binds IPv4 loopback, so nothing
  // reaches it over IPv6 today.
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function middleware(request: NextRequest): NextResponse {
  // Before the method gate, deliberately. This is the half that does not need
  // `Origin`, so there is no reason to spend it only on writes — and a read is
  // exactly what a rebound page wants. Every legitimate request already carries
  // a loopback `Host`, which is the same set of spellings the write path below
  // accepts, so nothing the app does can fail here.
  const host = request.headers.get('host')
  if (host === null || !isLoopbackHost(host)) {
    return NextResponse.json({ error: 'Request Host is not loopback' }, { status: 403 })
  }

  if (!STATE_CHANGING.has(request.method)) return NextResponse.next()

  const origin = request.headers.get('origin')

  // A same-origin non-GET from a browser always carries `Origin`. Its absence
  // means a non-browser client — curl, another local process, a LAN host — so
  // it is refused rather than waved through: "no Origin" is the easiest header
  // state for an attacker to produce, and treating it as trusted would leave
  // the whole check decorative.
  if (origin === null) {
    return NextResponse.json(
      { error: 'Origin header required for state-changing requests' },
      { status: 403 },
    )
  }

  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return NextResponse.json({ error: 'Malformed Origin' }, { status: 403 })
  }

  // Compared against the Host this request actually arrived on, not a compiled-in
  // constant: the app is reached as both 127.0.0.1:3000 and localhost:3000, and
  // pinning one would reject the operator's own tab on the other. `host` is
  // already known non-null and loopback by the gate at the top.
  if (originHost !== host) {
    return NextResponse.json(
      { error: 'Cross-origin state-changing request refused' },
      { status: 403 },
    )
  }

  return NextResponse.next()
}

export const config = {
  // Every API route, and nothing else — this does not run on page routes at
  // all, so nothing here covers them. Verified: POST /results with
  // Host: evil.example returns 200. That is safe only because every page is a
  // client component that fetches its data from /api, and no Server Action or
  // page-route handler exists. All three are pinned by wiring.test.ts, not by
  // this matcher.
  matcher: '/api/:path*',
}
