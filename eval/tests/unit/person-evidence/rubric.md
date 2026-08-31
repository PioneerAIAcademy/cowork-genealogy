# Person Evidence Rubric

Grading dimensions for person-evidence unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Confidence calibration

Is the confidence level (confident/probable/speculative) appropriate for the strength of evidence? A single census co-residence is "probable" at best — "confident" requires corroboration.

- **pass:** Confidence tier matches evidence strength: `confident` when multiple independent sources corroborate; `probable` when a single source with high informant quality; `speculative` when only circumstantial alignment.
- **partial:** Confidence is off by one tier — `confident` claimed on a single source, or `speculative` chosen when corroboration exists.
- **fail:** Confidence claim is clearly inverted (e.g., `confident` on circumstantial-only evidence; `speculative` on a fully corroborated link).

## Rationale quality

Does the rationale explain why this record's role is believed to be this person? It should cite specific matching attributes (name, age, location, family context), not just "names match."

- **pass:** `rationale` cites multiple specific matching attributes (e.g., "name matches; age consistent with subject's ~1845 birth; located in Schuylkill County where subject is known to have lived; no other Patrick Flynn of matching age in the county") and addresses why competing candidates were ruled out.
- **partial:** Rationale cites attributes but is missing the disambiguation step ("name and age match" without noting whether other candidates exist).
- **fail:** Rationale is generic ("names match") or asserts identity without inspecting alternatives.

## Multi-person awareness

When an assertion implies a relationship (e.g., "listed as son of Thomas"), did the skill create person_evidence links for both persons? The assertion bears on both the child and the parent.

- **pass:** For every relationship-implying assertion, both person_evidence entries exist — one for each person in the relationship. In a review/audit request (where no writes should be made), correctly flagging that a relationship assertion is missing its other-side link — and asking before creating it — satisfies this dimension.
- **partial:** Most relationship assertions get both links, but one or two have only one side linked.
- **fail:** Relationship assertions consistently only link to one side (typically the subject), missing the implied other-person link.

## Person minting and connecting edges

When an assertion's persona (or a household member the record introduces) matches no existing GedcomX person, did person-evidence mint it itself — carrying the record's SOURCED facts via `materialize_facts` create-or-enrich, not a name-only stub — link the assertion(s), and write the connecting parent-child / spouse EDGE(s) via `tree_edit` `add_relationship` with a source-ref? person-evidence owns the household skeleton; record-extraction is assertion-only. (Only graded when the scenario has an unmatched persona or household members absent from the tree; mark N/A otherwise.)

- **pass:** Mints each new person via `materialize_facts` create-or-enrich so it arrives WITH its sourced fact(s) — at minimum the sourced name fact, plus `gender` — each carrying a resolved non-null source-ref, not a bare name-only stub, and links the assertion(s). Any parent-child / spouse edge the record establishes is written via `tree_edit` `add_relationship` carrying a source-ref resolved from the relationship assertion's `source_id`: a directly-stated relationship (a will's "my son") is direct evidence; a pre-1880 census relationship (inferred from household position, no relationship column) is INDIRECT, materialized at lower ref quality. For a multi-person household, the `merge_warnings` dry-run coherence gate is handled correctly: run over the pre-materialization set before committing **when a candidate record document is in hand**, and otherwise skipped with the reason noted in the affected rationale — a scenario built from pre-extracted assertions supplies no candidate document, and `record_read` is not this skill's to call, so a noted skip is the pass there, not a shortfall. An existing tree person unexplainedly absent from the record is FLAGGED as an identity question — never renamed or overwritten. Confidence is calibrated to the evidence (a single source → `probable`, not `confident`); `match_score` is null for a full-text-sourced assertion.
- **partial:** Mints and links but leaves a member a name-only shell (the old stub shape), omits a record-established edge or writes one without a source-ref, mis-classifies a pre-1880 inferred edge as directly-stated, skips the `merge_warnings` gate on a household **while holding a candidate record document**, or skips it without noting why, is malformed (missing gender/name), over-claims confidence, or hedges by deferring the mint to a later step.
- **fail:** Forces an assertion onto a non-matching person, skips the role leaving the persona unlinked, does not build the household skeleton, writes edges with no source provenance, or overwrites/renames an existing tree person to force a record match.

## Score discipline

Is `same_person` actually invoked when a **record persona is reachable** for the assertion and a serious tree candidate exists — and once invoked, is the score treated as an input that informs, never replaces, the correlation analysis? (Only graded when a reachable persona and a candidate are both in play, or when the assertion genuinely has no reachable persona; mark N/A otherwise.)

A persona is reachable when the assertion carries a non-null `record_persona_id`, when it came from `record_read` (which returns GedcomX with a persons array, so the record can be re-opened), or when its log entry retained a sidecar (`results_ref`). A null `record_persona_id` records only that no sidecar was kept — **it does not mean the pair cannot be scored**, and grading it as if it did is what this dimension was previously doing.

- **pass:** `same_person` is called whenever a reachable persona meets a tree candidate, including the `record_read` and retained-sidecar cases; `primaryId1` is the persona for the party each link is about, not the assertion's own `record_persona_id` reused across both parties of a relationship assertion; the score is recorded in `match_score` and informs — not dictates — confidence (a high score does not auto-link past a qualitative conflict; a low score on a thin subject does not dismiss a strong qualitative match). When no persona is reachable — a full-text hit, an image-, external-site- or PDF-sourced assertion, or a search whose sidecar was not retained — correlation stands alone and `match_score` is legitimately null.
- **partial:** Uses the score correctly in direction but leans on it more than the correlation warrants — e.g., lets a high score nudge confidence up despite a noted conflict, or hesitates on a strong variant match because of the low score, without actually inverting the decision.
- **fail:** `same_person` is never called despite a reachable persona and a candidate (a mandatory score silently skipped) — including skipping it because `record_persona_id` is null when the record was `record_read` or the sidecar was retained; or the first party's persona is reused for a second party's link, manufacturing a near-zero score; or a called score overrides correlation — a `confident` link past a qualitative conflict because the score is high, or a strong qualitative match dismissed because the score is low, or `match_score` treated as the verdict.
