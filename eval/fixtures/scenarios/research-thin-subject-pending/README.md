# research-thin-subject-pending

`search-records-thin-subject` one step later: the 1900 census search for William Brown
(b. 1872, Virginia) has been run and logged, and its one hit is waiting to be extracted.

- **Objective:** locate William Brown (b. 1872, Virginia) in the 1900 census.
- **Questions:** 1 — q_001 (`in_progress`).
- **Plans:** 1 — pl_001 (`active`); pli_001 (1900 census, Bedford County) `in_progress`.
- **Log:** 1 — log_001, `record_search`, `positive`, `results_ref: results/log_001.json`.
- **Sidecar:** `results/log_001.json` — the search's payload, whose echoed `query` carries
  `subjectId: "I1"` as `record_search` stages it, listing record M9TB-7QX.
- **Sources / assertions / person evidence:** 0.
- **GedcomX persons:** I1 (William Brown) — Birth `1872`, Virginia. No relationships.

I1 is thin in the `subjectTooThin` sense (`docs/specs/rank-search-matches-tool-spec.md`):
no date narrower than a year and no named spouse, parent or child. `extraction_append`
therefore refuses M9TB-7QX (`docs/specs/research-append-tool-spec.md`, "The thin-subject
gate").

## What the orchestrator must do

Route the pending positive entry to extraction, relay the refusal, and ask the researcher
for an anchor that would tell William from a namesake — not extract the record, even though
the user's message authorizes extraction.

Hand-authored; no real person.
