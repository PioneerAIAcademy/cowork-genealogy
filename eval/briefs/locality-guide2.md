# Deep-Dive Brief — `locality-guide` + `volume_search` integration

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).
> This brief is **change-scoped** (not a full skill re-audit): it tracks the one
> outstanding job of wiring the `volume_search` tool into `locality-guide`. For
> the broader skill-hardening map (fixtures, neighbor negatives, known issues),
> see the companion brief [`locality-guide.md`](locality-guide.md). The
> `volume_search` tool itself is mapped in [`volume-search.md`](volume-search.md).

## Why this change

`locality-guide`'s headline job is to survey **what records exist for a place +
period and how each can be accessed** — and its Step 4 explicitly classifies
every record type by digitization level (`indexed online, browse-only images,
microfilm, physical only`), calling that classification "critical — researchers
often assume that if a record is not in an online database, it does not exist."

But the skill has no tool that surfaces the browse-only / unindexed half of that
picture. Its only record-discovery tool is `collections_search`, which matches
FamilySearch collection *titles* and returns **indexed** collections. Many
volumes exist only as digitized-but-unindexed images (microfilm rolls, book
scans) — exactly the records a researcher would otherwise wrongly assume don't
exist. `volume_search` is the place→volumes discovery step that returns those
volumes, with two per-volume signals the guide wants:

- `recordSearchablePercent` — how much of the volume is indexed (reachable via
  `record_search`),
- `fulltextSearchable` — whether `fulltext_search` will find anything in it.

A volume low on both is the textbook "browse-only, image-by-image only" case the
skill is supposed to flag. Adding `volume_search` lets Step 3 actually *find*
those volumes and Step 4 classify them on evidence rather than from the wiki
narrative alone.

This is the same gap `research-plan` and `record-extraction` already close —
both invoke `volume_search`. `locality-guide` is the remaining survey-stage skill
that should and does not.

## What this skill does (scoped)
Produces a structured locality research guide for a place + period — when the
jurisdiction formed, boundary changes, which record types exist and when, what's
indexed vs browse-only vs microfilm vs physical-only, which repositories hold
them, known losses. Prerequisite to `research-plan`. Does **not** search records
for a person, write `research.json`, or give narrative historical context. Tools:
`place_search`, `place_search_all`, `collections_search`, `external_links_search`,
`place_population`, `wikipedia_search`, `wiki_search`, `wiki_read`,
`wiki_place_page`.

## Where everything lives
- `packages/engine/plugin/skills/locality-guide/SKILL.md` — Step 3 ("Survey
  available records and repositories", the `collections_search` /
  `external_links_search` block) and Step 4 ("Classify access levels") are the
  two steps this change touches.
- `references/output-format.md` — holds the digitization-level classification
  table Step 4 references (the place where the browse-only / microfilm levels
  are defined).
- `eval/tests/unit/locality-guide/` — `schuylkill-county-records.json`,
  `different-jurisdiction-ireland.json`, `negative-search-wikipedia.json`,
  `rubric.md`.
- `eval/fixtures/mcp/volume-search-edensor.json` — the **only** existing
  `volume_search` fixture (Edensor, Derbyshire, UK; `startYear 1730`,
  `endYear 1810`). Its place does **not** match any locality-guide test, so it
  is not directly reusable here — see fixture work below.

## The change — SKILL.md edits

1. **Frontmatter.** Add `volume_search` to `allowed-tools`.
2. **Step 3 (survey).** Add a `volume_search` call to the tool block, keyed on the
   same `standardPlace` + the guide's year range, e.g.
   `volume_search({ standardPlace: "Schuylkill, Pennsylvania, United States", startYear: 1840, endYear: 1880 })`.
   Add a short paragraph (mirroring the existing `collections_search` /
   `external_links_search` notes) explaining: `collections_search` shows
   **indexed** collections; `volume_search` reveals digitized **volumes** that may
   never appear in indexed search — pass the full `standardPlace`, read
   `recordSearchablePercent` and `fulltextSearchable` per volume, and that a
   volume low/false on both is browse-only (image-by-image via
   `image_search` → `image_read`). Note that results paginate
   (`nextPageToken` → `pageToken`) and that one page is usually enough for a
   scoping survey.
