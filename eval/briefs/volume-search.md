# Deep-Dive Brief — `volume_search` (tool) + fixture regeneration

> Per-skill map for the deep-dive. Generic process: [`eval/JUNIOR-WALKTHROUGH.md`](../JUNIOR-WALKTHROUGH.md).
> This brief is tool-scoped (not skill-scoped): it tracks the one outstanding
> fixture-regeneration debt left by the tool naming/interface cleanup
> (`docs/specs/naming-cleanup-spec.md`).

## What this tool does
`volume_search` (formerly `metadata_search`) searches FamilySearch's Records
Management Service for **digitized volumes** (image groups: microfilm rolls,
book scans) covering a `standardPlace` and optional **year** range
(`startYear`/`endYear`, integers — sub-year/ISO precision was intentionally
dropped). Per volume it returns coverage (places, dates, record types),
`recordSearchablePercent` (how much is indexed for `record_search`), and
`fulltextSearchable`. Output envelope: `{ query, totalResults, results,
nextPageToken? }`. It is the place→volumes discovery step that **feeds
`image_search`** (volume → image IDs) and `fulltext_search`. Spec:
`docs/specs/volume-search-tool-spec.md`.

It is the only place-keyed `_search` tool with a real server cursor;
`external_links_search` and `collections_search` filter client-side and return
their full set in one response.

## ⚠️ Outstanding fixture-regeneration debt (the reason this brief exists)

`eval/fixtures/mcp/volume-search-edensor.json` was **migrated structurally** from
the former `image-search-edensor-place.json` (which mislabeled a place→volumes
query as `image_search`). The migration set the correct `tool`, `args`
(`{ standardPlace: "Edensor, Derbyshire, England, United Kingdom", startYear:
1730, endYear: 1810 }`), envelope (`query`/`totalResults`/`results`), and mapped
the coverage data we already had. **But three per-item signals are `null`
placeholders** because the recorded payload predates them:

- `imageCount`
- `recordSearchablePercent`
- `fulltextSearchable`

**Action needed:** regenerate the `response` against the **live** `volume_search`
and replace the `null`s with real values. This needs a valid FamilySearch
session (run the `login` tool first) and network access — it can't be done from
a VM/headless run:

```
cd packages/engine/mcp-server
npx tsx dev/try-volume-search.ts --standardPlace "Edensor, Derbyshire, England, United Kingdom" --startYear 1730 --endYear 1810
```

Copy the four real volume groups' fields into the fixture's `response.results`
(keep `tool`, `args`, and the `query` echo as-is), then drop the "null
placeholders" caveat from the fixture's `description`. Edensor, Derbyshire is a
known small result set (≈4 groups), so the diff should be easy to eyeball.

## Related migrated fixtures (no regen needed — pure renames)
- `image-search-by-group-number.json` — **kept** on `image_search` (a legitimate
  `imageGroupNumber` → image-IDs call; `image_search` was not renamed). Its
  output shape was not changed.
- `collections-search-{schuylkill,pennsylvania}.json`, `collection-read-by-id.json`,
  `external-links-search-schuylkill.json`, `same-person-flynn-{conflict,strong,variant}.json`
  — renamed + reshaped to the new envelopes; values are hand-authored mocks
  consistent with the new contracts (no live-API regen pending).

## Coverage gap
No skill currently has a `volume_search` test with a *real* recorded response.
The `research-plan` and `record-extraction` skills now declare `volume_search`
in `allowed-tools` (they previously misused `image_search` for place→volume
discovery — fixed in the cleanup). A first `volume_search` positive fixture
(post-regeneration) would let those skills' volume-discovery paths be exercised.

## Definition of done
Live-regenerate `volume-search-edensor.json` → drop the placeholder caveat →
(optional) add a `volume_search` positive test to `research-plan` or
`record-extraction` using the regenerated fixture → re-run the affected skills
and refresh their runlogs.
