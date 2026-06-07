# Web OAuth — Google login + FamilySearch per-project, local testing

**Date:** 2026-06-06. **Branch:** `hosted-web-workbench`. **Status:** plan, ready
to implement. **Touches:** `apps/server/app/{auth,familysearch,config,main}.py`,
a new top-level `/callback` route, `apps/web/src/{components/SessionView.tsx}`,
`apps/web/vite.config.ts`, `apps/server/.env`, `Makefile`.

This supersedes the first OAuth draft. Every `file:line` claim below was verified
against the actual code (see "Verified against code"); the corrections from that
review are folded in and marked **[FIX]**. The hard constraints (reuse the
desktop FamilySearch redirect registration; run on `127.0.0.1:1837`) are
unchanged and correct.

---

## Context

The control plane (`apps/server/`, FastAPI) ships two-layer auth, both currently
501 stubs:

- **App login** — Google OIDC + Gmail allowlist (`auth.py:137-145`).
- **Per-project data** — FamilySearch per-user OAuth, token written into the
  sandbox (`familysearch.py:82-97`).

**Goal:** make both real for local testing now. The binding constraint: we
cannot register a new FamilySearch redirect URI. The only one registered is the
desktop MCP server's `http://127.0.0.1:1837/callback` (`packages/engine/mcp-server/src/auth/config.ts:12-17`,
scope `offline_access`, **public client + PKCE, no secret**). So the web server's
FamilySearch flow must reuse that exact callback — which forces the local web
server to run on `127.0.0.1:1837`. Google is unconstrained and rides along on the
same host:port (different path).

Two facts that shape everything (both **verified**):

1. **Each provider matches the full redirect URI under its own client_id.**
   Sharing host:port doesn't make FamilySearch "free": to reuse its registration
   the web server must serve the callback at exactly `/callback` (not
   `/familysearch/callback`) and present the **desktop's FS `clientId`** — the
   one that owns that registration, and the same id the in-sandbox MCP refreshes
   with (`refresh.ts:55,70` → `getClientId()`).
2. **The session cookie is host-only.** `set_session_cookie` (`auth.py:33-39`)
   sets no `domain`, so the cookie is scoped to the exact host that issued it.
   `localhost` and `127.0.0.1` are **distinct cookie hosts and distinct CORS
   origins**, so the browser must use **one** host everywhere. `samesite=lax`
   (secondary) is what lets the cookie ride the top-level OAuth-callback
   navigation. `secure` is *derived* from the `public_url` scheme
   (`auth.py:35`), so over local `http://127.0.0.1` the cookie is sent (not
   `secure`). This all holds **only while `public_url` is http** — see §"Hosted".

> ⚠ **Local-only shortcut.** Hosted deploy will need fresh https redirects for
> both providers (`https://<host>/auth/google/callback`,
> `https://<host>/callback`) — the FamilySearch one needs a registration you
> can't add yet. This plan is the localhost path; it does not change the hosted
> story.

---

## Part A — Google Cloud Console (new project)

Create a dedicated project (not the existing "Gemini API" one).

1. **New project** — picker → New Project → e.g. `cowork-genealogy` → Create →
   select it.
2. **OAuth consent / Branding** — Get started:
   - User type **External** (a personal `@gmail.com` has no Workspace org).
   - App name, support email, developer contact. Save.
   - Leave publishing status **Testing** — no verification needed for an alpha,
     and we don't rely on Google refresh tokens (we mint our own 30-day session
     cookie via `itsdangerous`, `auth.py:29-30`), so the 7-day test-token expiry
     is irrelevant.
3. **Audience → Test users** — add every allowlisted Gmail (today
   `dallan@gmail.com`; must match `ALLOWED_EMAILS`). Only listed users can sign
   in while Testing.
