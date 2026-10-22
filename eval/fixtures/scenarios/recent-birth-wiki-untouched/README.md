# Scenario: recent-birth-wiki-untouched

`recent-birth-sealed` plus one locality guide (`loc_001`, Utah) whose `guide_markdown` names a record type that could hold the target fact and that no log entry searched.

What changes from `recent-birth-sealed`:

- **`localities`**: `loc_001`, read from the `online_records` section of `Utah_Online_Genealogy_Records` (`pages_read[0].url`). The guide names three record types:
  - **Utah school census records**: list each child with a parent or guardian. Not searched, and held offline (county school districts and the Utah State Archives). This is the **expected** `wiki_named_untouched` entry.
  - **Federal censuses 1940 and 1950**: already searched (`log_001`, `log_002`). Must not be listed.
  - **Land and property records**: cannot name a 1936 child's parents. Must not be listed.

The guide text is hand-built for this scenario. The MCP fixture `wiki-read-utah-online-genealogy-records` returns the same text, so a `wiki_read` of the page agrees with it.

The point: the entry's `wiki_title` must be the page title, `Utah_Online_Genealogy_Records`, not the section enum value `online_records`.

Used by `eval/tests/unit/research-exhaustiveness/not-reached-wiki-untouched.json`.
