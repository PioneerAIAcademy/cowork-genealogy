# get_name_variants (issue #2325) — plan

**Status:** Planned, not built. Blocked on the given-name list from Dallan (the
issue forbids seeding it from any other source).

Engine-only PR: one MCP tool returning a given name's alternate forms. No file
under `packages/engine/plugin/` changes; `config/given-name-variants.json`,
`tests/packaging/name-variant-drift.test.ts`, `expandNameForFulltext` and
`expandLookingFor` stay behaviorally identical. $0 eval spend.

## Contract (from the issue; no caller until #1828)

- Tool `get_name_variants`, one parameter `name: string` (required).
- Returns `{ name, variants: string[] }`. `name` echoes the trimmed input.
  `variants` is every form in the name's merged family whose
  `normalizeString` differs from the input's, in the table's spelling and
  table order.
- Case- and diacritic-insensitive (`normalizeString`); bidirectional (Bill →
  William and siblings). Unknown name → `variants: []`, not an error.
- Empty, whitespace-only, or non-string `name` → throw an LLM-instruction
  error. Not `{ ok: false }`; not added to `OK_FALSE_IS_FAILURE`.
- A missing or corrupt **new** table throws an installation-framed error from
  the tool (see step 1). Without this, a table that failed to ship reads as
  "every name is unknown" — a silent zero.

## Steps

1. **`src/utils/name-variants.ts`** — parameterize the loader on the table path.
   - Export `GIVEN_NAME_VARIANTS_PATH` (existing file, unchanged default) and
     `NAME_VARIANTS_GIVEN_PATH` (`config/name-variants-given.json`).
   - `ensureLoaded(tablePath)` caches per path in a `Map<string, LoadedTable>`,
     where `LoadedTable = { map: Map<string, NameFamily>; error: string | null }`.
     Family-merge logic is unchanged, just keyed per path.
   - `lookupNameFamily(name, tablePath = GIVEN_NAME_VARIANTS_PATH, opts?: { strict?: boolean })`.
     `strict: true` throws when that table's load recorded an error; default
     keeps today's degrade-to-empty, so both `expand*` functions (which call it
     with no path) behave exactly as before.
   - The `LoadedTable` enters the cache only after the build finishes (today the
     empty map is cached first, so a mid-build throw leaves a partial map
     cached). `error` is recorded for: unreadable file, JSON parse failure,
     missing or non-object `en`, and any entry whose `variants` is not an array.
   - `VariantEntry`/`FormalEntry` fields other than `form` / `variants` become
     optional in the interface (the loader never read them).
   - `__clearVariantCacheForTests()` clears every path.
   - The file read stays here; `tools/name-variants.ts` is **not** added to the
     `no-fs-outside-store` exemption.

2. **`config/name-variants-given.json`** (new) — Dallan's list, reshaped into
   the shape the loader already reads:
   `{ "_meta": { source, received, issue, shape }, "en": { "<Formal>": { "variants": [ { "form": "…" } ] } } }`.
   Exactly what he sent: no additions, no fills. If his list does not mark a
   formal form, the first name of each group is the key. `_meta` records the
   source (Dallan, via issue #2325) and date received.

3. **`src/tools/name-variants.ts`** (new) — `getNameVariants(input)` +
   `getNameVariantsSchema` (description ≤ 250 chars; says given names only,
   unknown → `[]`, the caller puts the forms into its own query). Calls
   `lookupNameFamily(name, NAME_VARIANTS_GIVEN_PATH, { strict: true })`. No
   `fs` import.

4. **Registration** — `src/tool-schemas.ts` (`allToolSchemas`), `src/server.ts`
   dispatch arm (plain `JSON.stringify` content like `wikipedia_search`; catch →
   `isError: true`), `manifest.json` `tools`.

5. **`dev/smoke-calls.ts`** — `offline: true` row, `{ name: "<a formal name in
   Dallan's list>" }`, `expect: (res) => ({ ok: !res.isError &&
   Array.isArray(res.body?.variants) && res.body.variants.length > 0, detail:
   brief(res) })` — `okTrue` reads `body.ok`, which this tool has none of; the
   non-empty check is what proves the table shipped in the stdio/http build.

6. **`scripts/verify-mcpb.sh`** — `require config/name-variants-given.json`
   after line 42.

7. **`eval/harness/harness/mock_mcp.py`** — `get_name_variants` into
   `LIVE_TOOLS` (comment: same rationale as `convert_calendar` — pure lookup, a
   canned fixture would supply the answer) and `_COMPILED_TOOLS`
   (`("name-variants.js", "getNameVariants")`). The injected `projectPath` is
   ignored. Not in `OK_FALSE_IS_FAILURE_LIVE`. Accepted for v1: a thrown
   empty-name error reaches the harness as `{ok:false, errors:[stderr]}` without
   `is_error` (`mock_mcp.py` no-output branch), unlike production's `isError`.
   Nothing calls the tool until #1828; `sidecar_read`/`research_query` already
   throw the same way.

8. **`tests/tools/name-variants.test.ts`** (new) against the real new table:
   known formal name; reverse lookup (diminutive → formal); case folding;
   diacritic folding; input's own form excluded; unknown → `[]`; empty and
   whitespace → throws; non-string → throws. Plus, against two committed
   fixture tables under `tests/fixtures/name-variants/`: a name present only
   in table A returns nothing through table B after A was loaded (cache
   bleed), a missing path with `strict` throws while non-strict returns null,
   and a table with no `en` key throws under `strict`.

9. **`docs/specs/name-variants-tool-spec.md`** (new) — contract above, table
   provenance, and "Deferred": surnames and places (pending a probe of the wiki
   page `Guessing_a_Name_Variation`); retiring `given-name-variants.json`, its
   drift test and both `expand*` functions in issue #1828.

10. **`README.md`** — row under "Reference and context" (Auth: None), and the
    tool count `48` → `49` at lines 57 and 479 (`readme-catalog.test.ts:105-120`).

11. **`tests/packaging/prompt-sizes.json`** — regenerate with
    `UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts`;
    the staleness test fails on any new `allToolSchemas` entry.

## Acceptance

- `make engine-test`, `make typecheck`, `make engine-smoke-stdio`,
  `make harness-test` green; `scripts/verify-mcpb.sh` passes on a built `.mcpb`.
- `tests/packaging/name-variant-drift.test.ts` and
  `tests/utils/name-variants.test.ts` pass **unmodified** (proof the old path is
  untouched). `git diff --stat` shows nothing under `packages/engine/plugin/`
  and no change to `config/given-name-variants.json`.
- Falsifiability: deleting `name-variants-given.json` fails the tool tests,
  the smoke row, and `verify-mcpb.sh`; making `ensureLoaded` ignore its path
  argument fails the cache-bleed test.
- Dallan confirms the committed table in PR review (nothing else can).
