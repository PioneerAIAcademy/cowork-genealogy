# Shipping Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the electron-vite scaffold for shipping by applying security hardening (§3), GitHub Actions CI (§6), native menu (§7), Linux config (§8), and pre-launch items (§9) from the shipping reference.

**Architecture:** The existing electron-vite quickstart has insecure defaults (sandbox disabled, full `electronAPI` exposed to renderer, overly permissive entitlements). We lock down the main process, preload bridge, and CSP; add a native menu with "Check for updates"; configure electron-builder for all three platforms with GitHub Releases publishing; and add the release workflow. Per the shipping reference follow-up (lines 1006–1100), the app will eventually need network access, so CSP allows a configurable API origin and entitlements include `network.client`.

**Tech Stack:** Electron 39, electron-vite, electron-builder 26, React 19, TypeScript, GitHub Actions

**Notes on what this plan does NOT touch:** The renderer components (JSON tree, markdown viewer, file open UI, drag-drop) are part of the initial-plan and will be implemented later. This plan only prepares the infrastructure and security shell.

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/main/index.ts` | Window creation with hardened webPreferences, CSP header, navigation blocking, IPC handlers, menu setup |
| Create | `src/main/menu.ts` | Native application menu with standard roles + Help > Check for Updates + About dialog |
| Modify | `src/preload/index.ts` | Locked-down contextBridge with explicit API surface (no full electronAPI exposure) |
| Modify | `src/preload/index.d.ts` | TypeScript types for the preload API |
| Modify | `build/entitlements.mac.plist` | Remove unnecessary entitlements, add network.client |
| Modify | `electron-builder.yml` | Hardened mac/win/linux config, GitHub Releases publisher, AppImage-only Linux |
| Create | `.github/workflows/release.yml` | Multi-OS release workflow triggered by version tags |
| Create | `LICENSE` | MIT license |
| Modify | `.gitignore` | Add `.env*` patterns |
| Modify | `package.json` | Remove `electron-updater` dependency, update author/homepage |

---

### Task 1: Preload bridge lockdown

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

The current preload exposes the entire `electronAPI` to the renderer (`contextBridge.exposeInMainWorld('electron', electronAPI)`). Per §3.6 this is an anti-pattern — an XSS becomes an RCE. Replace with an explicit, minimal API surface.

- [ ] **Step 1: Replace preload/index.ts**

Replace the entire file with:

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getVersion: () => ipcRenderer.invoke('get-version')
})
```

This removes the `@electron-toolkit/preload` import and the `electron` global entirely. Only three IPC channels are exposed, each as a specific function.

- [ ] **Step 2: Replace preload/index.d.ts**

Replace the entire file with:

```ts
export interface AppAPI {
  openFile: () => Promise<{ filePath: string; content: string; ext: string } | null>
  openExternal: (url: string) => Promise<void>
  getVersion: () => Promise<string>
}

declare global {
  interface Window {
    api: AppAPI
  }
}
```

This removes the `ElectronAPI` type and the `window.electron` declaration. The renderer now only sees `window.api`.

- [ ] **Step 3: Update renderer App.tsx to remove old IPC usage**

The current `App.tsx` calls `window.electron.ipcRenderer.send('ping')` which will break. Replace the entire file with a minimal placeholder (the real UI comes from the initial-plan later):

```tsx
function App(): React.JSX.Element {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1>Research Viewer</h1>
      <p>Shell is ready. UI coming soon.</p>
    </div>
  )
}

export default App
```

- [ ] **Step 4: Verify typecheck passes**

Run: `npm run typecheck`
Expected: exit 0 (no type errors)

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/preload/index.d.ts src/renderer/src/App.tsx
git commit -m "security: lock down preload bridge to explicit API surface"
```

---

### Task 2: Native menu + main process security hardening

**Files:**
- Create: `src/main/menu.ts`
- Modify: `src/main/index.ts`

Create menu.ts first (Task 2 imports it), then replace index.ts with hardened version. Applies §3.1 (webPreferences), §3.2 (CSP header), §3.5 (file open IPC), §3.7 (block navigation), §7 (menu), §9.2 (About dialog).

- [ ] **Step 1: Create src/main/menu.ts**

```ts
import { Menu, shell, app, dialog } from 'electron'

