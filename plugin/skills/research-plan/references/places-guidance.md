<!--
  CANONICAL SOURCE — do not edit a copy in isolation.
  This block is duplicated, byte-for-byte, into each place-using skill's
  references/places-guidance.md (Claude Code can't reliably load a shared
  reference across skills — issue #17741 — so each skill carries its own copy).
  A drift lint (mcp-server/tests/packaging/skill-guidance.test.ts) fails if any
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

- `place_population({ standardPlace, ... })`
- `place_external_links({ standardPlace, ... })`
- `place_distance({ standardPlace1, standardPlace2 })`
- `wiki_country_home` / `_getting_started` / `_online_records` / `_research_tips`({ standardPlace })
- `metadata_search({ standardPlace, ... })`

For `place_distance`, two events at the **same** `standard_place` are distance 0
(no call needed); otherwise pass the two names.

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
