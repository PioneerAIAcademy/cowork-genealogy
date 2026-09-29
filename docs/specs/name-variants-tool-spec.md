# `get_name_variants` — given-name lookup tool — Spec

> **Status:** New (2026-09-29). v1 covers given names only. No caller exists
> yet — a follow-on card wires the `search-full-text` and `search-records`
> skill call sites and retires the hidden auto-expansion inside
> `fulltext_search`/`image_transcribe` once this tool lands.

A pure, offline lookup tool: given one given name, return every other form
of that name (nicknames, diminutives, formal forms) the bundled table knows
about. Bidirectional — either direction of a nickname pair returns the other.

```
get_name_variants({ name }) -> { name, variants }
```

---

## 1. Why this exists

Given-name variant expansion existed already, but hidden inside two search
tools (`fulltext_search`, `image_transcribe`), which made it invisible to the
agent: a primed transcription or an OR'd query could not be audited from the
tool-call transcript, and treating the expansion table as a period filter had
to be argued as a property of a table the search tool owned. Lead ruling
2026-09-07 (`/make-decisions`): expansion becomes an explicit tool call the
agent makes and can see. This spec covers only the tool; the skill call sites
and retiring the old hidden path are a separate, follow-on piece of work.

## 2. Contract

- Tool name `get_name_variants`. One parameter, `name: string` (required).
- Returns `{ name: string, variants: string[] }`. `name` echoes the input,
  trimmed. `variants` lists every other name that shares a source-table row
  with the input, across every row the input appears in — own form excluded.
- Matching is case- and diacritic-insensitive (the shared `normalizeString`
  helper). Lookup is bidirectional: `bill` returns `william` and its
  siblings, and `william` returns `bill`.
- An unrecognized name returns `variants: []`. This is the normal answer,
  not an error — the caller should not branch on it as a failure.
- Empty, whitespace-only, or non-string `name` throws an LLM-instruction
  error (`Error`, surfaced as `isError: true` on the MCP response). This
  tool never returns `{ ok: false }` and is not in `OK_FALSE_IS_FAILURE`.
- A missing or corrupt table throws an installation-framed error from the
  tool (the loader runs in `strict` mode for this table). Without this, a
  table that failed to ship would silently read as "every name is unknown."
- Returned forms are in the table's own spelling (this table is all
  lowercase — no capitalization is added), in first-occurrence order across
  the rows scanned. No `kind` parameter: surnames and places are deferred
  (see §5).

## 3. Data source and the row-co-occurrence rule

`config/name-variants-given.json` is a reshape of a public file, not a list
typed by hand:

- Source: `https://github.com/rootsdev/nama/blob/master/references/givenname_nicknames.csv`
  (repo `rootsdev/nama`, MIT license, which permits redistribution with the
  copyright notice retained).
- Fetched at commit `30ccc4ababcd204d80d2ad077949edcb35efbbab`, retrieved
  2026-09-29. Recorded in the JSON's own `_meta` block.
- 418 source rows, reshaped 1:1 into a `groups: string[][]` array — one
  `string[]` per CSV row, values exactly as the CSV has them (lowercase,
  nothing added or dropped). No `formal`/`variant` distinction: a CSV row
  like `alfred,al,alf` is a flat equivalence group, not a formal-name-to-
  variants mapping, and inventing a "formal" designation the source data
  doesn't assert would misrepresent it.

**The lookup rule is per-row co-occurrence, unioned across every row a name
appears in — it is explicitly NOT transitive.** Two names are related only
if they share a literal row somewhere in the table; sharing a row with a
common third name does not relate them to each other. This is the one fact
about this table a future editor must not get wrong, because the *other*
table this repo already bundles (`config/given-name-variants.json`, behind
`fulltext_search`/`image_transcribe`'s hidden expansion) uses a genuinely
different, transitive algorithm (`buildTable` in `src/utils/name-variants.ts`
merges any two entries that share even one form, repeated to a fixed point).
Reusing that algorithm for this table produces wrong answers: simulated
against the real 418 rows, the transitive merge collapses the table into 230
groups (the largest holding 86 names), and pulls unrelated names together
through hub names that appear on many rows — "al" appears on 15 rows, "bert"
on 10. Concretely: `fred` should return exactly 6 names (below), but the
transitive merge puts it in a 53-name group that wrongly includes `albert`
and `alan`, neither of which shares a row with `fred`.

Two examples, verified against the live source file and used as exact-match
regression tests (`tests/tools/name-variants.test.ts`, `dev/smoke-calls.ts`):

| Query | Expected `variants` | Why |
|---|---|---|
| `fred` | `alfred, frederick, freddy, fredricks, federico, friederich` | `fred` appears on two rows: `alfred,fred` and `frederick,fred,freddy,fredricks,federico,friederich`. |
| `alfred` | `al, alf, fred` | `alfred` appears on three rows: `alfred,al`, `alfred,alf`, `alfred,fred`. |

A handful of source rows repeat a name within the row itself (e.g. the
`bertha` row lists `birdie` twice). The loader dedupes within and across
rows by `normalizeString`, so a name never appears twice in its own result.

The engine loader for this table (`buildNicknameTable`/`lookupNameVariants`
in `src/utils/name-variants.ts`) is a separate function pair from the
existing `buildTable`/`ensureLoaded`/`lookupNameFamily`, cached separately.
It does not touch `expandNameForFulltext`/`expandLookingFor` or their table.

## 4. What this does NOT do

- Does not call `fulltext_search`/`image_transcribe`'s hidden expansion, and
  does not change `config/given-name-variants.json` or
  `tests/packaging/name-variant-drift.test.ts` in any way.
- Does not add the result to a search query itself — the caller does that.
- Not called by any skill or agent yet (see Status above).

## 5. Deferred

- **Surnames and places.** v1 is given names only. A `kind` parameter for
  surnames/places is deferred pending a probe of the FamilySearch wiki page
  `Guessing_a_Name_Variation`, which was not attempted for this card.
- **Retiring the old path.** `config/given-name-variants.json`, its drift
  test, and the `expandNameForFulltext`/`expandLookingFor` functions are
  retired only once a follow-on card moves every caller onto this tool. Until
  then both tables ship and are independently correct for their own callers.

## 6. Provenance confirmation

The committed table is a mechanical reshape of a public file, not a list
Dallan typed by hand with no independent copy to check against — so the PR
links the source file and commit SHA for a by-hand diff, and the `fred`/
`alfred` exact-match tests (his own worked examples) are the automated check
that the reshape preserved the source faithfully.