const isMac = process.platform === 'darwin'

const REPO_URL = 'https://github.com/pioneeracademy/cowork-genealogy-ui'

const template: Electron.MenuItemConstructorOptions[] = [
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const }
          ]
        }
      ]
    : []),
  {
    label: 'File',
    submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }]
  },
  {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' }
    ]
  },
  {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  },
  {
    label: 'Help',
    submenu: [
      {
        label: `Check for Updates (v${app.getVersion()})`,
        click: (): void => {
          shell.openExternal(`${REPO_URL}/releases`)
        }
      },
      { type: 'separator' },
      {
        label: 'About',
        click: (): void => {
          dialog
            .showMessageBox({
              type: 'info',
              title: 'About Research Viewer',
              message: 'Research Viewer',
              detail: `Version ${app.getVersion()}\n\nMIT License\n${REPO_URL}\n\nNo telemetry. No analytics.`,
              buttons: ['OK', 'View on GitHub']
            })
            .then(({ response }) => {
              if (response === 1) {
                shell.openExternal(REPO_URL)
              }
            })
        }
      }
    ]
  }
]

export function setupMenu(): void {
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
```

- [ ] **Step 2: Replace src/main/index.ts**

Replace the entire file with:

```ts
import { app, shell, BrowserWindow, ipcMain, session, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs from 'node:fs/promises'
import path from 'node:path'
import icon from '../../resources/icon.png?asset'
import { setupMenu } from './menu'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // HMR for renderer based on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// --- CSP header (§3.2) ---
// Skipped in dev mode: Vite HMR injects inline scripts and uses eval,
// which script-src 'self' would block. Production CSP is enforced via header.
function setupCSP(): void {
  if (is.dev) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self';",
          "script-src 'self';",
          "style-src 'self' 'unsafe-inline';",
          "img-src 'self' data:;",
          "font-src 'self' data:;",
          "connect-src 'self';",
          "object-src 'none';",
          "base-uri 'none';",
          "frame-ancestors 'none';"
        ].join(' ')
      }
    })
  })
}

// --- IPC handlers (§3.5, §3.6) ---
function setupIPC(): void {
  ipcMain.handle('open-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON / Markdown', extensions: ['json', 'md', 'markdown'] }]
    })
    if (canceled || filePaths.length === 0) return null
    const filePath = filePaths[0]
    if (filePath.includes('\0')) throw new Error('Invalid path')
    const ext = path.extname(filePath).toLowerCase()
    if (!['.json', '.md', '.markdown'].includes(ext)) throw new Error('Unsupported file type')
    const stat = await fs.stat(filePath)
    if (stat.size > 50 * 1024 * 1024) throw new Error('File too large')
    const content = await fs.readFile(filePath, 'utf8')
    return { filePath, content, ext }
  })

  ipcMain.handle('open-external', async (_e, url: string) => {
    if (typeof url !== 'string') return
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        await shell.openExternal(url)
      }
    } catch {
      // Malformed URL — silently ignore
    }
  })

  ipcMain.handle('get-version', () => {
    return app.getVersion()
  })
}

// --- Block navigation and new windows (§3.7) ---
function setupNavigationBlocking(): void {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-navigate', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
}

// --- App lifecycle ---
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.pioneeracademy.researchviewer')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupCSP()
  setupIPC()
  setupNavigationBlocking()
  setupMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
