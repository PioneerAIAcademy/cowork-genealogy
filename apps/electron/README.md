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

- Node.js 20+
- npm

## Install

```bash
npm install
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

Or use npm/npx directly:

```bash
npm run dev
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

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev mode with HMR |
| `npm start` | Preview the production build locally |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | TypeScript type checking (both Node and Web contexts) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier formatting |
| `npm run build` | Typecheck + compile for production |
| `npm run build:win` | Build Windows installer (NSIS, x64) |
| `npm run build:mac` | Build macOS DMG (arm64 + x64) |
| `npm run build:linux` | Build Linux AppImage (x64) |

## Testing

Unit tests use Vitest with jsdom. Test fixtures use the Patrick Flynn worked example from the research schema spec.

```bash
npm test              # single run
npm run test:watch    # watch mode
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

## Build and distribution

Production builds use electron-builder. The GitHub Actions workflow (`.github/workflows/release.yml`) triggers on version tags:

```bash
npm version 1.1.0
git push --follow-tags
```

This builds and publishes to GitHub Releases for all three platforms.

| Platform | Format | Architectures | Signing |
|----------|--------|--------------|---------|
| macOS | DMG + ZIP | arm64, x64 | Code signing + notarization (requires Apple Developer secrets) |
| Windows | NSIS installer | x64 | Unsigned in v1 (SmartScreen click-through) |
| Linux | AppImage | x64 | N/A |

See `docs/shipping-reference.md` for the complete signing, notarization, and distribution guide.

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
