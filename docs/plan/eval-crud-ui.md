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

The spec was updated to switch the per-dimension score format from
enum (`pass`/`partial`/`fail`) to integer (`3`/`2`/`1`); the run-log
JSON Schema already uses integers, so codegen produces the correct
shape directly.

## Stack

- **Next.js (App Router) + TypeScript.** Pin to `15.x` (latest stable
  with App Router). App Router so server-only file I/O lives in route
  handlers / server components and never leaks to the browser bundle.
- **Package manager:** `npm` — matches `eval/Setup.bat`.
- **Runtime:** Node. Local-only — no deployment target.
- **UI library:** Mantine `7.x` (pin — v6→v7 broke a lot). No Tailwind.
  Default color scheme is `light`. No toggle in v1 — internal tool,
  juniors use the default; add a toggle only if someone asks.
- **Forms:** `@mantine/form` with Zod resolver. The Zod schemas are
  generated from `docs/specs/schemas/*.schema.json` via
  `scripts/gen-zod.ts`, which uses the `json-schema-to-zod` library
  (pin in `package.json` — its output style is load-bearing for
  consumers). Wired to **both** `postinstall` and `prebuild` in
  `eval/app/package.json`. `postinstall` is the load-bearing trigger
  — it covers cold clone, IDE TypeScript LSP, `npm test`, `npm run
  lint`, and CI (if/when added); `prebuild` is defense for cached
  `node_modules`. Generated files in `lib/schema/` are `.gitignored` —
  no committed source for drift to occur against. If `npm ci
  --ignore-scripts` is ever used, run `npm run gen-zod` manually
  before `npm test` / `tsc`.
- **State:** TanStack Query for server state. `refetchOnWindowFocus`
  enabled for list/detail read views; **disabled** for edit views and
  the AnnotationGrid (otherwise an alt-tab away from a half-filled
  form refetches and clobbers the in-progress values). Edit-view
  queries set `refetchOnWindowFocus: false` or gate with
  `enabled: !isDirty`.
- **Change detection:** the per-view `refetchOnWindowFocus` above.
  No server-side file watcher, no SSE. `git pull` becomes visible on
  the next alt-tab back to a read view.
