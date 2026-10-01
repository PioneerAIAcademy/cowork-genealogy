# Plan: search-full-text #1828 — reverse collection-scoping ban, add `includeFacets`, retire hidden name expansion

**Issue:** #1828  
**Branch:** `search-full-text-1828`  
**Status:** Pending implementation  
**PR strategy:** One PR

## What this plan changes

Four capabilities land in one PR:

1. **Collection scoping — nuanced rule instead of absolute ban.** A `collectionId` from a prior `includeFacets` call is safe; a borrowed one is not. The prose, the validator, and the rubric all change.
2. **`includeFacets` — teach it.** The tool already sends `m.defaultFacets=on` when `includeFacets: true`; the skill just never told Claude to use it. Add it to SKILL.md and query-syntax.md so the skill knows how to get a safe `collectionId` from facets and use it on a follow-up call.
3. **Non-principal framing widening.** FTS also finds principals in paragraph-style records that were never name-indexed. Widen the description, intro, and step 12 summary to say so.
4. **Keywords-first for non-principal name queries.** Retire the hidden `expandNameForFulltext` from `fulltext-search.ts`. Replace with explicit `get_name_variants` guidance in SKILL.md. Add the Keywords↔Name-field switch to the nil ladder.

Two probe-confirmed corrections also land (already in query-syntax.md and search-strategies.md from #2253; SKILL.md line 164–167 still has the old text):

5. **"Not adjacent" narrowing in SKILL.md only.** Add the "in the father's own records" qualification and the mother's-adjacency caveat.
6. **Place field description correction.** query-syntax.md line 13 still says "Matches BOTH transcript content AND collection metadata" — section J proved it is metadata only. Fix it.

Plus two supporting changes:

7. **Validator rewrites.** Both FTS validators need updating: `test_fulltext_search_never_scopes_to_collection_id` becomes a conditional (allow collectionId when facets preceded it), and `test_first_fulltext_search_call_is_unscoped` becomes per-topic (fixes the `_011` parallel-search case).
8. **merge-issues SKILL.md Gate 4 note** — one line noting that `packages/engine/mcp-server/src/**` is outside every skill's run-log snapshot.

---

## Files changed — complete list

### Plugin files (in the VM snapshot)

| File | Change type |
|---|---|
| `packages/engine/plugin/skills/search-full-text/SKILL.md` | Multiple edits (7 sites) |
| `packages/engine/plugin/skills/search-full-text/references/query-syntax.md` | Multiple edits (2 sites) |
| `packages/engine/plugin/skills/search-full-text/references/search-strategies.md` | Remove one line (1 site) |

### Engine files (outside snapshot — no eval slot needed for engine-only)

| File | Change type |
|---|---|
| `packages/engine/mcp-server/src/tools/fulltext-search.ts` | Remove hidden expansion (6 sites) |
| `packages/engine/mcp-server/src/utils/name-variants.ts` | Remove `expandNameForFulltext` export (1 site) |
| `packages/engine/mcp-server/src/types/fulltext-search.ts` | Remove `NameExpansionInfo` interface + field on `FulltextSearchResponse` |
| `docs/specs/fulltext-search-tool-spec.md` | Remove `nameExpansion` from `name` field description, response type, and expansion section (3 sites) |
| `packages/engine/mcp-server/tests/utils/name-variants.test.ts` | Remove `expandNameForFulltext` import + `describe` block (lines 5, 75–175) |
| `packages/engine/mcp-server/tests/tools/fulltext-search.test.ts` | Remove `nameExpansion` tests 39–45b (lines 867–945) |

### Eval files

| File | Change type |
|---|---|
| `eval/harness/validators/test_search_full_text.py` | Rewrite 2 validators |
| `eval/tests/unit/search-full-text/rubric.md` | Update Query construction pass/partial bar |
| `eval/tests/unit/search-full-text/principal-in-unindexed-record.json` | New fixture |
| `eval/tests/unit/search-full-text/keywords-first-name-field-retry.json` | New fixture |
| `eval/tests/unit/search-full-text/too-many-results-boosting.json` | New fixture |

### Docs/skills files

| File | Change type |
|---|---|
| `docs/gps-research-flow.md` | 2 sites |
| `.claude/skills/merge-issues/SKILL.md` | 1 line added to Gate 4 |

### Files confirmed NOT touched

| File | Why |
|---|---|
| `packages/engine/plugin/skills/search-full-text/references/transcription-quirks.md` | Already correct from #2253 |
| `packages/engine/mcp-server/tests/packaging/name-variant-drift.test.ts` | Pins `given-name-variants.json` against the abbreviations table; that table is not touched |
| `packages/engine/mcp-server/config/given-name-variants.json` | Still used by `expandLookingFor` (image-transcribe); not removed |
| `packages/engine/mcp-server/config/name-variants-given.json` | Already exists from #2325; no changes needed |
| `eval/fixtures/` | `nameExpansion` field confirmed absent from all fixture files; no updates needed |

---

## Site-by-site edits

### Group 1 — query-syntax.md: place field correction (section J finding)

**File:** `packages/engine/plugin/skills/search-full-text/references/query-syntax.md`  
**Line:** 13 (the Place row in the Search fields table)

**Current:**
```
| Place | Place name | Matches BOTH transcript content AND collection metadata — major source of false positives. **Prefer filtering by place after search rather than including place in the query.** |
```

**New:**
```
| Place | Place name | Matches collection metadata only — NOT transcript text. Causes false positives because a document's actual place may differ from the collection's place metadata. **Prefer filtering by place after search rather than including place in the query.** |
```

**Why:** Section J measurement (PR #2431) confirmed `q.recordPlace` and `f.recordPlace*` match collection metadata only, not transcript content. The current "BOTH" claim is factually wrong.

---

### Group 2 — query-syntax.md: replace the absolute ban with the nuanced rule + teach `includeFacets`

**File:** `packages/engine/plugin/skills/search-full-text/references/query-syntax.md`  
**Lines:** 76–87 (section "Do not scope FTS to a record collection ID")

**Current text** (to remove):
```markdown
## Do not scope FTS to a record collection ID

`fulltext_search` accepts a `collectionId`, but the full-text corpus is
partitioned into its **own** auto-generated collections that do **not**
line up with the indexed-`record_search` collection IDs (or with a
`collections_search` survey). Passing a `collectionId` guessed from
those sources frequently excludes the very FTS volume that holds the
answer, and the search returns zero with no hint that scoping caused it.

Search the **whole corpus first**. Narrow only *after* you have hits,
using the post-search filters below (`recordPlace*`, `recordType`, year
range) or a known `imageGroupNumber` — never a borrowed `collectionId`.
```

**Replace with:**
```markdown
## Scoping FTS to a collection ID

The FTS corpus is partitioned into its **own** auto-generated collections
that do **not** line up with `record_search` collection IDs or a
`collections_search` survey. A `collectionId` borrowed from those sources
frequently excludes the very FTS volume that holds the answer, silently
returning zero.

**Safe path — use `includeFacets: true` on the first call.** When
`includeFacets: true`, the response includes a `facets` array. Each facet
item carries a `filterParam` string — the exact `collectionId` value to
pass on a scoped follow-up call. That value is safe because it names a
real FTS partition that already returned hits.

```
# Step 1: unscoped, with facets
fulltext_search({ keywords: "+Flynn +Patrick", includeFacets: true, projectPath })
# Step 2: scoped to one facet-derived partition
fulltext_search({ keywords: "+Flynn +Patrick", collectionId: <facets[0].items[0].filterParam>, projectPath })
```

**Never borrow a `collectionId` from `record_search` or `collections_search`.**
Search the whole corpus first; narrow only via `recordPlace*` / `recordType` /
year-range filters, a known `imageGroupNumber`, or a `collectionId` taken from
`includeFacets` results.
```

---

### Group 3 — SKILL.md: frontmatter description — widen to include principals in unindexed docs

**File:** `packages/engine/plugin/skills/search-full-text/SKILL.md`  
**Lines:** 3–17 (the `description:` value)

Add the "principal in an unindexed paragraph-style record" case to the trigger description so the skill fires for that use-case, not just non-principal roles.

**Current (abbreviated):**
```yaml
description: Invoke for FamilySearch full-text search (FTS) — immediately
  when the user says "full-text search", "FTS", "search document
  transcripts", or "construct a full-text query". Use this skill to find a
  person as a witness, executor, executrix, administrator, appraiser, heir,
  neighbor, surety, or other non-principal in deeds, probate, wills, court
  minutes, or notarial protocolos; to run Lucene-style queries with
  +required terms, wildcards, or phrase matching; and to cover spelling and
  transcription variants across FamilySearch's AI-transcribed historical
  documents. FamilySearch document images only. ...
```

**New (add clause after "notarial protocolos"):**
```yaml
description: Invoke for FamilySearch full-text search (FTS) — immediately
  when the user says "full-text search", "FTS", "search document
  transcripts", or "construct a full-text query". Use this skill to find a
  person as a witness, executor, executrix, administrator, appraiser, heir,
  neighbor, surety, or other non-principal in deeds, probate, wills, court
  minutes, or notarial protocolos; or to find any person — principal
  included — in a paragraph-style or narrative record that was never
  name-indexed; to run Lucene-style queries with +required terms,
  wildcards, or phrase matching; and to cover spelling and transcription
  variants across FamilySearch's AI-transcribed historical documents.
  FamilySearch document images only. ...
```

---

### Group 4 — SKILL.md: intro paragraph — widen "unique strength"

**File:** `packages/engine/plugin/skills/search-full-text/SKILL.md`  
**Lines:** 34–36 and line 57

**Lines 34–36 current:**
```
FTS searches the raw transcript text of
those images — a fundamentally different search surface than indexed
Records search. FTS finds people mentioned
anywhere in a document (witnesses, neighbors, heirs, appraisers),
not just indexed principals.
```

**Lines 34–36 new (add a sentence before "not just indexed principals"):**
```
FTS searches the raw transcript text of
those images — a fundamentally different search surface than indexed
Records search. FTS finds people mentioned
anywhere in a document (witnesses, neighbors, heirs, appraisers),
and finds any person — principal or not — in a paragraph-style record
that was never name-indexed.
```

**Line 57 current:**
```
- **Unique strength:** Finding non-principal mentions (witnesses, neighbors, heirs).
```

**Line 57 new:**
```
- **Unique strength:** Finding non-principal mentions (witnesses, neighbors, heirs), and finding any person in a paragraph-style record that was never name-indexed, principal included.
```

---

### Group 5 — SKILL.md: Step 3 table — keywords-first for name queries

**File:** `packages/engine/plugin/skills/search-full-text/SKILL.md`  
**Lines:** 122–128 (the Step 3 query-strategy table)

**Current row:**
```
| Find person as witness/appraiser/heir | `Surname` in Name field (no `+` — it disables auto-expansion), place filter after |
```

**New row (keywords-first, Name field as retry):**
```
| Find person as witness/appraiser/heir | `+Surname` in Keywords first; if NLP missed the name, retry with `Surname` in Name field. Call `get_name_variants` beforehand to build the explicit variant set for the keywords query. |
```

**Why:** The hidden `expandNameForFulltext` expansion is being retired. Explicit `get_name_variants` + keywords replaces it. The Name field is kept as a retry path when NLP doesn't pick up the name.

Also add `get_name_variants` to the `allowed-tools` frontmatter list (currently absent).

---

### Group 6 — SKILL.md: Step 4 critical rules — replace absolute collectionId ban with nuanced rule + teach `includeFacets`

**File:** `packages/engine/plugin/skills/search-full-text/SKILL.md`  
**Lines:** 153–159

**Current text:**
```
- **Do NOT scope a full-text search to a record `collectionId`.** The
  FTS corpus is partitioned into its own auto-generated collections;
  a `collectionId` guessed from `record_search` (or from a collections
  survey) frequently does **not** contain the FTS volume that holds the
  answer, so scoping silently drops it. Search the whole corpus first;
  narrow with `recordPlace*` / `recordType` / year filters (or a
  known `imageGroupNumber`) only after you have hits.
```

**New text:**
```
- **Never borrow a `collectionId` from `record_search` or a collections
  survey.** The FTS corpus uses its own auto-generated partitions that
  do not map 1:1 onto indexed-record collection IDs; a borrowed ID
  silently excludes the very FTS volume that holds the answer. The safe
  path: pass `includeFacets: true` on the first call; the response
  `facets` array gives `filterParam` values that are real FTS partition
  IDs. Use only those on scoped follow-up calls — never a borrowed ID.
  See `references/query-syntax.md` "Scoping FTS to a collection ID" for
  the two-call pattern.
```

Also update the example queries block (line ~183–189) — remove the `UNSCOPED (no collectionId)` comment from the compound-surname example and add an `includeFacets` example:

```
# includeFacets: get partition IDs from the first call
fulltext_search({ keywords: "+Flynn +Patrick", includeFacets: true, projectPath })
# Scoped follow-up using a facet-derived collectionId
fulltext_search({ keywords: "+Flynn +Patrick", collectionId: "<facets[0].items[0].filterParam>", projectPath })
```

---

### Group 7 — SKILL.md: Step 4 — "not adjacent" narrowing (mother's adjacency case)

**File:** `packages/engine/plugin/skills/search-full-text/SKILL.md`  
**Lines:** 163–167

**Current text:**
```
- **Decompose a compound surname into co-occurrence, not a phrase.**
  For an Iberian / Latin-American name (`Given Paterno Materno`, e.g.
  "Francisco **Naveda Somarriba**"), require the two surnames as
  separate terms — `+Naveda +Somarriba` — **never** `+"Naveda
  Somarriba"`. The parents' own records name the father with the
  paternal surname and the mother with the maternal, so the words are
  on **different people and not adjacent**. See `references/query-syntax.md`
  for escalation once the mother's fuller form is known.
```

**New text:**
```
- **Decompose a compound surname into co-occurrence, not a phrase.**
  For an Iberian / Latin-American name (`Given Paterno Materno`, e.g.
  "Francisco **Naveda Somarriba**"), require the two surnames as
  separate terms — `+Naveda +Somarriba` — **never** `+"Naveda
  Somarriba"`. In the father's own records he is named with the
  paternal surname and the mother with hers, so the words sit on
  different people and are not adjacent there. A married woman is
  often written with her own surnames plus her husband's ("María
  Somarriba de Naveda"), where adjacency is available — the
  co-occurrence still covers that case, and the phrase form still
  misses the parentage records you want. See `references/query-syntax.md`
  for escalation once the mother's fuller form is known.
```

---

### Group 8 — SKILL.md: Step 9 nil ladder — add Keywords↔Name field switch

**File:** `packages/engine/plugin/skills/search-full-text/SKILL.md`  
**Lines:** 322–336 (Step 9 "Handle nil results", the numbered variant list)

Add as item 1 (before spelling variants), shifting existing items down:

```
1. **Switch Keywords↔Name field.** If the initial search used the Name
   field, retry with `+Surname` in Keywords (NLP may have missed the name).
   If it used Keywords, retry with `Surname` in the Name field. This counts
   as one retry against the 5-query cap.
```

---

### Group 9 — SKILL.md: Step 12 — add principals in unindexed records

**File:** `packages/engine/plugin/skills/search-full-text/SKILL.md`  
**Line:** ~358

**Current:**
```
Summarize what was searched and found, highlighting non-principal
mentions (FTS's unique value). Show log entries, plan progress, and
suggest next steps (more plan items, cross-references, or re-plan).
```

**New:**
```
Summarize what was searched and found, highlighting non-principal
mentions and any principals found in records that are only searchable
via FTS (FTS's twin unique values). Show log entries, plan progress, and
suggest next steps (more plan items, cross-references, or re-plan).
```

---

### Group 10 — search-strategies.md: remove "run it unscoped" from compound-surname example

**File:** `packages/engine/plugin/skills/search-full-text/references/search-strategies.md`  
**Line:** 127

**Current:**
```
To find the parents, **decompose the compound into a co-occurrence** —
`+Naveda +Somarriba` — and run it **unscoped** (no `collectionId`; the
answer often sits in a different FTS collection than you'd guess). Do
```

**New (remove the parenthetical):**
```
To find the parents, **decompose the compound into a co-occurrence** —
`+Naveda +Somarriba`. Do
```

**Why:** The absolute ban on `collectionId` is being replaced with the nuanced rule. Saying "run it unscoped" is no longer accurate (facet-derived IDs are allowed). The rule is in the references files; search-strategies.md just needs the dead instruction removed.

**Also fix at line 139:** The numbered escalation list that follows says `"1. \`+Naveda +Somarriba\` (both surnames required, unscoped)."` — remove the word `unscoped` from that entry too:

```
// Current:
1. `+Naveda +Somarriba` (both surnames required, unscoped).
// New:
1. `+Naveda +Somarriba` (both surnames required).
```

---

### Group 11 — search-strategies.md: too-many-results boosting ladder

**File:** `packages/engine/plugin/skills/search-full-text/references/search-strategies.md`  
**Location:** "Iterative refinement" section (near bottom of file)

Add a "Too many results — boosting ladder" subsection after the existing bullets:

```markdown
### Too-many-results ladder

When a wildcard or common-name query returns hundreds of results:

1. **Float probable words as non-required boost terms.** Add them without
   `+` so they push matching results higher without dropping non-matching
   ones: `+Flynn "Last Will" testament probate`. Scan `highlightTerms` to
   see which boost terms actually fired.
2. **Scan `highlightTerms` for adjacent name highlights.** If the target
   name and an associated name both appear in `highlightTerms`, the document
   likely names them in the same context. Prioritize those results for image
   verification.
3. **Stop when quality degrades.** Once the top results no longer show both
   names in `highlightTerms`, narrowing further is unlikely to improve yield.
   Apply a `recordPlace*` or year filter instead, or declare the search
   sufficiently searched for the plan item.
```

---

### Group 12 — docs/gps-research-flow.md: two sites

**File:** `docs/gps-research-flow.md`

**Site 1 — line ~149: add principal case**

**Current (lines ~148–150):**
```
This is the only way to find someone as a witness, executor,
appraiser, bondsman, heir, or neighbor — and the only way to find anyone at
all, principal included, in a paragraph-style record that was never
name-indexed.
```

This sentence already includes "principal included" — **no change needed here**. Verify against the actual file content at implementation time.

**Site 2 — lines ~158–162: update "don't scope to a single collection" bullet**

**Current:**
```
- **Don't scope to a single collection.** The full-text corpus is
  partitioned into collections of its own, so an id borrowed from indexed
  record search can name a partition that does not hold the document: a
  Cantabrian baptism found by an unscoped name search returned nothing when
  scoped that way.
```

**New:**
```
- **Don't borrow a collection ID from indexed record search.** The full-text corpus is
  partitioned into collections of its own, so an id borrowed from indexed
  record search can name a partition that does not hold the document. Use
  `includeFacets: true` on the first call to get real FTS partition IDs from
  the response's `facets` array; those are safe to scope on a follow-up call.
```

---

### Group 13 — fulltext-search.ts: remove hidden expansion

**File:** `packages/engine/mcp-server/src/tools/fulltext-search.ts`

Three sites:

**Site 1 — line 5: remove import**
```typescript
// Remove:
import { expandNameForFulltext } from "../utils/name-variants.js";
```

**Site 2 — lines 184–189: remove expansion call and URL override**
```typescript
// Remove:
const expansion = input.name ? expandNameForFulltext(input.name) : null;
const url = buildUrl(input, expansion?.expanded);
// Replace with:
const url = buildUrl(input);
```

**Site 3 — lines 62–78: remove `nameOverride` param and boost line from `buildUrl`**
```typescript
// Current signature:
function buildUrl(input: FulltextSearchInput, nameOverride?: string): string {
// New:
function buildUrl(input: FulltextSearchInput): string {

// Remove these lines:
const nameValue = nameOverride ?? input.name;
if (nameValue) {
  add("q.fullName", nameValue);
  if (nameOverride) add("q.fullName.boost", 2.0);
}
// Replace with:
if (input.name) add("q.fullName", input.name);
```

**Site 4 — lines 344–360: remove nameExpansion from response building**
```typescript
// Remove the nameExpansion block:
...(expansion && input.name
  ? {
      nameExpansion: {
        original: input.name,
        expanded: expansion.expanded,
        expansions: expansion.expansions,
        variantsInResults: detectVariantsInResults(),
      },
    }
  : {}),
```

**Site 5 (new — compile fix) — lines 243–285: remove `detectVariantsInResults` function**

This inner function references the now-removed `expansion` variable as a closure. Remove the entire block — the comment starting with "// Detect which expanded variants appear in results" through the closing `}` of `detectVariantsInResults`.

**Site 6 — lines 424–428: remove nameExpansion from the tool schema description**

In `fulltextSearchToolSchema`, the `name` field description currently reads:
```
"Search within name fields only. Recognized English given names are automatically expanded " +
"with historical diminutives (e.g. Elizabeth also matches Betty, Bess, Eliza). " +
"Do not prefix terms with + or the expansion is disabled. " +
"The response includes a nameExpansion field showing what was expanded and which variants matched.",
```

Replace with:
```
"Search within name fields only. Auto-handles last-name-first inversions. " +
"Do not prefix terms with + (terms are already required by m.queryRequireDefault). " +
"Use get_name_variants to get explicit variant forms before querying.",
```

Also update the SKILL.md "Key differences" section (line 54–55) to remove the auto-expansion claim for the `name` field, since the expansion is now retired:

**Current (line 54–55):**
```
- **No fuzzy matching** in `keywords` and `place` fields. Exact text only — no nicknames, phonetic variants, or Soundex. The `name` field auto-expands recognized English given names with historical diminutives.
- **No abbreviation expansion** in `keywords` and `place` fields. The `name` field auto-expands (e.g. Elizabeth also matches Betty, Bess, Eliza).
```

**New:**
```
- **No fuzzy matching** in any field. Exact text only — no nicknames, phonetic variants, or Soundex. Use `get_name_variants` to build an explicit variant set and run each as a separate query.
- **No abbreviation expansion** in `keywords`, `place`, or `name` fields. Run abbreviations explicitly.
```

---

### Group 14 — name-variants.ts: remove `expandNameForFulltext`

**File:** `packages/engine/mcp-server/src/utils/name-variants.ts`

Remove the `expandNameForFulltext` function (lines 288–349) and update the comment at line 11.

Update line 11 comment:
```typescript
// Current:
/** The table behind fulltext_search / image_transcribe's hidden expansion. */
// New:
/** The table behind image_transcribe's hidden expansion (expandLookingFor). */
```

**Keep:** `expandLookingFor` (used by `image-transcribe.ts`), `GIVEN_NAME_VARIANTS_PATH`, all other exports.

**Also remove from `tests/utils/name-variants.test.ts`:**
- Line 5: `expandNameForFulltext` import from the import statement
- Lines 75–175: the entire `describe("expandNameForFulltext", ...)` block

**Also remove from `tests/tools/fulltext-search.test.ts`:**
- Tests 39–45b (lines 867–945): all tests that assert `nameExpansion` on the response. Also remove the `bettyEntry()` helper function if it is only used by these tests (check at implementation time with a grep).

**Also remove from `src/types/fulltext-search.ts`:**
- The `NameExpansionInfo` interface (lines 91–100)
- The `nameExpansion?: NameExpansionInfo` field on `FulltextSearchResponse` (line 122)

**Also update `docs/specs/fulltext-search-tool-spec.md`:**
- Line 76: remove the clause about auto-expansion and the `nameExpansion` response field from the `name` parameter description
- Line 263: remove the `nameExpansion?` entry from the response type block
- Lines 323–335: remove the "When expansion occurs" section describing `nameExpansion`

---

### Group 15 — validators: rewrite two tests

**File:** `eval/harness/validators/test_search_full_text.py`

**Validator 1 — `test_fulltext_search_never_scopes_to_collection_id` (line 350)**

Replace absolute ban with conditional: allow `collectionId` only when a prior call in the same turn used `includeFacets: true`; block `collectionId` when no prior call had `includeFacets`.

```python
def test_fulltext_search_never_scopes_to_collection_id(tool_calls):
    """collectionId is allowed only when a prior fulltext_search call in the
    same turn sent includeFacets=true. A borrowed collectionId (no prior
    facet call) silently excludes the FTS partition holding the answer."""
    calls = _fts_tool_calls(tool_calls)
    if not calls:
        pytest.skip("no fulltext_search calls this turn")

    # Track whether we have seen an includeFacets=true call at each position.
    facets_seen = False
    errors = []
    for c in calls:
        args = c["args"]
        if args.get("includeFacets"):
            facets_seen = True
        elif "collectionId" in args and not facets_seen:
            errors.append(
                f"fulltext_search sent collectionId={args['collectionId']!r} "
                f"without a prior includeFacets=true call in this turn "
                f"(query: {args.get('keywords') or args.get('nlQuery')!r})"
            )
    assert not errors, "\n  - ".join(errors)
```

**Validator 2 — `test_first_fulltext_search_call_is_unscoped` (line 323)**

Replace literal-first-call check with per-topic check: group calls by their `keywords`/`nlQuery` handle, treat each group's first call independently. This fixes the `_011` parallel-search case where two independent searches (Thomas and Patrick Flynn) are issued simultaneously — the second parallel search was previously mislabeled as a follow-up.

```python
def test_first_fulltext_search_call_is_unscoped(tool_calls):
    """For each independent search topic (identified by keywords or nlQuery
    handle), the first call for that topic must not carry post-search filters.
    Parallel first calls for different topics are each checked independently.
    """
    calls = _fts_tool_calls(tool_calls)
    if not calls:
        pytest.skip("no fulltext_search calls this turn")

    # Group calls by handle (keywords or nlQuery). The first call for each
    # handle is the "first look" for that topic.
    seen_handles: set[str] = set()
    errors = []
    for c in calls:
        args = c["args"]
        handle = args.get("keywords") or args.get("nlQuery") or ""
        if handle not in seen_handles:
            seen_handles.add(handle)
            present = [k for k in POST_SEARCH_FILTER_KEYS if k in args]
            if present:
                errors.append(
                    f"first fulltext_search call for topic {handle!r} "
                    f"includes post-search filter(s) before any unfiltered "
                    f"hit count was observed: {present}"
                )
    assert not errors, "\n  - ".join(errors)
```

---

### Group 16 — rubric.md: update Query construction pass bar

**File:** `eval/tests/unit/search-full-text/rubric.md`

**Current pass bar (lines 11–12):**
```
- **pass:** Queries use the search engine's operators correctly (phrase quoting, `+`/`-`, `?`/`*` wildcards), leave the first call for a topic unscoped and apply jurisdiction/date/record-type scope only afterward as post-search filters, and use the right field (Name vs. Keywords) for the query intent. A canonical-spelling query that returns the expected record is acceptable.
```

**New pass bar (add collection-scoping rule):**
```
- **pass:** Queries use the search engine's operators correctly (phrase quoting, `+`/`-`, `?`/`*` wildcards), leave the first call for a topic unscoped and apply jurisdiction/date/record-type scope only afterward as post-search filters, and use the right field (Name vs. Keywords) for the query intent. A `collectionId` is allowed on a second-or-later call only when the same turn's first call for that topic sent `includeFacets: true` — a borrowed collectionId (no prior facet call) is a fail. A canonical-spelling query that returns the expected record is acceptable.
```

**Current partial bar (line 12):**
```
- **partial:** Queries are effective but mishandle an obvious operator or scoping decision (e.g., use OR-default by omitting `+`, put place in the query field instead of using filters, or send `recordPlace*`/`yearFrom`/`yearTo`/`recordType` on the FIRST `fulltext_search` call for a plan item before any unfiltered hit count has been observed — those are post-search filters per SKILL.md and query-syntax.md and must wait for a second call), OR the prompt explicitly suggests a variant is needed and the skill omits it.
```

**New partial bar:**
```
- **partial:** Queries are effective but mishandle an obvious operator or scoping decision (e.g., use OR-default by omitting `+`, put place in the query field instead of using filters, or send `recordPlace*`/`yearFrom`/`yearTo`/`recordType` on the FIRST `fulltext_search` call for a plan item before any unfiltered hit count has been observed — those are post-search filters per SKILL.md and query-syntax.md and must wait for a second call), OR the prompt explicitly suggests a variant is needed and the skill omits it. Sending a borrowed `collectionId` (one not derived from a prior `includeFacets` call in the same turn) is also a partial unless the result set was clearly empty without it.
```

---

### Group 17 — New eval fixtures (3 files)

**File 1:** `eval/tests/unit/search-full-text/principal-in-unindexed-record.json`

Tests that the skill uses FTS for a principal in a paragraph-style record that was never name-indexed (not a non-principal / witness use-case).

Structure: one positive case (FTS for principal in unindexed collection, skill invokes `fulltext_search`) and one negative case (principal in an indexed record → skill routes to `record_search`, not FTS).

**File 2:** `eval/tests/unit/search-full-text/keywords-first-name-field-retry.json`

Tests the keywords-first strategy:
- Positive: NLP misses name → skill retries with Name field
- Negative: keywords succeed → no redundant Name field call

**File 3:** `eval/tests/unit/search-full-text/too-many-results-boosting.json`

Tests the too-many-results boosting ladder:
- Positive: wildcard returns large result set → skill adds non-required boost terms; scans `highlightTerms`; applies stopping rule when quality degrades
- Negative: small clean result set → no boosting needed, skill does not apply the ladder

**Fixture format (confirmed from `attachment-triage-witnesses.json`):** Each fixture is a JSON object with these top-level fields:
- `test`: `{ id, skill, type, tags }` — `tags` is what selects which validators run
- `input`: `{ user_message, scenario }` — the prompt and research context
- `mcp_fixtures`: array of fixture file paths under `eval/fixtures/mcp/`
- `execution`: `{ max_wall_clock_seconds }`
- `judge_context`: array of strings passed to the judge

There is no `meta`, `positive`, `negative`, `prompt`, `research_state`, `expected_calls`, or `validator_names` at the top level. Each new fixture also needs corresponding MCP fixture entries under `eval/fixtures/mcp/` for any tool calls it exercises. Copy `attachment-triage-witnesses.json` as the starting template.

---

### Group 18 — merge-issues/SKILL.md: Gate 4 note

**File:** `.claude/skills/merge-issues/SKILL.md`  
**Location:** Section "## 4. Prove it before proposing"

Add one line after the section header or the "Open the files the issues name" instruction:

```
**Engine-only PRs buy no eval slot.** `packages/engine/mcp-server/src/**` is excluded from every skill's run-log snapshot (`eval/harness/harness/snapshot.py`), so a PR touching only that tree does not earn an eval run — do not count one when computing "runs bought back."
```

---

## Sequence

Implement in this order (each group is one commit or small batch):

1. Group 1: query-syntax.md place field correction
2. Group 2: query-syntax.md — replace ban with nuanced rule + `includeFacets`
3. Groups 3–9: SKILL.md — all seven sites in one commit
4. Group 10–11: search-strategies.md — remove "unscoped" line + add boosting ladder
5. Group 12: docs/gps-research-flow.md
6. Groups 13–14: engine — remove hidden expansion (fulltext-search.ts + name-variants.ts)
7. Groups 15–16: validators + rubric
8. Group 17: new eval fixtures
9. Group 18: merge-issues SKILL.md

---

## Acceptance checks (falsifiable)

1. `grep -n "expandNameForFulltext" packages/engine/mcp-server/src/tools/fulltext-search.ts` returns no matches.
2. `grep -n "expandNameForFulltext" packages/engine/mcp-server/src/utils/name-variants.ts` returns no matches.
3. `grep -n "nameExpansion" packages/engine/mcp-server/src/tools/fulltext-search.ts` returns no matches.
4. `grep -rn "nameExpansion" eval/fixtures/` returns no matches (unchanged; baseline check).
5. `grep -n "Do NOT scope" packages/engine/plugin/skills/search-full-text/SKILL.md` returns no matches (old absolute ban removed).
6. `grep -n "Do NOT scope" packages/engine/plugin/skills/search-full-text/references/query-syntax.md` returns no matches.
7. `grep -in "includeFacets" packages/engine/plugin/skills/search-full-text/SKILL.md` returns at least one match.
8. `grep -in "includeFacets" packages/engine/plugin/skills/search-full-text/references/query-syntax.md` returns at least one match.
9. `grep -n "Matches BOTH" packages/engine/plugin/skills/search-full-text/references/query-syntax.md` returns no matches.
10. `grep -n "Matches collection metadata only" packages/engine/plugin/skills/search-full-text/references/query-syntax.md` returns a match.
11. `grep -n "expandLookingFor" packages/engine/mcp-server/src/utils/name-variants.ts` returns a match (kept).
12. `grep -n "expandNameForFulltext" packages/engine/mcp-server/src/tools/image-transcribe.ts` returns no matches (confirm `image-transcribe.ts` never imported the expansion being removed; `expandLookingFor` is a different export).
13. `uv run pytest eval/harness/validators/test_search_full_text.py` passes on all existing fixtures.
14. `uv run pytest eval/harness/validators/test_search_full_text.py` passes on the three new fixtures.
15. The `name-variant-drift.test.ts` packaging test still passes (the abbreviations table in search-strategies.md is not touched).
16. The `attachment-triage-witnesses.json` (`_011`) fixture passes `test_first_fulltext_search_call_is_unscoped` with the new per-topic validator.
17. The `get_name_variants` tool is in the `allowed-tools` list of SKILL.md.
18. `grep -n "expandNameForFulltext" packages/engine/mcp-server/tests/utils/name-variants.test.ts` returns no matches.
19. `grep -n "nameExpansion" packages/engine/mcp-server/tests/tools/fulltext-search.test.ts` returns no matches.
20. `grep -n "NameExpansionInfo" packages/engine/mcp-server/src/types/fulltext-search.ts` returns no matches.
21. `grep -n "nameExpansion" packages/engine/mcp-server/src/types/fulltext-search.ts` returns no matches.
22. `grep -in "nameExpansion" docs/specs/fulltext-search-tool-spec.md` returns no matches.
23. `npm test` (vitest) in `packages/engine/mcp-server/` passes — no broken references to removed functions.
