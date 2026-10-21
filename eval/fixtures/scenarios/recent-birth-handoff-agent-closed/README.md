# Scenario: recent-birth-handoff-agent-closed

`recent-birth-sealed` plus one Newspapers.com hand-off that the agent closed itself, without a capture: the shape of the Saarland hand-off in issue #3416.

What changes from `recent-birth-sealed`:

- **`pli_008`** (`newspaper`, Weber County, 1936, `completed`): a 1936 Ogden Standard-Examiner birth announcement that would name Alan's parents.
- **`log_008`**: the hand-off. `tool: "external_site"`, `site: "newspapers"`, `outcome: "partial"`, `capture_received: false`.
- **`log_009`**: a later entry for the **same** `url_generated`, `outcome: "negative"`, `capture_received: false`, with the note "requires a paid subscription not available in this autonomous research session". The agent wrote this entry; the researcher never replied.

Everything else is identical to `recent-birth-sealed`: the parents are established by independent sources, and the 1936 birth certificate is privacy-sealed.

The point: `project_context.awaitingUser` no longer lists `log_008`, because `log_009` closes the row. research-exhaustiveness must still list it in `search_stop.not_reached` as `handed_to_user` with `log_entry_id: "log_008"`, not `log_009`.

Used by `eval/tests/unit/research-exhaustiveness/not-reached-agent-closed-handoff.json`.
