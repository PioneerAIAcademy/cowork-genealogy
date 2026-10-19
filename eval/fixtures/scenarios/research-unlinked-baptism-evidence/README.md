# research-unlinked-baptism-evidence

Mined from a Cowork project on 2026-10-08 (Family Tree LZJF-J13, William Honeyman, weaver, buried at Rudby, Yorkshire, 27 Mar 1783). The objective asks which baptism is his: 5 Apr 1719 at Hutton Rudby (a_001) or 2 Dec 1716 at Edinburgh, son of William Honniman and Elizabeth Duncan (a_005). It also asks whether his father came from Fife (q_002). The run extracted fifteen assertions across both questions and never linked one: `person_evidence[]` stayed empty for the whole run. Even so, `/research` went on to register and resolve the baptism conflict, and to write ps_001 at Probable on "correlation across several independent entries" and ps_002 at Not Proved. The routing table's "Assertions not yet linked to persons" row requires `@plugin:person-evidence` before any of that. On this state, `project_context` used to report `research-exhaustiveness, then proof-conclusion` for both questions. It now reports `person-evidence — none of this question's N assertions is linked to a person`.

- **Objective / questions:** q_001 (the baptism) and q_002 (the father's Fife origin). Both are open, with no stop decision.
- **Plans:** pl_001 for q_001 (pli_001 Hutton Rudby registers, pli_002 Scottish baptisms) and pl_002 for q_002 (pli_003 Scoonie 1670–1695). Every item is `completed`.
- **Log:** log_001 (Hutton Rudby registers, positive), log_002 (Scotland 1700–1730, positive) and log_003 (Scoonie christening, negative). Each positive entry is extracted.
- **Assertions:** a_001 to a_015, unlinked. q_001 has 13 of them and q_002 has 5.
- **person_evidence / conflicts / hypotheses / proof_summaries / evaluations:** empty.

## This is a constructed carve, not the literal pre-failure state

The case folder is the post-run state, and it was not written through the current writer tools. It has no plan, nine log entries with no results sidecars, assertions with no `log_entry_id` or `record_basis`, and capitalized fact types. The carve keeps every source and assertion and changes only what today's validator requires:

- Fact types are lower-cased (`ParentChild` becomes `relationship`, with a `structured_value`). Every assertion gets `record_basis` (`inferred` for a_008, the birth year computed from the burial age), and the field the case called `evidence_type` is dropped.
- a_008's age note moves to `informant_bias_notes`. Its quality becomes `indeterminate`, because its informant is `unknown`.
- **The plans and log_002 are RECONSTRUCTED.** They exist so that no "question with no plan" or "pending extraction" row fires above the one this test grades. log_001 and log_003 are the case's own entries. log_002 stands in for the case's Scottish searches, and the two Scottish records (src_004, src_008) are assigned to it. Every other source is assigned to log_001.
- The questions are reset to `open`. The conflicts (c_001, c_002), hypotheses (h_001 to h_004) and both proof summaries are removed, because they came after the step this test grades.

The tree is the case's own, unchanged. **Verify the carve before relying on the test.**

## PII

William Honeyman and his family are deceased, public Family Tree persons who died in the 1700s, and the competing baptism dates are the evidence under test. Names, places and dates are kept, as in `research-unregistered-census-conflicts`. The scrub is best-effort, so review it before committing.
