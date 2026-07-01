# Research Viewer

A desktop application that watches `research.json` and `tree.gedcomx.json` files in real time as the AI genealogy research assistant works. Built with Electron, React 19, TypeScript, and Vite.

No telemetry. No analytics. Offline-first.

## What it does

- Watches a project folder for changes to research files
- Displays research progress through a visual pipeline (Init, Question Selection, Research Plan, Search Records, Extraction, Analysis, Proof Summary)
- Renders 11 research sections as browsable Notion-style cards: Project Overview, Questions, Plans, Research Log, Sources, Assertions, Person Evidence, Conflicts, Hypotheses, Timelines, Proof Summaries
- Shows GedcomX persons and relationships in the Project Overview
- Cross-links between sections (click an assertion ID in a question card to jump to that assertion)
- Light and dark theme toggle
- Developer mode toggle (shows raw JSON for any card)

## Prerequisites

- Node.js 22+ (the repo pins 22 via `.nvmrc`; root `engines.node` is `>=22`)
- pnpm (run `corepack enable`) — this app is a member of the monorepo pnpm workspace

## Install

This app is a workspace member, so install from the **monorepo root**, not from
here. A local `npm install` would write a stray lockfile and break the
`workspace:*` links to `@genealogy/schema` and `@genealogy/viewer-ui`.

```bash
# from the repo root
pnpm install        # or: make install
```

## Development

A Makefile provides short commands for all common workflows. Run `make help` to see them all.

```bash
make dev                # Start dev mode with HMR
make dev-sample         # Dev mode, auto-open the sample project
make dev-debug          # Dev mode with CDP on port 9222 (for agent-browser)
make dev-debug-sample   # Dev + debug + sample project (full QA setup)
make test               # Run unit tests
make check              # Run typecheck + lint + tests
```

Or run the bundler directly:

```bash
pnpm dev            # electron-vite dev (HMR)
```

The Electron window opens automatically. The Vite dev server provides HMR for the renderer process, and electron-vite hot-reloads the main process and preload scripts on changes.

### Opening a project

On launch, the app shows a welcome screen. Click "Open Project Folder" to select a folder containing `research.json` and `tree.gedcomx.json`. The app watches both files and updates the UI in real time when they change.

You can also auto-open a project folder via the `--project-dir` CLI argument:

```bash
make dev-sample
# or: npx electron-vite dev -- --project-dir /path/to/project
```

A sample project is included at `test/fixtures/sample-project/`.

### Dev mode with remote debugging (for agent-browser / CDP)

To enable Chrome DevTools Protocol access for automated testing with `agent-browser`:

```bash
make dev-debug
# or: npx electron-vite dev --remoteDebuggingPort 9222
```

Then connect from another terminal:

```bash
make ab-connect         # agent-browser connect 9222
make ab-snapshot        # accessibility tree snapshot
make ab-screenshot      # save screenshot
```

## Scripts

