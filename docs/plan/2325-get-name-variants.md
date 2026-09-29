# get_name_variants (issue #2325) — plan

**Status:** Planned, not built. Step 1 (the parameterized loader for the
existing `given-name-variants.json` path) is already committed
(`033bc9bd8` after rebase, same patch as the earlier `18900e26e`) and stays
as-is. Everything below this line is new since Dallan's reply named the
actual data source.

Engine-only PR: one MCP tool returning a given name's alternate forms. No file
under `packages/engine/plugin/` changes; `config/given-name-variants.json`,
`tests/packaging/name-variant-drift.test.ts`, `expandNameForFulltext` and
`expandLookingFor` stay behaviorally identical. $0 eval spend.

## Data source (Dallan, 2026-09-29)

Dallan pointed at a public file rather than typing a list:
`https://github.com/rootsdev/nama/blob/master/references/givenname_nicknames.csv`
(repo `rootsdev/nama`, MIT license). Last touched at commit
`30ccc4ababcd204d80d2ad077949edcb35efbbab` (2022-12-05). Fetched and inspected
2026-09-29: 418 data rows (`wc -l` says 417 — the last line has no trailing
newline), CRLF line endings, all lowercase ASCII, comma-separated, no empty
fields, no short rows, no exact-duplicate rows. 1259 distinct name tokens
across all columns.

**Row shape:** each line is a group of names that belong together, e.g.
`alfred,al`. A name's nicknames are every OTHER name on every row it
appears on. Dallan's own worked example (Slack, 2026-09-29): "alfred" sits
on three rows (`alfred,al` / `alfred,alf` / `alfred,fred`) so its nicknames
are `al, alf, fred`; "fred" sits on two rows (`alfred,fred` and
`frederick,fred,freddy,fredricks,federico,friederich`) so its nicknames are
`alfred, frederick, freddy, fredricks, federico, friederich`. Verified
against the fetched file — both examples match exactly.

**This is per-row co-occurrence, not transitive.** The existing loader in
`name-variants.ts` (`buildTable`) merges families transitively: if family A
and family B share any one form, they become one family, and that merge
keeps cascading. That is wrong for this file. Proof (simulated against the
actual 418 rows, 2026-09-29): running the existing transitive merge over
every row collapses the table into 230 groups, the largest holding 86 names;
"fred" lands in an 53-name group that wrongly includes "albert" and "alan" —
neither shares a row with "fred" — because they reach it through the hub
name "al" (15 rows), "bert" (10 rows), etc. Dallan's own example gives "fred"
exactly 6 names. **v1 does not reuse `buildTable`/the transitive-merge path
for this table.** It gets its own loader (step 1a below) that unions only
the names sharing a literal row with the query, across every row the query
appears in — no chaining through a third name.

**Four rows have a repeated name in them** (duplicate token within one CSV
row, not a duplicate row): `bertha,birdie,berta,berti,berty,bird,birdie,birdy`,
`charlotte,lottie,lotte,lottie,sharlotte,charlotta`,
`eleanor,nora,helen,elenor,eleanor,elleanor,ellen,nellie,nelly,nell,eleanora,elinor`,
`sarah,sara,sadie,sally,saddie,sadie`. The loader must dedupe (a name must
not appear twice in its own result), including across the CRLF-stripped
line.

**License / attribution:** MIT permits redistribution with the copyright
notice retained. `config/name-variants-given.json`'s `_meta` records the
source URL, the file path in that repo, the commit SHA above, the retrieval
date, "MIT license, rootsdev/nama", and the row-co-occurrence rule so a
future reader does not have to re-derive it. No separate NOTICE file exists
in this repo for third-party data today (`config/given-name-variants.json`
is original prose, not a redistributed file) — the `_meta` block is where
this repo already puts source rationale for a bundled config table, and this
is not a build-time dependency (no separate license file needed the way an
npm package would).

## Contract (from the issue; no caller until #1828)

- Tool `get_name_variants`, one parameter `name: string` (required).
- Returns `{ name, variants: string[] }`. `name` echoes the trimmed input.
  `variants` is every name sharing a row with the input anywhere in the
  table (own form excluded), in the table's own spelling (lowercase — the
  table has no capitalization and none is added), in first-occurrence order
  across the rows scanned.
- Case- and diacritic-insensitive matching (`normalizeString`); bidirectional
  (`bill` returns `william` and vice versa). Unknown name → `variants: []`,
  not an error.
- Empty, whitespace-only, or non-string `name` → throw an LLM-instruction
  error. Not `{ ok: false }`; not added to `OK_FALSE_IS_FAILURE`.
- A missing or corrupt table throws an installation-framed error from the
  tool (strict mode — see step 1a). Without this, a table that failed to
  ship reads as "every name is unknown" — a silent zero.

## Steps

1. **(Done, `18900e26e`)** `src/utils/name-variants.ts` — `ensureLoaded` /
   `lookupNameFamily` parameterized on table path, unchanged behavior for
   `GIVEN_NAME_VARIANTS_PATH`. Not reused below; kept for
   `expandNameForFulltext` / `expandLookingFor` only.

