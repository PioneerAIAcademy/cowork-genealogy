# Specification: FamilySearch OAuth Authentication (Milestone B)

## Context

Milestone A is complete — `wikipedia_search` and `places` tools work through all 4 testing layers. The next milestone is **OAuth authentication**, which unblocks all remaining tools (`collections`, `search`, `tree`, `cets`). The team selected **Pattern B** (login tool built into MCP server) from the project guide at `project_guide/project-goal.md`.

**Prerequisite (manual, not code):** FamilySearch developer registration, application creation with `client_id`, redirect URI registration for `http://127.0.0.1:1837/callback`, and email to `devsupport@familysearch.org` for refresh token support. Code can be written and unit-tested with mocks while waiting for approval.

---

## Files to Create/Modify (18 total)

| # | File | Action |
|---|------|--------|
| 1 | `src/types/auth.ts` | **Create** — Auth interfaces (TokenStore, LoginResult, AuthStatusResult, FSTokenResponse, AppConfig) |
| 2 | `src/auth/config.ts` | **Create** — OAuth URLs, port, paths, and file-backed config (`loadConfig`, `saveConfig`, `getClientId`) at `~/.familysearch-mcp/config.json` |
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

export interface AppConfig {
  clientId?: string;
  // room for future keys (sandbox URLs, other providers)
}
```

---

## Step 2: Config (`src/auth/config.ts`)

Constants + file-backed config store.

- Authorization URL: `https://ident.familysearch.org/cis-web/oauth2/v3/authorization`
- Token URL: `https://ident.familysearch.org/cis-web/oauth2/v3/token`
- Redirect URI: `http://127.0.0.1:1837/callback` (HTTP server binds to `127.0.0.1`, not `0.0.0.0`)
- Callback port: `1837`
- Scopes: `openid offline_access` (enables refresh tokens)
- Login timeout: 5 minutes
- Expiry buffer: 5 minutes (treat token as expired 5 min early)
- Token storage: `path.join(os.homedir(), ".familysearch-mcp", "tokens.json")`
- Config storage: `path.join(os.homedir(), ".familysearch-mcp", "config.json")`

Functions:

- `loadConfig()` -> `AppConfig` — reads the JSON config file; returns `{}` on missing/corrupt/wrong-shape (never throws).
- `saveConfig(patch: Partial<AppConfig>)` — merges `patch` into existing config, `mkdir({ recursive: true })` + `writeFile` JSON with `mode: 0o600`. Preserves any keys the user has set that are not in `patch`.
- `getClientId()` -> `string` — calls `loadConfig()`, returns `clientId` if present and non-empty; otherwise throws an LLM-instruction error naming the path and shape:
  ```
  FamilySearch client ID is not configured. Create the file
  ~/.familysearch-mcp/config.json with shape
  { "clientId": "<your-FamilySearch-dev-key>" }
  or pass `clientId` to the login tool to have it written automatically.
  ```

No env-var fallback — config file is the sole source.

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

The most complex module. Single function: `performLogin()` -> `LoginResult` (never throws).

Flow:
1. Get `clientId` from env
2. Generate PKCE pair + state
3. Build authorization URL with params: `client_id`, `redirect_uri`, `response_type=code`, `scope=openid offline_access`, `state`, `code_challenge`, `code_challenge_method=S256`
4. Start HTTP server on port 1837, handle only `/callback` path
5. Open browser with `open` package
6. Wait for callback (5-min timeout)
7. Validate state matches, check for error param
8. Exchange auth code for tokens via `exchangeCodeForTokens()`
9. Save tokens via `saveTokens()`
10. Return HTML success page to browser, shut down server

Error handling: state mismatch, FS error param, no code received, token exchange failure, browser can't open (returns URL for manual use), timeout.

---

## Step 7: MCP Tool Wrappers

Three thin tools following the existing pattern (function + schema + input type):

