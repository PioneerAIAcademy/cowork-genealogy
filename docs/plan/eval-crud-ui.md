# Eval CRUD UI — Implementation Plan

**Spec:** `docs/specs/eval-crud-ui-spec.md`
**Related:** `docs/plan/per-pr-review-workflow.md`, `eval/CLAUDE.md`
**Status:** Ready for implementation.

## Summary

Build a Next.js app at `eval/app/` that lets junior genealogists CRUD
unit/e2e tests, browse scenarios and MCP fixtures, view run logs,
annotate LLM judge grades, and compare a PR's run log against the
previous one side-by-side.

The filesystem is the database: the app reads and writes the existing
`eval/tests/`, `eval/fixtures/`, `eval/runlogs/` trees directly. Test
execution stays out of the UI — juniors invoke `RunTests.bat` or the
Python CLI; the UI surfaces new run logs via refresh-on-focus.

Scenarios and fixtures are read-only in the UI per spec §4–§5. Devs
add or update them outside the UI on demand when juniors ask.

## Spec dependency

The spec is being updated in parallel to switch run log scores from
enum (`pass`/`partial`/`fail`) to integer (`3`/`2`/`1`). This plan
assumes the integer form. When the spec lands, regenerating the Zod
schemas (see below) picks up the new shape with no code changes.

## Stack

- **Next.js (App Router) + TypeScript.** Pinned to the latest stable
  LTS Next.js. App Router so server-only file I/O lives in route
  handlers / server components and never leaks to the browser bundle.
- **Package manager:** `npm` — matches `eval/Setup.bat`.
- **Runtime:** Node. Local-only — no deployment target.
- **UI library:** Mantine. Internal-only tool — batteries-included
  multi-select, combobox, and tag inputs save real implementation time
  and cover the form ergonomics in the spec out of the box. No Tailwind
  — Mantine handles styling.
- **Forms:** `@mantine/form` with Zod resolver. The Zod schemas are
  generated from `docs/specs/schemas/*.schema.json` via a `gen-zod`
  script wired to `predev` and `prebuild` in `eval/app/package.json`,
  so codegen runs every time someone starts the dev server or builds.
  The generated files in `lib/schema/` are `.gitignored` — drift is
  impossible because they don't exist on disk until codegen runs.
- **State:** TanStack Query for server state (list/detail fetches,
  invalidation on save, `refetchOnWindowFocus` for the refresh-on-focus
  behavior). No global client store.
- **Change detection:** TanStack Query's `refetchOnWindowFocus` only.
  No server-side file watcher, no SSE. `git pull` becomes visible on
  the next alt-tab back to the browser.
- **Testing:** Vitest (matches `mcp-server/`) for unit tests on the
  data layer. No Playwright — manual smoke testing per release is
  fine for an internal tool.

## App layout

