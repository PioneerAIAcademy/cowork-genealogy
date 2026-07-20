---
name: security-invariants
description: |
  Electron security checklist for this project. Run this skill before any PR
  that touches src/main/, src/preload/, IPC channels, CSP, or package.json
  dependencies. Also run before tagging a release. Use when: "check security",
  "security review", "pre-release check", before /ship on any branch that
  modified main or preload process code.
---

# Security Invariants

This is the non-negotiable security baseline for Research Viewer. Every item
below was chosen for a specific reason. Violating any of them reopens an
attack surface that was deliberately closed.

Run this checklist by reading the current source files and verifying each
invariant still holds. Report PASS or FAIL for each item with the file and
line number as evidence.

## How to run this check

1. Read `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`,
   `src/main/watcher.ts`, and `package.json`.
2. Walk through each invariant below.
3. For each: cite the file:line that proves compliance, or flag the violation.
4. Output a summary: N/N passed, or list failures.

## Invariants

### 1. BrowserWindow webPreferences

These five settings prevent the renderer from accessing Node.js APIs or
escaping the Chromium sandbox. If any one is wrong, an XSS in the renderer
becomes arbitrary code execution on the user's machine.

Check `src/main/index.ts` where `new BrowserWindow()` is called:

- [ ] `contextIsolation: true` — isolates preload from renderer globals
- [ ] `nodeIntegration: false` — no `require()` or `process` in renderer
- [ ] `sandbox: true` — OS-level Chromium sandbox
- [ ] `webSecurity: true` — same-origin policy enforced
- [ ] `allowRunningInsecureContent: false` — no HTTP resources on HTTPS pages

If any of these are missing, they may default to safe values in modern Electron,
but explicit is better than implicit. All five must be present.

### 2. Content Security Policy

CSP is the last line of defense if untrusted content reaches the renderer.
It must be set via HTTP header (not just `<meta>` tag) because of CVE-2023-23623.

Check `src/main/index.ts` for `onHeadersReceived` CSP header:

- [ ] `default-src 'self'` — only same-origin by default
- [ ] `script-src 'self'` — no inline scripts, no eval
- [ ] `style-src 'self' 'unsafe-inline'` — inline CSS allowed (React needs it), but no external stylesheets except explicitly listed domains
- [ ] `connect-src 'self'` — no arbitrary network requests from renderer
- [ ] `object-src 'none'` — no plugins
- [ ] `base-uri 'none'` — no base tag hijacking
- [ ] `frame-ancestors 'none'` — no embedding

Any domain added to CSP directives must have a documented reason. Beyond
`'self'`, the current header (`src/main/index.ts`) allows:

| Directive | Value | Reason |
|-----------|-------|--------|
| `style-src` | `'unsafe-inline'` | React inline styles |
| `style-src` | `https://fonts.googleapis.com` | Google Fonts stylesheet |
| `font-src` | `https://fonts.gstatic.com`, `data:` | Google Fonts files + inline data-URI fonts |
| `img-src` | `data:` | inline data-URI images |
| `connect-src` | `http://localhost:3000`, `https://script.google.com`, `https://script.googleusercontent.com` | ⚠️ **UNVERIFIED — flagged for removal.** No renderer consumer found: the feedback POST runs in the **main** process (where `connect-src` does not apply) and `viewer-ui` makes no direct external `fetch`. These were inherited from the shared hosted-web CSP (#293). The Electron renderer's `connect-src` should be just `'self'` — see the follow-up note below. |

There is also a `<meta>` CSP in `src/renderer/index.html` carrying the same
directives; keep the two in sync (the **header** in `index.ts` is authoritative —
see CVE-2023-23623 above).

> **Follow-up (tracked, not yet done):** tighten `connect-src` to `'self'` in
> both the header and the `<meta>` tag once confirmed no renderer path uses the
> three external origins above. Until then this item is a documented known-gap,
> not a PASS by default.

CSP is skipped in dev mode (Vite HMR needs eval). This is acceptable because
dev mode is local only.

### 3. Preload bridge is an explicit allowlist

The preload script must use `contextBridge.exposeInMainWorld` with a fixed
set of named functions. This is the ONLY channel between main and renderer.

Check `src/preload/index.ts`:

- [ ] Uses `contextBridge.exposeInMainWorld('api', { ... })`
- [ ] Does NOT expose raw `ipcRenderer` to the renderer
- [ ] Does NOT use `ipcRenderer.send` with user-controlled channel names
- [ ] Every `ipcRenderer.on` listener uses a hardcoded channel name string
- [ ] `removeAllListeners` only removes specific named channels

The allowed IPC channels (update this list when adding new ones):

| Channel | Direction | Handler |
|---------|-----------|---------|
| `open-file` | invoke | File open dialog with validation |
| `open-external` | invoke | HTTPS-only URL opener |
| `get-version` | invoke | App version string |
| `project:select-folder` | invoke | Folder picker dialog (rejects a folder with no `research.json`) |
| `project:get-state` | invoke | Current watcher state (cached; no file I/O) |
| `project:list-files` | invoke | List files under the open project folder |
| `project:read-sidecar` | invoke | Read a `results/<logId>.json` sidecar (logId validated in `readSidecar`) |
| `project:read-image` | invoke | Read a source page scan (`images/<key>.jpg`) as a `data:` URL (filename validated in `readSourceImage`) |
| `session:get-log` | invoke | Read the session log for the open folder |
| `feedback:submit` | invoke | Build + POST a feedback zip (the POST is a **main-process** `fetch`, not a renderer request) |
| `project:research-updated` | on (push) | Parsed research.json |
| `project:gedcomx-updated` | on (push) | Parsed tree.gedcomx.json |
| `project:watch-error` | on (push) | Error string |
| `project:sidecar-updated` | on (push) | A sidecar changed: `{ logId, mtime }` |

If a channel exists in the preload but is not in this table, it is unauthorized.
Push channels are sent from `src/main/watcher.ts` (the two `*-updated` file
channels come from a hardcoded filename→channel map, not a computed name).

### 4. IPC input validation

The renderer is untrusted. Every IPC handler in the main process must validate
its inputs before acting on them.

Check `src/main/index.ts` for each `ipcMain.handle`:

- [ ] `open-file`: file dialog filters (JSON/MD only), null byte check, extension whitelist, 50MB size limit
- [ ] `open-external`: type check (`typeof url !== 'string'`), URL parse, HTTPS-only protocol check
- [ ] `project:select-folder`: uses `dialog.showOpenDialog` with `openDirectory` property (no user-supplied path)
- [ ] `project:get-state`: returns cached data only, no file I/O on user input

### 5. Navigation and window creation blocked

Prevents the renderer from navigating to attacker-controlled URLs or opening
new windows (which could escape CSP).

Check `src/main/index.ts`:

- [ ] `will-navigate` event calls `e.preventDefault()` on all web contents
- [ ] `setWindowOpenHandler` returns `{ action: 'deny' }` for all requests

### 6. No `remote` module

The `remote` module gives the renderer full main-process access. It was
removed from Electron core and must never be re-added via `@electron/remote`.

Check `package.json`:

- [ ] `@electron/remote` is NOT in dependencies or devDependencies
- [ ] No `import` or `require` of `@electron/remote` in any source file

### 7. No unsafe HTML rendering

XSS in a desktop app is worse than in a web app because the attacker has
access to the local filesystem via the main process IPC bridge.

Check all `.tsx` files in `src/renderer/`:

- [ ] No `dangerouslySetInnerHTML` usage
- [ ] No `rehype-raw` import (allows raw HTML in react-markdown)
- [ ] No `eval()`, `new Function()`, or `document.write()` in renderer code
- [ ] `react-markdown` is used without `rehype-raw` for proof summary narratives

### 8. Secrets not in source

- [ ] `.env` is in `.gitignore`
- [ ] No API keys, tokens, or passwords in any committed file
- [ ] GitHub Actions secrets use `${{ secrets.X }}`, never hardcoded values

### 9. Dependencies are minimal

Every production dependency is an attack surface. This app should have very
few production deps because the renderer is bundled by Vite and most packages
are devDependencies.

Check `package.json`:

- [ ] Production `dependencies` contains only the following (and their transitive deps):
  - `@electron-toolkit/utils`, `chokidar` — window/env helpers + the project file watcher
  - `react-markdown` — proof-summary narrative rendering (no `rehype-raw`; see §7)
  - `focus-trap-react` — modal focus containment (feedback dialog)
  - `jszip` — builds the feedback zip in-process (see the `feedback:submit` channel)
  - `@genealogy/schema`, `@genealogy/viewer-ui` — internal `workspace:*` packages (first-party, not third-party attack surface)
- [ ] No native C++ addons in production deps (verify: `npm ls --prod --all 2>/dev/null | grep -i 'gyp\|node-pre\|prebuild\|nan\|napi'` returns nothing)
- [ ] `npmRebuild: false` in `electron-builder.yml` (no native modules to rebuild)

### 10. Hardened runtime and minimal entitlements (macOS)

Check `build/entitlements.mac.plist`:

- [ ] `com.apple.security.cs.allow-jit` is `true` (required for V8)
- [ ] `com.apple.security.network.client` is `true` (for font loading and future API)
- [ ] `com.apple.security.cs.allow-unsigned-executable-memory` is NOT present (not needed on Electron 12+, increases attack surface)
- [ ] `com.apple.security.cs.disable-library-validation` is NOT present (not needed unless loading unsigned external libraries)

Check `electron-builder.yml`:

- [ ] `hardenedRuntime: true` under `mac`

## Output format

```
SECURITY INVARIANTS CHECK
═════════════════════════

1. BrowserWindow webPreferences    [PASS] src/main/index.ts:19-25
2. Content Security Policy         [PASS] src/main/index.ts:53-64
3. Preload bridge allowlist        [PASS] src/preload/index.ts (13 channels)
4. IPC input validation            [PASS] src/main/index.ts:71-116
5. Navigation blocked              [PASS] src/main/index.ts:122-123
6. No remote module                [PASS] not in package.json
7. No unsafe HTML rendering        [PASS] 0 violations in renderer
8. Secrets not in source           [PASS] .env in .gitignore
9. Minimal dependencies            [PASS] 5 external + 2 workspace prod deps, 0 native
10. Hardened runtime               [PASS] entitlements.mac.plist

RESULT: 10/10 PASSED
```

If any item fails, show the violation and the fix.
