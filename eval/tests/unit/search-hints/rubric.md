# Search Hints Rubric

Grading dimensions for search-hints unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

search-hints reviews the FamilySearch hints on one tree person. A hint is a **pending** record match, returned by `person_record_matches` with `status: ["pending"]`. The agent runs in two modes, one per spawn, because it returns once and cannot ask the researcher anything mid-run: **triage** recommends `accept`, `reject` or `not enough information to judge` for each hint and writes nothing; **record** logs one entry per verdict the researcher stated and recommends nothing. Accepted hints flow on to record-extraction through their positive log entries; the agent extracts nothing itself.

Harness note: the fixtures are static. `record_read` returns a fixed persona per hint ark, and `image_transcribe` returns the death certificate's image only for its `imageArk`. Whether `status: ["pending"]` was sent, whether the image was read, and the shape of the log entries are checked deterministically (`eval/harness/validators/test_search_hints.py`); do not re-grade those mechanics here.

## Hint scope

Did the agent review the hints — the pending matches — and only those?

- **pass:** Every hint the agent reviewed is a pending match; an accepted match (already attached) is not presented as a hint to decide. Each hint's FamilySearch confidence is stated. When a person has no hints, saying so plainly is a pass.
- **partial:** The pending hints are reviewed, but an accepted or rejected match is mixed into the list without being told apart, or a hint's confidence is missing.
- **fail:** The agent reviewed accepted matches as if they were hints, invented a hint, or reviewed none of the pending hints it was given.

## Recommendation soundness

Is each recommendation one a careful genealogist would stand behind, and does it say why?

The rules the agent holds: an index-vs-tree disagreement is a reason to read the image, never a reason to reject; a one-field near miss (a date one day off) is weak evidence; FamilySearch's confidence is a triage signal, never the verdict; `not enough information to judge` is a correct answer, not a fallback.

- **pass:** Each recommendation names its deciding facts. A hint whose index disagrees with the tree was checked against its image (when it had one) before any recommendation against it, and the recommendation follows what the image says. A hint too thin to confirm or contradict the tree person gets `not enough information to judge`, with what would decide it.
- **partial:** The recommendations are defensible but the deciding facts are vague, or a near miss is weighed as strong evidence without changing the recommendation.
- **fail:** A hint is recommended for rejection on an index disagreement the image resolves (or on an index disagreement with no image read); a thin hint is forced to accept or reject; a recommendation rests on FamilySearch's confidence alone; or the agent adopts a verdict the delegation pre-stated without checking it.

## Verdict recording

In record mode, does the log say what the researcher decided, and only that?

Score `n/a` on triage tests.

- **pass:** One log entry per decided hint, its outcome following the researcher's verdict (accept → positive, reject → negative) rather than the agent's own view, with notes naming the hint and the verdict as the researcher's. The return gives each accepted hint's ark with its log id. No extraction, no link, no tree edit.
- **partial:** The entries are right but the notes do not say the verdict was the researcher's, or the return omits the accepted hints' log ids.
- **fail:** An entry's outcome contradicts the researcher's verdict, a hint the researcher did not decide is logged as decided, or the agent extracts or links in record mode.