```
eval/app/
  package.json               predev/prebuild scripts run gen-zod
  next.config.mjs
  tsconfig.json
  .gitignore                 lib/schema/, .local/
  app/
    layout.tsx               Shell + nav (Tests / Scenarios / Fixtures / Results)
    page.tsx                 Redirect to /tests
    tests/
      page.tsx               List + filter
      new/page.tsx           Create form
      [id]/page.tsx          Edit form
    scenarios/
      page.tsx               List
      [name]/page.tsx        Detail (README + JSON viewer + reverse lookup)
    fixtures/
      page.tsx               List
      [name]/page.tsx        Detail
    results/
      page.tsx               Filterable run log list, sorted timestamp desc
      [runId]/page.tsx       Run detail + annotation view
      compare/page.tsx       Two-most-recent comparison
    api/
      tests/route.ts                    GET list, POST create
      tests/[id]/route.ts               GET / PUT / DELETE
      scenarios/route.ts                GET list
      scenarios/[name]/route.ts         GET detail
      fixtures/route.ts                 GET list
      fixtures/[name]/route.ts          GET detail
      runlogs/route.ts                  GET list (filtered)
      runlogs/[id]/route.ts             GET detail
      runlogs/[id]/annotation/route.ts  GET / PUT (.ann.json)
      runlogs/compare/route.ts          GET two-most-recent comparison data
      skills/route.ts                   GET skills + rubric.md parsed
  lib/
    paths.ts                 Resolves eval/ paths from app/ at runtime
    fs/
      tests.ts               Read/write/list unit + e2e test JSONs
      scenarios.ts           Read scenarios + reverse lookup
      fixtures.ts            Read fixtures + reverse lookup
      runlogs.ts             Read/list run logs
      annotations.ts         Read/write .ann.json
      atomic.ts              Write-temp-then-rename helper
    schema/                  GENERATED, gitignored — populated by gen-zod
      unit-test.ts
      run-log.ts
      annotation.ts
    skills.ts                Scan plugin/skills/, parse SKILL.md + rubric.md
    identity.ts              Resolve current user (git email or prompt)
  scripts/
    gen-zod.ts               Reads docs/specs/schemas/*.json → writes lib/schema/*.ts
  components/
    forms/                   TestForm, ScenarioPicker, FixturePicker, ...
    results/                 RunRow, AnnotationGrid, ComparisonTable, ...
    layout/                  Nav, breadcrumb, etc.
  tests/
    fs/*.test.ts             Vitest, real fs against fixture tree
```

`lib/paths.ts` resolves `eval/` relative to the app, so the app works
whether started from `eval/app/` directly or via `eval/Start.bat`.

## Data access layer

The filesystem is the database, and bugs here silently corrupt eval
data — the unit test coverage in `tests/fs/` exists for this reason.

- **Atomic writes.** Every write to `eval/tests/*.json` or
  `eval/runlogs/.../<id>.ann.json` goes through `lib/fs/atomic.ts`:
  write to `foo.json.tmp` → `fsync` → `rename` over `foo.json`. Avoids
  a half-written file if the process dies mid-save or if a `git pull`
  collides with a save. No concurrent-edit conflict path — git is the
  conflict-resolution layer when it happens.
- **Reverse lookups.** Computed on demand by scanning `eval/tests/`
  for `scenario` / `mcp_fixtures` references. Cheap (hundreds of files)
  — no index needed.
- **Schemas.** `docs/specs/schemas/*.schema.json` is the source of
  truth. `scripts/gen-zod.ts` (run by `predev` and `prebuild`)
  generates Zod equivalents in `lib/schema/`. Generated files are
  gitignored, so they always reflect the current JSON Schema.

## Routes and forms

- **TestForm** (`/tests/new`, `/tests/[id]`) is one component with
  branches on `type` (positive/negative). Skill choice drives whether
  `mcp_fixtures` is visible and which rubric dimensions render in the
  sidebar. Built on `@mantine/form` with the generated Zod schema as
  the resolver; field errors render inline.
- **Tests list status badge** is a single "blocked" indicator per row:
  shown when the test's referenced scenario doesn't exist, or any
  referenced MCP fixture doesn't exist, or `scenario_notes` is
  populated. A hover-tooltip shows the specific reason. Simpler than
  the three-state badge in spec §3 and same user value.
- **Scenario/Fixture picker** is a Mantine combobox without a "Create
  new" affordance. When no scenario matches, the junior picks the
  closest and fills `scenario_notes` (spec §3); devs add the new
  scenario outside the UI and the junior updates the test to point at
  it.
- **Run logs list** lives at `/results`. Sorted by timestamp
  descending by default; the most recent run logs are visible at the
  top with no separate "recent widget" component. Filters: skill,
  model version, date range, annotation status (annotated /
  unannotated).
- **AnnotationGrid** (`/results/[runId]`) renders one row per
  (test, dimension), shows the LLM judge's integer score (1–3, read
  directly from the run log — no enum mapping), lets the junior
  overwrite it (1–3) and add a comment. Save writes the full
  `.ann.json` via the atomic-write helper. Partial-judge guard: if
  any test in the run log has `judge.skipped: true` with an error,
  render a refusal message and no grid.
