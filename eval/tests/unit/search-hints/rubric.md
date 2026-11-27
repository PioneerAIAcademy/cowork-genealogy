# Search Hints Rubric

Grading dimensions for search-hints unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

search-hints reviews the FamilySearch hints on one tree person. A hint is a **pending** record match at confidence 4 or 5, returned by `person_record_matches` with `status: ["pending"]` and `minConfidence: 4`. The agent runs in two modes, one per spawn: **review** decides `accept`, `reject` or `not enough information to judge` for each hint itself and logs each accept and reject; **record** logs one entry per verdict the researcher stated, overruling any earlier decision, and decides nothing. Accepted hints flow on to extraction through their positive log entries; the agent extracts nothing itself.

Harness note: the fixtures are static. `record_read` returns a fixed persona per hint ark, and `image_transcribe` returns the death certificate's image only for its `imageArk`. Whether `status: ["pending"]` and `minConfidence: 4` were sent, whether the image was read, whether a hint the project already linked reads `already linked by <pe_ id>`, and the shape of the log entries are checked deterministically (`eval/harness/validators/test_search_hints.py`); do not re-grade those mechanics here.

### Tool Arguments: the hints listing's own arguments are no deduction

The agent's instructions list the hints with `person_record_matches({ id, status: ["pending"], minConfidence: 4 })`. On that call `status: ["pending"]` and `minConfidence: 4` are both required arguments, not noisy extra ones, whether or not the fixture's `expected_args` lists them: a fixture matches on a subset of the arguments, and some match on `id` alone. Neither is ever the reason for a Tool Arguments deduction, of any size; grade that call's other arguments, and the other calls, as usual. Whether they were sent is checked deterministically (above), so do not re-grade it here. A `research_log_append` entry (or `ops[]` element) whose `tool` field reads `person_record_matches` is a log write, not the listing: a `query` that repeats the listing's `status` or `minConfidence`, or leaves them out, is no deduction either.

## Hint scope

Did the agent review the hints — the pending matches — and only those?

- **pass:** Every hint the agent reviewed is a pending match; a match FamilySearch already lists as accepted is not presented as a hint to decide. A pending hint whose record this project already linked is still a hint: listing it as `already linked by <pe_ id>` with no recommendation is correct. Each hint's FamilySearch confidence is stated. When a person has no hints, saying so plainly is a pass.
- **partial:** The pending hints are reviewed, but an accepted or rejected match is mixed into the list without being told apart, or a hint's confidence is missing.
- **fail:** The agent reviewed accepted matches as if they were hints, invented a hint, or reviewed none of the pending hints it was given.

## Recommendation soundness

Is each decision one a careful genealogist would stand behind, and does it say why?

The rules the agent holds: an index-vs-tree disagreement is a reason to read the image, never a reason to reject; a one-field near miss (a date one day off) is weak evidence; FamilySearch's confidence is a triage signal, never the verdict; `not enough information to judge` is a correct answer, not a fallback.

When a hint's record has no page image, its index is the only evidence the agent can read. An index is derivative, an indexer's transcription of the original, so saying "index only" or "no image read" is an accurate and appropriate caveat, even when the index lists household members or relationships: those are part of the transcription too. It must not reduce Correctness or Recommendation soundness.

- **pass:** Each recommendation names its deciding facts. A hint whose index disagrees with the tree was checked against its image (when it had one) before any recommendation against it, and the recommendation follows what the image says. A hint too thin to confirm or contradict the tree person gets `not enough information to judge`, with what would decide it.
- **partial:** The recommendations are defensible but the deciding facts are vague, or a near miss is weighed as strong evidence without changing the recommendation.
- **fail:** A hint is recommended for rejection on an index disagreement the image resolves (or on an index disagreement with no image read); a thin hint is forced to accept or reject; a recommendation rests on FamilySearch's confidence alone; or the agent adopts a verdict the delegation pre-stated without checking it.

## Verdict recording

Does the log say what was decided, and only that? In review mode the decisions are the agent's own; in record mode they are the researcher's.

Score `n/a` on a test where no hint could be read or none was pending.

- **pass:** One log entry per newly accepted or rejected hint, its outcome following the decision (accept → positive, reject → negative); in record mode the researcher's verdict rather than the agent's own view, with notes saying the verdict is the researcher's. A hint not enough to judge, already linked, or accepted when the project already holds its record is not logged. The return gives each accepted hint's ark with its log id. No extraction, no link, no tree edit.
- **partial:** The entries are right but the notes do not say whose verdict it was, or the return omits the accepted hints' log ids.
- **fail:** An entry's outcome contradicts the decision it records, a hint nobody decided is logged as decided, the review asks the researcher to decide instead of deciding, or the agent extracts or links.