4. **Data Access → Add scopes** — `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile` (all non-sensitive).
5. **Clients → Create client** — Application type **Web application**:
   - Authorized redirect URI: `http://127.0.0.1:1837/auth/google/callback`
     (Google allows http for loopback `127.0.0.1`). Exact match.
   - Authorized JavaScript origins: leave empty (server-side flow).
   - Create → copy **Client ID** and **Client secret** (Google is a confidential
     client; both are required — see [FIX] in C1).

You can add more redirect URIs here anytime (Google is unconstrained) — e.g. the
Fly host later.

---

## Part B — Local run topology

| Piece | Where | Note |
|---|---|---|
| FastAPI control plane | `http://127.0.0.1:1837` | `PUBLIC_URL` = this |
| Vite web client | `http://127.0.0.1:5173` | open the app **here**, not `localhost` |
| Google callback | `127.0.0.1:1837/auth/google/callback` | direct to API |
| FamilySearch callback | `127.0.0.1:1837/callback` | reuses the desktop registration |
| FamilySearch `clientId` | read from `packages/engine/mcp-server/config/familysearch.json` | same id ⇒ in-sandbox refresh works |

**Don't run a desktop FamilySearch login while the web server holds 1837** (port
collision with the MCP's ephemeral callback listener).

---

## Part C — Code wiring

### C1. Google OIDC — `auth.py` + `main.py`

- **`main.py`:** add `SessionMiddleware(secret_key=settings.session_secret)`
  (Starlette) before the routers — Authlib stores OAuth state/nonce there.
  **Verified absent** (`main.py:70-76` has only CORS; nothing uses
  `request.session`). **Authlib is already a dependency** (`pyproject.toml:15`,
  authlib 1.7.2) — no add needed.
- **`auth.py`:** build the Authlib registry once:
  ```python
  from authlib.integrations.starlette_client import OAuth
  oauth = OAuth()
  oauth.register(
      "google",
      server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
      client_id=settings.google_client_id, client_secret=settings.google_client_secret,
      client_kwargs={"scope": "openid email profile"},
  )
  ```
  - Replace the `/auth/google/login` stub (`auth.py:137-145`) — make it
    `async def`, take `request: Request`, and
    `return await oauth.google.authorize_redirect(request, f"{settings.public_url}/auth/google/callback")`.
  - **[FIX] Guard on BOTH `google_client_id` AND `google_client_secret`.** The
    current stub guards only on the id (`auth.py:140`); Authlib's token exchange
    needs the secret, so a missing secret fails at runtime with an opaque error.
  - Add `GET /auth/google/callback`:
    ```python
    token = await oauth.google.authorize_access_token(request)
    info = token["userinfo"]
    if not info.get("email_verified") or not _is_allowed(session, info["email"]):
        return <403 page>                       # require a VERIFIED email AND the allowlist
    user = _upsert_user(session, info["email"], google_sub=info["sub"])
    resp = RedirectResponse(settings.web_origin)   # Google login is full-page → land on the SPA
    set_session_cookie(resp, user.id)              # mutate THIS response, then return it
    return resp
    ```

  **[FIX] — the #1 footgun, NEW callbacks only.** `set_session_cookie` mutates the
  response you pass and returns `None` (`auth.py:33-39`). `dev_login`
  (`auth.py:117-127`) is **not** buggy — it returns a JSON model and sets the
  cookie on FastAPI's injected `response: Response`, which *is* the response sent.
  The trap is only in a redirect handler: it must **construct the
  `RedirectResponse` first, pass it to `set_session_cookie`, and return that same
  object** — do not copy dev_login's injected-`response` pattern into a redirect,
  or the cookie lands on a response that's never sent. Applies to both new
  callbacks (Google here; the FS popup page in C2).

  Reuse as-is: `_is_allowed`, `_upsert_user(…, google_sub=…)`,
  `set_session_cookie` (all **verified** at `auth.py:33-63`). `/auth/config`
  already flips to Google-only once `google_client_id` is set (`auth.py:109-113`)
  — no change. Allowlist seeds from `ALLOWED_EMAILS` on boot (`db.py:18-26`).
  Implementer notes: the `<403 page>` is an `HTMLResponse(…, status_code=403)`;
  import `RedirectResponse`/`HTMLResponse` from `fastapi.responses`.

