# Path-prefix proof rig (U28)

The FamilySearch edge serves a service under an Alias or Service Group binding at
`https://<host>/service/search/agent-tools/<name>/…` and forwards it to the origin with
the prefix stripped, plus `X-Orig-Base`, `X-Orig-Host`, `X-Orig-Proto: https` and
`X-Orig-Port: 443`. A stream silent for ~45 s is cut. `nginx.conf` reproduces that in
front of the compose web tier on `127.0.0.1:8090`; `../docker-compose.prefix.yml` adds it
and points web's `PUBLIC_URL` at the prefix.

    make proto-grant           # once per stack
    make proto-prefix-check    # billed: one one-line turn

`check.mjs` drives the real SPA in Chromium: it loads the prefix with and without its
trailing slash, asks for two API paths with a trailing slash and fails unless each
redirect stays under the prefix on the edge's origin, signs in through dev-login, opens a
session, sends one message, waits for the reply, then holds the stream idle for 70 s. It
fails on any same-origin request outside the prefix, any response >= 400, a stream that
dropped or reconnected during the hold, or a `wb_session` cookie not scoped to the prefix.

The recipe recreates the edge once web is healthy, because nginx resolves `web` only at
start, and removes it when the check ends.

Unprefixed, against a fresh `make proto-up` (which recreates web without the override):

    BASE=http://127.0.0.1:8085 node apps/server/proto/prefix/check.mjs

`nginx.conf` copies what FamilySearch's edge was measured to do (handoff U28, 2026-10-31):
it answers the bare prefix itself with a 301 to `<prefix>/`, passes the public `Host`, and
leaves the origin's `Location` headers unrewritten, so a redirect that escapes the prefix
shows here as it would there.

Not covered: the FamilySearch sign-in round-trip, whose dev-key redirect is fixed at
`http://127.0.0.1:1837/callback`.
