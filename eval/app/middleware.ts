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
 * GET is deliberately not covered: a same-origin `GET` is also how the app's
 * own pages load, and a `<script>`/`<img>` cross-site GET carries no `Origin`
 * at all — so a check here would either break the app or pass anyway. Read
 * routes are contained at the filesystem sink instead, ad hoc per sink today;
 * PR #2000 consolidates that into `lib/fs/safe-path.ts`.
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
  // pinning one would reject the operator's own tab on the other.
  const host = request.headers.get('host')
  if (host === null || originHost !== host || !isLoopbackHost(host)) {
    return NextResponse.json(
      { error: 'Cross-origin state-changing request refused' },
      { status: 403 },
    )
  }

  return NextResponse.next()
}

export const config = {
  // Every API route. Page routes are GET and are covered by the method check
  // above anyway; scoping the matcher keeps this off static asset requests.
  matcher: '/api/:path*',
}
