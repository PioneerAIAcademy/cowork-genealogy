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

## Stub-person creation

When an assertion's persona matches no existing GedcomX person, did the skill create a new stub person and link to it — rather than forcing a bad match or skipping the role? (Only graded when the scenario contains an assertion with no plausible existing match; mark N/A otherwise.)

- **pass:** Recognizes no existing person fits, creates a minimal stub in `tree.gedcomx.json` (synthetic id, `gender`, one name with a surname), and creates the `person_evidence` entry linking the assertion to that new stub. Confidence is calibrated to the evidence (a single will naming the relationship → `probable`, not `confident`); `match_score` is null for a full-text-sourced assertion.
- **partial:** Creates the link but the stub is malformed (missing gender or name), or over-claims confidence, or hedges by recommending the stub be created later instead of creating it.
- **fail:** Forces the assertion onto an existing person who does not match, or skips the role entirely, leaving the persona unlinked.

## Score discipline (advisory)

Is the `same_person` score treated as an input that informs — never replaces — the correlation analysis? (Only graded when a `same_person` score is in play, or when the assertion is unscored and that is the point; mark N/A otherwise.)

- **pass:** The score is recorded in `match_score` when one was obtained, but the confidence decision is driven by correlation: a high score does not auto-link past a qualitative conflict (the conflict caps confidence), and a low score caused by a transcription variant does not dismiss a strong qualitative match. When no score is available (FTS-, image-, PDF-sourced), correlation stands alone and `match_score` is null.
- **partial:** Uses the score correctly in direction but leans on it more than the correlation warrants — e.g., lets a high score nudge confidence up despite a noted conflict, or hesitates on a strong variant match because of the low score, without actually inverting the decision.
- **fail:** Lets the score override correlation — a `confident` link past a qualitative conflict because the score is high, or a strong qualitative match dismissed because the score is low, or `match_score` treated as the verdict.
