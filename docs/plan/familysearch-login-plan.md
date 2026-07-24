# Unified FamilySearch login (replace Google OAuth)

**Status:** Proposal for review · 2026-06-07
**Related:** [`neon-postgres-plan.md`](./neon-postgres-plan.md),
[`hosted-web-workbench-spec.md`](./hosted-web-workbench-spec.md) §5.

## Context

The hosted web workbench currently has **two-layer auth**:

1. **App access** — Google OIDC + an email allowlist → signed session cookie
   (`apps/server/app/auth.py`). Google is optional; when unconfigured a
   dev-login (enter an allowlisted email) stands in for the POC.
2. **Data access** — per-session FamilySearch OAuth (PKCE), token written into
   the sandbox at `~/.familysearch-mcp/tokens.json`
   (`apps/server/app/familysearch.py`). Surfaced as a "Connect FamilySearch"
   button per session in `SessionView.tsx`.

Every user of a *genealogy* product already needs a FamilySearch account, so
gating the front door with Google is redundant and forces users to authenticate
FamilySearch a second time per session. The goal: **sign in with FamilySearch
once**; that one login both (a) gates app access via the allowlist and (b)
yields the data token injected into every sandbox the user creates. Google goes
away entirely, and so does the separate per-session connect step.

**This is feasible and is net subtraction.** A complete FS OAuth flow already
exists in the server (`familysearch.py`: PKCE, authorize redirect, token
exchange) and the `familysearch_tokens` DB table already exists to hold a
control-plane copy. We are repointing existing machinery at the front door, not
building OAuth from scratch. Estimated effort: **~1 day** plus testing — *after*
Spike 0 confirms the allowlist key.

## Spike 0 — does `/platform/users/current` return an email? (do this first)

**Why first:** the whole design keys the allowlist on email. The MCP code reads
only `users[0].personId` from this endpoint today (`person-ancestors.ts:114-142`,
`FSCurrentUserResponse`), so whether a usable **email** comes back for our client
id + token is a known unknown. The answer decides steps 2–3 below; resolve it
before writing any auth code. Timebox: ~30 min.

**How:** add a one-shot `packages/engine/mcp-server/dev/probe-users-current.ts` (following the
existing `dev/probe-*.ts` convention — these scripts document the live-API
evidence trail behind each spec). Reuse `getValidToken()` for the token (run a
desktop `login` first so `~/.familysearch-mcp/tokens.json` exists), then
`GET https://api.familysearch.org/platform/users/current` with
`Authorization: Bearer <token>`, `Accept: application/x-fs-v1+json`, and
`BROWSER_USER_AGENT` (Imperva 403s non-browser UAs). Dump the full `users[0]`
object and note which of `id`, `email`, `personId`, `displayName`,
`contactName` are present and populated. A bare `curl` with those three headers
works too if quicker.

**Decision gate:**

| Probe result | Allowlist key | Plan impact |
|---|---|---|
| `email` present & populated | **email** (as written) | Proceed with steps 2–3 unchanged. Keep onboarding-by-email. |
| `email` absent / empty / clearly unverifiable | **FS id** (`users[0].id` or `personId`) | Re-key the `allowed_emails` table → `allowed_familysearch_ids` (seeded from env), swap `_is_allowed` to match on FS id, and seed it with each tester's FS id. Worse onboarding (need the id up front), but no new flow. Re-estimate +half day. |

Record the captured `users[0]` shape in the probe script's header comment as the
evidence trail, then continue.

## Approach

One FS OAuth round-trip at login. On callback we exchange the code, fetch the
user's identity to check the allowlist, persist the token to the DB, and set the
session cookie. Every sandbox-create reads that DB token and injects it into the
sandbox — replacing the per-session connect.

### 1. New app-login FS route (`apps/server/app/auth.py`)