### C2. FamilySearch — `familysearch.py` + a top-level `/callback`

**[FIX] Source the FS `clientId` from the bundled file, not a new env var.**
CLAUDE.md (`:196-233`) states the bundled `packages/engine/mcp-server/config/familysearch.json`
is the **sole** source of the FS client id ("no env-var fallback"). Introducing
`FAMILYSEARCH_CLIENT_ID` would create a second copy that drifts on rotation. The
web server can't import the TS `getClientId()`, but it **can read the same JSON
file** (committed to git; `REPO_ROOT` is computed at `config.py:15`). Add a
property:
```python
# config.py
@property
def familysearch_client_id(self) -> str | None:
    p = REPO_ROOT / "mcp-server" / "config" / "familysearch.json"
    try:
        return json.loads(p.read_text())["clientId"]   # field is "clientId" (verified)
    except (OSError, KeyError, json.JSONDecodeError):
        return None
```
No FS **client secret** is needed: the FS app is a **public PKCE client** (the
desktop MCP uses it with no secret — `refresh.ts:71-75` sends only `client_id`).
Reusing the same registration means the web flow is also public+PKCE.

**[FIX] `familysearch_configured` should require the client id is present**, not
just the flag. Today it aliases `familysearch_web_enabled` (`config.py:84-85`):
```python
@property
def familysearch_configured(self) -> bool:
    return self.familysearch_web_enabled and bool(self.familysearch_client_id)
```

- **`/familysearch/status`: add a `real` field.** The frontend gates the connect
  button on it (§C3). `StatusOut` + `status()` (`familysearch.py:34-56`) return
  only `{connected, mock}`; add `real: <familysearch_configured>` so the SPA shows
  the real connect (popup) button vs dev-connect.

- **`/familysearch/login?sessionId=…`** (`familysearch.py:82-97`): **[FIX] add the
  same `Depends` injections status/dev-connect use** (`get_current_user`,
  `get_session`) and `_owned(session, user, sessionId)` (`sessions.py:71`) — the
  current stub is a bare `def login(sessionId)` that can't resolve the user.
  Then: generate PKCE (verifier + S256 challenge) + a random `state` nonce.
  Build the FS authorize URL
  (`https://ident.familysearch.org/cis-web/oauth2/v3/authorization`, **verified
  match** at `config.ts:7-10`) with `client_id=familysearch_client_id`,
  `redirect_uri=f"{public_url}/callback"`, `response_type=code`,
  `scope=offline_access`, `state`, `code_challenge`,
  `code_challenge_method=S256`. Return a `RedirectResponse` (browser navigation).

  **[FIX] PKCE verifier storage — use a signed short-lived cookie, not an
  in-process dict.** An in-memory store loses the verifier on `--reload` mid-login
  and breaks across >1 process. Reuse the `itsdangerous` serializer (distinct
  salt, e.g. `"fs-oauth"`, short max_age ~10 min) to sign `{sessionId, verifier,
  state}` into a cookie set on the `/login` response. `samesite=lax` lets it ride
  the top-level callback navigation.