**`src/tools/login.ts`** — Calls `performLogin()`, returns `LoginResult`
- Input schema: `{ clientId?: string }` — optional. If provided, `performLogin` writes it to `config.json` via `saveConfig({ clientId })` before starting the OAuth flow. This is the bootstrap path for first-time setup.
- Schema description tells LLM: "Must be called before using tools that require authentication. If the user has not configured their FamilySearch client ID yet, pass it as `clientId`."

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
- `loadConfig` returns `{}` on missing file
- `getClientId` returns the stored clientId when config has one
- `getClientId` throws an LLM-instruction error when config is missing or `clientId` is empty
- `saveConfig` merges a patch into existing config (preserves other keys), writes JSON with `mode: 0o600`
- **Mock:** `node:fs/promises`

### `tests/auth/tokenManager.test.ts` — 8 tests
- save creates dir + writes file, load returns valid tokens, load returns null (missing file), load returns null (corrupted JSON), load returns null (wrong shape), isExpired false (valid), isExpired true (expired), isExpired true (within buffer)
- **Mock:** `node:fs/promises`

### `tests/auth/refresh.test.ts` — 10 tests
- exchangeCodeForTokens: success, correct POST body, throws on non-OK, throws on error field
- refreshAccessToken: success, keeps old refresh token if new not issued
- getValidToken: returns token when valid, refreshes when expired, throws when no tokens, throws when refresh fails
- **Mock:** `fetch` (global stub), `tokenManager` module

### `tests/auth/login.test.ts` — 5 tests
- Starts server on correct port, opens browser with correct URL params, handles successful callback, returns failure on state mismatch, times out
- **Mock:** `open` module, `exchangeCodeForTokens`, vitest fake timers

### `tests/tools/login.test.ts` — 3 tests
- Success when performLogin succeeds, failure message when fails, clientId arg is forwarded to performLogin
- **Mock:** `performLogin`

### `tests/tools/logout.test.ts` — 2 tests
- Returns success after clearing, returns success when no tokens existed
- **Mock:** `clearTokens`

### `tests/tools/auth-status.test.ts` — 4 tests
- loggedIn: false when no tokens, loggedIn: true with valid tokens, loggedIn: false when expired, reports hasRefreshToken
- **Mock:** `loadTokens`

**Existing tests:** 16 (places). **New tests:** 41 (5 pkce + 4 config + 8 tokenManager + 10 refresh + 5 login + 3 login-tool + 2 logout-tool + 4 auth-status). **Total:** 57.

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
cd mcp-server
npm run build          # Compiles clean
npm test               # All 57 tests pass
```

### Manual Layer 1 (MCP Inspector, no credentials)
```bash
npx @modelcontextprotocol/inspector node build/index.js
```
- `auth_status` -> `{ loggedIn: false }`
- `logout` -> success message
- `login` with no `clientId` arg and no `~/.familysearch-mcp/config.json` -> clear "not configured" error

### Manual Layer 1 (MCP Inspector, with test client ID)
```bash
# One-shot bootstrap via the login tool:
npx @modelcontextprotocol/inspector node build/index.js
# In Inspector, call login({ clientId: "test" })
#   -> writes ~/.familysearch-mcp/config.json
#   -> browser opens (FS will show error for invalid client, but confirms
#      HTTP server + browser launch works)

# Or prepare the config file manually:
mkdir -p ~/.familysearch-mcp
printf '{"clientId":"test"}\n' > ~/.familysearch-mcp/config.json
chmod 600 ~/.familysearch-mcp/config.json
```

### Integration (requires real FS developer account)
1. First-time: call `login({ clientId: "<your-real-app-key>" })` — writes config + opens browser
2. Thereafter: call `login()` with no args — reads from config
3. Browser -> FS login -> redirect -> "Login Successful"
4. `auth_status` -> `{ loggedIn: true, expiresInMinutes: ~1440 }`
5. `logout` -> success, `auth_status` -> `{ loggedIn: false }`

---

## Dependency Graph

```
types/auth.ts (pure interfaces)
  |
auth/config.ts (constants + env var)
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