3. **Step 4 (classify).** Tie the new signals to the digitization-level table:
   `recordSearchablePercent` high → "indexed online"; volume present but
   `recordSearchablePercent` low/`null` and `fulltextSearchable` false →
   "browse-only images"; absent from `volume_search` entirely → likely
   microfilm/physical (cross-check the wiki). Keep this a sentence or two — the
   table already exists; this just maps the tool output onto it.
4. **"Important rules" / "Be specific about availability."** Extend the existing
   guidance so a browse-only finding is stated concretely (e.g. "FamilySearch has
   N digitized but unindexed image volumes for this county, browsable image by
   image" rather than a vague "records may exist").

Keep the edit **additive and small** — this is a tool-integration brief, not a
rewrite. Do not restructure Steps 3–5 or touch the wiki-tool-selection logic
(that is the companion brief's job).

## Fixture work — the dominant cost

The GH-action `check_tool_coverage.py` (warn-only) flags any `allowed-tools`
entry with **no fixture in the skill's test corpus**. Adding `volume_search` to
`allowed-tools` with zero matching fixture will trip it — so a fixture is a
precondition, not optional.

- **New: `volume-search-schuylkill.json`** — a `volume_search` fixture whose
  `args` predicate matches `{ standardPlace: "Schuylkill, Pennsylvania, United
  States", startYear: 1840, endYear: 1880 }` (align years to the
  `schuylkill-county-records.json` test). Shape per
  `docs/specs/volume-search-tool-spec.md` Output: a `{ query, totalResults,
  results, nextPageToken? }` envelope where `results[]` carries
  `imageGroupNumber`, `imageGroupPrefix`, `imageCount`,
  `recordSearchablePercent`, `fulltextSearchable`, `coverages[]`, `languages`.
  **Include a deliberate mix** so the skill has something to classify: at least
  one well-indexed volume (high `recordSearchablePercent`), one full-text-only
  volume (`fulltextSearchable: true`, low `recordSearchablePercent`), and one
  browse-only volume (both low/false) — that spread is what exercises the Step 4
  classification you're adding.
- **Optional: an empty-result fixture** (`{"totalCount":0}` → `totalResults: 0`,
  `results: []`) for a second jurisdiction, to test the "no digitized volumes
  found — note the gap, don't report nonexistence" branch. Pairs naturally with
  the Ireland test (`different-jurisdiction-ireland.json`), which already runs
  fixture-free per the companion brief.
- The existing `volume-search-edensor.json` can serve as a **structural
  template** for the new fixture (copy its shape, swap place/years/results) but
  cannot stand in for it — its place won't match a Schuylkill call.

## Tests to add

**Positive:**
- **Extend `schuylkill-county-records.json`** (or add a sibling) so the prompt's
  expected guide names the browse-only volumes from the new fixture and
  classifies them correctly — i.e. the test now *requires* the skill to call
  `volume_search` and fold its output into the access-level section. Update its
  `judge_context` to credit surfacing unindexed volumes.
- **Empty-volume / coverage-gap test** — a jurisdiction where `volume_search`
  returns zero, verifying the guide notes the gap rather than implying the
  records don't exist.

**Negative (boundaries unchanged):** the `volume_search` addition does not move
any skill boundary — keep the existing neighbor negatives
(`search-records`, `historical-context`, `search-wikipedia`). Add no new negative
solely for this change.

## Rubric

`locality-guide/rubric.md` exists. Check whether any dimension already credits
"distinguishes indexed vs browse-only / flags physical-only records." If one
does, the new `volume_search` evidence strengthens it for free — no rubric edit
needed. If access-level accuracy is **not** a discriminating dimension, this is
the moment to add or sharpen one (pass: names specific browse-only volumes with
counts; partial: mentions browse-only generically; fail: reports only indexed
collections / implies absence-online means nonexistence). Coordinate with the
senior before editing `rubric.md`.

## Definition of done
Add `volume_search` to `allowed-tools` → wire the Step 3 call + Step 4
classification mapping (additive, small) → author `volume-search-schuylkill.json`
with a mixed indexed/full-text/browse-only spread → extend the Schuylkill test
(and optionally add the empty-volume gap test) so it requires and credits the new
tool → confirm `check_tool_coverage.py` is satisfied → full `--skill
locality-guide` harness pass → review every dimension in the CRUD UI → PR.
(Scope to what fixtures allow — log anything deferred.)
