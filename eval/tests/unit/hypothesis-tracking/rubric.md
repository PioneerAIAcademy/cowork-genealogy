# Hypothesis Tracking Rubric

Grading dimensions for hypothesis-tracking unit tests. Evaluated by the LLM judge alongside the three base dimensions (Correctness, Completeness, Tool Arguments).

## Claim clarity

Is the hypothesis stated as a specific, testable claim? "Thomas Flynn might be related" is vague. "Thomas Flynn of Schuylkill County was the father of Patrick Flynn" is testable.

- **pass:** Claim names specific persons, the specific relationship/fact being hypothesized, and includes enough place/time detail that a follow-up search could test it.
- **partial:** Claim is specific about the relationship but vague about the persons (uses "an immigrant from Ireland" rather than naming the candidate), or vice versa.
- **fail:** Claim is too vague to test ("Patrick had Irish ancestry") or so broad it can't be ruled out by any evidence.

## Evidence linkage

Are supporting and contradicting assertions correctly linked? Each linked assertion should genuinely bear on the hypothesis — tangential evidence should not be included.

- **pass:** Every `supporting_assertion_ids` and `contradicting_assertion_ids` entry is a direct or indirect statement about the hypothesized fact; no off-topic links.
- **partial:** Mostly relevant linkage but at least one assertion is tangential (e.g., a residence assertion linked to a parentage hypothesis with no connecting reasoning).
- **fail:** Linkage is arbitrary — assertions are dropped in without clear bearing on the claim.

## Status transitions

A hypothesis moves to "supported" only when no conflict naming its linked assertions is still unresolved, and either one supporting assertion is direct or two are indirect from two different sources. "Ruled out" requires affirmative refutation, not just lack of evidence.

- **pass:** Status transitions match the hypotheses status-transitions rules in research-schema-spec.md — `supported` only when every `conflicts[]` entry naming its supporting/contradicting assertions is `resolved` or `moot`, and either one supporting assertion is direct or two are indirect citing two distinct `source_id`s; `ruled_out` only with affirmative refutation; `ruled_out_reason` populated when `ruled_out: true`.
- **partial:** Transition is plausible but the threshold is debatable: for example `supported` declared on two or more indirect assertions that all cite the same `source_id`, where the argument should conclude through `proof-conclusion`'s assertions route instead of being promoted.
- **fail:** Hypothesis moved to `ruled_out` due to lack of evidence rather than refuting evidence, or `supported` declared in the face of unresolved contradictions.
