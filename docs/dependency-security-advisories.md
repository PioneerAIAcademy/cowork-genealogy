# Dependency security advisories

Tracking note for `pnpm audit` / `npm audit` findings across the repo's three JS
dependency trees (root pnpm workspace, `packages/engine/mcp-server` npm,
`eval/app` npm). Re-run the audits after any dependency bump and update this file.

Last reviewed: **2026-07-07**.

## Fixed
- **form-data** (HIGH, GHSA-hmw2-7cc7-3qxx, CRLF injection) — root pnpm
  workspace, pulled transitively by `electron-builder` → `electron-publish`
  (build/publish tooling in `apps/electron`; not in the running app or the MCP
  server). Fixed by a `pnpm.overrides` entry in the root `package.json`
  (`"form-data@<4.0.6": "^4.0.6"`), bumping 4.0.5 → 4.0.6. The lockfile change is
  scoped to form-data only.

## Deferred / no clean fix

- **postcss** (MODERATE, GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>` in CSS
  stringify) — `eval/app` only, via `next`'s internally pinned `postcss@8.4.31`.
  **Deferred.** `next` 15.5.18/.19/.20 all pin the vulnerable exact version, so a
  safe patch bump doesn't help. An npm `overrides` entry *does* fix it (dedupes to
  the already-present patched 8.5.16 → 0 vulnerabilities), but npm won't apply a
  new override to an already-locked exact pin without a full re-resolve, which
  drifts ~113 unrelated dev-toolchain packages (vitest, playwright, rollup,
  typescript-eslint, tsx…) and rewrites platform-binary entries. Not worth that
  churn for a moderate CSS-stringify XSS in an internal-only dev tool (the Eval
  CRUD UI is never shipped or deployed).
  **Revisit when** `eval/app` needs a routine lockfile refresh anyway, or on the
  next `next` major bump (16+, which ships a patched postcss natively).

- **tmp** (HIGH, GHSA-52f5-9888-hmc6 + GHSA-ph9p-34f9-6g65, symlink /
  path-traversal write) — `packages/engine/mcp-server` only, via
  `@anthropic-ai/mcpb` → `@inquirer/prompts` → `@inquirer/editor` →
  `external-editor` → `tmp`. **No fix available.** We are already on the newest
  `@anthropic-ai/mcpb` (2.1.2), whose `@inquirer` chain pins the old `tmp`; no
  patched release exists. `@anthropic-ai/mcpb` is a devDependency used only to
  build the `.mcpb` desktop extension — it is not shipped in the MCP server
  runtime or any deployed artifact.
  **Revisit when** `@anthropic-ai/mcpb` publishes a release that bumps the
  `@inquirer`/`tmp` chain.

- **esbuild** (LOW, GHSA-g7r4-m6w7-qqqr, dev-server arbitrary file read,
  **Windows only**) — root pnpm workspace, bundled by `vite@7.3.5`. **Deferred.**
  Affects only the running dev server on Windows; `vite` pins its esbuild, so an
  override risks a vite/esbuild version mismatch for near-zero security gain.
  **Revisit when** `vite` is upgraded to a release bundling esbuild ≥ 0.28.1.
