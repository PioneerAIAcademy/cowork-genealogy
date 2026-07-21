<!--
  CANONICAL SOURCE — do not edit a copy in isolation.
  This block is duplicated, byte-for-byte, into each place-using skill's
  references/places-guidance.md (Claude Code can't reliably load a shared
  reference across skills — issue #17741 — so each skill carries its own copy).
  A drift lint (packages/engine/mcp-server/tests/packaging/skill-guidance.test.ts) fails if any
  copy diverges from this source. To change the guidance: edit this file, then
  re-copy it into every skill listed in that test.
-->

# Working with places (standard places)

Above the tool layer, places are always **names**, never IDs. The canonical
name is the `standardPlace` from `place_search`.

## Resolving a place

Call `place_search` with the place name as `placeName` (optionally a
higher-level `contextName` to disambiguate):

```
place_search({ placeName: "Schuylkill County, Pennsylvania" })
```

It returns an array of matches; each match has a **`standardPlace`** field (the
fully-qualified standardized name) plus `type`, `dateRange`, coordinates, and
links. **Pick the best/first match and use its `standardPlace` verbatim** as the
handle for everything downstream. There are no place IDs in the output.

Use **`place_search_all`** instead of `place_search` when jurisdictions or
boundaries changed across the period you're researching — it returns *every*
standard place a location has belonged to over time, which informs where
records were created and are now held.

## Passing places to other tools

The place tools all take a `standardPlace` name (not an ID) and resolve it
internally — pass the `standardPlace` you got from `place_search`:

- `collections_search({ standardPlace })` — lists record collections; it matches at the state level for the US/Canada/Mexico and the country level elsewhere (derived internally, returned as `scope`)
- `volume_search({ standardPlace, ... })`
- `external_links_search({ standardPlace, ... })`

`place_population`, `wiki_place_page`, `wiki_search`, and `place_distance`
are **locality-guide's** tools, not research-plan's — you receive their
findings as the facts and quirks in the `localities` entry (Step 2), you do
not call them here.

For `place_distance`, two events at the **same** `standard_place` are distance 0
(no call needed); otherwise pass the two names.

## Broadening to a parent jurisdiction

Every place tool returns results for the **exact** standardPlace you pass.
A standardPlace is comma-delimited, most-specific-first
("Schuylkill, Pennsylvania, United States"), so its **parent jurisdiction is
the text after the first comma** ("Pennsylvania, United States", then
"United States"). To broaden, drop the leading component and call again.

- **Superseding resources** (locality-guide's — you read these as facts in the
  `localities` entry, you don't fetch them): a place's wiki research page and
  population have one right answer per place — the most-specific available.
  locality-guide climbs to the parent jurisdiction when a place has none.
- **Additive resources** (yours) — `external_links_search`, `collections_search`,
  `volume_search`. Each level holds *different* records (the county courthouse,
  the state archive, the national index), so fetch the levels your research
  actually needs and combine them. Bias to the specific end; the national level
  is mostly generic collections the researcher already knows — pull it only on
  first contact with a country or when the local levels are sparse.

## Writing places to research.json / tree.gedcomx.json

Whenever you persist a place on a fact, assertion, or timeline event, also set
its **`standard_place`** companion (snake_case in the data formats) when one can
be found:

- If the place came from a `record_read` / `record_search` / `person_read`
  result, that fact already carries a converter-resolved `standard_place` —
  **copy it** (no tool call).
- Otherwise call `place_search({ placeName: "<place>" })` and use the first
  result's `standardPlace`. Resolve each distinct place once.
- Leave `standard_place` null when `place` is null or nothing resolves.