1a. **`src/utils/name-variants.ts`** — a second, independent loader for the
    row-co-occurrence table:
    - Export `NAME_VARIANTS_GIVEN_PATH` (`config/name-variants-given.json`).
    - `interface NicknameTable { _meta: Record<string, unknown>; groups: string[][] }`.
    - `buildNicknameTable(tablePath)`: read + `JSON.parse`; error (not throw)
      on unreadable file, invalid JSON, missing/non-array `groups`, or any
      group that is not an array of non-empty strings. Build
      `Map<string (normalized), string[] (original spelling, dedup, first-seen order)>`
      by iterating every group, and for every name in the group, appending
      every OTHER name in that same group (original spelling) to the first
      name's entry — deduping by `normalizeString` so the four repeated-token
      rows above don't produce a repeated entry, and so a name met in
      multiple rows accumulates the union rather than overwriting.
    - Cached in its own `Map<string, { map, error }>`, separate from `tables`
      (different shape — no `NameFamily`/`formal` concept here, this table is
      fully symmetric).
    - `lookupNameVariants(name, tablePath = NAME_VARIANTS_GIVEN_PATH, opts?: { strict?: boolean }): string[]`.
      `strict: true` throws the recorded error; default returns `[]` (unused
      by anything in v1 — only the strict caller exists — but keeps the same
      degrade-safe shape as `lookupNameFamily` for consistency). Excludes any
      form whose `normalizeString` equals the query's.
    - `__clearVariantCacheForTests()` also clears this cache.
    - The file read stays in this module; `tools/name-variants.ts` is not
      added to the `no-fs-outside-store` exemption list.

2. **`config/name-variants-given.json`** (new) — the CSV reshaped as JSON,
   nothing added or dropped:
   `{ "_meta": { source, source_file, source_commit, retrieved, license, algorithm }, "groups": [["aaron","ron"], ["abigail","abby"], ["abigail","gail"], ...] }`.
   All 418 rows, each a `string[]` in file order, each name lowercase exactly
   as the CSV has it. `_meta.algorithm` states the co-occurrence rule in one
   sentence so a reader of the file alone (not this plan) understands why
   there's no "formal" field.

3. **`src/tools/name-variants.ts`** (new) — `getNameVariants(input)` +
   `getNameVariantsSchema` (description ≤ 250 chars; says given names only,
   unknown → `[]`, the caller puts the forms into its own query). Trims
   `input.name`; throws on empty/whitespace/non-string. Calls
   `lookupNameVariants(name, NAME_VARIANTS_GIVEN_PATH, { strict: true })`. No
   `fs` import.

4. **Registration** — `src/tool-schemas.ts` (`allToolSchemas`), `src/server.ts`
   dispatch arm (plain `JSON.stringify` content like `wikipedia_search`; catch →
   `isError: true`), `manifest.json` `tools`.

5. **`dev/smoke-calls.ts`** — `offline: true` row, `{ name: "fred" }`,
   `expect: (res) => ({ ok: !res.isError && Array.isArray(res.body?.variants) && res.body.variants.length === 6, detail: brief(res) })` —
   the exact count pins the row-co-occurrence behavior, not just "non-empty."

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

8. **`tests/tools/name-variants.test.ts`** (new) against the real table:
   `fred` → exactly the 6 names from Dallan's example (proves row
   co-occurrence, not transitive — the falsifiable claim of this whole PR);
   `alfred` → `al, alf, fred` (the other worked example); a name whose row
   has a repeated token (e.g. `birdie`) does not repeat in its own result;
   case folding (`FRED` finds the same table entry); input's own form
   excluded; unknown name → `[]`; empty and whitespace → throws; non-string →
   throws. Plus, against two small committed fixture tables under
   `tests/fixtures/name-variants/`: loading table A does not leak into a
   lookup against table B (cache-bleed guard), a missing path with `strict`
   throws while non-strict returns `[]`, and a table with no `groups` array
   throws under `strict`.

9. **`docs/specs/name-variants-tool-spec.md`** (new) — contract above, the
   data-source section above (verbatim provenance + the row-co-occurrence vs.
   transitive-merge distinction, since that is the one fact a future editor
   of this table must not get wrong), and "Deferred": surnames and places
   (pending a probe of the wiki page `Guessing_a_Name_Variation`); retiring
   `given-name-variants.json`, its drift test and both `expand*` functions in
   issue #1828.

10. **`README.md`** — row under "Reference and context" (Auth: None), and the
    tool count `48` → `49` at lines 57 and 477 (`readme-catalog.test.ts:105-120`).

11. **`tests/packaging/prompt-sizes.json`** — regenerate with
    `UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts`;
    the staleness test fails on any new `allToolSchemas` entry.

## Acceptance

- `make engine-test`, `make typecheck`, `make engine-smoke-stdio`,
  `make harness-test` green; `scripts/verify-mcpb.sh` passes on a built `.mcpb`.
- `tests/packaging/name-variant-drift.test.ts` and the pre-existing
  `tests/utils/name-variants.test.ts` pass **unmodified** (proof the old path
  is untouched). `git diff --stat` shows nothing under
  `packages/engine/plugin/` and no change to `config/given-name-variants.json`.
- Falsifiability: deleting `name-variants-given.json` fails the tool tests,
  the smoke row, and `verify-mcpb.sh`; making the new loader reuse
  `buildTable`'s transitive merge instead of row co-occurrence fails the
  `fred` test (would return ~53 names instead of 6, including `albert`).
- The exact-count `fred` and `alfred` tests are copied straight from
  Dallan's own reply, so nobody downstream needs to re-verify against the
  live GitHub file to trust the table shipped correctly.
- **This replaces, not drops, the issue's "ask Dallan to confirm the
  committed file in PR review" line.** That instruction was written when the
  expected input was a list Dallan typed by hand, with no independent copy
  to check against. His actual answer was a link to a file already on
  GitHub — the committed table is a mechanical reshape of bytes he did not
  author, so the confirmation that matters is "did the reshape preserve the
  source faithfully," which the `fred`/`alfred` tests check directly against
  his own worked examples. The PR body still links the source file and commit
  SHA so a reviewer can diff by hand if they want to; asking Dallan to eyeball
  418 rows is not required for this to be correct.
