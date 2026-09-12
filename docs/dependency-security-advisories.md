# Dependency security advisories

Tracking note for `pnpm audit` / `npm audit` findings across the repo's three JS
dependency trees (root pnpm workspace, `packages/engine/mcp-server` npm,
`eval/app` npm). Re-run the audits after any dependency bump and update this file.

Last reviewed: **2026-09-09** (root pnpm workspace and `eval/app`). The engine tree
was last reviewed 2026-09-08 and is unchanged since; see #2352.

> **This file is the mechanism, by decision.** @DallanQ ruled on 2026-09-09 (#2352)
> that no CI job will audit any dependency tree: failing the build, warning without
> failing, and a scheduled run that files an issue were each considered and rejected.
> The gap stays on the `nothing-checks` register as an **accepted** one, which makes
> re-running the audits after any dependency bump and updating this file the only thing
> standing between a new advisory and a shipped artifact.
>
> **The paragraph below is known to be partly wrong and is #2352's to re-derive.** Its
> "every finding below except `fast-uri` lives in a devDependency" half no longer holds
> — see the `electron` note underneath it — and #2352 owns the refresh rather than this
> PR patching around it.

**Reachability, once, up front.** Every finding below except `fast-uri` lives in a
**devDependency** — dev tooling (eslint, vite/vitest, electron-builder,
`@anthropic-ai/mcpb`) or the internal-only Eval CRUD UI. Check reachability with
`pnpm why --prod -r <pkg>` — **without `-r` the command inspects only the root
package, which declares no dependencies, so it returns nothing for everything**
(`pnpm why --prod react` is silent even though `apps/web` depends on it). The
`.mcpb` is built with
`npm ci --omit=dev` (`scripts/build-mcpb.mjs`), so dev-tree findings never reach
**that** artifact. Weigh fix churn against that before treating a HIGH as urgent.

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
  the real `build/index.js` boots over stdio and serves every advertised tool with empty stderr,
  and `make mcpb` produces a working artifact. hono is unreachable regardless —
  `src/index.ts` constructs only `StdioServerTransport`, and hono is imported solely by
  the SDK's `streamableHttp` transport.
  **Revisit when** the server grows an HTTP/SSE transport, which would make hono
  reachable for the first time.

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
  CVEs) — `eval/app`. Fixed 2026-07-31 by npm `overrides`. **This supersedes the
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

## Deferred / no clean fix

- **vitest** and **@vitest/mocker** (MODERATE ×2) — root pnpm workspace, dev-only,
  patched at `>=4.1.11`. **Deferred 2026-09-09.** `packages/viewer-ui`, `apps/web` and
  `apps/electron` all declare `^3.2.4`, so the fix is a **3 → 4 major** across three
  packages rather than a lockfile refresh — the shape the withdrawn `esbuild` entry
  only appeared to have. `packages/engine/mcp-server` and `eval/app` already declare
  `^4.1.10`, but **the engine is affected and its fix is a refresh, not a major**:
  `packages/engine/mcp-server`'s lockfile pins **4.1.10**, inside the vulnerable range,
  and `npm update --package-lock-only vitest` clears it there with no `package.json`
  change. `eval/app` is clear because this PR moved it to 4.1.11, not because of what it
  declares. Reading a declared range as though it were the resolved version is the
  mistake that produced the original wording here.
  **Revisit when** someone takes the vitest 4 migration, or a 3.x backport publishes.

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
  **Revisit when** a fixed `extract-zip` is published, or when `electron` drops the
  dependency.

- **brace-expansion** (HIGH, GHSA-mh99-v99m-4gvg, unbounded-expansion OOM DoS) —
  root pnpm workspace, dev-only (eslint's `minimatch@3.1.5`, electron-builder's
  `minimatch@9`). **Partially unfixable — read the range carefully.** Unlike the
  sibling advisory GHSA-3jxr-9vmj-r5cp, which was backported to each release line
  (1.1.16 / 2.1.2 / 5.0.7), this one publishes a **single** range `<= 5.0.7`
  patched **only** at `5.0.8`. By plain semver that range swallows the entire 1.x
  and 2.x lines, so `brace-expansion@1.1.18` and `@2.1.4` stay flagged forever and
  the refresh above cannot clear the alert. Closing it would mean overriding
  `minimatch@3.x`/`@9.x` consumers onto `brace-expansion@5` — three majors, a
  changed `balanced-match` peer and a narrowed `engines` field — for a DoS in a
  glob expander that only ever sees our own hardcoded patterns (EPSS 0.0034).
  **Not worth it.**
  **Revisit when** a 1.x/2.x backport is published, or when eslint/electron-builder
  move to a minimatch that depends on `brace-expansion@^5`.


  **Stale as of 2026-09-09 — no longer flagged.** GHSA-mh99-v99m-4gvg now carries four
  ranges with per-line patches (1.1.17 / 2.1.3 / 3.0.3 / 5.0.8), so the "single range,
  stays flagged forever" reading no longer holds. The advisory's ranges changed at
  19:37 UTC on 2026-07-31, two and a half hours after this entry was committed, so it
  was accurate when written. `pnpm audit` reports zero `brace-expansion` rows today.
  Left in place for #2352 to fold into Fixed rather than half-rewritten here.
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
  against the entry's own commit date**, which is cheap and was never run. #2352's
  re-derive should apply it to every entry here.

## Automated dependency updates

`.github/dependabot.yml` was added 2026-07-31, in the same PR as the fixes above.
Until then GitHub raised security *alerts* from the dependency graph but nothing
opened routine version-update PRs — which is how 24 open alerts accumulated, most
of them a plain lockfile refresh that no upstream constraint was blocking. The
config covers **four ecosystems in five update blocks** — `npm` (the three
package.json trees), `github-actions` (`.github/workflows`), `docker` (both
Dockerfiles), and `uv` twice (`apps/server` and `eval/harness`, split so the
harness can carry its own `ignore` rules). Weekly, with minor/patch grouped into
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

Two `ignore` rules protect load-bearing upper bounds in
`eval/harness/pyproject.toml` — `mcp>=1.29,<2` (PR #932; mcp 2.0.0 removed
`Server.list_tools`, which `claude_agent_sdk.create_sdk_mcp_server` calls) and
`claude-agent-sdk<0.2`. Both are scoped to `version-update:*`, so a genuine
security advisory on either package still opens a PR. Note that Dependabot
classifies `0.1 → 0.2` as semver-**minor** for a 0.x package, so the
`claude-agent-sdk` ignore must cover minor as well as major.

One known rough edge: `packages/engine/mcp-server` pins `npm@11.12.1` and
`check-engine-lockfile.yml` fails any PR whose lockfile that exact npm would
rewrite. Dependabot resolves with its own npm, so an engine PR can trip the gate
through no fault of the bump — check the branch out, run `npm install` under
11.12.1, commit the re-normalized lockfile. See the header comment in
`dependabot.yml`.