Run via `pnpm <script>` from this directory (the local `make` targets wrap these):

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start dev mode with HMR |
| `pnpm start` | Preview the production build locally |
| `pnpm test` | Run unit tests (Vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | TypeScript type checking (both Node and Web contexts) |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier formatting |
| `pnpm build` | Typecheck + compile for production |
| `pnpm build:win` | Build Windows installer (NSIS, x64) |
| `pnpm build:mac` | Build macOS DMG (arm64 + x64) |
| `pnpm build:linux` | Build Linux AppImage (x64) |

## Testing

Unit tests use Vitest with jsdom. Test fixtures use the Patrick Flynn worked example from the research schema spec.

```bash
pnpm test             # single run
pnpm test:watch       # watch mode
```

Tested modules:
- `src/renderer/src/lib/progress.ts` (pipeline stage inference)
- `src/renderer/src/contexts/ResearchDataContext.tsx` (cross-reference index builder)

## Architecture

```
src/
  main/           # Electron main process (Node.js)
    index.ts      # App lifecycle, IPC handlers, CSP, security hardening
    watcher.ts    # chokidar file watcher, pushes parsed JSON via IPC
    menu.ts       # Native application menu
  preload/        # Bridge between main and renderer
    index.ts      # contextBridge with explicit API allowlist
    index.d.ts    # TypeScript types for the preload API
  renderer/       # React app (sandboxed Chromium)
    src/
      App.tsx                  # Layout shell, routing, welcome screen
      lib/
        schema.ts              # TypeScript types for research.json + GedcomX
        progress.ts            # Pipeline stage inference logic
      contexts/
        ResearchDataContext.tsx # Shared state, cross-reference index
      components/
        layout/                # Header, Sidebar, ProgressPipeline
        shared/                # Card, StatusBadge, DetailPanel, PersonCard, CrossLink
        sections/              # 11 section components (one per research.json section)
      styles/
        global.css             # CSS variables, light/dark themes
```

### Process split

| Process | Role | Security |
|---------|------|----------|
| Main | File I/O, native dialogs, IPC dispatch, CSP headers, navigation blocking | Full Node.js access |
| Preload | Bridge between main and renderer via `contextBridge` | Explicit API allowlist only |
| Renderer | React UI, state management, rendering | Sandboxed, no Node.js, no direct IPC |

### IPC channels

| Channel | Direction | Payload |
|---------|-----------|---------|
| `project:select-folder` | renderer to main | Response: folder path or null |
| `project:research-updated` | main to renderer | Parsed research.json |
| `project:gedcomx-updated` | main to renderer | Parsed tree.gedcomx.json |
| `project:watch-error` | main to renderer | Error message string |
| `open-file` | renderer to main | Response: file content or null |
| `open-external` | renderer to main | HTTPS URL to open in browser |
| `get-version` | renderer to main | App version string |

## Releasing (alpha — unsigned)

Desktop builds ship from the **monorepo** workflow
[`.github/workflows/electron-release.yml`](../../.github/workflows/electron-release.yml)
(repo root — the old `apps/electron/.github/...` was nested where GitHub Actions
never reads it, so it never ran). electron-builder config lives in
[`electron-builder.yml`](./electron-builder.yml).

Alpha builds are **unsigned**: mac and Windows installers are not code-signed or
notarized, so testers must clear Gatekeeper/SmartScreen by hand (below). Signing
is deferred — see [Adding code signing later](#adding-code-signing-later).

### Dry run first (no publish)

Before cutting a real tag, run the workflow manually to prove it: **GitHub →
Actions → "Electron release" → Run workflow**. It builds the full mac/win/linux
matrix with `--publish never` and uploads the installers as downloadable run
artifacts you can smoke-test. (The sibling repo shipped this workflow but never
once ran it — don't repeat that; dry-run before tagging.)

### Cut a release

1. Bump `version` in [`package.json`](./package.json) — electron-builder names the
   artifacts **and the GitHub Release** from this, not from the git tag.
2. Commit, then push a namespaced tag:
   ```bash
   git tag electron-v1.0.1 && git push origin electron-v1.0.1
   ```
   CI builds and publishes to a GitHub Release on `PioneerAIAcademy/cowork-genealogy`:

   | Platform | Format | Arch |
   |----------|--------|------|
   | macOS | DMG + ZIP | arm64, x64 |
   | Windows | NSIS installer | x64 |
   | Linux | AppImage | x64 |

The trigger is `electron-v*` (not the generic `v*.*.*`) so it never collides with
`.mcpb`/plugin release tags in this monorepo. Note: electron-builder publishes the
Release under tag `v<version>` (from `package.json`), distinct from the `electron-v*`
trigger tag — cosmetic, worth aligning if it ever matters.

### Installing an unsigned build (what to tell testers)

- **macOS** — a downloaded `.dmg` is quarantined and shows *"…is damaged and can't
  be opened."* That's Gatekeeper on an un-notarized app, not actual corruption.
  After dragging the app to `/Applications`, clear the quarantine flag:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Research Viewer.app"
  ```
  The app is ad-hoc signed, so it launches once quarantine is cleared.
- **Windows** — SmartScreen warns on the unsigned NSIS installer: click
  **More info → Run anyway**.
- **Linux** — `chmod +x Research-Viewer-*.AppImage` and run it.

### Adding code signing later

Deferred for alpha. To make builds pass Gatekeeper/SmartScreen with no manual
steps, re-introduce signing to the workflow's build steps.

**macOS (Developer ID + notarization)** — `electron-builder.yml` already sets
`hardenedRuntime: true` + entitlements, so once the credentials are present it
signs and notarizes automatically:

1. Enrol in the Apple Developer Program ($99/yr; approval can take 1–2 days).
2. Create a **Developer ID Application** certificate and export it as a `.p12`.
3. Add these GitHub repo secrets, then in `electron-release.yml` **remove**
   `CSC_IDENTITY_AUTO_DISCOVERY: false` from the mac step and add the env block:
   ```yaml
   env:
     GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
     CSC_LINK: ${{ secrets.MAC_CERTS }}                       # base64 of the .p12
     CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTS_PASSWORD }}      # the .p12 password
     APPLE_ID: ${{ secrets.APPLE_ID }}                        # notarization
     APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
     APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
   ```

**Windows (optional)** — unsigned triggers SmartScreen. To sign, obtain an OV/EV
code-signing certificate (or use Azure Trusted Signing) and add
`WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets, consumed by the win build step.

**Linux** — AppImage needs no signing.

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
- Content Security Policy enforced via HTTP headers in production
- Preload bridge exposes only 7 named IPC channels (no raw `ipcRenderer` access)
- File paths validated (null byte check, extension whitelist, 50MB size limit)
- External URLs restricted to HTTPS
- Navigation and new-window creation blocked
- `react-markdown` used without `rehype-raw` (no raw HTML injection)

## Privacy

Research Viewer connects to the network only to load fonts from Google Fonts. No telemetry, no analytics, no crash reports. Files you open never leave your machine. The CSP `connect-src` directive restricts all other network access.

## License

MIT. See [LICENSE](LICENSE).
