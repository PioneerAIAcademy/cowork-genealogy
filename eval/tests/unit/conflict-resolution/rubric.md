# Conflict Resolution Rubric

Grading dimensions for all conflict-resolution unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Source independence analysis

Did the skill assess whether competing sources are truly independent? Two derivative indexes of the same original are not independent. Two census records with different enumerators but the same household informant may not be fully independent for the facts that informant reported. The analysis must be specific to the conflict's fact type, not a generic statement about the sources.

- **pass:** `independence_analysis` names the specific informants and records involved, and explains whether they share an information chain for the disputed fact.
- **partial:** Independence is asserted but reasoning is generic ("the sources are independent because they're different documents") without inspecting the informant chain.
- **fail:** No independence analysis, or independence claimed where a shared informant clearly undermines it.

## Evidence weighing

Did the skill apply the GPS preponderance hierarchy? Original sources outweigh derivative. Primary information outweigh secondary. Contemporary recordings outweigh later recollections. Direct evidence outweighs indirect. The weighing must cite specific attributes of the competing assertions (informant proximity, temporal distance, source classification), not just state the hierarchy abstractly.

- **pass:** `weighing_analysis` cites specific assertion attributes (informant proximity, temporal distance, source classification) and applies the preponderance hierarchy to them.
- **partial:** Weighing is applied but invokes the hierarchy abstractly without grounding in the specific assertions' attributes.
- **fail:** No weighing analysis, or hierarchy is applied incorrectly (later recollection preferred over contemporary recording without justification).

## Resolution completeness

Did the resolution address ALL competing assertions, not just the two most obvious? A conflict with three competing assertions requires explaining why each non-preferred assertion is less reliable, not just why the preferred one is best. The resolution rationale must be specific enough that a reviewer can understand the reasoning without reading the full assertion details.

- **pass:** `resolution_rationale` names every competing assertion and explains why the non-preferred ones are less reliable.
- **partial:** Resolution covers the preferred assertion plus one non-preferred but leaves another non-preferred unaddressed.
- **fail:** Resolution names only the preferred assertion and ignores why the others were rejected.