- **ComparisonTable** (`/results/compare`) takes a skill + model,
  lists run logs in that directory sorted by timestamp descending,
  picks the two most recent, and renders them side-by-side. The
  previous run log is already in the branch (inherited from `main`
  at branch creation) — no cross-branch lookup. Per-test rows whose
  `test_content_hash` differs between the two run logs are flagged
  "edited — excluded from headline comparison" and visually
  de-emphasized; the hash is read straight from each run log (the
  harness computes it; the UI never recomputes). Within-variance
  advisory (|Δweighted-mean| < 0.3) is a banner above the table.

## Skills introspection

`lib/skills.ts` scans `plugin/skills/<name>/`:

- `SKILL.md` frontmatter → name, description, `allowed-tools`.
- `rubric.md` → parsed dimensions per `unit-test-spec.md §7`.
- Read on each request — the skill count is small enough that caching
  isn't worth the invalidation complexity.

**Rubric parser validation.** On app boot, `lib/skills.ts` parses
every `rubric.md` under `plugin/skills/`. If any file is malformed,
the server fails to start with a clear error pointing at the offending
file. This catches format drift at startup instead of at runtime when
a junior opens the form.

## Identity

`lib/identity.ts` resolves the current user as follows:

1. Read `git config user.email` via `child_process.execSync`.
2. If that returns empty or fails, show a one-time Mantine modal on
   first interaction asking for an email/handle. Write the result to
   `eval/app/.local/identity.json`.
3. Cache in memory for the server process lifetime.

The string is used as the `annotator` field in `.ann.json` writes.
`eval/app/.local/` is gitignored.

## Build order

Each step ships a working slice.

1. **Scaffold + Tests list (read-only).** `npx create-next-app`,
   Mantine provider, four-page nav stub, `eval/Start.bat` updated to
   run `npm run dev` from `eval/app/`, `gen-zod` wired to predev,
   `lib/paths.ts`, `lib/fs/tests.ts`, `/api/tests`, `/tests` page with
   skill/type/tags filters and blocked-badge column.
2. **Tests create + edit.** TestForm with `@mantine/form` + Zod
   validation, atomic write, rubric sidebar from `lib/skills.ts`.
   Rubric parser validation on boot lands here.
3. **Scenarios + Fixtures read-only views.** List + detail + reverse
   lookup. Skipped for stateless skills.
4. **Run logs list + detail.** Filterable, sorted timestamp desc.
   No annotation yet — just browsing. `refetchOnWindowFocus` enabled.
5. **Annotation view + write.** AnnotationGrid, partial-judge guard,
   `.ann.json` atomic write, identity resolution.
6. **Comparison view.** Pick skill + model → list run logs in that
   directory by timestamp desc → render the two most recent
   side-by-side with hash-mismatch de-emphasis and within-variance
   advisory.

## Decisions (formerly open questions)

- **Phasing:** spec §8's Phase 2 work is out of scope indefinitely.
  Scenarios/fixtures remain read-only in the UI; AI-assisted bulk
  authoring, launch-and-watch button, and bulk operations are not
  built.
- **Schema → Zod drift:** prevented structurally by codegen-on-build
  + gitignored generated files. No CI gate needed.
- **Rubric parser fragility:** caught at app boot by parsing every
  `rubric.md` and failing fast on malformed input. No CI gate needed.
- **Identity:** `git config user.email` first, prompt-once fallback,
  stored under `eval/app/.local/`. No OAuth.
- **`eval/app/.local/` policy:** gitignored; created on first write.
- **`scenario_notes` → scenario promotion:** no in-UI mechanism.
  Genealogists and devs work together daily — juniors ask devs to
  build scenarios in real time when no existing one fits.

## Implementation notes

- Update `eval/Start.bat` to run `npm install && npm run dev` from
  `eval/app/`.
- Update `eval/Setup.bat` if Node version requirements change.
- Mantine's color scheme provider should default to `light` to match
  the rest of the team's tooling; allow `dark` via a toggle in the nav
  if it's a 5-minute add.
- For the run log list, paginate at 100 rows. The corpus will grow but
  not fast.
