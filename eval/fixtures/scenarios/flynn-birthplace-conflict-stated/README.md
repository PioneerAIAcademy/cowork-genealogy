# Scenario: flynn-record-matching

A mid-research project for Patrick Flynn's parentage, in the state **after
candidate records have been gathered but before identity resolution**.
Built for the research-log result-retention eval cases — it exercises the
`results/` sidecar files and the `same_person` wiring.

## State

- **Subject:** Patrick Flynn (`I1`), b. ~1845 Ireland, Schuylkill County, PA.
  The tree also holds candidate parents Thomas (`I2`) and Mary (`I3`) Flynn.
- **Four gathered records**, each with a `results/<log_id>.json` sidecar:
  - `log_001` — 1850-census record (`MXHY-TP4`): three personas — Patrick
    (`P1`, b. 1845 Ireland), Thomas (`P2`) and Mary (`P3`), all resident 1850
    in Branch Township, Schuylkill — with both parent-child edges to Patrick
    and a couple edge between Thomas and Mary. Name and birthplace match the
    tree's `I1`, whose birth date is recorded there as `~1845`.
  - `log_002` — church baptism (`CFLT-9K2`): one persona, a "Patrick Flynn"
    of the same birth year and the same 1850 township as `log_001`, whose
    birthplace is recorded as **Germany** where every other source records
    Ireland.
  - `log_003` — 1850-census record (`VRNT-7M3`): "Patrick **Flinn**" — a
    transcription-variant surname — b. 1845 Ireland, resident 1850 in Branch
    Township, Schuylkill. Two personas, Patrick (`VP1`) and Thomas (`VP2`),
    with one parent-child edge: no mother and no couple edge, unlike
    `log_001`. Every fact it records matches `log_001` except the surname,
    spelled `Flinn` for both.
  - `log_004` — full-text probate hit (`FTXT-Q88`): a will of Thomas Flynn
    naming "my son Patrick Flynn". No structured GedcomX persona.
- **Four unlinked assertions** (`a_001`–`a_004`), no `person_evidence` yet.
  `a_001`/`a_002`/`a_003` carry `record_persona_id` (`P1`/`CP1`/`VP1`);
  `a_004` (full-text) has `record_persona_id: null`.

## What it exercises

- person-evidence resolving an assertion through its sidecar and scoring the
  match with `same_person`, including the score-as-input threshold policy.
  On two of the four, the score and the record content point opposite ways:
  `log_002` matches `log_001` on name, birth year and 1850 township while
  recording the birthplace as Germany, and `log_003` matches it on every
  fact except the surname spelling while naming neither a mother nor a
  couple edge.
- The full-text path (`a_004`): no `record_persona_id`, so no score —
  correlation analysis alone.
- search-records / search-full-text writing fresh sidecars against the open
  plan items `pli_001` / `pli_002`.
