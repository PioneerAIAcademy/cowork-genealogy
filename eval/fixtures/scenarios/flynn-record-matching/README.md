# Scenario: flynn-record-matching

A mid-research project for Patrick Flynn's parentage, in the state **after
candidate records have been gathered but before identity resolution**.
Built for the research-log result-retention eval cases — it exercises the
`results/` sidecar files and the `same_person` wiring.

## State

- **Subject:** Patrick Flynn (`I1`), b. ~1845 Ireland, Schuylkill County, PA.
  The tree also holds candidate parents Thomas (`I2`) and Mary (`I3`) Flynn.
- **Four gathered records**, each with a `results/<log_id>.json` sidecar:
  - `log_001` — clean 1850-census match (`MXHY-TP4`): Patrick Flynn age 5 in
    Thomas Flynn's household. Strong on every identifier.
  - `log_002` — conflict record (`CFLT-9K2`): a "Patrick Flynn" whose
    birthplace is recorded as **Germany**, contradicting the Ireland
    birthplace in every other source.
  - `log_003` — variant record (`VRNT-7M3`): "Patrick **Flinn**" — a
    transcription-variant surname — age 5 in 1850, Schuylkill, in Thomas
    Flinn's household. Strong on every identifier *except* the spelling.
  - `log_004` — full-text probate hit (`FTXT-Q88`): a will of Thomas Flynn
    naming "my son Patrick Flynn". No structured GedcomX persona.
- **Four unlinked assertions** (`a_001`–`a_004`), no `person_evidence` yet.
  `a_001`/`a_002`/`a_003` carry `record_persona_id` (`P1`/`CP1`/`VP1`);
  `a_004` (full-text) has `record_persona_id: null`.

## What it exercises

- person-evidence resolving an assertion through its sidecar and scoring the
  match with `same_person` — including the score-as-input threshold
  policy: a high score must not auto-link past the `log_002` birthplace
  conflict, and the low score on the `log_003` variant must not dismiss a
  strong qualitative match.
- The full-text path (`a_004`): no `record_persona_id`, so no score —
  correlation analysis alone.
- search-records / search-full-text writing fresh sidecars against the open
  plan items `pli_001` / `pli_002`.
