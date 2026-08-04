# Dependency security advisories

Tracking note for `pnpm audit` / `npm audit` findings across the repo's three JS
dependency trees (root pnpm workspace, `packages/engine/mcp-server` npm,
`eval/app` npm). Re-run the audits after any dependency bump and update this file.

Last reviewed: **2026-07-31**.

**Reachability, once, up front.** Every finding below except `fast-uri` lives in a
**devDependency** — dev tooling (eslint, vite/vitest, electron-builder,
`@anthropic-ai/mcpb`) or the internal-only Eval CRUD UI. `pnpm why --prod` returns
*nothing* for every vulnerable package in the workspace. The `.mcpb` is built with
`npm ci --omit=dev` (`scripts/build-mcpb.mjs`), so dev-tree findings never reach a
shipped artifact. Weigh fix churn against that before treating a HIGH as urgent.

## Fixed

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
  `check-engine-lockfile` verified idempotent. **`fast-uri` is the one finding in
  this file that ships** — it is a prod dep via `@modelcontextprotocol/sdk` → `ajv`
  and is bundled into the `.mcpb`. Exploitability is still low: `ajv` uses it only
  to resolve `$id`/`$ref` in our own static tool schemas, never an attacker-supplied
  URL.

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

- **@hono/node-server** (MODERATE, GHSA-frvp-7c67-39w9, `serve-static` path
  traversal on Windows via encoded backslash) — `packages/engine/mcp-server`,
  1.19.14, pulled by `@modelcontextprotocol/sdk`. **Deliberately deferred
  2026-07-31.** The patch is 2.0.5, i.e. a **major** bump of a prod dep that ships
  in the `.mcpb`. The SDK does permit it (`"@hono/node-server": "^1.19.9 ||
  ^2.0.5"`), but the vulnerable code is unreachable here: `src/index.ts` uses
  `StdioServerTransport`, so the SDK's HTTP/SSE transport — the only thing that
  imports hono — is never loaded. The bump would buy no real security and add
  major-version risk to the shipped artifact.
  *Historical note:* PR #920 is titled "bump @hono/node-server … to 2.0.12" but
  **did not** move it — the merged lockfile still reads 1.19.14. Dependabot bumped
  only the SDK (1.29.0 → 1.30.0), which widened the *declared* range. Don't read
  that PR title as evidence hono 2 was ever exercised here.
  **Revisit when** the server grows an HTTP/SSE transport, or on the next SDK major.

- **esbuild** (LOW, GHSA-g7r4-m6w7-qqqr, dev-server arbitrary file read,
  **Windows only**) — root pnpm workspace, bundled by `vite@7.3.5`. **Deferred.**
  Affects only the running dev server on Windows; `vite@7.3.5` pins
  `esbuild@^0.27.0` and the patch is 0.28.1, out of range. Clearing it needs a
  vite 7 → 8 migration across `apps/web`, `packages/viewer-ui` and
  `apps/electron` (vite 8 drops the esbuild dependency for rolldown) — a real
  migration, not a dep bump, for near-zero security gain.
  **Revisit when** the workspace moves to vite 8 for unrelated reasons.

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
