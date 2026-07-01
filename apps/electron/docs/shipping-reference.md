# Shipping v1: Electron JSON/Markdown Viewer — Complete Reference

*Last verified: May 2, 2026.* This is a working reference for shipping v1 of a free, offline Electron + React + TypeScript + Vite JSON/Markdown viewer to macOS, Windows, and (bonus) Linux via GitHub Releases. Target: 5–8 days of focused work plus calendar time for Apple and Microsoft validation.

---

## TL;DR

- **Use electron-vite (`npm create @quick-start/electron@latest` with the `react-ts` template) + electron-builder ≥ 26 + GitHub Actions.** Lowest-friction stack in 2026 and the only one with first-class Azure Artifact Signing support via `azureSignOptions`.
- **For Windows v1, ship unsigned NSIS now and add Azure Artifact Signing in v1.1.** Artifact Signing (formerly Trusted Signing) went GA on January 12, 2026 ("Trusted Signing is now Artifact Signing—and it's officially Generally Available!" — annilayan, Microsoft Security Blog) and is restricted to organizations in US/Canada/EU/UK and individuals in US/Canada. $9.99/month Basic.
- **For macOS, enroll in the Apple Developer Program ($99/yr) on day 0 in parallel with development.** Most individual enrollments approve in hours to a few days; sign with a Developer ID Application certificate, hardened runtime + minimal entitlements (`com.apple.security.cs.allow-jit`), and notarize with `notarytool`.

---

## Key Findings (Decisions to Make Before Writing Code)

1. **Scaffold:** electron-vite via `npm create @quick-start/electron@latest` (template `react-ts`). Skip electron-forge for this project.
2. **Packager:** electron-builder ≥ 26. It has 1,633,517 weekly npm downloads vs electron-forge's 2,459 per npmtrends — a ~664:1 ratio. The community is overwhelmingly on Builder, Azure Artifact Signing is built in (`win.azureSignOptions`), and the GitHub publisher needs no plugins.
3. **Apple:** enroll as **Individual** unless you have a registered company already. Individual = no D-U-N-S, faster approval, your legal name is the seller. Cost identical ($99/yr).
4. **Windows:** **two acceptable v1 paths**. Path A (unsigned NSIS, document SmartScreen click-through in README) is fully acceptable for free OSS v1. Path B (Azure Artifact Signing) removes the "Unknown publisher" line but costs $9.99/mo and needs identity validation.
5. **Linux:** single AppImage, no signing, no auto-update wiring in v1.
6. **Auto-update:** ship a "Check for updates → opens GitHub releases page" menu item in v1; keep `electron-updater` for v1.1.
7. **Architecture:** macOS arm64 + x64 as separate DMGs (smaller downloads in 2026); Windows x64 only.

---

## 1. Account/Credential Setup (Do This First — Day 0)

These have approval lead times that block the *release*, not development. Start them on day 0 and develop in parallel.

### 1.1 Apple Developer Program ($99/yr)

**What you get:** access to App Store Connect, Developer ID Application certificates (for distribution outside the Mac App Store), Apple's notarization service, app-specific passwords, and App Store Connect API keys.