```

**Key differences from the scaffold:**
- `sandbox: true` (was `false`)
- `contextIsolation: true` and `nodeIntegration: false` explicitly set
- `autoHideMenuBar: false` (we want the menu visible — it has "Check for Updates")
- `width: 1200` (wider for the viewer layout)
- CSP header enforced in production only (dev mode skipped to avoid breaking Vite HMR); blocks all network except `'self'` — actual API calls go through main process IPC, not renderer fetch
- `electronApp.setAppUserModelId` uses `com.pioneeracademy.researchviewer` (matches electron-builder.yml appId)
- Navigation and window-open blocked globally
- IPC handlers for file open with path/size validation, safe external URL opening (with try/catch for malformed URLs), and version query
- The old `ipcMain.on('ping')` test handler is removed
- The old `shell.openExternal(details.url)` in `setWindowOpenHandler` is removed (was in the scaffold's `createWindow` — it opened any URL the renderer requested, which is too permissive)

- [ ] **Step 3: Verify typecheck passes**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: Verify app launches**

Run: `npm run dev`
Expected: Window opens showing the placeholder UI from Task 1. Menu bar visible with File, Edit, View, Help menus. No console errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/menu.ts src/main/index.ts
git commit -m "security: harden main process — CSP, sandbox, IPC validation, nav blocking, native menu"
```

---

### Task 3: Entitlements and electron-builder config

**Files:**
- Modify: `build/entitlements.mac.plist`
- Modify: `electron-builder.yml`
- Modify: `.gitignore`
- Modify: `package.json`

Fix macOS entitlements (§4.2), configure electron-builder for all platforms (§4.3, §5 Path A, §8), switch publisher to GitHub Releases, and remove `electron-updater`.

- [ ] **Step 1: Replace build/entitlements.mac.plist**

The scaffold includes `allow-unsigned-executable-memory` and `allow-dyld-environment-variables` — both unnecessary and increase attack surface per §4.2. Add `network.client` per the shipping reference follow-up.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

- [ ] **Step 2: Replace electron-builder.yml**

```yaml
appId: com.pioneeracademy.researchviewer
productName: Research Viewer
directories:
  buildResources: build
files:
  - '!**/.vscode/*'
  - '!src/*'
  - '!electron.vite.config.{js,ts,mjs,cjs}'
  - '!{.eslintcache,eslint.config.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}'
  - '!{.env,.env.*,.npmrc,pnpm-lock.yaml}'
  - '!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}'
asarUnpack:
  - resources/**

mac:
  category: public.app-category.developer-tools
  target:
    - target: dmg
      arch: [arm64, x64]
    - target: zip
      arch: [arm64, x64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist

dmg:
  sign: false
  artifactName: ${name}-${version}-${arch}.${ext}

win:
  executableName: research-viewer
  target:
    - target: nsis
      arch: [x64]

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: Research Viewer
  artifactName: ${name}-${version}-setup.${ext}

linux:
  target:
    - target: AppImage
      arch: [x64]
  category: Utility
  synopsis: Genealogy research file viewer
  description: |
    View research.json and tree.gedcomx.json files from the genealogy
    research assistant. Offline-first. No telemetry.
  icon: build/icon.png

appImage:
  artifactName: ${name}-${version}.${ext}

npmRebuild: false

publish:
  provider: github
```

