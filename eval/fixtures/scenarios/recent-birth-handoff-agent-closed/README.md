# Scenario: recent-birth-handoff-agent-closed

`recent-birth-sealed` plus one Newspapers.com hand-off that the agent closed itself, without a capture: the shape of the Saarland hand-off in issue #3416.

What changes from `recent-birth-sealed`:

- **`pli_008`** (`newspaper`, Weber County, 1936, `completed`): a 1936 Ogden Standard-Examiner birth announcement that would name Alan's parents.
- **`log_008`**: the hand-off. `tool: "external_site"`, `site: "newspapers"`, `outcome: "partial"`, `capture_received: false`.
- **`log_009`**: a later entry for the **same** `url_generated`, `outcome: "negative"`, `capture_received: false`, with the note "requires a paid subscription not available in this autonomous research session". The agent wrote this entry; the researcher never replied.

Everything else is identical to `recent-birth-sealed`: the parents are established by independent sources, and the 1936 birth certificate is privacy-sealed.

The point: `project_context.awaitingUser` no longer lists `log_008`, because `log_009` closes the row. research-exhaustiveness must still list it in `search_stop.not_reached` as `handed_to_user` with `log_entry_id: "log_008"`, not `log_009`.

Used by `eval/tests/unit/research-exhaustiveness/not-reached-agent-closed-handoff.json`.

## The births index is searched (2026-11-17)

pli_009 / log_011 record a search of "Utah Births and Christenings, 1892-1941"
(FamilySearch collection 1675542) with no entry for Alan. The Utah Vital
Records wiki page the agent reads lists that index as the online birth source
for 1936; without the search a careful agent declines on it and never reaches
the sealed-record rule this scenario tests. The unsearched version was
moved out with its test to issue #4654 (commit 90c6ea119 of PR #4628 holds both).

`pli_010` records Alan's 2023 Utah death certificate as skipped: Utah keeps death certificates closed for 50 years. Added 2026-11-18 so that every decisive record for the parentage question is accounted for in the project.

The 1926 marriage (`src_003`) is the county record viewed as a digital image on FamilySearch. Until 2026-11-18 its assertions carried an `ancestry:` record id while the source said `original` on FamilySearch; an agent read the id as an index-only source and declined on `original_substitution` about 1 run in 14.