- **New top-level `GET /callback`** (its own no-prefix router included in
  `main.py`; the registered path is `/callback`, **not** `/familysearch/callback`):
  read `code`+`state`; read+verify the signed `fs-oauth` cookie; check `state`
  matches (CSRF); recover `sessionId`+`verifier`; resolve the current user from
  the session cookie; `_owned` check (wire the standard
  `Depends(get_current_user / get_session / get_provider)` and use an
  `httpx.AsyncClient` for the token POST). POST to the FS token URL
  (`https://ident.familysearch.org/cis-web/oauth2/v3/token`, **verified match**)
  with `grant_type=authorization_code, code, client_id, code_verifier,
  redirect_uri`. **[FIX] headers: only `Content-Type:
  application/x-www-form-urlencoded` + `Accept: application/json` — no browser
  User-Agent.** The FS `ident` token endpoint is **not** behind the Imperva UA
  gate: the desktop's `postTokenEndpoint` sends exactly those two headers
  (verified `refresh.ts:5-15`). `httpx` sets `Content-Type` from `data=`, so just
  add `Accept`; do **not** import `BROWSER_USER_AGENT` here. **[FIX] map FS's snake_case response to the engine's camelCase /
  ms-epoch shape exactly** (the engine **rejects** any other shape →
  `tokenManager.ts:9-24`, `types/auth.ts:1-5`):
  ```python
  tok_resp = await client.post(TOKEN_URL, data={...})    # the FS code→token exchange
  if tok_resp.status_code != 200:               # surface FS errors as a page, don't write a bad token
      return HTMLResponse("FamilySearch authorization failed — close this window and retry.", status_code=502)
  r = tok_resp.json()   # {access_token, refresh_token, expires_in (seconds)}
  token = {
      "accessToken": r["access_token"],
      "refreshToken": r.get("refresh_token"),       # offline_access returns one; .get avoids a 500 if absent
      "expiresAt": int((time.time() + r.get("expires_in", 3600)) * 1000),  # epoch ms, absolute
  }   # NO "mock" key → /status reports mock=false (familysearch.py:50-53)
  sandbox = await provider.resume(project.sandbox_id)   # resume (not get) so a paused sandbox is writable
  await sandbox.write_file(TOKENS_PATH, json.dumps(token, indent=2).encode())
  # Popup flow (§C3): close the popup + nudge the opener to re-poll status.
  out = HTMLResponse(
      "<!doctype html><script>try{window.opener&&window.opener.postMessage('fs-connected','*')}"
      "catch(e){}window.close()</script>FamilySearch connected — you can close this window."
  )
  out.delete_cookie("fs-oauth", path="/")
  return out
  ```
  `TOKENS_PATH = /home/user/.familysearch-mcp/tokens.json` (**verified**
  `familysearch.py:31` + `HOME_DIR`). `refresh_token` should be present
  (`offline_access`); `.get` only avoids a 500 if FS omits it — without it the
  in-sandbox refresh can't run (`refresh.ts:90`), so treat its absence as a soft
  failure to surface, not a crash. Writing `expires_in` instead of an absolute ms
  `expiresAt` would make `isExpired()` instantly true.

**[FIX] Sequence the flag flip.** `familysearch_configured` gates BOTH paths:
flipping `FAMILYSEARCH_WEB_ENABLED=true` **disables `dev_connect`**
(`familysearch.py:68`) and makes `/login` the only path. Land `/login` + `/callback`
**before** enabling the flag, or you get a 501 with no working fallback.

### C3. Frontend — `apps/web/src/components/SessionView.tsx` + `vite.config.ts`

- **[FIX] Use a popup, NOT a full-page redirect.** The Connect-FamilySearch
  button calls `api.fsDevConnect` and updates state in place
  (`SessionView.tsx:52-55`). Do **not** switch it to `window.location.href` —
  `App.tsx` has **no router**: it selects the open session purely from `useState`
  (`open`), with zero `URLSearchParams`/`window.location` parsing (**verified**,
  `App.tsx:9,17-27`). A full navigation resets `open` to `null` on reload, any
  `?session=` is read by nothing, the user lands on the **session list**, and the
  live viewer/chat WS + agent (`SessionView.tsx:36-49`) are destroyed. Instead,
  open a popup:
  ```ts
  const w = window.open('/familysearch/login?sessionId=' + sessionId, 'fs', 'width=600,height=800')
  ```
  The OAuth round-trip runs **in the popup**; the SPA, its WS, and the agent stay
  alive (exactly the "don't disrupt the running session" property we want). The
  opener refreshes `fsConnected` by re-polling `/familysearch/status` on
  `window.message` (posted by the `/callback` page, §C2) — **verify
  `event.origin === 'http://127.0.0.1:1837'` (the API origin) and
  `event.data === 'fs-connected'` before trusting it** — and/or on popup close
  (`w.closed` poll). Gate the real button on a `fsReal`
  flag from `/familysearch/status` (derive from `settings.familysearch_configured`);
  keep dev-connect when off.
