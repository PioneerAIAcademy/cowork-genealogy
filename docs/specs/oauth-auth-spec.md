# Specification: FamilySearch OAuth Authentication (Milestone B)

## Context

Milestone A is complete — `wikipedia_search` and `place_search` tools work through all 4 testing layers. The next milestone is **OAuth authentication**, which unblocks all remaining tools (`collections_search`, `record_search`, `person_read`, `cets`). The team selected **Pattern B** (login tool built into MCP server) from the project guide at `project_guide/project-goal.md`.

**Prerequisite (already done, baked into the repo):** the FamilySearch `client_id` is committed at `packages/engine/mcp-server/config/familysearch.json` and read at runtime by `getClientId()`. The redirect URI `http://127.0.0.1:1837/callback` is registered against that key. Users (and the LLM) never see, configure, or supply the client ID — it ships with the MCP server.

---

## Files to Create/Modify (18 total)

| # | File | Action |
|---|------|--------|
| 0 | `config/familysearch.json` | **Create (committed to git)** — `{ "clientId": "<dev-key>" }`. Bundled into the `.mcpb` and read by `getClientId()` at runtime. Sole source for the client ID. |
| 1 | `src/types/auth.ts` | **Create** — Auth interfaces (TokenStore, LoginResult, AuthStatusResult, FSTokenResponse, AppConfig). `AppConfig` covers per-user settings only (e.g. `wikiApiUrl`); it does **not** carry `clientId`. |
| 2 | `src/auth/config.ts` | **Create** — OAuth URLs, port, paths, `loadConfig`/`saveConfig` for the per-user `~/.familysearch-mcp/config.json`, and `getClientId()` that reads the bundled `config/familysearch.json` |
| 3 | `src/auth/pkce.ts` | **Create** — PKCE code_verifier/code_challenge + state generation |
| 4 | `src/auth/tokenManager.ts` | **Create** — Save/load/clear tokens from `~/.familysearch-mcp/tokens.json` |
| 5 | `src/auth/refresh.ts` | **Create** — Token exchange, refresh, and `getValidToken()` |
| 6 | `src/auth/login.ts` | **Create** — Full OAuth flow (HTTP callback server + browser launch) |
| 7 | `src/tools/login.ts` | **Create** — MCP `login` tool wrapper |
| 8 | `src/tools/logout.ts` | **Create** — MCP `logout` tool wrapper |
| 9 | `src/tools/auth-status.ts` | **Create** — MCP `auth_status` tool wrapper |
| 10 | `src/index.ts` | **Modify** — Register 3 new tools |
| 11 | `tests/auth/pkce.test.ts` | **Create** — 5 tests |
| 11b | `tests/auth/config.test.ts` | **Create** — 4 tests |
| 12 | `tests/auth/tokenManager.test.ts` | **Create** — 8 tests |
| 13 | `tests/auth/refresh.test.ts` | **Create** — 10 tests |
| 14 | `tests/auth/login.test.ts` | **Create** — 5 tests |
| 15 | `tests/tools/login.test.ts` | **Create** — 3 tests |
| 16 | `tests/tools/logout.test.ts` | **Create** — 2 tests |
| 17 | `tests/tools/auth-status.test.ts` | **Create** — 4 tests |
| 18 | `package.json` | **Modify** — Add `open` dependency |

---

## Step 1: Types (`src/types/auth.ts`)

Pure interfaces, no dependencies.

```typescript
export interface TokenStore {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix epoch milliseconds
}

export interface LoginResult {
  success: boolean;
  message: string;
}

export interface AuthStatusResult {
  loggedIn: boolean;
  expiresAt?: string;       // ISO 8601
  expiresInMinutes?: number;
  hasRefreshToken?: boolean;
}

export interface FSTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

// Per-user settings file at ~/.familysearch-mcp/config.json. Holds tunables
// like wikiApiUrl. Does NOT hold the FamilySearch client ID — that ships
// bundled at config/familysearch.json and is read by getClientId().
export interface AppConfig {
  wikiApiUrl?: string;
  // room for future per-user keys
}
```

---

## Step 2: Config (`src/auth/config.ts`)

Constants + two distinct config sources.

**OAuth constants:**