**Prereqs:**
- An Apple Account with **two-factor authentication enabled** (mandatory; cannot enroll without it).
- Your **legal name** in the Apple Account first/last name fields. Any nickname/alias delays approval.
- A credit card in your own name (for individuals — using someone else's card triggers a manual ID review).
- Be the legal age of majority in your region.

**Individual vs. Organization (recommended for this project: Individual):**

| | Individual | Organization |
|---|---|---|
| Annual cost | $99 | $99 |
| Seller name on App Store | Your legal personal name | Legal entity name |
| D-U-N-S number required | No | **Yes** (free from Dun & Bradstreet via Apple's lookup) |
| Typical approval time | Minutes to 48 hours (rare cases up to 2 weeks) | 1–7+ business days |
| Best fit for free OSS solo dev | ✅ | ❌ (overkill) |

Apple's own enrollment text states: *"Your purchase may take up to 48 hours to process."* Real-world experience varies: enrollment can clear in under an hour, or stall for 1–4 weeks if Apple flags your name/address mismatch or asks for ID. **Plan for up to 1 week**, not 48 hours.

**While waiting:** install Xcode, write code, and run/sign locally with a "Personal Team" (limited 7-day provisioning, not for distribution). You cannot notarize without a paid membership.

**Action checklist (day 0):**
- [ ] Create/verify an Apple ID with 2FA on, name fields = legal name.
- [ ] Go to developer.apple.com/programs/enroll, choose Individual.
- [ ] Pay $99 with personal credit card.
- [ ] After approval, in **Certificates, Identifiers & Profiles**, generate a **Developer ID Application** certificate. Download the `.p12` and export the private key (you'll need this in CI).
- [ ] In **Users and Access → Integrations → App Store Connect API**, generate a key with **Developer** role (preferred over app-specific password for `notarytool`).
- [ ] Note your **Team ID** (10-character alphanumeric on the membership details page).

### 1.2 GitHub Repo Setup

- **Public vs. private:** **public**. Public repos get unlimited free GitHub Actions minutes — this matters because of the macOS 10× and Windows 2× multipliers (see §6).
- **Asset hosting limits:** GitHub Releases assets are capped at 2 GB per file (well under what an Electron viewer needs — yours will be 80–150 MB). No bandwidth limits.
- **Releases page UX:** Releases auto-generate a download list grouped by tag. Naming files `App-${version}-${arch}.${ext}` (electron-builder default) gives you neatly grouped `App-1.0.0-arm64.dmg`, `App-1.0.0-x64.dmg`, `App-1.0.0-Setup.exe`, etc.
- Add a `LICENSE` (MIT or Apache-2.0 recommended for free OSS — choose MIT for simplicity unless you want patent-grant protection).
- Enable **Actions** in repo settings (default: on).
- Add **branch protection** on `main` so tag pushes are deliberate.

### 1.3 Azure Artifact Signing (formerly Trusted Signing) — Eligibility-First

**Critical 2026 update:** Microsoft renamed Trusted Signing to **Artifact Signing** and announced General Availability on **January 12, 2026** in the Microsoft Security Blog post *"Simplifying Code Signing for Windows Apps: Artifact Signing (GA)"* by annilayan: *"Trusted Signing is now Artifact Signing—and it's officially Generally Available!"*

**Eligibility (the gating factor):** Per Microsoft Learn's Artifact Signing Quickstart (last updated 2026-04-28):

> "For Public Trust certificates, Artifact Signing is currently available to organizations in the USA, Canada, the European Union, and the United Kingdom, as well as individual developers in the USA and Canada."

So if you're an individual in the UK/EU, **you cannot use Artifact Signing as an individual yet** — your only options are: form a UK/EU legal entity, ship unsigned, or use a legacy OV certificate from a third party. The previous public-preview rule that organizations needed 3 years of business history was lifted at GA. The April 2, 2025 *"Trusted Signing Public Preview Update"* originally imposed the restriction *"to US and Canada-based organizations with 3 years or more of verifiable history"*; this was lifted at GA, confirmed in melatonin.dev's April 2026 guide: *"You can now apply as a self-employed individual and you no longer need the 3 years of history that were required when the service was in public preview."*

**Pricing (2026, unchanged from preview):**
- **Basic:** $9.99/month — 5,000 signatures, 1 of each certificate profile type.
- **Premium:** $99.99/month — 100,000 signatures, 10 of each certificate profile type.
- **Overage:** $0.005 per signature beyond plan.
- **Not pro-rated.** Per Azure's pricing FAQ: *"The pricing is not calculated on a pro rata basis. The invoice is generated with the full amount for the SKU that you selected when you created the account, regardless of when you begin to use the service."*
- **Billing starts the moment you create the Artifact Signing account.** Set a Cost Management budget alert immediately.
- **Free/Trial Azure subscriptions are not supported** — you need a Pay-As-You-Go subscription.

**Identity validation timeline:** Microsoft uses **AU10TIX** as the third-party identity verifier (via Microsoft Entra Verified ID + the Authenticator app). Per the GA blog by annilayan: *"Most validations are completed within a few business days, and once approved, you're ready to start signing your apps immediately."* Real-world reports range from 10 minutes to 10+ days; Microsoft's FAQ explicitly states identity validation **cannot be expedited**. **Plan for 1–2 weeks.**

**Setup steps (Azure Portal):**
1. Create a Pay-As-You-Go Azure subscription if you don't have one.
2. In Subscriptions → Settings → Resource Providers, search `Microsoft.CodeSigning` and **Register**. (The resource provider name still uses the old "CodeSigning" branding even after the rename.)
3. Create a resource group (e.g., `rg-codesigning`).
4. Create an **Artifact Signing Account** in the resource group. Select Basic tier and a region (US or Europe; pick the one closest to your CI). **Billing begins now.**
5. In the Artifact Signing Account → Access Control (IAM), add yourself as **Artifact Signing Identity Verifier** (renamed Jan 28, 2026 from "Trusted Signing Identity Verifier"). Yes, you must explicitly grant your own admin account this role to perform validation.
6. Click **Identity Validation** → **Get verified here through our trusted ID-verifiers** → AU10TIX. Complete via the Microsoft Authenticator mobile app and a government photo ID.
7. After approval, create a **Certificate Profile** (Public Trust). Choose CN = your legal name (this is what Windows displays as the publisher).
8. Create an **Entra ID App Registration** (this is the service principal CI will use). Generate a client secret (24-month max).
9. Back in the Artifact Signing Account, assign the App Registration the role **Artifact Signing Certificate Profile Signer**. (You must search the App Registration name explicitly in the role assignment UI; it doesn't appear in the default list.)
10. Note these values for CI secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, plus the account endpoint URL (e.g., `https://eus.codesigning.azure.net/`), the certificate profile name, and the account name.

**EV cert is no longer worth it for new projects.** Per Microsoft Learn's *SmartScreen reputation for Windows app developers* doc:

> "Historically, Extended Validation (EV) code signing certificates granted immediate SmartScreen reputation — an EV-signed binary would show no warning even on first download. This behavior was removed in 2024 when Microsoft updated the Trusted Root Program requirements."

> "EV certificates still provide value (they require more identity validation, which may matter for enterprise procurement), but they no longer provide instant SmartScreen bypass. Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified."

The Microsoft Trusted Root Program text: *"Beginning in August 2024, all EV Code Signing OIDs will be removed from existing roots in the Microsoft Trusted Root Program, and all Code Signing certificates will be treated equally."* So a $300–500/yr EV cert with a USB dongle now provides the same SmartScreen behavior as a $9.99/mo Artifact Signing cert — pick Artifact Signing.

---

## 2. Project Scaffolding & Dev Environment

### 2.1 Recommended Scaffold

```bash
npm create @quick-start/electron@latest json-md-viewer -- --template react-ts
cd json-md-viewer
npm install
npm run dev
```

This is the official electron-vite scaffold. It gives you:

- `src/main/` — main process TypeScript (window creation, IPC handlers).
- `src/preload/` — preload script with `contextBridge` boilerplate.
- `src/renderer/` — React + Vite + TypeScript app.
- `electron.vite.config.ts` — single config file for all three processes.
- `electron-builder.yml` — already wired up.
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` — three separate configs (the right shape for Electron).

Per the electron-vite docs: *"Provides a single configuration point for the main process, renderer processes, and preload scripts, with sensible defaults optimized for Electron. Features instant Hot Module Replacement (HMR) for renderer processes, plus hot reloading support for the main process and preload scripts."*

**Pros vs. alternatives:**

| Option | Verdict |
|---|---|
| `npm create @quick-start/electron@latest` (electron-vite) | ✅ **Pick this.** Three-process build, HMR for renderer, hot-reload for main/preload, sensible TS configs out of the box. |
| `electron-vite-react` boilerplate (clone) | Equivalent; clone if you want a richer starting React app. |
| Hand-rolled vite + electron + tsc | More control, more YAGNI surface for v1. Skip. |
| `cawa-93/vite-electron-builder` | Excellent secure boilerplate but mono-repo structure is heavier than needed. |

### 2.2 electron-builder vs. electron-forge in 2026

**Recommendation: electron-builder.** Reasons:

1. **First-class Azure Artifact Signing** via `win.azureSignOptions` (since electron-builder 26.0.x). Forge supports it but the configuration is split across three files (`forge.config.ts`, `windowsSign.ts`, `.env.trustedsigning`).
2. **Built-in GitHub publisher.** Set `publish: { provider: "github" }`, set `GH_TOKEN`, and `electron-builder --publish always` drafts a release with all artifacts — no plugins.
3. **Wider community in the wild** for notarization recipes (more Stack Overflow signal, more blog posts to crib from).
4. **Vastly more popular.** electron-builder has 1,633,517 weekly downloads vs electron-forge's 2,459 per npmtrends — a ~664:1 ratio. The Builder ecosystem moves faster on new platform features.

**When Forge wins:** if you want Squirrel.Mac auto-update with `update.electronjs.org`'s free service (no server needed). For v1 you don't have auto-update at all, so this is moot.

### 2.3 TypeScript Configuration

The scaffold gives you three tsconfigs because main/preload/renderer have different runtimes:

- `tsconfig.node.json` (main + preload) — `module: "ESNext"`, `target: "ES2022"`, no DOM lib, includes `electron` types.
- `tsconfig.web.json` (renderer) — DOM + ES2022, no Node types, includes React types.
- `tsconfig.json` — root references both.

Don't merge them — main code that accidentally imports `window` should fail compilation, not blow up at runtime.

### 2.4 Recommended File/Folder Structure

```
json-md-viewer/
├─ src/
│  ├─ main/
│  │  ├─ index.ts            # app lifecycle, BrowserWindow, IPC handlers
│  │  ├─ menu.ts             # native menu + "Check for updates" item
│  │  └─ ipc/
│  │     └─ files.ts         # open-file, validate-path
│  ├─ preload/
│  │  └─ index.ts            # contextBridge.exposeInMainWorld('api', {...})
│  └─ renderer/
│     ├─ src/
│     │  ├─ App.tsx
│     │  ├─ components/
│     │  │  ├─ JsonTree.tsx
│     │  │  └─ MarkdownView.tsx
│     │  ├─ lib/
│     │  │  ├─ parseJson.ts
│     │  │  └─ markdown.ts
│     │  └─ main.tsx
│     └─ index.html
├─ build/                    # electron-builder buildResources
│  ├─ entitlements.mac.plist
│  ├─ icon.icns               # mac
│  ├─ icon.ico                # windows
│  └─ icon.png                # linux 512×512
├─ resources/
│  └─ samples/                # sample JSON + MD files for first-run
├─ .github/workflows/release.yml
├─ electron-builder.yml
├─ electron.vite.config.ts
├─ package.json
└─ LICENSE
```

### 2.5 The Vercel Labs `agent-browser/electron` Skill

`agent-browser` is a native Rust CLI from Vercel Labs that drives Chrome/Chromium via CDP for AI agents. It ships with skills — small `SKILL.md` instruction packs that teach Claude Code (and other agents) workflow-specific patterns.

```bash
npx skills add vercel-labs/agent-browser --skill electron
```

This installs a thin discovery stub at `.claude/skills/agent-browser/SKILL.md` that points Claude Code at `agent-browser skills get electron` to fetch live workflow content for **automating Electron desktop apps**. Per the agent-browser docs, this is the same skill family that automates VS Code, Slack, Discord, Figma, Notion, and Spotify.

What this enables in your worktree-parallel Claude Code workflow:

- Claude can launch your built app, take accessibility-tree snapshots (with element refs like `@e9`), click around, and verify the JSON tree renders / markdown highlights / drag-drop works — all without you opening it manually.
- Sessions and state persistence let agents resume across messages.
- Compact accessibility snapshots use a few hundred tokens vs. thousands for screenshots, so iteration is cheap.

Practical usage: after `npm run build` produces a packaged `.app`/`.exe`, Claude can connect to it with `agent-browser` and run a smoke test before you tag a release. Pair it with the `dogfood` skill (`agent-browser skills get dogfood`) for exploratory QA passes.

---

## 3. Non-Negotiable v1 Security Hardening

Even for an offline file viewer, these are not optional. A malicious `.md` opened locally can exploit a misconfigured renderer.

### 3.1 BrowserWindow webPreferences

```ts
// src/main/index.ts
import { BrowserWindow, app, session } from 'electron';
import path from 'node:path';

const win = new BrowserWindow({
  width: 1200,
  height: 800,
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.cjs'),
    contextIsolation: true,        // MUST be true (default in Electron 12+)
    nodeIntegration: false,         // MUST be false
    sandbox: true,                  // MUST be true (default in Electron 20+)
    webSecurity: true,
    allowRunningInsecureContent: false,
  },
});
```

Per the Electron Context Isolation doc: *"Context isolation has been enabled by default since Electron 12, and it is a recommended security setting for all applications."* contextIsolation prevents prototype-pollution attacks against built-ins; nodeIntegration: false stops the renderer from `require('child_process').exec(...)` directly; sandbox: true applies the Chromium OS-level sandbox.

### 3.2 Strict Content-Security-Policy

Set a CSP header from main, not just a `<meta>` tag (CSP via meta has a documented enforcement gap before `readyState=interactive`, fixed in Electron 24.x via CVE-2023-23623):

```ts
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self';",
        "script-src 'self';",
        "style-src 'self' 'unsafe-inline';",   // syntax-highlighting CSS
        "img-src 'self' data:;",
        "font-src 'self' data:;",
        "connect-src 'none';",                  // offline app — no network
        "object-src 'none';",
        "base-uri 'none';",
        "frame-ancestors 'none';",
      ].join(' '),
    },
  });
});
```

`connect-src 'none'` is the load-bearing line — this is an offline app. If a malicious markdown tries to exfiltrate data via `fetch()`, CSP blocks it.

### 3.3 Safe Markdown Rendering

Use `react-markdown` with `remark-gfm`. **Do NOT add `rehype-raw`** — this is the single biggest XSS vector in markdown viewers (it allows raw HTML, including `<iframe>` and `<script>` after sanitization gaps).

```tsx
// renderer/src/components/MarkdownView.tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownView({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // No rehype-raw, no rehype plugins that allow HTML.
      urlTransform={(url) => {
        const lower = url.toLowerCase().trim();
        if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) return '#';
        if (lower.startsWith('data:') && !lower.startsWith('data:image/')) return '#';
        return url;
      }}
      components={{
        a: ({ href, children, ...props }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault();
              if (href) window.api.openExternal(href);
            }}
            {...props}
          >
            {children}
          </a>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
```

Why this is safe by default — per the react-markdown README: *"Use of react-markdown is secure by default. Overwriting urlTransform to something insecure will open you up to XSS vectors."* react-markdown converts markdown tokens directly to React elements (no `dangerouslySetInnerHTML`), and the default `urlTransform` already neutralizes `javascript:`, `vbscript:`, and `file:` protocols. Raw HTML in markdown renders as escaped text.

If you ever add `rehype-raw` later, mandatorily pair it with `rehype-sanitize` (default GitHub schema). For v1 you don't need either.

### 3.4 Safe JSON Parsing

```ts
// renderer/src/lib/parseJson.ts
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB cap

export function parseJsonSafe(text: string): unknown {
  if (text.length > MAX_BYTES) {
    throw new Error(`File too large (${(text.length / 1e6).toFixed(1)} MB > 50 MB)`);
  }
  // JSON.parse cannot trigger prototype pollution by itself, but objects with
  // __proto__/constructor keys can be written into Object.prototype downstream
  // if you spread/merge them carelessly.
  const reviver = (key: string, value: unknown) => {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return undefined;
    }
    return value;
  };
  return JSON.parse(text, reviver);
}
```

For very large files (>10 MB), render the JSON tree virtually (`react-window` or similar). For v1, hard-cap and show a clear error.

### 3.5 File Path Validation in IPC

The renderer should never pass arbitrary paths to main. Either:
1. The renderer asks main to show the OS file picker; main returns the path; main reads the file and returns content.
2. Or the renderer drag-drops a `File` object and reads via `webUtils.getPathForFile(file)` in preload.

Validate paths in main:

```ts
// src/main/ipc/files.ts
import { ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'JSON / Markdown', extensions: ['json', 'md', 'markdown'] }],
  });
  if (canceled || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  if (filePath.includes('\0')) throw new Error('Invalid path');
  const ext = path.extname(filePath).toLowerCase();
  if (!['.json', '.md', '.markdown'].includes(ext)) throw new Error('Unsupported file type');
  const stat = await fs.stat(filePath);
  if (stat.size > 50 * 1024 * 1024) throw new Error('File too large');
  const content = await fs.readFile(filePath, 'utf8');
  return { filePath, content, ext };
});
```

### 3.6 contextBridge Bridge Pattern

```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('open-file'),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  getVersion: () => ipcRenderer.invoke('get-version'),
});
```

Type it on the renderer side:

```ts
// renderer/src/api.d.ts
export interface AppAPI {
  openFile: () => Promise<{ filePath: string; content: string; ext: string } | null>;
  openExternal: (url: string) => Promise<void>;
  getVersion: () => Promise<string>;
}
declare global { interface Window { api: AppAPI; } }
```

**Anti-pattern:** never `contextBridge.exposeInMainWorld('electron', { ipcRenderer })`. That re-exposes the entire IPC surface to the renderer — an XSS becomes an RCE.

### 3.7 Block Navigation and New Windows

```ts
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
```

For an offline viewer, there's no legitimate reason to navigate or open a window from the renderer — deny everything.

---

## 4. macOS Distribution — Full Pipeline

### 4.1 Certificate & Setup

After Apple Developer enrollment (§1.1):
1. Open **Certificates, Identifiers & Profiles** → **+** → **Developer ID Application**.
2. Create CSR via Keychain Access → Certificate Assistant → Request a Certificate. Save the `.certSigningRequest`.
3. Upload CSR; download the signed `.cer`. Double-click to install in Keychain.
4. Right-click the cert in Keychain → Export → save as `developer-id.p12` with a strong password. **This is what goes into CI as `CSC_LINK`/`CSC_KEY_PASSWORD`** (electron-builder reads `CSC_LINK` as base64 or path to the `.p12`).
5. Generate an App Store Connect API key with **Developer** role. Save the `AuthKey_XXXXXXXX.p8`, the Key ID, and the Issuer ID. Prefer this to app-specific passwords for `notarytool` — per electron-builder docs: *"For security reasons it is recommended to use the first option [API key]."*

### 4.2 Hardened Runtime + Entitlements

For an Electron 28+ app with no native modules, the minimum entitlements are:

```xml
<!-- build/entitlements.mac.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
</dict>
</plist>
```

Per `@electron/notarize` README:
- **`com.apple.security.cs.allow-jit`** is required — V8 generates JIT'd code. *"Your app may need to be signed with hardenedRuntime: true option, with the com.apple.security.cs.allow-jit entitlement."*
- **`com.apple.security.cs.allow-unsigned-executable-memory`** is **NOT** needed on Electron 12+. Per the README: *"If you are using Electron 11 or below, you must add the com.apple.security.cs.allow-unsigned-executable-memory entitlement too. When using version 12+, this entitlement should not be applied as it increases your app's attack surface."*
- `com.apple.security.cs.disable-library-validation` only needed if you load unsigned external libraries (you don't).
- You don't need network entitlements (offline app), file-access entitlements (Gatekeeper handles user-selected files automatically), or `cs.allow-dyld-environment-variables`.

### 4.3 electron-builder mac Config

```yaml
# electron-builder.yml
appId: dev.yourname.jsonmdviewer
productName: JSON MD Viewer
directories:
  output: release
  buildResources: build
