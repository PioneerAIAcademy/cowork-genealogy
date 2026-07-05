# flynn-record-search-handoff

The project state **immediately after `search-records` ran a `record_search`
and before `record-extraction` runs** — the cross-skill handoff that
`record-extraction/SKILL.md` §4 describes ("If search-records … produced the
record, they already wrote the log entry — reference it via `log_entry_id`").

Seeded state:

- `log[0]` = `log_001`, a `record_search` entry with
  `results_ref: "results/log_001.json"` — the log entry search-records
  finalized when it retained the search results.
- `results/log_001.json` = the staged sidecar holding the `record_search`
  gedcomx: `P1` Patrick Flynn (focus, `primaryId`), `P2` Thomas Flynn,
  `P3` Mary Flynn, plus their `ParentChild` / `Couple` relationships.
- No `sources` or `assertions` yet — record-extraction has not run.

This scenario exists so a record-extraction test can exercise the real
`record_persona_id` path: an assertion carrying a non-null persona id must
resolve it against its log entry's sidecar (validator rule D5). An
`empty-project-just-created` scenario cannot — with no pre-existing log
entry/sidecar, the skill would have to invent a `results_ref: null` log
entry, and D5 correctly rejects a non-null persona with no sidecar to
resolve against. The sidecar is a byte-for-byte copy of the same record in
`flynn-record-matching/results/log_001.json`.
