# g9gj-proof-update-after-later-search

Mined from issue #3177, puzzle 4 (Family Tree G9GJ-959, Iram F. Hyde, b. about 1796–98, of Jackson, Washington Co., NY, d. after 1870 in White Co., IN). The source is the graded Cowork run of 2026-10-09 (`puzzle4-g9gj-run2`, plugin and `.mcpb` built from `main` at `bf77695b`). Used by `ut_proof_conclusion_g9j`.

The run concluded both questions and then kept searching. `log_019` (16:02 UTC) read the 1855 NY state census image, `log_020` (16:37) read daughter Margaret Clark's 1880 census entry, and `log_021` (17:21) searched the full text of Walworth's *Hyde Genealogy*. Each proof was then updated one field at a time:

- `ps_001` (birthplace): its narrative gained both image readings, but its `exhaustive_search_summary` still listed both images, and Walworth, as "Not completed".
- `ps_002` (parents): its `exhaustive_search_summary` was rewritten after 17:21 to report all three searches, but its narrative's "What could resolve it" still recommended all three.

This scenario holds the moment before `ps_002`'s last update. The test re-invokes proof-conclusion on `q_002`.

- **Questions:** q_001 (birth state) resolved, with `ps_001` at probable; q_002 (parents) in progress, with `ps_002` at not_proved.
- **Log:** 21 entries. `log_019`–`log_021` are the three searches made after `ps_002` was written.
- **Conflicts:** `c_001`, birthplace: New Hampshire (1850, 1860, 1870) against Washington Co., NY (1855 image).
- **Hypotheses:** none, as in the run.

## Changes from the project as found

- **RECONSTRUCTED: `ps_002.exhaustive_search_summary`.** Rolled back to before `log_019`–`log_021`. The real field reported those three searches. The reconstruction lists them as not yet examined, matching the narrative's own "What could resolve it" list, and keeps every other sentence of the real field. `ps_002`'s narrative is verbatim.
- **`ps_001.exhaustive_search_summary` brought up to date.** It now reports the two image readings and the Walworth search, so that `ps_002` is the only stale proof in the scenario. Its narrative is verbatim.
- **ADDED: both proofs' `updated` stamps.** The run predates the field, so the times are chosen, not recorded. `ps_002` is stamped 15:50 UTC, between `log_018` and `log_019`, so `research_append` refuses a one-field update of it until both fields are sent. `ps_001` is stamped 17:25 UTC, after `log_021`, matching its up-to-date search summary.
- **Migrated to the current schema:** the 23 assertions' pre-2026-09-18 evidence field became `record_basis` with the engine's own mapping (`src/utils/record-basis.ts`; all 23 were direct, so stated). Both questions' pre-2026-10-07 stop declaration, which was not declared, became an unstopped `search_stop`. Both proofs lost the retired `status` field and gained `shortfall: "gap"`, since each summary names a source still to search.
- **Dropped:** `results/match-scores.jsonl` (a ranking scratch file that points at staging files not in the scenario) and `tree.gedcomx.json.bak`.
- **Scrubbed:** each sidecar's `payload.query.projectPath` held the operator's local folder path; it is now `<workspace>`.

## PII

Iram Hyde and his family are deceased, public Family Tree persons already named on public issue #3177. Names are kept, as for a recorded e2e run.