- **Fallback only if you reject popups:** add real `?session=` routing to
  `App.tsx` (parse the param on load, seed `open`) as an explicit prerequisite,
  and have `/callback` `RedirectResponse` to `/?session=<id>`. The popup avoids
  this entirely and is recommended. **Google login is unaffected** — it's from the
  login screen, so a full-page callback landing on `/` → session list is correct.
- **[FIX] `vite.config.ts`:** the proxy is **hardcoded** to `http://localhost:8000`
  for `/api`,`/auth`,`/familysearch`,`/ws` (`vite.config.ts:12-15`). Make the
  target env-driven so the mock flow is untouched:
  `const API = process.env.VITE_API_TARGET ?? 'http://localhost:8000'`. Also
  **add `changeOrigin: true` to the `/familysearch` entry** (it's a bare string
  today, unlike `/api`) for the OAuth redirect/Host-header flow. Note the WS key
  is **`ws: true`** (not `websocket: true`). For OAuth testing run with
  `VITE_API_TARGET=http://127.0.0.1:1837` and open `http://127.0.0.1:5173`.

### C4. Cookie correctness (two small fixes)

**[FIX] Make `secure` explicit config, not derived.** Today
`set_session_cookie` computes `secure = public_url.startswith("https")`
(`auth.py:35`). That's a latent hosted footgun: an `https` `PUBLIC_URL` served
over plain http (TLS terminated upstream — a tunnel/load balancer) would set
`secure=True` and the browser would silently drop the cookie. Add an explicit
override:
```python
# config.py
session_cookie_secure: bool | None = None   # None → derive from public_url scheme; True/False → force
```
and in `set_session_cookie`:
```python
s = get_settings()
secure = s.session_cookie_secure if s.session_cookie_secure is not None else s.public_url.startswith("https")
```
Default (`None`) preserves today's behavior, so local http still works with no
env. Hosted sets `SESSION_COOKIE_SECURE=true` explicitly.

**[FIX] Symmetric delete.** `clear_session_cookie` (`auth.py:43`) deletes with
only `path="/"`. Mirror the set attributes (`samesite="lax"`, same `secure`) on
delete, or strict browsers may not clear it on logout.

---

## Part D — Env + run target

`apps/server/.env` (read by pydantic `env_file=".env"`, **relative to
`apps/server`** since both `make` and `run-dev.sh` launch uvicorn there):

```
PUBLIC_URL=http://127.0.0.1:1837          # [FIX] override the http://localhost:8000 default
WEB_ORIGIN=http://127.0.0.1:5173          # [FIX] override the http://localhost:5173 default (CORS allows ONE origin)
ALLOWED_EMAILS=dallan@gmail.com
GOOGLE_CLIENT_ID=<from Part A>
GOOGLE_CLIENT_SECRET=<from Part A>        # required (Google is confidential)
FAMILYSEARCH_WEB_ENABLED=true
SESSION_SECRET=<a strong stable dev secret>   # [FIX] do NOT leave the insecure default; signs both the session AND Authlib state
```

