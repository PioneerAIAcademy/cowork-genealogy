# Final Setup & Workflow for Shipping Your Electron v1

You already have gstack installed. This is everything else you need, what to actually use, and when.

## 1\. Install (one-time, \~10 minutes)

\# Browser automation for Electron — replaces gstack /qa, /browse, /setup-browser-cookies

npx skills add vercel-labs/agent-browser \--skill electron

npx skills add vercel-labs/agent-browser \--skill dogfood

\# Anthropic-quality skills for authoring \+ UI work

npx skills add vercel-labs/agent-skills \--skill skill-creator \--skill frontend-design

\# Superpowers — TDD/planning discipline, complements gstack's process

/plugin marketplace add anthropic/claude-plugins-official

/plugin install superpowers@claude-plugins-official

Then write **two custom project skills** with `skill-creator` (do this on day 1, not day 0 — you don't know enough yet):

- `release.md` — your tag → matrix build → notarize → sign → publish flow, executable from "ship v1.0.1"  
- `security-invariants.md` — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no `remote`, CSP `connect-src` whitelist, all IPC validates inputs, tokens via `safeStorage`, no `rehype-raw`, no `eval`, no inline scripts. Claude checks its work against these before opening any PR.

## 2\. The skills you'll actually use

| Skill | Source | When | Why |
| :---- | :---- | :---- | :---- |
| `/office-hours` | gstack | Day 1, before code | Six forcing questions catch scope drift. Writes the design doc the chain reads. |
| `/plan-eng-review` (or `/autoplan`) | gstack | After `/office-hours` | Architecture, IPC contract, edge cases, test plan. **Prime with the Electron addendum** (below). |
| `frontend-design` | Anthropic via Vercel | Whenever writing React UI | Design tokens, component patterns, styling constraints. Visibly improves output. |
| `agent-browser` \+ `electron` skill | Vercel Labs | Per UI change, before merge | Launches your built app via `--remote-debugging-port`, accessibility-tree snapshots, click \+ verify. Closes the "agent codes blind on UI" loop. |
| `/review` | gstack | Per branch, before merge | N+1s, race conditions, missing handlers. Tell it whether the file is main / renderer / preload. |
| Superpowers (auto-triggered) | obra | Background, every session | Forces TDD, writes a plan before code, runs a fresh subagent for code review. Disable with `/plugin disable superpowers` for trivial tasks. |
| `security-invariants.md` | Custom | Per branch | Regression prevention on the rules you already know. |
| `agent-browser` `dogfood` skill | Vercel Labs | Before tagging a release | Exploratory QA — Claude tries to break the app and writes a structured bug report with screenshots. |
| `/cso` | gstack | Pre-launch \+ after every IPC change | Threat discovery (STRIDE, OWASP). **Prime with the Electron addendum.** |
| `/ship` | gstack | Per PR | Sync, test, coverage delta, push, open PR. Stack-agnostic — works fine for Electron. |
| `release.md` | Custom | Per release | One command from "ship v1.0.1" to published GitHub Release. |
| `/retro` | gstack | Weekly | Test-ratio trend, hotspots, what slowed you down. |

## 3\. Skills to ignore (stop second-guessing — these are deliberate)

**From gstack:** `/qa`, `/browse`, `/setup-browser-cookies` (replaced by `agent-browser` \+ `electron`); `/setup-deploy`, `/land-and-deploy`, `/canary` (web-shaped, irrelevant for desktop); `/benchmark` (web vitals); `/plan-ceo-review` and `/plan-design-review` (theater for a solo viewer app); `/design-consultation`, `/design-shotgun`, `/design-html`, `/design-review` (only if your UI is the product — skip for a v1 viewer); `/document-release` (defer to v1.1); `/qa-only`, `/investigate`, `/codex` (use reactively when stuck or worried, not proactively); `/freeze`, `/guard`, `/careful` (only when working near prod data).

**Don't install:** anything from VoltAgent's `electron-pro` subagent — overlaps with what `/cso` \+ `agent-browser/electron` \+ your `security-invariants.md` already cover, and adds context bloat.

## 4\. The two prompt addendums (paste these verbatim)

**For `/plan-eng-review` on day 1:**

"This is an Electron app. The plan must explicitly cover: main/renderer/preload process split with rationale; full IPC channel contract (channel name, direction, payload schema, validation); native dependencies and `@electron/rebuild` strategy; packaging targets (mac arm64/x64, win x64, linux); auto-update mechanism (electron-updater \+ GitHub Releases assumed unless otherwise stated); code-signing and notarization sequence."

**For `/cso` pre-launch and after every IPC change:**

"This is an Electron app. In addition to OWASP Top 10 and STRIDE, audit: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no `remote` module, preload script as sole bridge with explicit `contextBridge.exposeInMainWorld` allowlist, IPC channel input validation (treat renderer as untrusted), CSP on renderer (`connect-src` whitelist), deep-link/protocol-handler validation, `will-navigate` and `will-attach-webview` lockdowns, auto-update signature verification, `safeStorage` usage for any secret material."

## 5\. v1 workflow — two-week shipping plan

### Day 0 — setup (\~2 hours)

- Run installs above.  
- Scaffold with `electron-vite` or `electron-forge`.  
- Initialize git repo, push to GitHub, set up the `release.yml` Actions matrix (mac/win/linux build \+ sign \+ notarize).  
- Write a one-paragraph CLAUDE.md describing the app's purpose and the non-negotiables (Electron, security invariants, target platforms).

### Day 1 — plan (no code, \~3 hours)

1. `/office-hours` — describe the pain, accept the reframe, take the narrowest wedge that's still useful to a real person.  
2. `/plan-eng-review` with the Electron addendum — get architecture, IPC contract, test plan locked.  
3. Use `skill-creator` to draft `security-invariants.md` from the plan's non-negotiables. Don't write `release.md` yet — wait until you've shipped a tag manually once and know what hurts.  
4. Approve the plan, exit plan mode.

### Days 2–8 — build

- Let Claude Code implement against the plan. Superpowers' TDD pressure is automatic; let it run.  
- Use `frontend-design` for any React surface — it's loaded automatically when relevant.  
- After every meaningful chunk: `agent-browser` snapshot of the built app, then `/review` on the diff. Accept auto-fixes; argue with the rest.  
- When stuck on a bug for \>30 minutes: `/investigate` (auto-freezes the module being debugged).  
- Commit to feature branches. Never merge without `/review` passing.

### Days 9–11 — harden

- Run `agent-browser` `dogfood` against a built-and-installed copy of the app (not the dev server). Triage the bug report.  
- `/cso` with the Electron addendum. Fix every High/Critical; document accepted Lows.  
- Run your `security-invariants.md` skill check. Fix any drift.  
- Manually tag a pre-release (`v0.9.0-rc1`) to exercise the matrix build / sign / notarize / publish pipeline. **Now** write `release.md` documenting what you actually did, including the things that broke.

### Day 12 — ship v1

- Final `/review` and `/cso` pass on `main`.  
- `/ship` opens the release PR with coverage delta in the body.  
- Merge.  
- Run `release.md` skill: bump to `v1.0.0`, tag, watch the matrix, edit draft notes, publish.  
- Smoke-test the published artifacts on each platform (auto-update from `v0.9.0-rc1` → `v1.0.0`, code signature, notarization, first-run experience).

### Day 13+ — operate

- After every IPC change: re-run `/cso`. IPC is where Electron apps get owned.  
- Weekly: `/retro`. Watch the test ratio; if it's dropping, pause features and pay back.  
- Bug reports come in: `agent-browser` to reproduce, `/investigate` to root-cause, then standard build → `/review` → `/ship` → `release.md` flow.

## 6\. The two rules that matter most

1. **Never skip `/office-hours` and `/cso`.** Everything else is replaceable; these two prevent the failures (wrong product, security regression) that a v1 can't recover from.  
2. **Write the custom skills the moment you've done a thing twice.** The compounding starts on the third release, not the first. `release.md` and `security-invariants.md` are just the beginning — every recurring pattern in your project should become a SKILL.md within a week of you noticing it.