- **Testing:** Vitest (matches `mcp-server/`) for unit tests on the
  data layer. No Playwright; UI rendering breaks loudly and is
  smoke-tested manually per release. Critical-path test commitments
  the plan locks in (everything else is implementer's discretion):
  - `lib/fs/atomic.ts` — happy temp+rename, `EBUSY` retry that
    succeeds on attempt 2, `EBUSY` retry that exhausts all 3
    attempts and surfaces the error. Why: silent annotation loss
    on Windows is the worst-case data bug.
  - `lib/fs/runlogs.ts` + `lib/fs/annotations.ts` — happy path,
    malformed run-log JSON, missing-annotation-file.
  - `lib/skills.ts` — happy parse of a well-formed rubric set,
    and a malformed `rubric.md` produces a thrown error whose
    message contains the offending file path. Why: the plan
    promises that error; without a test the promise is prose.
  - `components/results/ComparisonTable` logic — the four
    enumerated edge cases (0 logs, 1 log, single-side tests,
    zero overlapping after edits). Pure data transformation
    tests against fixture run-log pairs, not rendering tests.
    Why: an enumeration in a plan is documentation of intent;
    a test is a guarantee of behavior.

## App layout

```
eval/app/
  package.json               postinstall + prebuild scripts run gen-zod
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
      identity/route.ts                 GET / POST current annotator
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
  write to `foo.json.tmp` → `rename` over `foo.json`. Avoids a
  half-written file if the process dies mid-save or if a `git pull`
  collides with a save. No `fsync` — losing the last 50ms of eval data
  to a power cut is acceptable (junior re-enters the annotation), and
  directory `fsync` is a non-portable headache on Windows. On Windows,
  retry the rename on `EBUSY`/`EPERM` (3 attempts, 50ms backoff) —
  antivirus, OneDrive, and Dropbox routinely hold file handles
  transiently and `eval/` users are mostly on Windows. No
  concurrent-edit conflict path — git is the conflict-resolution layer
  when it happens.
- **Reverse lookups.** Computed on demand by scanning `eval/tests/`
  for `scenario` / `mcp_fixtures` references. Cheap (hundreds of files)
  — no index needed.
- **Robust reads.** `lib/fs/runlogs.ts` and the other list readers skip
  files that fail JSON parse: log a `console.warn` with the offending
  path and include the path in a `corrupt: string[]` field on the API
  response. The list view renders a small banner ("1 run log could not
  be read — check console") when `corrupt` is non-empty. One bad file
  must not break an entire list.
- **Schemas.** `docs/specs/schemas/*.schema.json` is the source of
  truth. `scripts/gen-zod.ts` (run by `postinstall` and `prebuild`)
  generates Zod equivalents in `lib/schema/`. Generated files are
  gitignored, so they always reflect the current JSON Schema.

## Routes and forms

- **Filter state in URL.** Both the tests list and the run-logs list
  store their filters in query params via App Router's
  `useSearchParams`. Refresh, back/forward, and shareable links ("look
  at this set of blocked tests") all work without extra wiring.
- **TestForm** (`/tests/new`, `/tests/[id]`) is one component with
  branches on `type` (positive/negative). Skill choice drives whether
  `mcp_fixtures` is visible and which rubric dimensions render in the
  sidebar. Built on `@mantine/form` with the generated Zod schema as
  the resolver. **Validates shape, not reference existence** — a test
  whose referenced scenario was renamed or deleted must still save so
  the junior can fix it. Existence checks drive the blocked badge, not
  form validity.
- **Tests list** sorts alpha by name within skill grouping by default;
  column headers toggle direction. Status is a single "blocked"
  indicator per row: shown when the referenced scenario doesn't
  exist, any referenced MCP fixture doesn't exist, or
  `scenario_notes` is populated. Hover-tooltip explains the specific
  reason. Simpler than the three-state badge in spec §3, same user
  value.
- **Scenario/Fixture picker** is a Mantine combobox without a "Create
  new" affordance. When no scenario matches, the junior picks the
  closest and fills `scenario_notes` (spec §3); devs add the new
  scenario outside the UI and the junior updates the test to point at
  it.
- **Run logs list** lives at `/results`. Sorted by timestamp
  descending by default; the most recent run logs are visible at the
  top with no separate "recent widget" component. Filters: skill,
  model version, date range, annotation status. Paginated client-side
  at 100 rows.
- **AnnotationGrid** (`/results/[runId]`) renders a flat Mantine
  `Table` with a section-break row per test (test name + per-test
  save indicator). The section-break row uses CSS `position: sticky`
  so the test name stays visible at the top of the viewport while
  the junior scrolls through that test's dimension rows. A typical
  rubric is 5–7 dimensions, so a 10-test run is ~50–70 rows total —
  small enough to show everything at once, which is actually nicer
  for "scan the whole grid for a value I want to override" than a
  collapsible structure. Each row shows the LLM judge's integer
  score (1–3, read directly from the run log — no enum mapping),
  lets the junior overwrite it (1–3) and add a comment. **Save
  model: debounced per-test write** — each test's group of
  dimension scores writes its own `.ann.json` 500ms after the last
  change in that group. Lossless autosave without hammering the
  disk, regardless of rubric size. The `.ann.json` for a test is
  always written in full (not patched) via the atomic-write helper.
  **Save indicator per test-row:** small label cycling
  `idle` → `Saving…` → `Saved · Xs ago` so the junior can confirm
  their last keystroke landed before closing the tab. Partial-judge
  guard: if any test in the run log has `judge.skipped: true` with an
  error, render a refusal message and no grid.
- **ComparisonTable** (`/results/compare?skill=…&model=…`) lists run
  logs in `eval/runlogs/unit/<skill>/<model>/` sorted by timestamp
  descending, picks the two most recent, and renders them
  aggregate-first: a top banner shows the overall weighted-mean
  comparison (Δ + within-variance advisory), then below it per-test
  sections each showing the test name, per-test weighted-mean + Δ,
  and the dimension-level old / new / Δ rows expanded by default
  (sections are still collapsible if the junior wants to focus). At
  ~5–7 dimensions per test × ~10 tests, the full table fits without
  paging — flat rendering as one wide table is also acceptable if
  that reads better in practice. Hash-mismatched tests render in muted gray with
  an "edited" pill and stay expandable; the hash is read straight
  from each run log (the harness computes it; the UI never
  recomputes). If the hash field is absent on either side (older
  run log or harness bug), treat the row as edited (safer default —
  excludes from headline) and emit a `console.warn` so the gap
  surfaces in dev. Within-variance advisory (|Δweighted-mean| < 0.3)
  is a banner above the table. Edge cases:
  - 0 run logs in the directory → "no run logs for this skill /
    model" empty state.
  - 1 run log → single column with "no previous run log to compare
    against."
  - Tests present in only one of the two logs (added since previous
    run, or removed) → listed in a "single-side" section below the
    joined view, annotated with which side they appear on. Excluded
    from headline weighted-mean.
  - Zero overlapping tests after edits + single-side exclusions →
    headline weighted-mean suppressed with "no comparable tests."

## Skills introspection

`lib/skills.ts` scans `plugin/skills/<name>/` on every request:

- `SKILL.md` frontmatter → name, description, `allowed-tools`.
- `rubric.md` → parsed dimensions per `unit-test-spec.md §7`.
- No caching. The scan is a sub-millisecond walk over a handful of
  files; the upside is that dev edits to `rubric.md` show up without
  restarting the server.

**Rubric parser validation.** The parser throws on any malformed
`rubric.md` with a path pointer. Because the parse runs on every
relevant request, format drift surfaces as a clean 500 from the first
request that hit a bad file — equivalent to "fail fast" without
needing an explicit boot hook.

## Identity

Identity resolution needs a small server↔client handshake because the
server can't pop a modal. Identity is only required for `.ann.json`
writes, so the modal appears at the point of first write — not on
app load — and read-only browsing of tests, scenarios, fixtures, and
run logs works without any prompt.

1. Server-side, `lib/identity.ts` checks
   `eval/app/.local/identity.json` first; if absent, tries
   `git config user.email` via `child_process.execFile` (async,
   promisified). `execSync` would also work for a one-shot lookup but
   it blocks the event loop — using `execFile` keeps the pattern safe
   to copy elsewhere later. Result cached in memory for the process
   lifetime (dev-server restart re-runs the resolution).
2. `GET /api/identity` returns `{ resolved: true, annotator }` or
   `{ resolved: false }`.
3. The client calls `/api/identity` lazily on the first annotation
   save attempt. On `resolved: false`, the save is held, a Mantine
   modal opens asking for an email/handle, and on submit the client
   `POST`s `/api/identity` which writes `eval/app/.local/identity.json`
   atomically and refreshes the cached value. The held save then
   proceeds. Subsequent saves are unblocked.
4. The annotator string is embedded server-side in every `.ann.json`
   write from the cached identity — the client never sends it. One
   source of truth, no per-request plumbing.

`eval/app/.local/` is gitignored.

## Build order

Each step ships a working slice.

1. **Scaffold + Tests list (read-only).** `npx create-next-app`,
   Mantine 7 provider (light scheme, no toggle), four-page nav stub,
   `eval/Start.bat` updated to run `npm install && npm run dev` from
   `eval/app/`, `gen-zod` wired to `postinstall` + `prebuild` with
   `json-schema-to-zod` pinned, `eval/app/.gitignore` covering
   `lib/schema/` and `.local/`, `lib/paths.ts`, `lib/fs/tests.ts` +
   atomic helper with Windows-retry, `/api/tests`, `/tests` page with
   skill/type/tags filters (URL-backed) and blocked-badge column.
   Vitest fixture tree with happy-path, malformed run-log, and
   missing-annotation cases.
2. **Tests create + edit.** TestForm with `@mantine/form` + Zod
   validation, atomic write, rubric sidebar from `lib/skills.ts`.
   `getRubrics()` fail-fast lands here (first request that hits the
   sidebar throws on any malformed rubric).
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
- **Schema → Zod drift:** prevented structurally by codegen on
  `postinstall` + `prebuild` + gitignored generated files. No CI gate
  needed.
- **Rubric parser fragility:** `getRubrics()` parses every `rubric.md`
  on every request with no caching, and throws on malformed input with
  a path pointer. Format drift surfaces as a clean 500 from the first
  request to a bad file. No CI gate needed.
- **Identity:** `git config user.email` first, prompt-once fallback,
  stored under `eval/app/.local/`. No OAuth.
- **`eval/app/.local/` policy:** gitignored; created on first write.
- **`scenario_notes` → scenario promotion:** no in-UI mechanism.
  Genealogists and devs work together daily — juniors ask devs to
  build scenarios in real time when no existing one fits.
- **Concurrency model:** single concurrent editor assumed.
  Last-write-wins on collision. Two browser tabs editing the same
  test, or one tab editing while a CLI edits the same file, will
  silently lose one side's work — not a target use case for an
  internal tool with a small team.
- **Pagination:** client-side slice at 100 rows. Internal corpus
  stays small for the foreseeable future. Server-side cursor
  pagination is a deliberate later change when the run-log directory
  has thousands of entries — not designed for now.

## Implementation notes

- Update `eval/Start.bat` to run `npm install && npm run dev` from
  `eval/app/`. Update `eval/Setup.bat` if Node version requirements
  change.
- `eval/app/.gitignore` (written during step 1) covers `lib/schema/`,
  `.local/`, `.next/`, and `node_modules/`. The root `.gitignore`
  already covers `.local/` and `eval/app/lib/schema/` as belt-and-
  suspenders.
- Empty states (zero tests / zero scenarios / zero run logs) get a
  one-sentence "no X yet — see eval/README.md to add your first one"
  card. Internal tool or not, the first-run experience should not be
  a blank page.
