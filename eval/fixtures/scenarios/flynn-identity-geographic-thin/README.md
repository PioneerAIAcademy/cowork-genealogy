# flynn-identity-geographic-thin

The **deferral variant** of `flynn-identity-geographic`: the corroborating
evidence has been **stripped** so that identity conflict `c_002` genuinely
cannot be resolved from what is on file. Built for the
conflict-resolution defer test (`ut_conflict_resolution_007`,
`defer-insufficient-evidence.json`), whose premise — "no subsequent record
from either household has been found" — was false in the parent scenario
(its 1860 census and 1908 death certificate corroborated the household-84
Patrick).

Removed relative to the parent:

- `src_003` (1860 census) and `src_004` (1908 death certificate)
- Their assertions: `a_008`–`a_010` (1860 census) and `a_011`–`a_013`
  (death certificate)
- Their log entries: `log_004`, `log_005`
- Their person-evidence links: `pe_004`, `pe_005`
- `c_001` (the Ireland-vs-Pennsylvania birthplace conflict — its
  Pennsylvania side lived on the removed death certificate)
- `ps_001` (the proof summary rested on the removed corroboration)
- Tree citations of `S2`/`S3` on `R1` and on I1's death fact, plus the
  `S2`/`S3` source descriptions themselves

Adjusted for internal consistency: plan items `pli_004` (1860 census) and
`pli_005` (death certificate) are back to `planned` — those searches have
not been performed in this variant, which is exactly why they are the
decisive next records; `h_001` is `active` with only the 1850
co-enumeration (`a_004`) supporting it; `q_002`'s exhaustive declaration
and `c_002`'s wording acknowledge the second candidate (household 197)
without referencing the removed death certificate.

- **Conflicts:**
  - `c_002` — identity (which of the two same-age Patrick Flynns in 1850
    Schuylkill County — household 84 vs. household 197 — is the
    subject?), status: `unresolved`. **Undecidable from on-file
    evidence**: only the 1850 census (src_001/src_002) is extracted; the
    correct behavior is to defer (status stays `unresolved`,
    `preferred_assertion_id: null`) and name the decisive records still
    unsearched (1860 census, death certificate, baptism, probate).
  - `c_003` — identity (geographic): the 1870 Allegheny County record
    (`src_005`, `a_014`), unchanged from the parent.
- **All conflicts have:** null `preferred_assertion_id`,
  `independence_analysis`, `weighing_analysis`, `resolution_rationale`.
  All list `q_001` in `blocks_question_ids`.

## Used by

- `conflict-resolution` **defer-insufficient-evidence** test
  (`ut_conflict_resolution_007`) — the skill must complete the analysis
  fields on `c_002`, leave it `unresolved` with a null preferred
  assertion, and specify what evidence would be decisive.

## Conflict shapes present

- **Identity conflict (c_002, c_003):** ≥1 competing assertion, null
  `disputed_attribute`, populated `identity_question`.