Add `GET /auth/familysearch/login`: generate PKCE + state, stash them in a
short-lived signed cookie, redirect to `FS_AUTHORIZE_URL` with
`scope=offline_access`, `redirect_uri = {public_url}/callback`. This mirrors the
existing `familysearch.py:113-151` flow but carries **no `sessionId`** (login
precedes any sandbox).

Reuse the FS constants/helpers from `familysearch.py` (`FS_AUTHORIZE_URL`,
`FS_TOKEN_URL`, `_pkce()`, the PKCE cookie pattern) — lift the shared pieces into
a small `app/fs_oauth.py` module rather than duplicating, since both the login
route and the token-injection path (step 4) need the token shape + paths.

### 2. Single `/callback` handler (merge, don't duplicate)

There is now exactly **one** FS callback. Repurpose the existing top-level
`/callback` (`familysearch.py:154-205`) to the app-login flow:

1. Validate state cookie, exchange `code` + verifier for tokens (existing code).
2. **Fetch identity** — `GET https://api.familysearch.org/platform/users/current`
   with `Authorization: Bearer <token>`, `Accept: application/x-fs-v1+json`, and
   the **browser User-Agent** (`api.familysearch.org` sits behind Imperva and
   403s non-browser UAs — see `packages/engine/mcp-server/src/constants.ts` `BROWSER_USER_AGENT`
   and `person-ancestors.ts:114-142`). Read `users[0].email` and
   `users[0].personId`.
3. **Allowlist check** — `_is_allowed(session, email)` against the existing
   `allowed_emails` table (unchanged; keeps onboarding by email).
4. `_upsert_user(session, email, familysearch_id=users[0].id)`.
5. **Persist token** to `familysearch_tokens` (user_id, access/refresh/expires).
6. `set_session_cookie(resp, user.id)` and redirect to `web_origin`. (Login is a
   full redirect, not a popup — there is no opener window to post back to.)

### 3. Model + config changes

- `apps/server/app/models.py` — `User.google_sub` → `familysearch_id` (FS user
  id). Fresh POC SQLite is a drop/recreate; Neon (prod) needs a one-line ALTER
  (see `neon-postgres-plan.md`).
- `apps/server/app/config.py` — remove `google_client_id`/`google_client_secret`;
  `familysearch_web_enabled` becomes the gate for *real* app login (off → mock
  dev path stays active). `familysearch_client_id` (bundled-file source) is
  unchanged.
- `/auth/config` returns `{ familysearch: <bool>, devLogin: <bool> }`.

### 4. Inject the token at sandbox create (`apps/server/app/sessions.py`)

In `create_session` (sessions.py:90-117), after `provider.create(...)`, read the
user's `familysearch_tokens` row and write it into the new sandbox at
`{HOME}/.familysearch-mcp/tokens.json` in the engine's shape
(`{accessToken, refreshToken, expiresAt}` — the builder already in
`familysearch.py:192-196`, now lifted to `fs_oauth.py`). Because login guarantees
a token, every sandbox gets it automatically — no per-session connect.

**Token freshness:** inject as-is. The in-sandbox MCP's `getValidToken()`
(`packages/engine/mcp-server/src/auth/refresh.ts:80-104`) refreshes via the refresh token on
first use, so a stale access token + valid refresh token is fine. No Python-side
refresh needed for the POC. (Resume already boots the sandbox; if a sandbox can
be created long before first use, optionally refresh-on-inject later.)

### 5. Remove the old surfaces

- `auth.py`: delete `_google()`, `/auth/google/login`, `/auth/google/callback`.
- `familysearch.py`: delete the per-session `/familysearch/login`,
  `/familysearch/dev-connect`, `/familysearch/status` routes (keep the OAuth
  helpers, relocated to `fs_oauth.py`).
- `apps/web/src/components/SessionView.tsx`: remove the "Connect FamilySearch"
  button + popup/status polling (`SessionView.tsx:59-97`).
