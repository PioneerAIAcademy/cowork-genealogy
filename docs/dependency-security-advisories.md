# Dependency security advisories

Tracking note for `pnpm audit` / `npm audit` findings across the repo's two JS
dependency trees (root pnpm workspace — which since #1488 includes `eval/app` —
and `packages/engine/mcp-server` npm). Re-run the audits after any dependency
bump and update this file.

Last reviewed: **2026-11-09**, after issue #4189's toolchain major (vite 8,
`@vitejs/plugin-react` 6, vitest 5, jsdom 30, electron-vite 6). `pnpm audit` still
reports **18 findings (3 low / 7 moderate / 8 high)** and `pnpm audit --prod`
**15 (3 low / 4 moderate / 8 high)**: the same 17 advisories as before the bump, so
nothing cleared and nothing appeared. Every remaining row is under Deferred. The
engine's npm tree is untouched by it (`npm audit --omit=dev` still 0).

> **This file is the mechanism, by decision.** @DallanQ ruled on 2026-09-09 (#2352)
> that no CI job will audit any dependency tree: failing the build, warning without
> failing, and a scheduled run that files an issue were each considered and rejected.
> The gap stays on the `nothing-checks` register as an **accepted** one, which makes
> re-running the audits after any dependency bump and updating this file the only thing
> standing between a new advisory and a shipped artifact.

**Reachability, once, up front — across the two JS trees.** The engine's production tree
(`packages/engine/mcp-server`) audits clean — `found 0 vulnerabilities` on
`npm audit --omit=dev`, restored 2026-11-03 after it had regressed to 8 (see the
engine-tree re-fix under Fixed); `eval/app` is covered by the root `pnpm audit --prod`.
The production-reachable findings
are `electron` and `extract-zip` in `apps/electron`, reached via
`@electron-toolkit/utils` → `electron` (peer) → `extract-zip` (see the two
paragraphs below), plus `zod` 3.x — a production dependency of the internal-only,
loopback-bound Eval CRUD UI (`eval/app`), whose fix is the zod-4 move (issue
#4190). Everything else lives in **devDependencies** — dev tooling
(eslint, vite/vitest, electron-builder, `@anthropic-ai/mcpb`) or the internal-only
Eval CRUD UI. Check reachability with `pnpm why --prod -r <pkg>` — **without `-r`
the command inspects only the root package, which declares no dependencies, so it
returns nothing for everything** (`pnpm why --prod react` is silent even though
`apps/web` depends on it). The `.mcpb` is built with `npm ci --omit=dev`
(`scripts/build-mcpb.mjs`), so dev-tree findings never reach **that** artifact.
Weigh fix churn against that before treating a dev-only HIGH as urgent.

**Scope widened 2026-09-21.** The Dependabot backlog at the end counts the two Python
`uv.lock` trees (`apps/server`, `eval/harness`) as well, and their runtime findings are
recorded under Deferred or Fixed. Since 2026-11-04 it also counts the three
`requirements.txt` files exported from `apps/server/uv.lock` (`sandbox/`,
`proto/worker/`, `proto/web/`). The audits above reach none of the five Python
manifests: Dependabot alerts are their signal, and without alert access the public
advisory database answers the same question (the backlog section has the command).

**`electron` ships, and it is the exception to the paragraph above.** It reaches
production two ways, and either alone is enough. It is in the production graph:
`apps/electron` declares `@electron-toolkit/utils` as a production dependency, which
takes `electron` as a peer — `pnpm why --prod -r electron` shows the edge. And
`apps/electron/electron-builder.yml` sets no `electronVersion`, so electron-builder
packages the runtime at whatever the installed `electron` resolves to. So an advisory
against `electron` reaches every installed Research Viewer, and the `npm ci --omit=dev`
reasoning above does not cover it. Treat `electron` findings as shipping.

**`pnpm audit --prod` reaches through peer edges, and was right here.** It flags
`extract-zip` as production because `@electron-toolkit/utils` — a real production
dependency of `apps/electron` — peer-depends on `electron`, which declares
`extract-zip`. `pnpm why --prod -r extract-zip` prints that path.

## Fixed

- **certifi** (CRITICAL, GHSA-6q48-6c7w-9gw2) and **PyJWT** (every advisory the database
  lists for 2.13.0, up to CRITICAL: GHSA-ffc3-869f-jxw9) — both Python trees and the three
  `requirements.txt` files exported from `apps/server/uv.lock`, runtime. **Fixed
  2026-11-05.** certifi is patched at 2026.10.18. PyJWT needs 2.15.0: most of its
  advisories are patched at 2.14.0, but GHSA-x33g-cr3x-6449 and GHSA-42vr-xj54-vc7v cover
  2.14.0 as well. Both locks now resolve certifi 2026.10.23 and PyJWT 2.15.1 (`apps/server`
  and its exports took both in #4207's pin bump, `eval/harness` in a full
  `uv lock --upgrade`). Severities as the public advisory database gives them.

- **cryptography** (HIGH, GHSA-g6cj-pr64-35w5) — **Fixed 2026-11-05.** Patched at 50.0.0.
  `apps/server` was already on 50.0.2; `eval/harness` moved 49.0.0 → 50.0.2 in a full
  `uv lock --upgrade`. Under Deferred from 2026-09-21 until then.

- **h2** (MEDIUM, GHSA-6hr6-w5qg-qmwg) — `apps/server/uv.lock`. **Fixed 2026-11-05.** Patched at
  4.4.1, which a full `uv lock --upgrade` took (from 4.3.0). Under Deferred from 2026-09-21 until then.

- **mcp** (MEDIUM: GHSA-w4fh-qvv9-3v23, GHSA-5h93-6whr-6q8j, GHSA-rwrf-2pqf-9j8j and
  GHSA-84m7-p3x7-pcfv) — both Python trees and the `sandbox/` and `proto/worker/` exports.
  **Fixed 2026-11-05** by the same `uv lock --upgrade`: 1.28.1 / 1.29.0 → 1.30.0, the 1.x
  patch for all four, so the `<2` cap that keeps `claude-agent-sdk` working stays.

- **hpack** (MEDIUM, GHSA-8v8h-hg4w-mvq2) and **opentelemetry-api** (MEDIUM,
  GHSA-xcq7-p3pf-p88h) — `apps/server/uv.lock` only. **Fixed 2026-11-05** by the same
  `uv lock --upgrade`: hpack 4.1.0 → 4.2.0 (patched at 4.2.0) and opentelemetry-api
  1.44.0 → 1.45.2 (patched at 1.45.1).

- **Root pnpm workspace minor/patch sweep** — **Fixed 2026-11-04** (issue #4185,
  the minor-and-patch half of the 54-alert `pnpm-lock.yaml` backlog; the majors
  each have their own issue, listed under Deferred). Two moves, **no
  `pnpm.overrides` needed** — every floor was reachable inside a declared range:

  - **`pnpm update -r`** from the repo root. In-range only; no package crossed a
    major. Cleared: `undici` 6.28.0 → 6.29.1 (8 alerts, 2 high),
    `brace-expansion` 1.1.18/2.1.4/5.0.9 → 1.1.21/2.1.7/5.0.12 (9 alerts),
    `vite` 7.3.6 → 7.3.7 (5 alerts, 1 high), `fast-uri` 3.1.7 → 3.1.9 (5
    alerts), `ip-address` 10.7.0 → 10.7.6 (3 alerts), `@vitest/mocker` 4.1.11 →
    4.1.12 (2 alerts), `source-map-js` 1.2.1 → 1.2.2 (1 high), and the tree's
    zod-4 copy 4.4.3 → 4.6.7 (under `eslint-plugin-react-hooks`, whose
    `^3.25.0 || ^4.0.0` admits it — the zod *alert* stays open while eval/app's
    3.x copy remains; that is issue #4190).
  - **`next` 15.5.25 → 15.5.29** in `eval/app/package.json` (exact pin kept).
    15.5.28 fixes the critical `GHSA-2464-fhr4-w9xw` (unauthenticated RCE in
    the Image Optimization API via SVG — same no-`images`-block reachability
    argument as the 2026-09-09 Next.js entry below) and the high
    `GHSA-p3m5-59mp-jv5r` (Server Actions DoS); 15.5.27 fixed the two cache
    poisoning mediums. Clears all 4 `next` alerts, including the backlog's
    only pnpm-tree critical. Nothing in CI runs `next build` for eval/app
    (Playwright boots `next dev`), so the production build was run locally —
    see the PR.

  Post-upgrade audits (re-measured 2026-11-05): `pnpm audit` — **18 findings
  (3 low / 7 moderate / 8 high)**; `pnpm audit --prod` — **15 (3 low /
  4 moderate / 8 high)**. Every remaining row is one of the five packages this
  sweep could not clear (electron ×12, extract-zip ×2, glob, minimatch,
  zod 3.x), all recorded under Deferred with the issue that owns each. (An
  earlier run on 2026-11-04 reported 20 / 9-moderate; two moderate advisories
  left the GitHub advisory DB between the runs — same package set, so nothing in
  this PR changed.)

- **vitest / @vitest/mocker** (MODERATE ×2) — root pnpm workspace, dev-only.
  **Fixed 2026-11-04** by the sweep above: all four workspace members then
  declared `^4.1.12` and the lockfile resolved vitest and `@vitest/mocker` at
  4.1.12, outside the advisory range (`< 4.1.12`). Since issue #4189 all five
  members declare `^5.1.0` and the lockfile resolves both at 5.1.0, also outside
  it. The 2026-09-09 deferral below is withdrawn — its "3 → 4 major across
  three packages" premise went stale when the members moved to `^4.1.10`. The
  engine's own copy (`packages/engine/mcp-server/package-lock.json`, a separate
  npm tree) carried its own vitest/mocker alerts until issue #4186 cleared them
  on 2026-11-03 (the entry below).

- **The engine's production tree, a second time** — `packages/engine/mcp-server`.
  **Fixed 2026-11-03.** It had regressed to **8 advisories on `npm audit --omit=dev`
  (3 HIGH, 5 MODERATE)**, all transitive under `@modelcontextprotocol/sdk`: `zod`
  (`<4.6.6`, HIGH), `body-parser`, `@hono/node-server`, `hono`, `fast-uri`,
  `ip-address` and `qs`. Two moves cleared it:

  - **`npx npm@11.12.1 update`** bumped the SDK `^1.30.0` → 1.32.2, which carried
    `body-parser` → 2.4.0 (via `express` 5.3.0), `hono` → 4.13.16,
    `@hono/node-server` → 2.1.6, `fast-uri` → 3.1.9, `ip-address` → 10.7.6 and
    `qs` → 6.17.1 forward. It also cleared every dev-only finding except `tmp`:
    `node-forge` → 1.4.2 (past alert 240 / `GHSA-86w9-cpqp-85rv`, whose range is
    `<=1.4.0` — so despite a null `first_patched_version` in Dependabot, 1.4.2 is
    out of range), plus `vite`, `source-map-js`, `vitest` and `@vitest/mocker`.
  - **A nested `overrides` for `zod`.** `npm update` alone did **not** clear it:
    the dev-only `@anthropic-ai/mcpb` chain anchors a zod 3.x (mcpb depends on
    `zod@^3.25.67` directly) and every `zod-to-json-schema` peer tolerates 3.x, so
    npm deduped the SDK's zod *down* to a shared `3.25.76` — still inside the
    `<4.6.6` range, which has no 3.x patch. A nested override pins just the SDK's
    zod to `^4.6.6` (→ 4.6.7), leaving mcpb's dev-only 3.25.76 untouched:

        "overrides": { "@modelcontextprotocol/sdk": { "zod": "^4.6.6" } }

  Verified: `npm audit --omit=dev` → `found 0 vulnerabilities`; `npm ls --omit=dev`
  shows zod 4.6.7 / sdk 1.32.2 / body-parser 2.4.0; the lockfile is idempotent
  under the pinned `npm@11.12.1` (`check-engine-lockfile`); `make engine-test`
  (11123 tests) and `make typecheck` green. Two small majors rode along:
  `@types/node` 20 → 22 (to match the Node 22 runtime) and `open` 10 → 11 — its
  one caller, the `open(authUrl)` call in `performLogin` (`src/auth/login.ts`),
  keeps the unchanged default import, open 11's `engines` is `node>=20`, and a
  desktop `dev/try-login.ts` launched a browser tab (CI cannot catch an `open`
  launch regression: the call is `.catch(() => {})` and nothing mocks it). What remains in the **full** `npm audit` is dev-only and
  Deferred (`tmp`, and mcpb's zod 3 copy).

- **The engine's entire production tree** — `packages/engine/mcp-server`.
  **Fixed 2026-09-08.** Went from **5 packages carrying 17 advisories** (npm's summary
  line says "5 vulnerabilities" because it counts *packages* and reports each one's
  worst severity) to `found 0 vulnerabilities` on `npm audit --omit=dev`. The five were
  `fast-uri` (4, all HIGH), `hono` (4), `undici` (5), `ip-address` (3) and
  `@hono/node-server` (1). Two moves did it:

  - **Dropped `cheerio`**, an unused production dependency. It was the sole root of
    `undici`, so removing it cleared five advisories permanently rather than rebasing
    them onto a newer version, and took 22 lockfile entries out of the shipped tree
    (128 → 106 non-dev packages). The `.mcpb` went 6,786,824 → 5,484,516 bytes, a
    19.19% reduction, both measured at base `07f1fd31d`.
    *Provenance, since a path-scoped `git log -S` gets this wrong:* `cheerio` was added
    **and used** by `20261a61b` (PR #67, wiki page fetching) — `wikiFetchPage.ts`
    imported `load` from it. It was orphaned by `44f40d6cf`, which switched the wiki
    tools to the pre-crawled markdown corpus. `371e5db55` (PR #293) only renamed
    `mcp-server/` → `packages/engine/mcp-server/` with 0 insertions and 0 deletions,
    which is why a `git log -S` scoped to the current path fingers it. Use
    `git log --follow -S` here.
  - **`npm audit fix --package-lock-only`** for the rest. Lockfile only, no
    `package.json` change beyond the `cheerio` line. `fast-uri` 3.1.5 → 3.1.7,
    `hono` 4.12.27 → 4.13.7, `ip-address` 10.2.0 → 10.7.0, `@hono/node-server`
    1.19.14 → 2.1.1, plus `qs` and `nanoid`. `es-object-atoms` and `hasown` moved as
    incidental re-resolution.

  **On the `@hono/node-server` major, and the deferral it replaces.** The entry removed
  from Deferred said "The patch is 2.0.5, i.e. a **major** bump". That was wrong when
  written: 1.19.15 shipped 2026-07-24 and 1.19.17 on 2026-07-27, both before the
  2026-07-31 deferral, and the advisory range is `<1.19.15`, so the fix existed inside
  the 1.x line. **@DallanQ ruled 2026-09-08** to take 2.1.1 anyway rather than pin 1.x,
  noting he had originally avoided the major because it broke something he no longer
  recalls, and asking that it be verified working. Verified on 2.1.1: production tree
  installs clean under `engine-strict=true`, `tsc` clean, 123 files / 2986 tests pass,
  the real `build/index.js` boots over stdio and serves all 48 tools then advertised with empty stderr (re-measured 2026-09-16 on this branch merged with `main`: `make mcpb` + `scripts/verify-mcpb.sh` boot the packed server and `tools/list` returns all 50, `build_external_search_url` and `sidecar_read` included),
  and `make mcpb` produces a working artifact. At the time hono was unreachable —
  `src/index.ts` constructed only `StdioServerTransport`, and hono is imported solely by
  the SDK's `streamableHttp` transport — and this entry said to revisit when the server
  grew an HTTP transport.
  **Revisited 2026-09-18 (search-agent prototype, D16):** it has one. `build/http.js`
  (`src/http.ts` → `src/http-server.ts`) constructs the SDK's
  `StreamableHTTPServerTransport`, so hono and `@hono/node-server` are reachable **via
  that entrypoint only**. The `.mcpb`'s `build/index.js` still constructs only
  `StdioServerTransport`, so the desktop path is as unreachable as before even though
  `build/http.js` rides along inside the pack. Installed and locked on that date: `hono`
  4.13.7 and `@hono/node-server` 2.1.1 (read from `node_modules/*/package.json`), both
  outside their advisory ranges — the node-server range is `<1.19.15`, and 4.13.7 is the
  version `npm audit fix` moved hono to (4.12.27 →) to clear its four — and
  `npm audit --omit=dev` is still `found 0 vulnerabilities`. **Revisit when** a hono or
  `@hono/node-server` advisory lands: today's exposure is one loopback-bound compose
  service (`apps/server/proto/tools/`), not a public listener.

- **electron** — `apps/electron`, 39.8.5. **Fixed 2026-09-08: 39.8.5 → 39.8.10.**
  **15 advisories, 3 HIGH / 10 MODERATE / 2 LOW**, all published 2026-08-05 and all
  patched inside the 39.8.x line — so this is a patch bump, not the five-major jump to
  44 that `npm view electron version` suggests. Check the patch line before assuming a
  major is required. The three HIGH are `GHSA-h7rp-cf8h-j98x` (context-isolation bypass
  via `Function.prototype.bind` hijack), `GHSA-9f4c-93c8-jc8g` (sandboxed iframe bypasses
  the `allow-popups` restriction) and `GHSA-v3j7-r9gq-3gjw` (custom protocol with
  `supportFetchAPI` but not `corsEnabled`). Worth naming one of the MODERATEs because it
  is this app's own pattern: `GHSA-ff2p-hmqr-hxm4`, contextBridge object copy honors
  prototype setters — `apps/electron/src/preload/index.ts` exposes its bridge with
  `contextBridge.exposeInMainWorld('api', …)`, which is exactly the shape it names.
  These ship (see the electron exception above), which is why they led this pass. The
  diff is one `package.json` line plus the lockfile.

- **@xmldom/xmldom** (MODERATE), **browserslist** (HIGH), **fast-uri** (HIGH ×4),
  **js-yaml** (HIGH), **nanoid** (HIGH GHSA-2v37-7h3g-55p8) — root pnpm workspace,
  dev-only. **Fixed 2026-09-08** with a targeted refresh, no overrides and no
  `package.json` change:

      pnpm update --recursive --lockfile-only @xmldom/xmldom browserslist esbuild fast-uri js-yaml nanoid

  Took the full workspace audit from 11 to 2. `esbuild` did not move on that command
  and was cleared separately, below.

- **esbuild** (LOW, GHSA-g7r4-m6w7-qqqr) — root pnpm workspace. **Fixed 2026-09-09**,
  and its deferral below is withdrawn. That deferral said clearing it needed a vite 7→8
  migration across three packages. It did not: `vite@7.3.6` already satisfies the
  declared `^7.2.6` and declares `esbuild: ^0.27.0 || ^0.28.0`, which admits the 0.28.1
  patch. `pnpm update --recursive --lockfile-only --no-save vite esbuild` moves it to
  0.28.2 with **no `package.json` change in any workspace package** — `--no-save` is
  load-bearing, since without it the command rewrites `vite` in two manifests. Found by
  @clack391 on #2343; the stated reason had gone stale rather than being wrong when
  written.

- **`eval/app`** — **Fixed 2026-09-08**, then **again 2026-09-09**. The first pass was
  `npm audit fix --package-lock-only` and cleared **four** flagged packages, not the one
  originally recorded here: `nanoid` (HIGH GHSA-2v37-7h3g-55p8), `brace-expansion`,
  `browserslist` (two advisories) and `postcss-selector-parser`.
  `baseline-browser-mapping` moved in the same pass but was not among them — its
  advisory only entered the reviewed feed at 20:41 that evening, after the audit that
  flagged the four.

  That claim went stale within hours. Five advisories published 2026-09-08 between 20:46
  and 21:25 UTC — the Next.js pair `GHSA-p293-qw3h-jr36` / `GHSA-2xp9-vwfh-vxw4` plus
  `sharp` — landed after the commit. Cleared 2026-09-09 by `next` → 15.5.25 and the
  `sharp` override → `^0.35.4`, plus `npm update --package-lock-only js-yaml vitest`
  (without which the full audit still reports three). Both audits now report
  `found 0 vulnerabilities`; `tsc` clean, 20 files / 226 tests, `next build` green.

  Neither was exposed, but the two need separate reasons and an earlier revision of
  this entry gave only one. **`GHSA-2xp9-vwfh-vxw4`** is the Image Optimization / AVIF
  path, and the image argument disposes of it: there is no `images` block in
  `next.config.mjs`, so remote URLs are refused at the allowlist gate and `formats`
  defaults to webp; there is no `public/`; and `next/image` is used nowhere.
  **`GHSA-p293-qw3h-jr36` is not an image bug** — it is unauthenticated RCE on
  *windows-hosted* servers, App Router included, with no documented workaround, and
  `eval/app` is App Router and is launched on Windows by `eval/Start.bat`. What limits
  it is the host and the reach, neither of which the image argument touches: it needs a
  Windows filesystem, both npm scripts bind `--hostname 127.0.0.1`, and `middleware.ts`
  403s any non-loopback `Host` on `/api/:path*`. Fixed because it is two lines and this
  file exists to record a clean audit — but "not reachable" has to be argued per
  advisory, not once per bump. **This entry is the argument for #2352:** the tree was clean and
  documented as clean, and was neither eight hours later.

- **tar** (CRITICAL GHSA-23hp-3jrh-7fpw + HIGH GHSA-8x88-c5mf-7j5w + 3 MODERATE),
  **postcss** (HIGH GHSA-r28c-9q8g-f849, source-map path traversal),
  **js-yaml** (HIGH GHSA-52cp-r559-cp3m), **fast-uri** (HIGH GHSA-4c8g-83qw-93j6 +
  GHSA-v2hh-gcrm-f6hx, host confusion), **brace-expansion** (HIGH
  GHSA-3jxr-9vmj-r5cp) — root pnpm workspace, all dev-only (electron-builder,
  eslint, vite/vitest). Fixed 2026-07-31 by a **targeted lockfile refresh**, no
  manifest change: every parent range already permitted the patched version.

      pnpm update -r --depth Infinity tar postcss js-yaml brace-expansion fast-uri

  tar 7.5.16 → 7.5.22, postcss 8.5.15 → 8.5.25, js-yaml 4.2.0 → 4.3.0,
  fast-uri 3.1.2 → 3.1.5, brace-expansion 1.1.15 → 1.1.18 / 2.1.1 → 2.1.4 /
  5.0.6 → 5.0.9. Churn: 8 target packages plus `nanoid` (a postcss dep) and a
  seventh `fs-extra` copy.

- **fast-uri** (HIGH ×2, as above) and **postcss** (HIGH) —
  `packages/engine/mcp-server`. Fixed 2026-07-31 by
  `npm update --package-lock-only fast-uri postcss` (npm 11.12.1, the
  `packageManager` pin). Four lockfile entries, no `package.json` change;
  `check-engine-lockfile` verified idempotent. **`fast-uri` ships** — it is a prod dep
  via `@modelcontextprotocol/sdk` → `ajv` and is bundled into the `.mcpb`. It was never
  the *only* one: the `@hono/node-server` entry that used to sit under Deferred said of
  itself "a prod dep that ships in the `.mcpb`", so the phrasing this entry carried —
  "the one finding in this file that ships" — was wrong when written.
  **Moved again 2026-09-08: 3.1.5 → 3.1.7.** Its advisory count is **four, all HIGH**,
  not the two recorded above: two SSRF (`GHSA-f65p-4m7j-42xc` malformed IPv6
  normalization, `GHSA-fph4-wmhf-6fwf` repeated hostname percent-decoding) and two host
  confusion (`GHSA-5jgf-p345-68v8` skipped IDN canonicalization, `GHSA-jqff-g426-hqxp`
  percent-encoded scheme normalization). Exploitability is still low, and the reason
  covers all four rather than only the SSRF pair: `ajv` uses it only to resolve
  `$id`/`$ref` in our own static tool schemas, never an attacker-supplied URL.

- **postcss** (HIGH GHSA-r28c-9q8g-f849 + HIGH GHSA-6g55-p6wh-862q + MODERATE
  GHSA-qx2v-qp2m-jg93) and **sharp** (HIGH GHSA-f88m-g3jw-g9cj, inherited libvips
  CVEs) — `eval/app`. Fixed 2026-07-31 by npm `overrides`; those pins moved to
  root `pnpm.overrides` in #1488, because pnpm ignores a workspace member's own
  `overrides` block **silently** — check with `pnpm why sharp`. **This supersedes the
  earlier deferral of the postcss finding**, whose stated cost no longer holds (see
  below). `next` pins `postcss` at exactly `8.4.31` and `sharp` at `^0.34.3`, and
  **upgrading `next` does not help** — `next@16.2.12` still pins postcss `8.4.31`
  and sharp `^0.34.5`. An override is the only route:

      "postcss": "$postcss",   // + the direct devDep raised to ^8.5.25
      "sharp": "^0.35.3"

  The `$postcss` form is required: npm rejects a literal override that conflicts
  with a direct dependency (`EOVERRIDE`). Result: next's nested `postcss@8.4.31`
  disappears entirely (dedupes to one 8.5.25) and sharp → 0.35.3. Churn was **31
  lockfile entries, 28 of them sharp's platform binaries** — *not* the ~113
  dev-toolchain packages the 2026-07-07 note predicted. That estimate was correct
  when written and went stale: the lockfile has since been refreshed
  independently, so the re-resolve no longer moves vitest/playwright/rollup/tsx.
  Verified with `npm ci` + 134 tests + `tsc --noEmit` + a full `next build`.

- **form-data** (HIGH, GHSA-hmw2-7cc7-3qxx, CRLF injection) — root pnpm
  workspace, pulled transitively by `electron-builder` → `electron-publish`
  (build/publish tooling in `apps/electron`; not in the running app or the MCP
  server). Fixed by a `pnpm.overrides` entry in the root `package.json`
  (`"form-data@<4.0.6": "^4.0.6"`), bumping 4.0.5 → 4.0.6. The lockfile change is
  scoped to form-data only.

- **brace-expansion** (HIGH, GHSA-mh99-v99m-4gvg, unbounded-expansion OOM DoS) —
  root pnpm workspace, dev-only. **Fixed by upstream.** The advisory originally
  published a single range `<= 5.0.7` patched only at `5.0.8`, which swallowed
  the entire 1.x and 2.x lines — the 2026-07-31 deferral was correct when written.
  The advisory's ranges changed at 19:37 UTC on 2026-07-31 (two and a half hours
  after that entry was committed), adding per-line patches: 1.1.17 / 2.1.3 / 3.0.3 /
  5.0.8. The existing lockfile pins (1.1.18 / 2.1.4 / 5.0.9, from the
  GHSA-3jxr-9vmj-r5cp refresh on 2026-07-31) are all above the new patch lines.
  `pnpm audit` reports zero `brace-expansion` rows. Its sibling advisory
  GHSA-3jxr-9vmj-r5cp was already fixed 2026-07-31 (see above). Confirmed
  2026-09-21.

## Deferred / no clean fix

- **vitest / @vitest/mocker** — **withdrawn 2026-11-04, see the Fixed entry above.**
  The 2026-09-09 deferral said the fix was a 3 → 4 major across
  `packages/viewer-ui`, `apps/web` and `apps/electron`, which all declared
  `^3.2.4` then. All four workspace members have since moved to `^4.1.10`, so
  by 2026-11-04 the fix was an in-range refresh — the same staleness shape as
  the withdrawn `esbuild` entry, caught by the same publish-date-vs-entry-date
  check. The engine's separate npm tree still carries its own vitest/mocker
  alerts (issue #4186).

- **minimatch** (MODERATE GHSA-g3hv-75wg-m249, DoS via globparts
  amplification; fix `>=11.0.1`) — root pnpm workspace,
  dev-only. **Deferred 2026-11-04 — no in-major fix exists.** The tree resolves
  3.1.5, 5.1.9, 9.0.9 and 10.2.6; the advisory range is `< 11.0.1`, and
  `npm view minimatch versions` (checked 2026-11-04) shows each of those is
  already the **newest release of its major line** — the only patched line is
  11.x. eslint and its plugin ecosystem call the minimatch 3 API, so an
  override across the major is not safe and is out of scope for a minor/patch
  pass. No sibling issue owns this; it clears when the eslint toolchain moves.
  **Revisit when** a patched 3.x/5.x/9.x/10.x publishes (as happened for
  brace-expansion), or the parents move to minimatch 11.

- **glob** (MODERATE GHSA-3g3m-2fjr-6pw4, AbortSignal cancellation bypass;
  vulnerable `>= 9.0.0, <= 14.0.1`, fix `>=14.0.2`) — root
  pnpm workspace, dev-only. **Deferred 2026-11-04 — no in-major fix exists.**
  The tree resolves 7.2.3 and 10.5.0; only the 10.x copy is in the vulnerable
  range (7.2.3 predates it). `npm view glob versions` (checked 2026-11-04):
  10.5.0 is the newest 10.x — the only patched line is 14.x, a cross-major
  move. **Revisit when** a patched 10.x publishes or the parents move to
  glob 14.

- **electron** (12 alerts: 5 HIGH / 4 MODERATE / 3 LOW) — `apps/electron`,
  pinned exactly 39.8.10. **Deferred 2026-11-04 — every fix is cross-major:**
  the patched versions are 41.10.4/41.10.6 and 42.11.1–42.11.16, nothing
  inside 39.x (contrast the 2026-09-08 Fixed entry above, whose 15 advisories
  were all patched inside 39.8.x). electron ships (see the reachability note
  up top), so these are the highest-value open alerts in the tree. **Owned by
  issue #4188** (Electron 39 → 42), which also owns the toolchain that moves
  with it.

- **zod 3.25.76** (HIGH, fix `>=4.6.6`) — `eval/app`, a production dependency
  of the internal-only, loopback-bound Eval CRUD UI. **Deferred 2026-11-04 —
  the fix is the zod 3 → 4 major**, coupled to `json-schema-to-zod` 2.6.1
  (which emits the zod-3 API; see the pins header in `.github/dependabot.yml`)
  and `mantine-form-zod-resolver` 1.3.0. **Owned by issue #4190.** The tree's
  *other* zod copy (under `eslint-plugin-react-hooks`) moved to 4.6.7 in the
  2026-11-04 sweep, but the alert keys on the vulnerable copy and stays open
  while 3.x remains.

- **extract-zip** (HIGH, unvalidated symlink path traversal) — root pnpm workspace,
  `2.0.1`, pulled by `electron` itself (both 39.8.5 and 39.8.10 declare
  `extract-zip: ^2.0.1`). **Deferred 2026-09-08 — no patch exists.** npm reports
  `patched_versions: <0.0.0`, i.e. no released version fixes it, so there is nothing to
  bump to and an override has no target. **It is in the production graph** —
  `apps/electron` → `@electron-toolkit/utils` → `electron` (peer) → `extract-zip`, per
  `pnpm why --prod -r` — so `pnpm audit --prod` is right to flag it. What limits it is
  *when* it runs, not whether it ships: `extract-zip` is what electron's own postinstall
  uses to unpack the runtime archive it downloads from Electron's release server over
  HTTPS, at install time on a developer's machine. The shipped app never invokes it, and
  the traversal needs an attacker-controlled zip.
  Re-checked 2026-11-04: still no patched version (`first_patched_version`
  absent on both open alerts) — but the "electron drops the dependency" exit
  has arrived: electron 42 replaces `extract-zip` with
  `@electron-internal/extract-zip` (`npm view electron@42.11.16 dependencies`),
  so **issue #4188's 39 → 42 move clears both alerts** by removing the package
  from the tree. These two ride #4188, not an upstream `extract-zip` release.

- **zod** (HIGH GHSA-mrhx-c7xc-m3w5, memory exhaustion validating oversized
  constrained collections) — `packages/engine/mcp-server` only, the dev-only
  `zod@3.25.76` under `@anthropic-ai/mcpb`. **No clean fix available.** The
  advisory range is `<4.6.6` with no 3.x patch, and `@anthropic-ai/mcpb@2.1.2`
  depends on `zod@^3.25.67` directly, hard-pinning the 3.x line in its subtree.
  **The production copy is clear** — a nested `overrides` pins the SDK's zod to
  4.6.7 (see the first Fixed entry); this remaining copy is reached only through
  `@anthropic-ai/mcpb`, a devDependency used solely to build the `.mcpb`, so
  `npm ci --omit=dev` never ships it. **Revisit when** `@anthropic-ai/mcpb` drops
  its direct `zod@^3.25.67` or bumps it past 4.6.6.

- **tmp** (HIGH GHSA-ph9p-34f9-6g65 + LOW GHSA-52f5-9888-hmc6, symlink /
  path-traversal write) — `packages/engine/mcp-server` only, via
  `@anthropic-ai/mcpb` → `@inquirer/prompts` → `@inquirer/editor` →
  `external-editor` → `tmp@0.0.33`. **No clean fix available.** We are already on
  the newest `@anthropic-ai/mcpb` (2.1.2), which pins `@inquirer/prompts@^6.0.1`;
  `external-editor@3.1.0` in turn requires `tmp@^0.0.33`, hard-pinning the 0.0.x
  line. Newer `@inquirer/editor` dropped `external-editor` for
  `@inquirer/external-editor` (no `tmp` at all), but the `^6.0.1` pin cannot reach
  it. An `overrides: {"tmp": "^0.2.7"}` would probably work — `fileSync` and
  `setGracefulCleanup` both survive into 0.2.x — but it is an untested API gamble
  across a package we only invoke to pack the extension.
  `@anthropic-ai/mcpb` is a devDependency used only to build the `.mcpb` desktop
  extension — `npm ci --omit=dev` means it is not shipped in the MCP server runtime
  or any deployed artifact.
  **Revisit when** `@anthropic-ai/mcpb` publishes a release that bumps the
  `@inquirer`/`tmp` chain.

- **esbuild** — **withdrawn 2026-09-09, see the Fixed entry above.** This entry said
  clearing it needed a vite 7→8 migration across three packages. `vite@7.3.6` already
  admits the 0.28.1 patch inside the declared `^7.2.6`, so it was a lockfile refresh.
  Kept as a record, but **not** as an example of a reason going stale — it was wrong
  when written. On 2026-07-31, `esbuild@0.28.1` (published 2026-06-11) and `vite@7.3.6`
  (2026-06-25) both already existed, `apps/web` and `apps/electron` already declared
  `^7.2.6`, and nothing pinned vite to 7.3.5, so the same one-line refresh would have
  cleared it that day. **The check that catches this is the dependency's publish date
  against the entry's own commit date**, which is cheap and was never run. Applied
  2026-09-21 (#2352) to all five Deferred entries. `extract-zip` and `tmp` checked
  out — no patched version existed when either was written. **`vitest` did not**:
  4.1.11 was published 2026-08-18, three weeks before the 2026-09-09 deferral, and
  the entry itself records the engine's half as a lockfile refresh. `cryptography`
  says outright that a patch exists — it is deferred on coordination cost, not
  availability. `h2` checked out.

## Automated dependency updates

`.github/dependabot.yml` was added 2026-07-31, in the same PR as the fixes above.
Until then GitHub raised security *alerts* from the dependency graph but nothing
opened routine version-update PRs — which is how 24 open alerts accumulated, most
of them a plain lockfile refresh that no upstream constraint was blocking. The
config covers **four ecosystems in five update blocks** — `npm` (the three
package.json trees), `github-actions` (`.github/workflows`), `docker` (both
Dockerfiles), and `uv` twice (`apps/server` and `eval/harness`, split so the
harness can carry its own `ignore` rules). Monthly, with minor/patch grouped into
one PR per ecosystem so majors are the ones that arrive individually.

That grouping *is* the safety mechanism, and it is worth stating why. Dependabot
has no semantic knowledge of this codebase — it reads version ranges, so it will
propose a major that typechecks and still breaks behavior (`mcp` 2.0.0 removing
`Server.list_tools` is exactly that shape). Grouping minor/patch means every
**major arrives as its own individual PR**, never buried in a batch. Read those,
especially for the engine's production dependencies, which ship inside the
`.mcpb`, and hardest of all for `@modelcontextprotocol/sdk` — same failure class
as the mcp break, and it ships. Note also that no CI job exercises the Cowork
plugin path; run `make agent-smoke` before merging an Agent-SDK-chain major.

The `docker` entry is deliberately narrow. Both Dockerfiles pin *floating* tags,
not digests, so it catches tag moves (`python:3.12` → `3.13`) and nothing else —
patch-level base-image CVEs land when upstream rebuilds the same tag, which a
rebuild picks up and Dependabot never sees. Pin by digest if that ever matters.

Three `ignore` rules protect load-bearing Python pins. Both uv trees cap mcp below 2
(`mcp>=1.29,<2` in `eval/harness/pyproject.toml`, `mcp>=1.28.1,<2` in
`apps/server/pyproject.toml`; PR #932: mcp 2.0.0 removed `Server.list_tools`, which
`claude_agent_sdk.create_sdk_mcp_server` calls), and each tree's entry ignores mcp
majors. The third is the exact `claude-agent-sdk==` pin in `eval/harness`, which moves
only with apps/server's `sandbox` group
(`eval/harness/tests/unit/test_sdk_pin_matches_hosted.py`), so every version update to
it is ignored. All three are scoped to `version-update:*`, so a genuine security
advisory on either package still opens a PR.

One known rough edge: `packages/engine/mcp-server` pins `npm@11.12.1` and
`check-engine-lockfile.yml` fails any PR whose lockfile that exact npm would
rewrite. Dependabot resolves with its own npm, so an engine PR can trip the gate
through no fault of the bump — check the branch out, run `npm install` under
11.12.1, commit the re-normalized lockfile. See the header comment in
`dependabot.yml`.

### Dependabot alert backlog

**`npm audit --omit=dev` and the Dependabot alert count answer different
questions, and this doc reconciles against the audits, with `.dependency.scope` as
the bridge.** `npm audit --omit=dev` can report zero for a tree while Dependabot
still lists `scope: development` alerts against it; both are correct — they measure
different things. The command to reconcile:

    gh api "/repos/PioneerAIAcademy/cowork-genealogy/dependabot/alerts?state=open&per_page=100" \
      --paginate -q '.[] | [.security_advisory.severity, .dependency.scope, .dependency.manifest_path, .dependency.package.name] | @tsv'

**Measured 2026-11-05 — 126 open alerts** (down from 164 on 2026-11-03, after
issue #4186 cleared 38 of the engine npm tree's 40; up from 14 on 2026-09-21,
that jump mostly the search-agent prototype's new manifests —
`apps/server/proto/{web,worker}` and `apps/server/sandbox/requirements.txt` — which
had no Dependabot coverage in the earlier count). Measured **after** #4186 merged
but **before** this PR (#4185) and #4187/#4188/#4190: alerts close only when
Dependabot rescans the default branch, so the `pnpm-lock.yaml` row below still
counts the 37 this PR fixes. Expected to survive this PR's rescan: **17 of
`pnpm-lock.yaml`'s 54** (electron ×12, extract-zip ×2, glob, minimatch, zod —
each under Deferred).

| Manifest | Scope | Count | Packages |
|---|---|---|---|
| `pnpm-lock.yaml` | runtime† | 54 | electron ×12, undici ×8, brace-expansion ×9, fast-uri ×5, vite ×5, next ×4, ip-address ×3, @vitest/mocker ×2, extract-zip ×2, glob, minimatch, source-map-js, zod |
| `eval/app/package.json` | runtime | 5 | next ×4, zod |
| `apps/electron/package.json` | development | 12 | electron ×12 |
| `packages/engine/mcp-server/package-lock.json` | development | 2 | tmp ×2 |
| `apps/server/uv.lock` | runtime + development | 7 | mcp ×4, h2, hpack, opentelemetry-api |
| `eval/harness/uv.lock` | runtime | 21 | PyJWT ×15, mcp ×4, certifi, cryptography |
| `apps/server/proto/worker/requirements.txt` | runtime | 20 | PyJWT ×15, mcp ×4, certifi |
| `apps/server/proto/web/requirements.txt` | runtime | 1 | certifi (CRITICAL) |
| `apps/server/sandbox/requirements.txt` | runtime | 4 | mcp ×4 |

†The pnpm workspace's dev-tooling rows (vite, @vitest/mocker, the glob/minimatch
eslint chain) are reported `runtime` by Dependabot, which cannot resolve dev
scope through a pnpm workspace lockfile — the same misclassification the
2026-09-21 measurement recorded. `pnpm why --prod -r` is the arbiter; the
genuinely-runtime rows are electron, extract-zip and zod (see the reachability
note up top).

Ownership of what remains: the engine npm tree is down to `tmp ×2` (dev-only,
Deferred) now #4186 has landed; the Python locks and the prototype
`requirements.txt` bundles (53) are covered by the #4187 note below; electron and
its 39 → 42 toolchain (24 across both manifests, plus the two extract-zip rows it
clears in passing) is issue #4188; zod 3 → 4 in eval/app (1) is issue #4190.
Issues #4188 and #4190 each still edit this section — whoever lands next recounts
it with the `gh` command above rather than hand-merging.

**#4187 (the Python trees), 2026-11-05.** `uv lock --upgrade` in both trees, and the
three exports regenerated from `apps/server/uv.lock`, leave no locked version inside any
advisory range the public advisory database lists, and OSV's `querybatch` finds none
either. The reliable query lists every advisory for each package and leaves the version
test to you, against each `vulnerabilities[].vulnerable_version_range`:

    gh api --paginate "/advisories?ecosystem=pip&affects=<package>,<package>&per_page=100"

Do not add `@<version>` to `affects`: that form matches the advisory's recorded package
name case-sensitively. On 2026-11-05, `pyjwt@2.13.0` returned 4 of the 15 advisories
whose ranges cover 2.13.0, and missed every one recorded as `PyJWT` or `pyJWT`.

Against the table above, this clears the `apps/server/uv.lock`, `eval/harness/uv.lock`
and `sandbox/` rows, and `proto/worker/`'s mcp. The `proto/worker/` PyJWT and certifi
alerts and `proto/web/`'s certifi alert are on versions those exports already left in
#4207 (PyJWT 2.15.1, certifi 2026.10.23), so they close on the same rescan either way.
Alerts close when Dependabot rescans `main`. This is a per-version check, not the
recount the paragraph above asks for: the alert list needs repository security access,
which the triage role lacks (HTTP 403), so the next recount needs someone who has it.

*Previous measurements: 164 on 2026-11-03; 14 on 2026-09-21; 75 on 2026-09-10;
53 on 2026-08-23 (issue #1036); 24 before PR #1030.*
