# flynn-proof-bare-ids

Patrick Flynn parentage research, mid-project — a **non-self-contained proof
narrative** variant of `mid-research-flynn`.

- **Objective:** Identify the parents of Patrick Flynn (b. ~1845, d. 1908)
- **Derived from:** `mid-research-flynn`

## Why this scenario exists

Issue #1392 adds a systematic review/assessment-mode checklist to
`proof-conclusion` SKILL.md §9. Before this scenario, `ut_proof_conclusion_007`
was the only GPS-review test, so any §9 edit would have been a single-test
case-patch with no generalization backstop. This scenario supplies the second
review-mode case.

## The delta — one field

Byte-identical to `mid-research-flynn` except for
`proof_summaries[0].narrative_markdown` (`ps_001`). In `mid-research-flynn`
that narrative is a well-formed, self-contained GPS summary: every record is
described in prose, and full citations appear inline and in a closing
citations section.

Here the same conclusion is written **non-self-contained**:

- evidence is referenced only by bare identifiers — `a_004`, `a_010`, `a_013`,
  `c_001`, `src_001`, `src_003`, `src_004`, `plan_001`
- no record is described in prose — no census years, dwelling/family numbers,
  informant, or repository
- no inline citations and no citations section

Everything else is unchanged, including the structured `proof_summaries`
fields (`tier: probable`, `vehicle: summary`, `supporting_assertion_ids`,
`resolved_conflict_ids`, `exhaustive_search_summary`), all 9 sources, 13
assertions, 6 person_evidence links, the resolved birthplace conflict `c_001`,
and `tree.gedcomx.json`.

Because the paired test's user message is near-identical to
`ut_proof_conclusion_007`'s, **narrative quality is the only variable between
the two tests** — which is what lets the pair prove a general checklist rather
than a scenario-specific patch.

## Used by

- `gps-review-narrative-not-self-contained.json` — review mode must
  systematically check narrative self-containment, not merely reach a verdict