- `apps/web/src/components/LoginScreen.tsx`: replace the Google `<a>` with
  `<a href="/auth/familysearch/login">Sign in with FamilySearch</a>`; gate on
  `config.familysearch`.
- `apps/web/src/api.ts`: drop `fsDevConnect`/`fsStatus`/`AuthConfig.google`; add
  `familysearch` to `AuthConfig`.

### 6. Offline/mock path (keep the POC runnable with no creds)

When `familysearch_web_enabled` is false, keep dev-login (enter allowlisted
email → upsert user). On create, inject a **mock** token row (the existing
`{"mock": true, ...}` shape) so the sandbox has a tokens file; the agent runs in
mock mode (`AGENT_MODE=mock`) and never calls real FS. Seed a mock
`familysearch_tokens` row for the dev user at login, or synthesize it at inject.

## Key risks / things to verify

- **Email availability** — resolved by **Spike 0** above (probe before coding).
  If email is absent/unverified, the allowlist re-keys to FS id per the spike's
  decision gate.
- **Imperva UA** — the userinfo call must send `BROWSER_USER_AGENT` or it 403s.
  (The token endpoint on `ident.familysearch.org` does not need it; the
  `api.familysearch.org` platform call does.)
- **Production redirect URI (pre-existing, not introduced here)** — real FS
  OAuth in prod needs a registered HTTPS redirect (`https://<host>/callback`)
  that we noted we can't register yet. This blocker already
  applied to data-access FS OAuth, so unifying does not add it — and it *removes*
  the Google Cloud project, client secret, and consent-screen verification
  burden, consolidating to a single FS registration. Locally everything works on
  the already-registered `127.0.0.1:1837/callback`.
- **DB migration** — trivial on POC SQLite (drop/recreate); a one-line column
  rename on Neon.

## Files to modify

- `apps/server/app/auth.py` — new FS login route; merged `/callback`; remove
  Google; `familysearch_id` upsert; `/auth/config`.
- `apps/server/app/fs_oauth.py` *(new)* — shared FS constants, PKCE, token-shape
  builder, sandbox tokens path/writer (lifted from `familysearch.py`).
- `apps/server/app/familysearch.py` — strip the per-session routes; keep nothing
  network-y that's not moved to `fs_oauth.py`.
- `apps/server/app/sessions.py` — inject the DB FS token on `create_session`.
- `apps/server/app/models.py` — `google_sub` → `familysearch_id`.
- `apps/server/app/config.py` — drop Google config; FS gate.
- `apps/server/app/main.py` — router wiring (remove dead routers).
- `apps/web/src/components/LoginScreen.tsx`, `SessionView.tsx`, `src/api.ts` —
  FS login button; remove Google + per-session connect.
- `Makefile` (`server-oauth` target), `apps/server/.env` — update for FS-only.

## Verification

1. **Offline (mock) E2E** — `make server` + `make web` with
   `familysearch_web_enabled=false`: dev-login with `dallan@gmail.com`, create a
   session, confirm the sandbox has a (mock) `~/.familysearch-mcp/tokens.json`
   and the agent (mock mode) renders the viewer. No Google anywhere.
2. **Identity probe** — covered by **Spike 0** (run before any coding); the
   captured `users[0]` shape is the evidence the allowlist key rests on.
3. **Real FS login E2E** — `make server-oauth` on `127.0.0.1:1837`,
   `FAMILYSEARCH_WEB_ENABLED=true`: click "Sign in with FamilySearch", complete
   the real round-trip, land back logged in; verify a `familysearch_tokens` row
   exists, then create a session and confirm the **real** token is injected and a
   live FS tool call (e.g. `person_ancestors` with no id → `/users/current`)
   succeeds inside the sandbox.
4. **Allowlist negative** — sign in with a non-allowlisted FS account → 403, no
   user row, no token persisted.
5. Run the server test suite (`make test`) for the auth/session paths.
