# Plan: move the engine into `packages/engine/`

**Status:** PROPOSED — not to be executed yet. Dallan reviews this with
the eng reviewer and runs it himself, as a single dedicated change,
after the hosted-web-workbench POC has settled.

**Branch:** `hosted-web-workbench` (or a child of it). This is a
follow-up to deviation #1 in
`docs/plan/hosted-web-workbench-spec.md` ("Engine stays at
`mcp-server/` + `plugin/` … Moving it is cosmetic and can happen
later"). It is purely a relocation: no engine behavior changes.

## Why this is worth doing (and why it's deferred)

Today the genealogy engine lives at the repo root (`mcp-server/`,
`plugin/`) and the web product lives under `apps/` + `packages/`. The
overlay works, but the layout reads as two projects sharing a folder
rather than one monorepo. Folding the engine into
`packages/engine/{mcp-server,plugin}` makes the tree legible —
"everything reusable is a package" — without changing the deliberate
boundary: the engine stays **npm-managed and out of the pnpm
workspace**, the `.mcpb`/plugin release pipeline is byte-for-byte the
same artifact, and the web/electron side keeps depending only on
`packages/schema`.

It is deferred because it touches three pipelines that are hard to
unbreak silently — **CI, the eval harness, and the release scripts** —
and the POC needs to stabilize first. The move is mechanical but
wide: ~14 active code/script references plus the runlog snapshot
keys (see Risk surfaces). Doing it as its own PR, with the
verification checklist below, keeps the blast radius reviewable.

## Target layout

```
packages/
  engine/
    mcp-server/        ← was repo-root mcp-server/   (git mv, unchanged inside)
    plugin/            ← was repo-root plugin/        (git mv, unchanged inside)
  schema/              (unchanged — pnpm workspace member)
  viewer-ui/           (unchanged — pnpm workspace member)
apps/                  (unchanged)
scripts/               (path edits only)
eval/                  (path edits only; runlog snapshot keys re-rooted)
docs/                  (prose edits)
```

Nothing else under `packages/engine/` — it is a container for the two
engine dirs, **not** a pnpm package (no `package.json` at
`packages/engine/`). `mcp-server/`'s own `package.json` is unchanged
and remains the engine's build root.

## The hard constraint: keep `packages/engine` OUT of the pnpm workspace

`pnpm-workspace.yaml` currently globs `packages/*`:

```yaml
packages:
  - packages/*
  - apps/web
  - apps/electron
```

After the move, `packages/engine` matches `packages/*`, so pnpm would
try to manage `packages/engine/mcp-server` (it has a `package.json`)
and pull its devDeps (`typescript`, `vitest`, `@anthropic-ai/mcpb`)
into the workspace lockfile — exactly what the npm-managed boundary
exists to prevent. Two facts make this safe to fix with one line:

- pnpm's glob negation: a pattern prefixed with `!` **excludes**
  matching dirs, and exclusions are applied after includes.
- pnpm only treats a dir as a workspace package if it contains a
  `package.json`. `packages/engine/` itself has none; only its
  `mcp-server` child does.

So add a single negation **after** the glob:

```yaml
# JS/TS workspace members. The genealogy engine
# (packages/engine/{mcp-server,plugin}) is deliberately NOT a member: it
# stays npm-managed so the .mcpb / plugin .zip release pipeline and CI
# are untouched. The web/electron/viewer side depends on packages/schema,
# never on the engine directly.
packages:
  - packages/*
  - '!packages/engine/**'    # engine is npm-managed, not a pnpm member
  - apps/web
  - apps/electron
```

`'!packages/engine/**'` (rather than `'!packages/engine'`) is the
defensive form — it excludes the dir and anything nested, so a future
`package.json` added anywhere under `engine/` can't accidentally be
adopted. **Verify after editing:** `pnpm install` then
`pnpm ls -r --depth -1` must list exactly `schema`, `viewer-ui`,
`web`, `cowork-genealogy-ui` (the four current members) and **not**
`genealogy-mcp`. Also confirm `pnpm-lock.yaml` gains no `mcp-server`
importer entry.

## The non-obvious risk: eval runlog snapshot keys

This is the one part of the move that is **not** a path string in a
script — it's data baked into committed JSON, and it is the reason
this change must be a dedicated PR.

`eval/harness/harness/snapshot.py` (`build_snapshot`) embeds, into
every committed runlog, a `snapshot` map keyed by **repo-relative
POSIX paths**, including the entire MCP source tree:

```python
mcp_src_dir = repo_root / "mcp-server" / "src"
_embed_tree(snapshot, mcp_src_dir, repo_root)   # keys like "mcp-server/src/tools/foo.ts"
```

`.github/workflows/check-runlogs.yml` runs
`eval/harness/scripts/check_runlogs.py`, whose **Rule 2 (blocking)**
calls `diff_snapshot_vs_disk(snapshot, REPO_ROOT)` for the latest
runlog of each touched skill and fails the PR if any snapshot key no
longer matches disk (`missing-on-disk` / `content-differs`).

After `git mv mcp-server packages/engine/mcp-server`, every runlog's
`mcp-server/src/...` keys point at paths that no longer exist →
`missing-on-disk`. The same applies to `plugin/skills/...` keys (also
embedded by `build_snapshot`). The move's PR **does** touch
`plugin/skills/**` and `mcp-server/src/**` (their new locations), so
`check-runlogs.yml`'s `paths:` filter fires.

There are two ways to handle this; the plan picks the second:

1. **Re-run every skill's harness** to regenerate snapshots with the
   new keys. Rejected: Rule 1 caps *released* runlogs at one new
   `v{N}.json` per skill per PR, so 28 fresh released runlogs in one
   PR violates discipline; and re-running burns API budget and judge
   variance for a no-op relocation.
2. **Re-root the snapshot keys in place** with a one-time scripted
   string rewrite over the committed runlog JSONs, in the same PR:
   `mcp-server/` → `packages/engine/mcp-server/` and `plugin/` →
   `packages/engine/plugin/` **inside each runlog's `snapshot` object
   keys only**. Because `git mv` doesn't change file *contents*, the
   snapshot *values* (sha/normalized bytes) are still correct; only
   the keys move. After the rewrite, Rule 2's `diff_snapshot_vs_disk`
   sees matching keys and passing values → green, with zero re-runs.

Write the rewrite as a small, reviewed Python helper (stdlib only) run
once during the migration, e.g.:

```python
# one-shot, run from repo root AFTER the git mv and AFTER snapshot.py is edited
import json, pathlib
PREFIXES = {"mcp-server/": "packages/engine/mcp-server/",
            "plugin/":     "packages/engine/plugin/"}
for p in pathlib.Path("eval/runlogs").rglob("*.json"):
    doc = json.loads(p.read_text())
    snap = doc.get("snapshot")
    if not isinstance(snap, dict):
        continue
    new = {}
    for k, v in snap.items():
        for old, repl in PREFIXES.items():
            if k.startswith(old):
                k = repl + k[len(old):]
                break
        new[k] = v
    doc["snapshot"] = new
    p.write_text(json.dumps(doc, indent=2) + "\n")   # match existing formatting
```

**Caveat for the reviewer:** confirm the exact JSON serialization the
harness writes (indent, trailing newline, key order) before running
this, so the rewrite produces a minimal, content-faithful diff and
doesn't reformat every runlog. Check `versioning.py`/`run_tests.py`
for how runlogs are written. If `.ann.json` files embed any snapshot
keys, include `*.ann.json` in the glob (they currently key on
`(test_id, dimension_source, dimension_name)`, not paths — verify).
This rewrite is the single largest line-count change in the PR
(~39 runlog files carry `mcp-server` keys) and should be reviewed as
"mechanical, generated by the script above," not line by line.

## Exact file edits

Counts below come from grepping the repo on the
`hosted-web-workbench` branch. Two prefixes change everywhere:
`mcp-server/` → `packages/engine/mcp-server/`, and `plugin/` →
`packages/engine/plugin/`.

### A. Build / release scripts (`scripts/`)

| File | Edit |
|---|---|
| `scripts/build-mcpb.sh` | `cd "$ROOT/mcp-server"` → `cd "$ROOT/packages/engine/mcp-server"`. `$ROOT` is `$(dirname "$0")/..` (repo root) and stays correct. Staging copies (`cp manifest.json package.json package-lock.json .mcpbignore`, `cp -R build config`) run from inside the engine dir, so no further change. |
| `scripts/package-plugin.sh` | `cd plugin` → `cd packages/engine/plugin`. The zip's include list (`.claude-plugin/`, `skills/`) is relative to that dir and unchanged. (`.claude-plugin/plugin.json` is the shipped manifest; the dir also holds `agents/`, `references/` that the zip intentionally omits — that's pre-existing, not touched here.) |
| `scripts/test.sh` | `cd "$ROOT/mcp-server"` → `cd "$ROOT/packages/engine/mcp-server"`. The eval-app and eval-harness `cd`s are unchanged (eval/ doesn't move). |
| `scripts/verify-mcpb.sh` | No path edit needed — it operates on `$ROOT/releases/genealogy-mcp.mcpb` (output path unchanged) and unpacks to a tmp dir. **Verify** it has no `mcp-server` literal (grep showed none). |

### B. CI workflows (`.github/workflows/`)

Both workflows reference engine paths in two ways — `on.pull_request.paths`
globs **and** `working-directory:` / `cache-dependency-path:` — and both
must change or the jobs silently stop triggering (paths) or fail to find
the dir (working-directory).

| File | Edit |
|---|---|
| `eval-harness-tests.yml` | `paths:` `- 'mcp-server/**'` → `- 'packages/engine/mcp-server/**'`; `- 'plugin/skills/**'` → `- 'packages/engine/plugin/skills/**'`. `cache-dependency-path: mcp-server/package-lock.json` → `packages/engine/mcp-server/package-lock.json`. Both `working-directory: mcp-server` → `packages/engine/mcp-server` (the `npm ci && npm run build` step). |
| `check-runlogs.yml` | `paths:` `- 'plugin/skills/**'` → `- 'packages/engine/plugin/skills/**'`; `- 'mcp-server/src/**'` → `- 'packages/engine/mcp-server/src/**'`. (`eval/**` paths unchanged.) No `working-directory` for the python steps. |

### C. Eval harness runtime paths (`eval/harness/`)

These resolve the engine **at run time** from the harness location via
`Path(__file__).resolve().parents[N]`. The harness itself stays at
`eval/harness/`, so the `parents[N]` indices that climb to repo root are
unchanged; only the `/ "mcp-server"` and `/ "plugin"` tails move under
`packages/engine`.

| File:line | Edit |
|---|---|
| `eval/harness/harness/mock_mcp.py:48` | `_MCP_BUILD = _REPO_ROOT / "mcp-server" / "build"` → `... / "packages" / "engine" / "mcp-server" / "build"` (used by the live `validate_research_schema` handler, line 193). |
| `eval/harness/harness/tool_catalog.py:95` | `repo_root / "mcp-server" / "src" / "tools"` → `... / "packages" / "engine" / "mcp-server" / "src" / "tools"` (the tool-catalog regex source dir). |
| `eval/harness/harness/snapshot.py:136` | `mcp_src_dir = repo_root / "mcp-server" / "src"` → `... / "packages" / "engine" / "mcp-server" / "src"`, AND `skill_dir = repo_root / "plugin" / "skills" / skill` (line ~119) → `... / "packages" / "engine" / "plugin" / "skills" / skill`. **These two define the snapshot keys going forward** — they must match the re-rooted runlog keys exactly (`packages/engine/mcp-server/...`, `packages/engine/plugin/skills/...`). Edit these in the same change as the runlog rewrite. |
| `eval/harness/scripts/check_tool_coverage.py:42` | `SKILLS_DIR = REPO_ROOT / "plugin" / "skills"` → `... / "packages" / "engine" / "plugin" / "skills"`. (`TESTS_DIR`, `FIXTURES_DIR` under `eval/` unchanged.) |
| `eval/harness/run_tests.py:213-214` | `_check_mcp_build_fresh()`: `src_root = REPO_ROOT / "mcp-server" / "src"` and `build_root = REPO_ROOT / "mcp-server" / "build"` → both under `packages/engine/`. |
| `eval/harness/e2e/orchestrator.py:44` | `DEFAULT_MCP_SERVER_ENTRY = REPO_ROOT / "mcp-server" / "build" / "index.js"` → under `packages/engine/`; `DEFAULT_PLUGIN_SKILLS = REPO_ROOT / "plugin" / "skills"` (line 47) → under `packages/engine/plugin/skills`. |

Grep `eval/harness/**` for `"mcp-server"` and `"plugin"` Path segments
after editing to confirm none were missed. The e2e suite is excluded
from CI (`-m 'not e2e'`) but must still be path-correct for local runs.

### D. Eval helper / doc-ish files (active)

| File | Edit |
|---|---|
| `eval/RunTests.bat` (lines 15-26) | `..\mcp-server\node_modules\` and `cd ..\mcp-server` → `..\packages\engine\mcp-server\...`. Windows path separators. |
| `eval/Setup.bat` (lines 42-46) | `cd ..\mcp-server` → `cd ..\packages\engine\mcp-server`. |
| `eval/briefs/volume-search.md:44` | `cd mcp-server` → `cd packages/engine/mcp-server`. |
| `eval/briefs/validate-schema.md:13` | path to `validator.ts` → `packages/engine/mcp-server/src/validation/validator.ts`. |
| `eval/CLAUDE.md` (lines 55, 106, 146, 149) | prose refs to `mcp-server/tests/`, `mcp-server/src/**`, `mcp-server/dev/try-*.ts` → re-root. Line 106 (`mcp-server/src/**`) describes the snapshot-tracked tree — keep it in sync with `snapshot.py`. |
| `eval/JUNIOR-WALKTHROUGH.md:75` | "Run `npm install` … in `mcp-server/`" → `packages/engine/mcp-server/`. |

### E. Web-side engine path defaults

| File | Edit |
|---|---|
| `apps/server/app/agent/real_agent.py:36-38` | `_REPO_ROOT = Path(__file__).resolve().parents[4]` is unchanged (file doesn't move). The two defaults change: `ENGINE_MCP_BUILD` default `str(_REPO_ROOT / "mcp-server" / "build" / "index.js")` → `... / "packages" / "engine" / "mcp-server" / "build" / "index.js"`; `ENGINE_PLUGIN_DIR` default `str(_REPO_ROOT / "plugin")` → `... / "packages" / "engine" / "plugin"`. The `ENGINE_MCP_BUILD` / `ENGINE_PLUGIN_DIR` **env overrides stay the API** for baked sandbox images — only the repo fallback moves. Update the module docstring's "node mcp-server/build/index.js" mention too. |
| `apps/server/app/sandbox/*.py`, `config.py` | **No edits needed** — grep found no `mcp-server` / `plugin` / `ENGINE_*` literals in `sandbox/` or `config.py`. The sandbox abstraction is path-agnostic; `e2b.py`'s only hit is the prose word "build" in an error string. Confirm with a fresh grep at execution time (a sandbox image-build script may be added before this lands). |
| `Makefile` line 69, 73, 77, 81 | `engine-test`: `cd mcp-server && npm test` → `cd packages/engine/mcp-server && npm test`. `mcpb`/`plugin` targets call the scripts (already fixed in §A), no change. `sandbox-image: bash apps/server/sandbox/build-image.sh` references a script that **does not exist yet** (Makefile is ahead of the tree) — if it exists at execution time, re-root any engine paths it copies into the image. |

### F. Repo docs (prose)

`grep -rln mcp-server docs/` = **55 files**; plus root `CLAUDE.md`,
`DEVELOPMENT.md`, `README.md`, `CONTRIBUTING.md`. Most are tool-spec /
testing-guide prose where `mcp-server/src/...` is descriptive. These are
**not load-bearing for CI** — they can be re-rooted with a single
scripted find-and-replace and spot-checked. Prioritize the four that a
developer or agent actually follows as instructions:

- **`CLAUDE.md`** — the "Repository layout" section (lines 54-67) and
  the "Hosted web workbench (monorepo overlay)" section (lines 77-101).
  Update the layout bullets to `packages/engine/mcp-server/`,
  `packages/engine/plugin/`, and rewrite the overlay paragraph so it
  reads "The engine (`packages/engine/{mcp-server,plugin}`) is
  deliberately kept out of the pnpm workspace via the
  `!packages/engine/**` negation in `pnpm-workspace.yaml`." Also lines
  117-128, 185, 188, 200, 222, 288, 402 (auth/tools/validator/secrets
  refs). Add a one-line note that `packages/engine` is a non-package
  container (no `package.json` of its own).
- **`DEVELOPMENT.md`** — every `cd mcp-server` (lines 12-16, 33-39,
  50-58, 70-71, 155, 162, 185, 189, 206) → `cd packages/engine/mcp-server`.
  The `try-*.ts` smoke-test recipes and the test-suite table.
- **`README.md`** — re-root any `mcp-server/` mentions in the tool
  catalog / layout sections.
- **`CONTRIBUTING.md`** — re-root the one engine reference.

Do the bulk docs replace last (after code + CI are green) so a botched
sed over 55 files can't mask a real CI break.

## What does NOT change

- **Relative imports inside `mcp-server/`.** Every TS import is
  package-relative (`../../src/tool-schemas.js`, `./auth/refresh.js`).
  `git mv` of the whole dir preserves all of them. No source edits.
- **The packaging drift test** (`mcp-server/tests/packaging/manifest.test.ts`).
  It resolves paths via `dirname(fileURLToPath(import.meta.url))` then
  `join(here, "..", "..")` and imports `allToolSchemas` from
  `../../src/tool-schemas.js` — all relative to the test file. Moving the
  enclosing dir keeps these correct. No edit.
- **`manifest.json`** `server.entry_point: "build/index.js"` and
  `mcp_config.args: ["${__dirname}/build/index.js"]`. These are
  relative to the bundle root / `__dirname` at install time, not the
  repo. The `.mcpb` is byte-identical. No edit.
- **`mcp-server/package.json`, `package-lock.json`, `.mcpbignore`,
  `tsconfig.json`, `vitest.config.ts`, `config/familysearch.json`.**
  All consumed relative to the engine dir. No edits.
- **The two stage-copy file lists** in `build-mcpb.sh` and the require/
  forbid lists in `verify-mcpb.sh` — they're relative to the staged
  bundle, independent of the engine's repo location.
- **`packages/schema`, `packages/viewer-ui`, `apps/*`** — they depend
  on `packages/schema`, never on the engine. Unaffected.
- **`pnpm-lock.yaml`** must NOT gain an engine importer. If it does,
  the negation in `pnpm-workspace.yaml` is wrong — fix that, don't
  commit the lockfile change.

## Step-by-step sequence

Do this on a clean branch off `hosted-web-workbench`, in this order, so
each pipeline can be verified before the next change layers on top.

1. **Move with history preserved.**
   `mkdir -p packages/engine`
   `git mv mcp-server packages/engine/mcp-server`
   `git mv plugin packages/engine/plugin`
   (`git mv` keeps blame/history; `git log --follow` still works.)
2. **Exclude from the pnpm workspace.** Add `'!packages/engine/**'` to
   `pnpm-workspace.yaml` (§"hard constraint"). Run `pnpm install`;
   confirm `pnpm ls -r --depth -1` shows the four members and no engine,
   and `pnpm-lock.yaml` is unchanged except (if anything) whitespace.
3. **Fix the release scripts** (§A) and run `make mcpb` + `make plugin`
   + `bash scripts/verify-mcpb.sh`.
4. **Fix the eval harness runtime paths** (§C) AND **re-root the runlog
   snapshot keys** (the one-shot script in "non-obvious risk"), in the
   same commit. Build the engine first
   (`cd packages/engine/mcp-server && npm run build`) so
   `_check_mcp_build_fresh` passes, then run the harness against one
   skill in scratch mode and confirm it loads tools and validates.
5. **Fix CI workflows** (§B) — both `paths:` and `working-directory:`.
6. **Fix the web-side defaults** (§E: `real_agent.py`, `Makefile`).
7. **Fix the eval helper/doc files** (§D).
8. **Bulk-rewrite repo docs** (§F), spot-checking the four primary docs.
9. **Run the full verification checklist** below, then push and let CI
   confirm both workflows still trigger and pass.

Keep steps 1-2 as their own commit (the move + workspace exclusion is
the reviewable heart of the change); 3-8 can be one commit each or
grouped, but the snapshot rewrite (step 4) should be visibly labeled.

## Verification checklist

Run all of these green before opening the PR:

- [ ] `git mv` used (not delete+add): `git log --follow
      packages/engine/mcp-server/src/index.ts` shows pre-move history.
- [ ] `pnpm install` clean; `pnpm ls -r --depth -1` lists `schema`,
      `viewer-ui`, `web`, `cowork-genealogy-ui` and **NOT**
      `genealogy-mcp`; `pnpm-lock.yaml` has no engine importer.
- [ ] `pnpm typecheck` and `pnpm test` green (web/electron/viewer-ui
      unaffected — they never referenced the engine).
- [ ] `make mcpb` (→ `scripts/build-mcpb.sh`) builds
      `releases/genealogy-mcp.mcpb`; `npx mcpb info` shows the same
      tool count and version as before the move.
- [ ] `bash scripts/verify-mcpb.sh` passes: bundle content checks +
      stdio boot + `tools/list` returns all tools (the manifest⇄server
      drift gate).
- [ ] `make plugin` (→ `scripts/package-plugin.sh`) builds
      `releases/genealogy-plugin.zip` with the same entries as before.
- [ ] `cd packages/engine/mcp-server && npm test` green — including the
      packaging drift test `tests/packaging/manifest.test.ts` (proves
      `import.meta.url`-relative resolution survived the move).
- [ ] `cd packages/engine/mcp-server && npm run build`, then
      `cd eval/harness && uv run pytest -m 'not e2e'` green (the
      harness's own suite: tool-catalog regex over the new tools dir,
      snapshot key construction, CLI build-freshness check).
- [ ] `eval/harness/run_tests.py --skill <one skill>` (scratch run)
      loads the MCP build and `validate_research_schema` from the new
      path without a "build not found" error.
- [ ] `python eval/harness/scripts/check_runlogs.py` (locally, with
      BASE/HEAD set) shows **no Rule 2 `missing-on-disk`** failures —
      i.e. the runlog snapshot rewrite + `snapshot.py` edit agree.
      This is the gate that proves the snapshot re-rooting is correct.
- [ ] `python eval/harness/scripts/check_tool_coverage.py` runs.
- [ ] On the PR: `check-runlogs.yml` AND `eval-harness-tests.yml` both
      **trigger** (paths matched the new locations) and pass green —
      confirm in the Actions tab they didn't silently skip.
- [ ] `apps/server` tests green: `cd apps/server && uv run pytest -q`.
      For the real-agent path, sanity-check `make server-real` boots
      and `real_agent.py` resolves the engine build/plugin from the new
      default paths (or set `ENGINE_MCP_BUILD`/`ENGINE_PLUGIN_DIR`).
- [ ] `grep -rn "mcp-server" docs/ CLAUDE.md DEVELOPMENT.md README.md
      CONTRIBUTING.md scripts/ .github/ eval/harness/ apps/` returns
      only `packages/engine/mcp-server` (no bare `mcp-server/` left in
      active files; historical runlog *values* are fine).

## Risk surfaces & reversibility

**Three pipelines, in order of blast radius:**

1. **Release pipeline** (`build-mcpb.sh`, `package-plugin.sh`,
   `verify-mcpb.sh`, `manifest.json`): a wrong `cd` breaks the shippable
   artifact. Mitigated by `verify-mcpb.sh` (boots the packed server) and
   the packaging drift test, both in the checklist. The `.mcpb`/`.zip`
   contents are unchanged — only where the build script `cd`s.
2. **Eval CI** (`check-runlogs.yml`, `eval-harness-tests.yml`): the
   subtle failure mode isn't a red X, it's a **silent skip** — if the
   `paths:` globs aren't re-rooted, the jobs stop triggering on engine
   changes and drift returns unnoticed (exactly the regression
   `eval-harness-tests.yml`'s own header warns about). The checklist's
   "confirm both workflows triggered" item guards this.
3. **Runlog snapshot integrity**: the only non-string-substitution part.
   Getting the key rewrite wrong (or skipping it) trips Rule 2 for every
   touched skill. Self-verifying via the local `check_runlogs.py` run in
   the checklist before the PR.

**Reversible.** The whole change is `git mv` + path-string edits + a
data-only key rewrite over runlog JSON. To back out: `git revert` the
PR (the inverse `git mv` restores the tree; the snapshot keys revert
with it) or branch-delete before merge. No data is destroyed, no
artifact format changes, and nothing the web/electron apps depend on
moves. The engine's behavior, tool list, manifest, and bundle are
identical before and after.