No `FAMILYSEARCH_CLIENT_ID` — it's read from `packages/engine/mcp-server/config/familysearch.json`
(§C2). Override both `PUBLIC_URL` and `WEB_ORIGIN` off their `localhost` defaults
(`config.py:61,74`) — but **not** for CORS reasons. Through the Vite proxy every
XHR/WS is same-origin (`127.0.0.1:5173`), so `allow_origins=[web_origin]`
(`main.py:70-76`) is never exercised locally (likewise in prod single-origin
serving). The real reasons: **(a)** `PUBLIC_URL` builds the OAuth `redirect_uri`s,
which must be `127.0.0.1:1837` to match the registrations; **(b)** `WEB_ORIGIN` is
the **post-login redirect target** for the Google callback, so it must point at
the Vite app. Use `127.0.0.1` (not `localhost`) everywhere so the session
cookie's **host** matches — cookies are host-scoped but **port-agnostic** (RFC
6265), so the `:1837` callback and the `:5173` SPA share the cookie as long as the
host is identical.

`Makefile`:
```make
server-oauth: ## Control plane with REAL Google+FS OAuth on 127.0.0.1:1837
	cd apps/server && AGENT_MODE=mock uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 1837
```
Run web with `VITE_API_TARGET=http://127.0.0.1:1837 pnpm --filter web dev` (or a
paired `web-oauth` target).

---

## Token lifecycle & refresh-token rotation

**The stated requirement — no re-login on a mid-session browser refresh — is
already met by the current "token in the sandbox" design (option a). No
token-broker work is needed for the POC.** Why, precisely:

- The FS token lives in the **sandbox** at `~/.familysearch-mcp/tokens.json`, not
  in the browser. A browser refresh reloads the SPA and reconnects the WS; it
  **does not touch the sandbox**. On WS disconnect the control plane disposes the
  *agent process + watch* (`live_session.py` `dispose`), but **never deletes the
  sandbox** — deletion happens only on explicit `DELETE /api/sessions/{id}`. So
  the token file survives a refresh; on reconnect the sandbox is resumed and the
  file is intact.
- While the access token is valid (~hours) the agent just uses it. When it
  expires mid-session, the **in-sandbox MCP self-refreshes** (`getValidToken()`
  → `refresh.ts`) using the refresh token in the file and writes the rotated
  token back to the same file — transparent to the browser. This works while the
  FamilySearch token is alive. **FamilySearch token lifetime (confirmed with an
  FS contact, not in the engine code):** a token expires after **a few hours of
  inactivity**, with a hard **24-hour** cap that forces re-login regardless. So an
  actively-used session keeps refreshing fine up to 24h; a few hours idle expires
  it.
- **New session** (fresh sandbox, no token), **a few hours idle**, or **past the
  24-hour cap** all require re-connecting FamilySearch — which you've said is
  acceptable.

So the rotation concern doesn't break the browser-refresh case, and — because the
E2B instance is **durable per-session storage** — it doesn't really bite within
the requirement at all.

### Why the token belongs in the E2B instance (option a is the design, not a stopgap)

**Session ↔ E2B instance is 1:1, and the E2B instance is durable per-session
storage.** Login selects a session and unhibernates its E2B; logout/idle
hibernates it; it persists across logins with the project files (and the FS
token) intact. **E2B supports indefinite pause/resume** — paused sandboxes are
retained indefinitely and resume on demand (E2B platform guarantee), so this
durability holds for the hosted product, not just the LocalProvider POC (where
it's trivially true — a local dir). This is the *opposite* of the desktop
Cowork model (where the plugin VM is ephemeral, per CLAUDE.md) — that assumption
must not carry over here. So the FS token in `~/.familysearch-mcp/tokens.json` is
**exactly as durable as the rest of the session's state** (if a sandbox ever were
lost you'd lose the project files too, not just the token — so the token is no
more at risk than everything else), and it lives **next to its only consumer**
(the in-sandbox MCP). That is the right resource. Walking the cases:

- **Browser refresh / reconnect:** E2B untouched (resumed) → token intact → no
  re-login. ✅
- **Hibernate → resume soon (within the inactivity window, under 24h):** the
  access token may have expired during the pause; on the next tool call the
  in-sandbox MCP refreshes with the still-valid refresh token and writes it back
  to the durable E2B file. ✅ No re-login. (A long hibernation past the
  inactivity/24h window → reconnect.)