- Authorization URL: `https://ident.familysearch.org/cis-web/oauth2/v3/authorization`
- Token URL: `https://ident.familysearch.org/cis-web/oauth2/v3/token`
- Redirect URI: `http://127.0.0.1:1837/callback` (HTTP server binds to `127.0.0.1`, not `0.0.0.0`)
- Callback port: `1837`
- Scopes: `offline_access` — `openid` was dropped because the FS dev app needs an OIDC realm configured server-side (which it doesn't have) and we don't consume an ID token anywhere. `offline_access` alone is sufficient for refresh tokens.
- Login timeout: 5 minutes
- Expiry buffer: 5 minutes (treat token as expired 5 min early)
- Per-user token storage: `path.join(os.homedir(), ".familysearch-mcp", "tokens.json")`
- Per-user config storage: `path.join(os.homedir(), ".familysearch-mcp", "config.json")`
- Bundled client config: `packages/engine/mcp-server/config/familysearch.json` resolved via `fileURLToPath(import.meta.url)` to `<install-root>/config/familysearch.json`. Shipped inside the `.mcpb`. Read fresh on each `getClientId()` call.

**Functions:**

- `loadConfig()` -> `AppConfig` — reads the **per-user** JSON config; returns `{}` on missing/corrupt/wrong-shape (never throws). Holds tunables like `wikiApiUrl`. Does not hold the client ID.
- `saveConfig(patch: Partial<AppConfig>)` — merges `patch` into existing per-user config, `mkdir({ recursive: true })` + `writeFile` JSON with `mode: 0o600`. Preserves any keys the user has set that are not in `patch`.
- `getClientId()` -> `string` — reads the **bundled** `config/familysearch.json` at runtime and returns `clientId` (trimmed). On missing/unreadable/malformed/empty, throws a packaging error:
  ```
  FamilySearch client ID is unavailable. The MCP server's bundled
  config file (config/familysearch.json) is missing, unreadable, or
  malformed. This is an installation problem — reinstall the MCP
  server.
  ```
  This error is framed for the operator/CI/install pipeline, not for the LLM to propagate to the end user — under normal install the file is always present and this branch never fires. The LLM-facing tool surface (`login`'s schema and description) never mentions the client ID at all.

No env-var fallback. No per-user override for the client ID. The bundled JSON file is the sole source.

---

## Step 3: PKCE (`src/auth/pkce.ts`)

Uses Node.js built-in `crypto` module (no external deps).

- `generatePKCE()` -> `{ codeVerifier, codeChallenge }` — 32 random bytes -> base64url, SHA-256 -> base64url
- `generateState()` -> 16 random bytes -> hex string

---

## Step 4: Token Manager (`src/auth/tokenManager.ts`)

File-based token persistence.

- `saveTokens(tokens)` — `mkdir({ recursive: true })` + `writeFile` JSON with `mode: 0o600` (user read/write only)
- `loadTokens()` -> `TokenStore | null` — never throws (returns null on missing/corrupt/wrong-shape)
- `isExpired(tokens)` -> boolean — pure function, checks `expiresAt - buffer`
- `clearTokens()` — `rm({ force: true })`, silent if already gone

---

## Step 5: Token Exchange & Refresh (`src/auth/refresh.ts`)

The core auth logic. **`getValidToken()` is the single entry point all authenticated tools will call.**

- `exchangeCodeForTokens(code, codeVerifier)` -> `TokenStore` — POST to token URL with `grant_type=authorization_code`
- `refreshAccessToken(refreshToken)` -> `TokenStore` — POST with `grant_type=refresh_token`, keeps old refresh token if new one not issued
- `getValidToken()` -> `string` (access token) — loads tokens, refreshes if expired, throws instructive error if no tokens or refresh fails:
  - No tokens: `"User is not logged in to FamilySearch. Call the login tool to authenticate."`
  - Expired + refresh fails: `"FamilySearch session has expired and refresh failed. Call the login tool to re-authenticate."`
  - Expired + no refresh token: `"FamilySearch access token has expired and no refresh token is available. Call the login tool to re-authenticate."`

---

## Step 6: Login Flow (`src/auth/login.ts`)

The most complex module. Single function: `performLogin()` -> `LoginResult` (never throws). Takes no arguments.

**Non-blocking design.** `performLogin()` returns as soon as the OAuth flow is *started* — it does not wait for the callback. The auth URL is always included in the result message, so the user has a manual fallback when the browser does not open (headless host, no default browser, sandboxed process). The token exchange completes in the background; the user confirms the outcome via the `auth_status` tool.

Flow:
1. If a login is already in progress (`pendingAuthUrl` set), return `{ success: true }` with that same URL — avoids failing on the busy callback port.
2. Get `clientId` from `getClientId()` (reads the bundled config file). If it throws (packaging error), `performLogin` catches and returns `{ success: false, message }`.
3. Generate PKCE pair + state.
4. Build authorization URL with params: `client_id`, `redirect_uri`, `response_type=code`, `scope=offline_access`, `state`, `code_challenge`, `code_challenge_method=S256`.
5. Start HTTP server on port 1837, handle only `/callback` path. If the port is unavailable, return `{ success: false, message }`.
6. Kick off background completion (see below) — does **not** block.
7. Best-effort browser launch with the `open` package; failures are swallowed (the URL is in the result message regardless).
8. Return immediately: `{ success: true, message }` where `message` contains the auth URL and instructions to open it manually if no tab appeared.

Background completion (`completeLoginInBackground`, never throws):
- Wait for callback (5-min timeout).
- Validate state matches, check for error param / missing code.
- Exchange auth code for tokens via `exchangeCodeForTokens()`, save via `saveTokens()`.
- Return the HTML success page to the browser, shut down the server, clear `pendingAuthUrl`.
- Any failure (timeout, state mismatch, FS error param, no code, token exchange failure) is logged to stderr — the user discovers it by calling `auth_status`.

---

## Step 7: MCP Tool Wrappers

Three thin tools following the existing pattern (function + schema + input type):

**`src/tools/login.ts`** — Calls `performLogin()`, returns `LoginResult`
- Input schema: `{ type: "object", properties: {} }` — no parameters. The client ID is read from the bundled config; the LLM and the user never see it.
- Schema description tells LLM: "Start the FamilySearch OAuth login flow. Opens the user's browser for authorization and saves the resulting tokens to `~/.familysearch-mcp/tokens.json`. Must be called before using tools that require authentication." (No mention of `clientId` / dev key — regression-guarded by `tests/tools/login.test.ts`.)

**`src/tools/logout.ts`** — Calls `clearTokens()`, returns success message

**`src/tools/auth-status.ts`** — Calls `loadTokens()` + `isExpired()`, returns `AuthStatusResult` with loggedIn, expiresAt, expiresInMinutes, hasRefreshToken

---

## Step 8: Register in `src/index.ts`

Three changes following the exact existing pattern:
1. Add 3 imports (login, logout, auth-status tools)
2. Add 3 schemas to `ListToolsRequestSchema` handler array
3. Add 3 `if` blocks to `CallToolRequestSchema` handler (same try/catch pattern)

---

## Step 9: Package.json

Add one production dependency:

```json
"open": "^10.0.0"
```

ESM-native, zero dependencies, ships TypeScript types, cross-platform browser launcher.

---

## Testing Plan (37 tests total across 7 files)

### `tests/auth/pkce.test.ts` — 5 tests
- Verifier is 43 chars, URL-safe chars only, challenge is valid base64url, challenge matches SHA-256 of verifier, state is 32 hex chars

### `tests/auth/config.test.ts` — 4 tests
- `loadConfig` returns `{}` on missing per-user config file
- `getClientId` reads the bundled `config/familysearch.json` and returns the trimmed `clientId`
- `getClientId` throws `CLIENT_ID_PACKAGING_ERROR` on missing / invalid-JSON / wrong-shape / empty / missing-field
- `CLIENT_ID_PACKAGING_ERROR` is framed as an installation problem, not an LLM-actionable prompt (regression guard: forbids "pass / provide / configure" + "dev key" + "Call the login tool" phrasing)
- `saveConfig` merges a patch into the per-user config (preserves other keys), writes JSON with `mode: 0o600`
- **Mock:** `node:fs/promises`

### `tests/auth/bundled-client-config.test.ts` — 2 tests
- The real `config/familysearch.json` exists on disk at the resolved bundled path
- It parses as JSON and contains a non-empty `clientId` string
- **No mocks** — uses real `fs.readFileSync` against the on-disk file. Catches a broken/missing bundled config before the `.mcpb` ships.

### `tests/auth/tokenManager.test.ts` — 8 tests
- save creates dir + writes file, load returns valid tokens, load returns null (missing file), load returns null (corrupted JSON), load returns null (wrong shape), isExpired false (valid), isExpired true (expired), isExpired true (within buffer)
- **Mock:** `node:fs/promises`

### `tests/auth/refresh.test.ts` — 10 tests
- exchangeCodeForTokens: success, correct POST body, throws on non-OK, throws on error field
- refreshAccessToken: success, keeps old refresh token if new not issued
- getValidToken: returns token when valid, refreshes when expired, throws when no tokens, throws when refresh fails
- **Mock:** `fetch` (global stub), `tokenManager` module

### `tests/auth/login.test.ts` — 8 tests
- Starts server on correct port; returns immediately with the auth URL in the message; attempts the browser open; still returns the URL when the browser open fails; exchanges + saves tokens after a successful callback; skips token exchange on a state mismatch; hands back the same URL when a login is already in progress; clears the in-flight flow after the timeout
- **Mock:** `node:http`, `open` module, `exchangeCodeForTokens`, `saveTokens`, vitest fake timers

### `tests/tools/login.test.ts` — 4 tests
- Success when `performLogin` succeeds, failure message when `performLogin` fails
- `loginToolSchema.inputSchema.properties` is empty (no `clientId` field)
- `loginToolSchema.description` matches no `/client[\s_-]?id|developer\s*key|dev\s*key/i` (regression guard)
- **Mock:** `performLogin`

### `tests/tools/logout.test.ts` — 2 tests
- Returns success after clearing, returns success when no tokens existed
- **Mock:** `clearTokens`

### `tests/tools/auth-status.test.ts` — 4 tests
- loggedIn: false when no tokens, loggedIn: true with valid tokens, loggedIn: false when expired, reports hasRefreshToken
- **Mock:** `loadTokens`

**Existing tests:** 16 (places). **New tests:** 44 (5 pkce + 4 config + 2 bundled-client-config + 8 tokenManager + 10 refresh + 5 login + 4 login-tool + 2 logout-tool + 4 auth-status). **Total:** 60.

---

## Implementation Order

Build leaf-first, test each step:

1. `src/types/auth.ts` + `src/auth/config.ts` + `src/auth/pkce.ts` -> `tests/auth/pkce.test.ts`
2. `src/auth/tokenManager.ts` -> `tests/auth/tokenManager.test.ts`
3. `npm install open` (add to package.json)
4. `src/auth/refresh.ts` -> `tests/auth/refresh.test.ts`
5. `src/auth/login.ts` -> `tests/auth/login.test.ts`
6. `src/tools/login.ts` + `logout.ts` + `auth-status.ts` -> their tests
7. Update `src/index.ts`
8. `npm run build && npm test` — full verification

---

## Verification

### Automated (no FS credentials needed)
```bash
cd packages/engine/mcp-server
npm run build          # Compiles clean
npm test               # All 57 tests pass
```

### Manual Layer 1 (MCP Inspector, no credentials)
```bash
npx @modelcontextprotocol/inspector node build/index.js
```
- `auth_status` -> `{ loggedIn: false }`
- `logout` -> success message
- `login` (no arguments) -> browser opens to the FS consent screen using the bundled client ID

### Integration (no manual key setup)
1. Call `login()` — browser opens; user authorizes
2. Browser -> FS login -> redirect -> "Login Successful"
3. `auth_status` -> `{ loggedIn: true, expiresInMinutes: ~1440 }`
4. `logout` -> success, `auth_status` -> `{ loggedIn: false }`

---

## Dependency Graph

```
types/auth.ts (pure interfaces)
  |
auth/config.ts (constants + bundled config/familysearch.json reader)
  |
auth/pkce.ts (pure crypto)
  |
auth/tokenManager.ts -> depends on config
  |
auth/refresh.ts -> depends on config, tokenManager
  |
auth/login.ts -> depends on config, pkce, tokenManager, refresh, open
  |
tools/login.ts -> depends on auth/login
tools/logout.ts -> depends on auth/tokenManager
tools/auth-status.ts -> depends on auth/tokenManager
  |
index.ts -> registers all tools
```

## Key Patterns to Follow (from existing code)

- **Reuse from `places.ts`:** Export function + schema, same try/catch in index.ts
- **Reuse from `places.test.ts`:** `vi.stubGlobal("fetch", mockFetch)`, `mockFetch.mockReset()` in beforeEach
- **Error messages as LLM instructions** (per boss's rules)
- **Never `console.log`** (stdio transport)
- **Cross-platform:** `os.homedir()`, `path.join()`, `open` package
