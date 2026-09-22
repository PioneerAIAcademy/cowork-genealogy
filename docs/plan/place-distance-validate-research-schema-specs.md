# Plan: Write `place_distance` and `validate_research_schema` tool specs

**Status:** Landed
**Issue:** #1119

## Goal

Create two new spec files:
- `docs/specs/place-distance-tool-spec.md`
- `docs/specs/validate-research-schema-tool-spec.md`

Both follow the pattern of `project-context-tool-spec.md`: status line,
purpose, input shape, output shape, error table, consumers, test plan.

## Scope fence (from issue)

- **place_distance** — full behavioral spec read off `src/tools/distance.ts`
  (103 lines) and its 6 test cases in `tests/tools/distance.test.ts`.
- **validate_research_schema** — the tool's I/O contract at the MCP boundary
  only. A pointer to `research-schema-spec.md` for the rule set. NOT the
  ~2,160-line validator internals.

Neither spec touches a SKILL.md, agent body, rubric, or eval fixture.

## Files created

1. `docs/specs/place-distance-tool-spec.md` (new)
2. `docs/specs/validate-research-schema-tool-spec.md` (new)

No other files are modified.

## Spec content — `place_distance`

Derived from `src/tools/distance.ts`:

- **Input:** `{ standardPlace1: string, standardPlace2: string }`, both required.
  Values are `place_search`'s `standardPlace` field.
- **Output:** `{ standardPlace1, standardPlace2, miles, kilometers }` — input
  names echoed verbatim, distances `Math.round`ed to whole numbers.
- **Algorithm:** Great-circle haversine, Earth radius 6371 km, conversion
  factor 0.621371. No travel routing.
- **Resolution:** Each name resolved via `standardPlaceToCoords`
  (`src/utils/place-resolver.ts`). Both resolved concurrently
  (`Promise.all`). First-place guard runs before second.
- **Error:** Throws `Could not resolve coordinates for "<name>". Use
  place_search to get a standard place name first.` — `server.ts` wraps as
  `{ error: "<message>" }` with `isError: true`. One message covers unknown
  name, API outage, and timeout (resolver returns `null` for all).
- **No auth:** `place-api.ts` sends no `Authorization` header.
- **No retry:** Uses `fetchWithTimeout` (not `fetchWithRetry`).
- **Consumers:** `timeline/SKILL.md`, `conflict-resolution/SKILL.md`,
  `gps-mentor.md`, `person-evidence.md`, 9 skills' `places-guidance.md`.
  Persisted field: `distance_from_previous_km` in research-schema-spec.md.

## Spec content — `validate_research_schema`

Derived from `src/tools/validate-research-schema.ts` (68 lines):

- **Input:** `{ projectPath: string }`, required.
- **Output:** `{ valid: boolean, errors: string[], warnings: string[],
  message: string }`. Each entry formatted `${e.path}: ${e.message}`.
- **Success message:** `"Both project files pass all validation checks."`
- **Failure message:** `"Validation failed: N error(s), M warning(s)"`
- **Error handling:** Catches every throw from `validateProject` and returns
  `valid: false` with `errors: ["Validation error: <message>"]` and matching
  `message`. No error modes at the MCP boundary — never sets `isError: true`.
- **Missing files:** `validateProject` adds an error for each missing/invalid
  file and returns `valid: false` before running further checks.
- **Rule set:** Pointer to `docs/specs/research-schema-spec.md`. Not restated.

## Acceptance criteria

- Both files exist under `docs/specs/`.
- Each spec states input shape, output shape, error messages verbatim.
- `make test-all` passes (the specs are docs-only, no code changes).
- PR body quotes each spec claim against the source code line.
- No automated check covers either file (stated in PR body per issue).
- Run `cd packages/engine/mcp-server && npx tsx dev/try-place-distance.ts "England, United Kingdom" "Ohio, United States"` and confirm the output shape matches the spec.

## What is NOT done

- No prose-drift test (per issue: decided against, citing #2480).
- No SKILL.md or agent body edits.
- No eval slot or paid run.
