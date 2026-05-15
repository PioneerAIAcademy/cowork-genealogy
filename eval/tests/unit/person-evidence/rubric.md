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

- **pass:** For every relationship-implying assertion, both person_evidence entries exist — one for each person in the relationship.
- **partial:** Most relationship assertions get both links, but one or two have only one side linked.
- **fail:** Relationship assertions consistently only link to one side (typically the subject), missing the implied other-person link.