files:
  - 'out/**/*'
  - 'package.json'
asar: true

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
  sign: false       # only the .app needs signing; signing the dmg is redundant
```

**Universal vs. separate arm64 + x64?** **Recommendation for 2026: ship separate arm64 and x64 DMGs.** Apple Silicon has been default for 5 years; the universal binary roughly doubles download size for negligible UX gain. Users on Apple Silicon don't need x64 binaries; users on Intel Macs are a shrinking minority and don't need arm64. Separate-build approach also makes notarization marginally faster (smaller upload). The DMG download list on the GitHub Releases page makes the choice obvious to users.

The `zip` target alongside `dmg` is required if you ever wire `electron-updater` (Squirrel.Mac auto-update reads from the zip). It's free to keep — per electron-builder docs: *"Squirrel.Mac auto update mechanism requires both dmg and zip to be enabled, even when only dmg is used. Disabling zip will break auto update in dmg packages."*

### 4.4 Notarization with `notarytool`

Use electron-builder's `afterSign` hook:

```js
// scripts/notarize.cjs
const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;
  if (process.env.SKIP_NOTARIZE === 'true') return;
  const appName = context.packager.appInfo.productFilename;
  return await notarize({
    tool: 'notarytool',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
```

Add to `electron-builder.yml`: `afterSign: scripts/notarize.cjs`.

**Stapling:** electron-builder runs `xcrun stapler staple` on the `.app` and `.dmg` automatically after notarization succeeds. Verify with `xcrun stapler validate path/to/App.dmg`.

**API key vs. app-specific password:** prefer the API key (issuer ID + key ID + .p8) — Apple recommends it and `notarytool store-credentials` validates the key before submission. For CI, you can swap the env vars above for `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, and `APPLE_API_KEY` (path to the .p8 in CI).

### 4.5 Common Notarization Rejection Reasons

1. **Signature missing secure timestamp** — happens only if you've custom-signed without `--timestamp`. electron-builder does this correctly.
2. **Binary uses an SDK older than 10.9** — modern Electron is fine; this hits old bundled binaries.
3. **Hardened runtime not enabled on a nested binary** — every helper executable must inherit hardened runtime. `entitlementsInherit` exists for this.
4. **Embedded binaries not signed** — for a pure JS Electron app you have none, but if you ever bundle a native module (e.g., better-sqlite3), it must be signed individually.
5. **Notarization "stuck in progress"** — Apple's queue can spike. Per recent Apple Developer Forums posts, multiple developers reported submissions stuck *"In Progress (15+ hours)"* and *"24+ hours with no progress"* in April 2026 during high-load periods. **Plan releases for off-peak hours**, not 9 AM PT on a Monday.

Debug: `xcrun notarytool log <submission-id> --apple-id ... --team-id ... --password ...` returns JSON with per-file issues.

### 4.6 Gatekeeper UX Even With Proper Signing

Even fully signed + notarized + stapled, **first-launch users still see a "JSON MD Viewer is an app downloaded from the Internet. Are you sure you want to open it?"** dialog with **Open** / **Cancel**. Notarization removes the more aggressive "cannot be opened because the developer cannot be verified" block; it does not remove the standard quarantine prompt. Document this in the README so users know it's normal.

### 4.7 Time Investment

| Task | First-time | Subsequent releases |
|---|---|---|
| Apple enrollment + cert generation | 1–4 hours active + waiting | 0 |
| `entitlements.mac.plist` + electron-builder config | 1 hour | 0 |
| Local notarization smoke test | 1–2 hours (incl. queue wait) | 5–30 min |
| Debug first failed notarization | 0–4 hours (likely needed) | rare |
| **Total first time** | **~half a day active** | — |

---

## 5. Windows Distribution — Two Paths

### Path A: Skip Signing (Recommended for v1)

**What users see:**

1. Download `JSON-MD-Viewer-Setup-1.0.0.exe` from GitHub Releases.
2. Double-click → SmartScreen blue dialog: *"Windows protected your PC. Microsoft Defender SmartScreen prevented an unrecognized app from starting. Running this app might put your PC at risk."*
3. The "Don't run" button is prominent. Path forward: click **More info** → SmartScreen reveals **Publisher: Unknown publisher** + **Run anyway** button.
4. After Run anyway, the NSIS installer opens normally.
5. Some users will also see Microsoft Defender Antivirus quarantine the installer briefly while it submits the hash for analysis. Usually auto-resolves within seconds.

**This is acceptable for free OSS v1.** Many beloved OSS apps (Logseq, Joplin, Standard Notes early on, Obsidian's beta phase) shipped unsigned for years. **Document it explicitly in the README:**

```markdown
## Windows install note

JSON MD Viewer is **not yet code-signed on Windows** (we plan to add Azure
Artifact Signing in v1.1). When you run the installer for the first time,
Windows SmartScreen will show:

> Windows protected your PC

Click **More info** → **Run anyway**. This is expected for unsigned freeware.
The installer is built deterministically by GitHub Actions from public source —
re-run the workflow yourself on your fork to verify.
```

**electron-builder config:**

```yaml
win:
  target:
    - target: nsis
      arch: [x64]
  # No signing config = unsigned build. Builder will print a warning.

nsis:
  oneClick: false              # show wizard (lets users choose install dir)
  perMachine: false            # per-user install (no admin required)
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: JSON MD Viewer
```

`oneClick: false` and `perMachine: false` together avoid the UAC elevation prompt — additional friction for unsigned apps.

### Path B: Azure Artifact Signing (When You're Eligible)

Setup steps are in §1.3. Once your account is provisioned, certificate profile is created, and identity is validated:

```yaml
win:
  target:
    - target: nsis
      arch: [x64]
  azureSignOptions:
    publisherName: "Your Legal Name"           # MUST match cert CN
    endpoint: "https://eus.codesigning.azure.net/"
    certificateProfileName: "json-md-viewer-profile"
    codeSigningAccountName: "your-artifact-signing-account"
```

Per the electron-builder Windows docs: *"By setting the property win.azureSignOptions in your electron-builder configuration… the environment variables are read directly by the Invoke-TrustedSigning module; they are not parsed or resolved by electron-builder."*

CI environment variables:
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

**Important caveats from real-world reports:**

1. **Signing must run on `windows-latest`**, not Linux Docker — issue #8649 documents the `TrustedSigning` PowerShell module requiring Windows. If you must use Linux runners, fall back to `jsign` 7.0+ via a custom `signtoolOptions.sign` function.
2. **NuGet/PowerShell dependency installation is fragile** in CI (issue #8828). Pre-install the modules in a step before electron-builder runs:
   ```yaml
   - name: Install Trusted Signing PS module
     if: matrix.os == 'windows-latest'
     shell: pwsh
     run: |
       Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser
       Install-Module -Name TrustedSigning -RequiredVersion 0.5.0 -Force -Scope CurrentUser -Repository PSGallery
   ```
3. **Concurrency bugs** when signing many files in parallel (issue #8700) — set `signingHashAlgorithms: ['sha256']` and avoid `signExts` overrides.

**SmartScreen reputation post-signing:** Per Microsoft Learn's *SmartScreen reputation for Windows app developers* doc:

> "SmartScreen reputation is per file hash — every new build of your app starts with zero reputation. Reputation does not transfer from previous versions."

> "First downloads: Users may see a SmartScreen prompt indicating the app is unrecognized. For signed apps, the publisher name is displayed — the warning is about low file reputation, not an unknown publisher."

> "As downloads accumulate: SmartScreen reputation builds up automatically. The prompt will stop appearing once the file hash has sufficient download history. Based on developer reports, this typically takes several weeks and hundreds of clean installs — there is no exact threshold Microsoft publishes."

So an Artifact Signing-signed v1.0 still shows a SmartScreen warning on first download for the first many users; the warning text is friendlier ("Publisher: Your Name" instead of "Unknown publisher") and the "Run anyway" button is one click away. Reputation is per-hash, so v1.0.1 starts over.

**Comparison with old EV cert:** $300–500/yr for a hardware token, manual ceremony to plug into your CI machine, no SmartScreen bypass anymore (since 2024 — see §1.3). Azure Artifact Signing wins on every axis except availability (US/Canada/EU/UK only).

---

## 6. Build Automation with GitHub Actions

### 6.1 Multi-OS Matrix Workflow

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: write   # required to publish releases

jobs:
  release:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-14         # arm64 hardware
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

      - name: Build & publish (win, unsigned — Path A)
        if: matrix.target == 'win'
        run: npm run build && npx electron-builder --win --x64 --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # Path B alternative — replace the Path A win step with these two:
      # - name: Install Trusted Signing module
      #   if: matrix.target == 'win'
      #   shell: pwsh
      #   run: |
      #     Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser
      #     Install-Module -Name TrustedSigning -RequiredVersion 0.5.0 -Force -Scope CurrentUser -Repository PSGallery
      # - name: Build & publish (win, signed)
      #   if: matrix.target == 'win'
      #   run: npm run build && npx electron-builder --win --x64 --publish always
      #   env:
      #     GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      #     AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
      #     AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
      #     AZURE_CLIENT_SECRET: ${{ secrets.AZURE_CLIENT_SECRET }}

      - name: Build & publish (linux)
        if: matrix.target == 'linux'
        run: npm run build && npx electron-builder --linux AppImage --x64 --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 6.2 Required Secrets

| Secret | Source | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | auto-provided | publish to GitHub Releases |
| `APPLE_ID` | your Apple Account email | notarytool auth |
| `APPLE_APP_SPECIFIC_PASSWORD` | appleid.apple.com → Sign-In and Security → App-Specific Passwords | notarytool auth |
| `APPLE_TEAM_ID` | developer.apple.com membership page | notarytool team ID |
| `MAC_CERTS` | base64-encoded `.p12` of Developer ID Application cert (`base64 < developer-id.p12 \| pbcopy`) | electron-builder reads as `CSC_LINK` |
| `MAC_CERTS_PASSWORD` | password you set when exporting the .p12 | unlock the .p12 |
| `AZURE_TENANT_ID` | Entra ID tenant | Path B only |
| `AZURE_CLIENT_ID` | App Registration client ID | Path B only |
| `AZURE_CLIENT_SECRET` | App Registration secret value | Path B only |

Optional: switch APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD for `APPLE_API_KEY` (base64 of .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` — Apple recommends API key auth.

### 6.3 Trigger on Tag Push

The workflow above triggers only on `v*.*.*` tags. Release flow:

```bash
npm version 1.0.0  # commits and tags
git push --follow-tags
```

This pushes the commit + the `v1.0.0` tag, triggering the workflow. electron-builder's GitHub publisher creates a **draft** release on tag push and uploads all artifacts. Edit and publish from the GitHub web UI when ready.

### 6.4 Caching

`actions/setup-node@v4` with `cache: 'npm'` already caches `~/.npm`. To explicitly cache the Electron binary:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/electron
      ~/.cache/electron-builder
    key: ${{ runner.os }}-electron-${{ hashFiles('package-lock.json') }}
```

Saves ~2 min on macOS runs.

### 6.5 Estimated CI Minutes Per Release (private repo)

GitHub Actions billing applies multipliers for non-Linux runners against private-repo quotas: per the official GitHub docs, *"Windows runners have a 2x multiplier and macOS runners have a 10x multiplier."*

| Runner | Wall time | Multiplier | Effective minutes |
|---|---|---|---|
| ubuntu-latest | ~5 min | 1× | 5 |
| windows-latest | ~10 min | 2× | 20 |
| macos-14 (arm64) | ~12 min (slower runners + notarization wait) | 10× | 120 |
| **Total per release** | — | — | **~145 minutes** |

The Free plan includes 2,000 minutes/month for private repos, so you'd get ~13 releases/month before paying. **Public repos: all of this is free, unlimited.** Make the repo public.

---

## 7. Auto-Update for v1: Just Don't

For v1, ship a **menu item that opens the GitHub releases page**:

```ts
// src/main/menu.ts
import { Menu, shell, app } from 'electron';

const menu = Menu.buildFromTemplate([
  // ... standard menu items ...
  {
    label: 'Help',
    submenu: [
      {
        label: `Check for updates (current: v${app.getVersion()})`,
        click: () => shell.openExternal('https://github.com/you/json-md-viewer/releases'),
      },
      { label: 'About', click: () => { /* show about dialog */ } },
    ],
  },
]);
Menu.setApplicationMenu(menu);
```

**Why deferring auto-update is fine:**
- electron-updater needs you to publish `latest.yml` / `latest-mac.yml` / `latest-linux.yml` metadata files alongside the artifacts (electron-builder does this automatically) — but if you misconfigure it, users on v1.0.0 may get half-broken updates.
- macOS auto-update via Squirrel.Mac requires a signed + notarized .zip alongside the .dmg.
- Windows auto-update via NSIS requires the installer to be signed (otherwise Windows blocks the silent update).
- For a JSON/MD viewer, users won't update urgently — the open-browser approach is fine.

**v1.1 path:** Add `electron-updater`, set `publish: { provider: 'github' }`, and call `autoUpdater.checkForUpdatesAndNotify()` on app start. electron-builder already publishes to GitHub Releases with the right metadata. Or use the free `update.electronjs.org` service via `update-electron-app` (requires public GitHub repo + valid SemVer tags + non-draft, non-pre-release).

---

## 8. Linux as a Bonus (AppImage Only)

Add to `electron-builder.yml`:

```yaml
linux:
  target:
    - target: AppImage
      arch: [x64]
  category: Utility
  synopsis: Free JSON and Markdown file viewer
  description: |
    Open and read JSON files (with collapsible tree view) and Markdown files
    (with safe rendering) on the desktop. Offline. No telemetry.
  icon: build/icon.png   # 512x512 PNG
```

Notes:
- **No code signing on Linux** — AppImage doesn't have a built-in signing mechanism. Some distros prompt about executability; users `chmod +x JSON-MD-Viewer-1.0.0.AppImage` and run.
- **File dialogs** use the native portal on GNOME/KDE; Electron handles this automatically — no extra config.
- **Drag-drop** works the same as on macOS/Windows.
- **Skip Snap/Flatpak for v1.** Snap requires a Snapcraft account + token (`action-snapcraft`); Flatpak requires manifest hosting + Flathub PR review. Neither is worth it for v1.

The AppImage is built on `ubuntu-latest`. Don't try to put the AppImage inside another archive — per electron-builder docs: *"Please do not put an AppImage into another archive like a .zip or .tar.gz."*

---

## 9. Pre-Launch Checklist

### 9.1 Icons (the most common forgotten item)

- **macOS:** `build/icon.icns` containing 16, 32, 64, 128, 256, 512, 1024 px (and @2x retina). Use `iconutil` or `electron-icon-builder` (`npx electron-icon-builder --input=./icon-1024.png --output=./build`).
- **Windows:** `build/icon.ico` with 16, 24, 32, 48, 64, 128, 256 px embedded.
- **Linux:** `build/icon.png` at 512×512.
- electron-builder picks these up automatically by name from `buildResources` directory.

### 9.2 About Dialog

```ts
import { app, dialog, shell } from 'electron';
dialog.showMessageBox({
  type: 'info',
  title: 'About JSON MD Viewer',
  message: 'JSON MD Viewer',
  detail: `Version ${app.getVersion()}\n\nMIT License\nhttps://github.com/you/json-md-viewer\n\nNo telemetry. No network. Offline.`,
  buttons: ['OK', 'View on GitHub'],
}).then(({ response }) => {
  if (response === 1) shell.openExternal('https://github.com/you/json-md-viewer');
});
```

On macOS, `app.setAboutPanelOptions({...})` provides the standard About panel.

### 9.3 LICENSE

Create `LICENSE` at repo root. **MIT** is the simplest choice (copy from choosealicense.com/licenses/mit/). Apache-2.0 if you want explicit patent grant; ISC if you want even shorter. Avoid GPL for a viewer (annoys downstream tools).

### 9.4 Privacy Statement (Even for an Offline App)

Add to README under "## Privacy":

> JSON MD Viewer makes **zero network requests**. No telemetry, no analytics,
> no crash reports, no auto-update checks. Files you open never leave your
> machine. The only network access is when you click an external link in a
> markdown file (which opens in your default browser, not in the app).
>
> Verify: the app's CSP includes `connect-src 'none'`.

This is increasingly important — users (especially developers) actively filter on "no telemetry."

### 9.5 README

Required sections:
- One-line description + screenshot.
- Install instructions per OS (with the SmartScreen click-through callout for Windows if unsigned).
- Keyboard shortcuts (⌘O / Ctrl+O to open, drag-drop, etc.).
- Privacy statement (above).
- Build from source (`npm install`, `npm run dev`, `npm run build`).
- License.

### 9.6 First-Run Experience

- Show the empty state with a big "Open File" button + "or drag a .json or .md file here" zone.
- Optionally bundle 2–3 sample files in `resources/samples/` and offer "View sample" links.
- Persist a "recent files" list in `app.getPath('userData')/recent.json` (max 10 entries). This is the one piece of state v1 should persist (alongside theme).

---

## 10. What v1 Explicitly Does NOT Need

Cut all of these. Each is a multi-day rabbit hole:

| Feature | Why skip for v1 |
|---|---|
| **Auto-update infrastructure** | Menu link to releases page is enough. v1.1 adds electron-updater. |
| **Crash reporting (Sentry)** | Adds a network dep that contradicts your "no telemetry" promise. Add later if real users hit crashes. |
| **Telemetry/analytics** | Your privacy story is the marketing. |
| **Accessibility audit** | Use semantic HTML and you'll be 80% there; full audit is v2. |
| **Internationalization (i18n)** | English-only is fine for v1. `react-i18next` adds bundler complexity. |
| **File associations (.json, .md as default opener)** | Conflicts with VS Code, Notepad++, etc. Users actively don't want this. |
| **Plugin system** | YAGNI. Your app is a viewer. |
| **Settings beyond theme** | Recent files + theme is enough. No preferences window. |
| **Marketing website** | GitHub README + releases page is your marketing. |
| **Microsoft Store / Mac App Store** | App Store requires sandboxing rework + review delays. Free OSS doesn't need it. |

---

## 11. Realistic Timeline

For a solo experienced developer using Claude Code Max with worktree-parallel:

| Phase | Calendar time | Active work |
|---|---|---|
| **Day 0 (parallel):** Apple enrollment, Azure Artifact Signing onboarding (if Path B), GitHub repo init, license, README scaffold | wait 1 day–2 weeks | 1 hour |
| **Day 0–1:** Scaffolding (`npm create @quick-start/electron@latest`), strip demo code, set up CSP + security baseline, install agent-browser skill | 0.5 day | 0.5 day |
| **Day 1–3:** Core viewer — JSON tree, Markdown render, file open dialog, drag-drop, theme toggle, recent files, About dialog, native menu | 2 days | 2 days |
| **Day 3.5:** macOS signing/notarization first-time setup, run a real notarization end-to-end on local machine | 0.5 day (incl. queue) | 0.5 day |
| **Day 4:** Windows path. Path A: 0.5 day. Path B: 1 day + waiting for Azure validation (start on day 0) | 0.5–1 day | 0.5–1 day |
| **Day 4–5:** GitHub Actions release workflow, secrets, first end-to-end tag → release | 1 day | 1 day |
| **Day 5–7:** Polish — empty state, edge cases (huge JSON, malformed markdown), real-machine testing, screenshots for README | 1–2 days | 1–2 days |
| **Total** | **5–8 days focused** + Apple/Azure calendar wait | — |

Critical-path lever: **start Apple enrollment and (if Path B) Azure Artifact Signing identity validation on the very first day.** They run in parallel with everything else.

---

## 12. Common Gotchas and Pitfalls

1. **Notarization can fail silently when entitlements are wrong.** `notarytool` returns "Accepted" but Gatekeeper still blocks the app on launch. Always test the notarized DMG on a *different* Mac (or one where `xattr -dr com.apple.quarantine` was never run on this app's bundle).

2. **electron-builder version vs. Electron version compatibility.** electron-builder ≥ 26 is required for Azure Artifact Signing's `azureSignOptions`. electron-builder 24/25 work for everything else. Pin major versions in `package.json`.

3. **Native modules complicate signing.** A pure JSON/markdown viewer should have **zero native deps**. Verify with `npm ls --prod | grep -i 'gyp\|node-pre\|prebuild'`. If anything shows up (better-sqlite3, sharp, fsevents on non-mac), you'll need extra signing config (`binaries:` array in mac config) and your CI matrix gets uglier.

4. **macOS universal binary vs. separate builds:** universal doubles download size. For 2026, separate arm64 + x64 is cleaner — but you need `arch: [arm64, x64]` in target config so each gets its own DMG.

5. **Windows Defender false positives on unsigned binaries.** Defender hash-submits unknowns to Microsoft. New unsigned NSIS installers occasionally get quarantined for 1–24 hours until Microsoft's automated analysis clears them. Mitigate by reusing app name (helps reputation) and posting hash on GitHub release notes so users can verify.

6. **GitHub Actions macOS runners are SLOW** compared to your local M-series Mac. Notarization adds 5–30 minutes of pure waiting (the `notarytool submit --wait` call blocks). A macOS runner job typically takes 12–20 minutes. **Budget for it** — don't tag at 4:55 PM Friday hoping to validate before EOD.

7. **Apple notarization queue can take 5–30 minutes during business hours, longer during peak load.** Multiple Apple Developer Forums posts in April 2026 reported 24+ hour stalls. The Apple System Status page (developer.apple.com/system-status) shows the Notary Service status. Plan to tag releases off-peak (early morning Pacific time) when the queue is short.

8. **The `Microsoft.CodeSigning` resource provider name is unchanged** even after the Trusted Signing → Artifact Signing rebrand. Expect documentation in the wild to use both names interchangeably for the next year.

9. **Azure billing starts the second you create the Artifact Signing account, and is not pro-rated.** Don't create it on day 1 if you're still 2 weeks from your first signed build — wait until the week before. Set a budget alert ($20/mo cap) immediately.

10. **electron-builder + Azure Trusted Signing concurrency bugs**: Issue #8700 reports the `TrustedSigning` PowerShell module being re-installed on every file signed in parallel, causing failures. Mitigate by pre-installing the module in a separate CI step before electron-builder runs (snippet in §5 Path B above).

11. **Don't commit `.env` files with Apple/Azure credentials.** Add to `.gitignore` and use GitHub Secrets exclusively for CI.

12. **The CSP must be set via HTTP header (`onHeadersReceived`), not just `<meta>`**. CVE-2023-23623 (fixed in Electron 24.x) showed `<meta>` CSP enforcement gap — *"Fixed an issue with Content-Security-Policy not being correctly enforced when sandbox: false and contextIsolation: false"* — and a remaining 24.1.0 regression (#48240) where CSP was applied only after `readyState=interactive`. Header-based CSP closes the gap.

---

## Recommendations (Staged, Decision-Ready)

**Day 0 — Do these in parallel before writing code:**
1. Enroll Apple Developer Program as Individual ($99). Set up 2FA, legal-name Apple ID. Generate Developer ID Application cert + App Store Connect API key as soon as enrollment clears.
2. Create public GitHub repo. Add MIT LICENSE, README scaffold with privacy section.
3. **Decide Windows Path A or B** based on eligibility (US/Canada individual or US/Canada/EU/UK org → eligible for B). If Path B, start Azure subscription + Artifact Signing account + identity validation on day 0; expect 1–2 weeks.

**Day 1–4 — Build the app:**
4. Scaffold with `npm create @quick-start/electron@latest viewer -- --template react-ts`.
5. Install `npx skills add vercel-labs/agent-browser --skill electron` for AI-driven smoke testing.
6. Implement security baseline (§3) in the very first commit, not as a final pass.
7. Build the viewer — JSON tree (use a virtualized list above 1MB files), `react-markdown` + `remark-gfm` (no `rehype-raw`), file open IPC, drag-drop, theme.
8. Add native menu with About dialog and "Check for updates" → opens GitHub releases.

**Day 4–5 — Ship pipeline:**
9. Configure electron-builder for mac (arm64 + x64 separate DMGs, hardened runtime, `allow-jit` only), windows (NSIS x64), linux (AppImage x64).
10. Wire `.github/workflows/release.yml` with the matrix in §6. Test with a `v0.0.1` pre-release tag end-to-end before tagging v1.0.0.

**Day 5–8 — Polish and ship:**
11. Test the actual produced installers on a clean macOS machine and a clean Windows VM (free Windows 11 dev VMs from Microsoft work). Verify Gatekeeper / SmartScreen prompts match what your README describes.
12. Tag `v1.0.0`, edit the auto-drafted GitHub release with screenshots and changelog, publish.

**Benchmarks that should change recommendations:**
- If you grow past **500 weekly downloads**, add opt-in Sentry crash reporting (still no telemetry, just opt-in crash reports).
- If you accept **PRs from other contributors**, add `actions/dependency-review` to the workflow.
- If you ever ship a feature that needs network (e.g., remote markdown URL fetching), revisit the CSP `connect-src 'none'` decision and the privacy statement.
- If your app exceeds **200MB compressed**, switch macOS to universal binary (the size penalty matters less when the base is already large).
- If you start hitting Azure Artifact Signing's 5,000 signatures/month (Basic) — every file inside the .app gets signed individually, so this is plausible — upgrade to Premium ($99.99/mo, 100K signatures).

---

## Caveats

- **Pricing and timelines are accurate as of May 2026** but Microsoft and Apple revise both regularly. Re-verify Azure Artifact Signing eligibility for your country before paying — eligibility expanded in 2026 and may continue to.
- **Notarization wait times are non-deterministic.** Apple does not commit to SLAs. The 5–30 min number is typical; outliers of 24+ hours happen.
- **SmartScreen reputation thresholds are not public.** Microsoft Learn explicitly says *"there is no exact threshold Microsoft publishes."* Plan for several weeks of warnings even with proper signing.
- **electron-builder's Azure Trusted Signing integration was beta in 25.x and stabilized in 26.x.** GitHub issues #8700, #8649, and #8828 document edge cases (Linux Docker incompatibility, NuGet/PowerShell module install failures). Sticking with `windows-latest` runners and pre-installing the `TrustedSigning` PowerShell module avoids most of them.
- **The Vercel Labs agent-browser project is early.** Per Pulumi's 2025 review: *"Agent-browser is early. Documentation is thin, and I read the source more than once to figure out edge cases."* The `electron` skill is well-suited for your use case but is not a replacement for Playwright if you ever need network interception, multi-tab testing, or PDF generation.
- **GitHub Actions pricing is shifting in 2026.** Per the GitHub Changelog of December 16, 2025, hosted-runner per-minute prices were reduced (up to 39%) effective January 1, 2026. A separately announced $0.002/minute charge for self-hosted runners — originally scheduled for March 1, 2026 — was postponed: *"We're postponing the announced billing change for self-hosted GitHub Actions to take time to re-evaluate our approach."* Standard hosted runners on **public repos remain free**; verify on the GitHub billing docs page when you're reading this.

The app will need to access the internet to push local files to a server and someday read files from the server and store them on disk. What should I change?

May 2
Claude responded: Good catch — that changes a few things in the security baseline, the privacy story, and the v2 roadmap.
Good catch — that changes a few things in the security baseline, the privacy story, and the v2 roadmap. Here are the concrete deltas to the report:

What changes immediately
1. CSP connect-src is the big one. The current connect-src 'none' blocks all network requests including yours. Change to allow only your server:

ts
"connect-src 'self' https://api.yourservice.com;"
'self' covers loopback for dev; the explicit HTTPS origin covers prod. Don't use connect-src * — that defeats the point. If your API endpoint isn't decided yet, use a placeholder and tighten before v1 ships. Keep default-src 'self', object-src 'none', and the rest of the CSP as-is.

2. The privacy statement needs a rewrite. The current "zero network requests, no telemetry, files never leave your machine" promise is now false. Replace with something like:

JSON MD Viewer connects to the network only to upload files you explicitly choose to upload, and (in the future) to download files you've previously uploaded. No telemetry, no analytics, no automatic background sync. The app never transmits a file you haven't asked it to transmit.

Network destinations: api.yourservice.com (your account, file storage). No third-party analytics, ad networks, or crash reporters. Verify by inspecting network traffic — the CSP connect-src directive whitelists only this origin.

The "no telemetry, opt-in only" framing is still your marketing edge — just be specific about what network access exists and why.

3. macOS entitlements need network client access. The current entitlements file is missing the network entitlement. For a sandboxed Mac app this is mandatory; for a Developer ID-distributed (non-MAS) app it's strictly speaking not required by Gatekeeper, but you should add it anyway for consistency and because you'll want it if you ever ship to the Mac App Store:

xml
<key>com.apple.security.network.client</key>
<true/>
<key>com.apple.security.cs.allow-jit</key>
<true/>
Don't add com.apple.security.network.server — you're a client, not a server.

4. Where network requests live. Make them in the main process, not the renderer. Two reasons:

The renderer's CSP connect-src constrains it; main-process Node fetch is not bound by CSP. You want the renderer sandboxed; you want main to be the only thing that touches your API.
Auth tokens belong in main, stored via safeStorage (encrypted via OS keychain/DPAPI), never exposed to the renderer.
Pattern:

ts
// main: ipcMain.handle('upload-file', async (_e, fileId) => { ... fetch(API) ... });
// preload: contextBridge.exposeInMainWorld('api', { uploadFile: (id) => ipcRenderer.invoke('upload-file', id) });
The renderer never sees your API URL, your token, or the response shape beyond what you choose to return through IPC.

5. Auth token storage. Use Electron's built-in safeStorage:

ts
import { safeStorage, app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

const tokenPath = path.join(app.getPath('userData'), 'token.bin');

export async function saveToken(token: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS keychain unavailable');
  const encrypted = safeStorage.encryptString(token);
  await fs.writeFile(tokenPath, encrypted);
}

export async function loadToken(): Promise<string | null> {
  try {
    const encrypted = await fs.readFile(tokenPath);
    return safeStorage.decryptString(encrypted);
  } catch { return null; }
}
safeStorage uses Keychain on macOS, DPAPI on Windows, and libsecret/kwallet on Linux. Don't use localStorage for tokens — XSS in the renderer becomes credential theft.

What this opens up that wasn't in scope before
Auth flow. You now need a sign-in. For v1, the simplest option is OAuth-via-browser: open the system browser to your auth endpoint with a loopback redirect URI (http://127.0.0.1:<random-port>), main spins up a temporary HTTP server on that port, receives the code, exchanges for a token, stores via safeStorage. This is the same PKCE flow you used for FamilySearch in your other project — directly portable.

Alternative: device code flow if your backend supports it. Avoid embedding a webview for auth — Google and others actively block webview-based OAuth, and it's a security anti-pattern.

Backend. You need a server. Out of scope for the report but worth flagging: a JSON/markdown file storage API isn't trivial to operate. Options range from S3 + a thin auth layer (cheap, you operate it) to using something like Supabase or Cloudflare R2 + Workers (less ops). For "thousands of users eventually" with free-tier ambitions, R2 + Workers is hard to beat on cost.

Upload UX. Files can be large. You want progress reporting (IPC events from main → renderer), cancel support (AbortController passed to fetch), and retry with exponential backoff for transient failures. Multipart upload if files exceed ~100MB.

Conflict handling for download-and-store. When you fetch a file from the server and write it to disk, what if a local file with that name already exists? What if the local copy is newer? This is sync semantics and gets gnarly fast. Defer to v2: for v1, download with a unique filename or prompt-on-conflict.

Offline-first considerations. What happens when a user opens the app with no network? The viewer should still work for local files — make network failure a soft error in the UI, not a fatal one.

What this doesn't change
The Electron + React + Vite + electron-builder + GitHub Actions stack stays exactly the same. The signing/notarization/Windows pipeline is unchanged. Auto-update deferral is unchanged. Linux AppImage is unchanged. Timeline still 5–8 days for v1, plus probably 2–3 days for the auth + upload flow if you scope it tight.

Updated v1 timeline if upload is in scope
Original v1: 5–8 days.
OAuth loopback flow + token storage: +1 day.
Upload IPC + progress UI + error handling: +1–2 days.
Backend (if you don't have one): variable; assume 2–3 days for a thin S3 + Workers setup.
So 8–13 days for "viewer + upload to server" v1, depending on backend readiness.

Recommendation
Ship the viewer alone as v1.0 (5–8 days), then upload as v1.1 (additive 2–3 days plus backend). Reasons:

The viewer is independently useful. People who don't want a cloud account get a fast local viewer; people who do, upgrade.
The privacy story stays clean for v1 — "zero network, period" is a stronger first impression than "we promise we only network when you ask." You can change the story when there's a feature to justify it.
You decouple the Apple/Azure validation lead time (which is on the critical path) from the backend work (which isn't blocked by anything).
v1.1 is a release where you've already debugged the signing pipeline once — adding network code on top is much lower risk.