- **New session / a few hours idle / past 24h:** a different E2B (or an expired
  token) → reconnect FamilySearch via the web flow. ✅ Accepted.

**The control-plane "token broker" is over-engineering for this architecture.**
Under the durable, per-session E2B model its premises don't hold: the credential
isn't stranded in a disposable VM; there's no "N copies per user" rotation race
because FS auth is **per-session** (one token per E2B, not one shared across
sessions); refresh-on-resume covers the hibernated case; and the ">1 day →
re-auth" path is the same web reconnect either way. Keeping the token in the
user's own isolated microVM, beside the only thing that reads it, is also a
**better security posture** than pooling every user's refresh token in one
central DB (smaller blast radius). Simpler *and* safer.

**One thing to confirm with your FS contact (concurrency).** Per-session auth
issues an **independent token pair per session**, which assumes FamilySearch
permits **multiple concurrent tokens per user + `client_id`**. If FS instead caps
or rotates active tokens per user, opening session B could silently invalidate
session A's token. Verify before relying on multiple concurrent sessions for one
FS account; if FS does cap, that's the one scenario that would push toward a
per-user token (the §"one thing that would change this" path).

### The one thing that would change this

Only a **product** decision moves the token out of E2B: wanting FamilySearch
connected **once per user and reused across all their sessions** (so opening a
*new* project doesn't re-prompt). The stated requirement explicitly doesn't need
that. If it's wanted later, the minimal add is a **per-user token row in the
control-plane DB** (the unused `FamilySearchToken` table) used *only* to
**pre-provision a new session's E2B** from the user's existing FS connection — not
a full broker (no central refresher, no engine "externally-managed" mode, no
per-expiry push). The in-sandbox MCP still self-refreshes inside its durable E2B
exactly as today. That adds cross-session reuse without giving up the simple
model.

**Recommendation: ship option (a) as the design** — no DB table, no engine
change, no refresh/push routine. The durable E2B instance is the correct home for
a per-session credential.

---

## Verification

1. `make server-oauth` (terminal 1) + `VITE_API_TARGET=http://127.0.0.1:1837 pnpm
   --filter web dev` (terminal 2). Open `http://127.0.0.1:5173`.
2. Login screen shows only the Google button (dev-login auto-disabled once
   `GOOGLE_CLIENT_ID` is set). Click → Google consent (as a test user) →
   redirected back **signed in** (`/auth/me` returns your user). A
   non-allowlisted Google account is rejected at the callback with a 403.
3. Open a session → Connect FamilySearch → FS consent → back to the **same
   session** → `/familysearch/status` returns `connected:true, mock:false`.
4. **Browser refresh mid-session** → still connected, no re-login (the sandbox +
   token file persist). Confirm the sandbox token at
   `.workbench-data/sandboxes/…/home/user/.familysearch-mcp/tokens.json` parses
   as `{accessToken, refreshToken, expiresAt}` with `expiresAt` an epoch-ms in
   the future.
5. **End-to-end token check needs the real agent.** Steps 1-4 run under the
   `server-oauth` target (`AGENT_MODE=mock`) — that exercises the OAuth
   round-trips, `/status`, and the written token file, but the mock agent makes
   no FamilySearch API calls. To prove the injected token actually authenticates
   (and that the in-sandbox refresh works when the access token expires, using
   the same bundled `clientId`), run with `AGENT_MODE=real` (+ `ANTHROPIC_API_KEY`
   and the built engine) and issue a person/record search in the session.
6. `make server-test` — green (mock default; OAuth paths are off without the
   env).

## Out of scope / caveats

- **Hosted https** redirects for both providers; the FS one needs a registration
  you can't add yet (external blocker, not code). The cookie-`secure`-over-http
  footgun is now handled by the explicit `SESSION_COOKIE_SECURE` setting (§C4),
  so it's no longer silent. One more **hosted-only** hardening step: set Starlette
  `SessionMiddleware(https_only=True)` under https. (The popup `event.origin`
  check is in §C3 as an always-do, not hosted-only.)
- **Cross-session FS reuse** (connect once per user, reused across sessions) —
  not built; the token lives per-session in the durable E2B instance, which is
  the right resource (see §Token lifecycle). If wanted later, add a per-user
  `FamilySearchToken` DB row to pre-provision new sessions. A full control-plane
  token-broker is **not** recommended for this architecture.
- **Internal dev key** (`fs-internal-dev-key-000262`) issuing tokens to many web
  users may hit FamilySearch terms/rate limits — a provisioning question for the
  real product (it's proven valid against `ident` because the desktop app ships
  it).
- **WebSocket auth** uses the same host-only cookie (`decode_session_token`,
  `auth.py:66-75`; CORS doesn't apply to WS upgrades), so `127.0.0.1`-everywhere
  is also what makes the chat/viewer socket authenticate — not just XHR CORS.
- **Adjacent cleanup (not OAuth, noticed while verifying):** the Agent-SDK resume
  id has *two* homes — a `Project.agent_session_id` DB column (`models.py:46`,
  currently unused) and the `/project/.agent_session` file the real agent writes
  (`real_agent.py`). Pick one. The file is simpler and co-located in the durable
  sandbox FS; recommend dropping the unused DB column (or switching the agent to
  it) so there's a single source.
- Don't run a desktop FamilySearch login while the web server owns `1837`.

---

## Verified against code (so the reviewer can trust the references)

All confirmed by reading the files (`auth.py`, `familysearch.py`, `main.py`,
`config.py`, `db.py`, `vite.config.ts`, `SessionView.tsx`, `LoginScreen.tsx`,
`packages/engine/mcp-server/src/auth/{config,tokenManager,refresh}.ts`,
`packages/engine/mcp-server/config/familysearch.json`, `CLAUDE.md`):

- Stubs at `auth.py:137-145` and `familysearch.py:82-97`; helpers at
  `auth.py:33-63` (`_upsert_user` accepts `google_sub`); `/auth/config` at
  `auth.py:109-113`; `SessionMiddleware` absent.
- FS host/scope/redirect **match** the plan: `ident.familysearch.org/cis-web/oauth2/v3/{authorization,token}`,
  `offline_access`, `http://127.0.0.1:1837/callback`, public+PKCE
  (`config.ts:7-17`, `refresh.ts:55,70-75`). Token POST sends only
  `application/x-www-form-urlencoded` + `Accept: application/json`, no browser UA
  (`refresh.ts:5-15`).
- Engine token contract: camelCase `{accessToken, refreshToken, expiresAt}`,
  epoch **ms**, at `/home/user/.familysearch-mcp/tokens.json`; non-conforming
  files are rejected (`types/auth.ts:1-5`, `tokenManager.ts:9-24`, `config.ts:22`).
- `clientId` is the field name in `packages/engine/mcp-server/config/familysearch.json`; CLAUDE.md
  SOLE-source rule at `:196-233`.
- Cookie host-only + `samesite=lax` + derived `secure` (`auth.py:33-39`); CORS
  single-origin + credentials (`main.py:70-76`); defaults are `localhost`
  (`config.py:61,74`). Deps present: authlib 1.7.2, itsdangerous, httpx
  (`pyproject.toml`).
- Vite proxy hardcoded to `localhost:8000`, `/ws` uses `ws: true`
  (`vite.config.ts:12-15`); connect button is in-place `fetch`
  (`SessionView.tsx:52-55`).
- **No client router:** `App.tsx:9,17-27` selects the open session from
  `useState` only — no `URLSearchParams`/`window.location` parsing anywhere. This
  is why FS connect must be a popup (§C3), not a full-page redirect.