**Key changes from scaffold:**
- `appId` → `com.pioneeracademy.researchviewer`
- `productName` → `Research Viewer`
- Mac: hardened runtime, separate arm64+x64 DMGs, zip alongside DMG (needed for future auto-update), `sign: false` on DMG itself
- Mac: removed camera/microphone/Documents/Downloads usage descriptions (this app doesn't need them)
- Mac: `notarize: false` removed (we'll set it via `afterSign` hook later when Apple enrollment is done)
- Win: NSIS with `oneClick: false`, `perMachine: false` (no UAC elevation for unsigned app)
- Linux: AppImage only (removed snap and deb — §8 says skip for v1)
- `publish: provider: github` (was `generic` with a placeholder URL)

- [ ] **Step 3: Remove electron-updater from package.json**

Per §7, v1 uses a menu link instead of auto-update. Remove the dependency:

Run: `npm uninstall electron-updater`

Also delete `dev-app-update.yml` which is only used by electron-updater:

Run: `rm dev-app-update.yml`

- [ ] **Step 4: Update package.json metadata**

In `package.json`, update:
- `"author"` from `"example.com"` to `"Pioneer Academy"`
- `"homepage"` from `"https://electron-vite.org"` to `"https://github.com/pioneeracademy/cowork-genealogy-ui"`

- [ ] **Step 5: Add .env to .gitignore**

Append to `.gitignore`:

```
.env
.env.*
```

- [ ] **Step 6: Commit**

```bash
git add build/entitlements.mac.plist electron-builder.yml package.json package-lock.json .gitignore
git rm dev-app-update.yml
git commit -m "config: harden electron-builder, fix entitlements, GitHub Releases publisher"
```

---

### Task 4: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

Multi-OS matrix workflow triggered on version tags (§6.1). Uses unsigned Windows (Path A) for v1.

- [ ] **Step 1: Create directory**

Run: `mkdir -p .github/workflows`

- [ ] **Step 2: Create .github/workflows/release.yml**

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14
            target: mac
          - os: windows-latest
            target: win
          - os: ubuntu-latest
            target: linux

    runs-on: ${{ matrix.os }}
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - run: npm ci

      - uses: actions/cache@v4
        with:
          path: |
            ~/.cache/electron
            ~/.cache/electron-builder
          key: ${{ runner.os }}-electron-${{ hashFiles('package-lock.json') }}

      - name: Build & publish (mac)
        if: matrix.target == 'mac'
        run: npm run build && npx electron-builder --mac --arm64 --x64 --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CSC_LINK: ${{ secrets.MAC_CERTS }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTS_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}

      - name: Build & publish (win, unsigned)
        if: matrix.target == 'win'
        run: npm run build && npx electron-builder --win --x64 --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Build & publish (linux)
        if: matrix.target == 'linux'
        run: npm run build && npx electron-builder --linux AppImage --x64 --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Notes:**
- Mac secrets (CSC_LINK, APPLE_ID, etc.) will fail gracefully if not set — the build succeeds but produces unsigned artifacts. This is fine during development.
- Windows is intentionally unsigned (Path A per §5).
- The Electron binary cache step saves ~2 min on macOS runs per §6.4.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add multi-OS release workflow for GitHub Releases"
```

---

### Task 5: MIT License

**Files:**
- Create: `LICENSE`

Per §9.3, MIT is recommended. The scaffold's LICENSE was deleted (per git status).

- [ ] **Step 1: Create LICENSE**

```
MIT License

Copyright (c) 2025 Pioneer Academy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT license"
```

---

### Task 6: Smoke test

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: exit 0 (or only pre-existing warnings)

- [ ] **Step 3: Launch dev mode**

Run: `npm run dev`

Verify:
- Window opens at 1200x800 with placeholder UI
- Menu bar is visible with File, Edit, View, Help
- Help > Check for Updates opens the GitHub releases page in browser
- Help > About shows version dialog
- File > Quit (or Cmd+Q on Mac) exits cleanly

- [ ] **Step 4: Verify CSP in production build**

CSP is skipped in dev mode (Vite HMR needs eval/inline scripts). To verify CSP works in production:

Run: `npm run build && npm run start`

This builds and launches the production app (electron-vite preview mode). Open DevTools (F12) → Console tab. Verify:
- No `Refused to execute inline script` or `Refused to evaluate a string as JavaScript` errors
- The placeholder UI renders normally
- In DevTools → Network tab, verify no outbound requests are made

Then try injecting a fetch to confirm CSP blocks it: in the DevTools Console, run `fetch('https://example.com')`. Expected: a CSP violation error (`Refused to connect to 'https://example.com' because it violates the following Content Security Policy directive: "connect-src 'self'"`).

- [ ] **Step 5: Test build (optional, platform-dependent)**

Run: `npm run build:linux` (or `build:mac` / `build:win` depending on your OS)
Expected: Artifacts appear in `dist/` directory. No signing errors expected (unsigned is fine for local testing).
