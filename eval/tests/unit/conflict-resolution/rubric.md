# Conflict Resolution Rubric

Grading dimensions for all conflict-resolution unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Source independence analysis

Did the skill assess whether competing sources are truly independent? Two derivative indexes of the same original are not independent. Two census records with different enumerators but the same household informant may not be fully independent for the facts that informant reported. The analysis must be specific to the conflict's fact type, not a generic statement about the sources.

- **pass:** `independence_analysis` names the specific informants and records involved, and explains whether they share an information chain for the disputed fact.
- **partial:** Independence is asserted but reasoning is generic ("the sources are independent because they're different documents") without inspecting the informant chain.
- **fail:** No independence analysis, or independence claimed where a shared informant clearly undermines it, or an on-file derivative of a source already inside the conflict goes unmentioned. A derivative index of the same original is one source, not two — it must be named and set aside even when it is absent from `competing_assertion_ids`, because a reader counting sources will otherwise count it.

## Evidence weighing

Did the skill apply the GPS preponderance hierarchy? Original sources outweigh derivative. Primary information outweigh secondary. Contemporary recordings outweigh later recollections. Direct evidence outweighs indirect. The weighing must cite specific attributes of the competing assertions (informant proximity, temporal distance, source classification), not just state the hierarchy abstractly.

**Read `weighing_analysis` against `independence_analysis` on the same write.** They are one argument in two fields, and a weighing that contradicts the independence finding beside it is not a weighing — it is an assertion. Where the independence analysis groups the winning side's assertions as partially dependent, or as one informant unit carrying the weight of one report, the weighing may not then count them as multiple independent items corroborating each other, and may not reach for GPS Standard 48 rationale 1 ("uncorroborated single item") against the losing side — the winning side is, by the skill's own finding, also a single item.

**Weighing may not rest on facts the record does not carry.** Where an assertion is recorded `information_quality: indeterminate` with an informant the record calls unknown, possible or likely, the weighing must treat that informant as undetermined. Naming them with a certainty the record withholds, giving them firsthand or eyewitness knowledge of the disputed fact, or assigning them a family relationship the project holds only as an unproved hypothesis, each fails the dimension — the last most seriously, because a resolution that assumes the parentage the research question is trying to prove is circular.

- **pass:** `weighing_analysis` cites specific assertion attributes (informant proximity, temporal distance, source classification) and applies the preponderance hierarchy to them.
- **partial:** Weighing is applied but invokes the hierarchy abstractly without grounding in the specific assertions' attributes.
- **fail:** No weighing analysis; or the hierarchy is applied incorrectly (later recollection preferred over contemporary recording without justification); or the weighing contradicts the independence finding on the same write, however well either field reads alone; or it rests on an informant identity, relationship, or firsthand knowledge the record does not establish.

## Resolution completeness

Did the resolution address ALL competing assertions, not just the two most obvious? A conflict with three competing assertions requires explaining why each non-preferred assertion is less reliable, not just why the preferred one is best. The resolution rationale must be specific enough that a reviewer can understand the reasoning without reading the full assertion details.

- **pass:** `resolution_rationale` names every competing assertion and explains why the non-preferred ones are less reliable.
- **partial:** Resolution covers the preferred assertion plus one non-preferred but leaves another non-preferred unaddressed.
- **fail:** Resolution names only the preferred assertion and ignores why the others were rejected, or it treats a competing assertion as a settled attribute of the research subject while an unresolved identity conflict covers that assertion's person-link. Until the identity question is answered the competing assertions are not known to describe one person, so the disagreement is not yet established as a conflict at all — resolving over it, without saying so, presents a contingent result as a decided one.
