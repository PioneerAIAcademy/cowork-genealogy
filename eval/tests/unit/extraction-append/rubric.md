# Extraction-append Rubric

Grading dimensions for the test-only `extraction-append` skill, which drives the indexed-record suite. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**What this suite grades.** The skill makes one `extraction_append` call and relays what it returns. Roles, the three classification layers, and every assertion are decided in code, and the `expected_classifications` validator checks them deterministically. **Do not grade a classification** — a `record_basis`, `informant_proximity` or `information_quality` value is the code's, not the model's, and is never a deduction in any dimension here, the base dimensions included. Grade the call and the relay.

## The call

Did the skill make exactly one `extraction_append` call carrying what the message named?

- **pass:** One call. `recordIds` holds every FamilySearch record id or ARK the message names, in order; `questionIds` carries any question id the message names; a person the message says was expected on a named record and is not there is in `absentPersons` with that record's `recordId`. For a nil search with no record, the call sends `absences` citing the search's log entry instead of `recordIds`.
- **partial:** One call, but a named id, question id or absent person is missing from it.
- **fail:** No call; more than one call; or a call that carries an id the message never named.

## Verbatim relay

Is the reply each record's `summary`, as the tool returned it?

- **pass:** The reply is the summaries, one after another, and nothing else.
- **partial:** The summaries are all there, with a line of framing added before or after them.
- **fail:** A summary is missing, reworded, shortened, or merged; or the reply adds analysis, classification commentary, or next steps the tool did not return.

## No self-authored writes

Did the skill leave the project's writes to the tool?

- **pass:** The only write is the one `extraction_append` call.
- **partial:** The only write is the one `extraction_append` call, but the skill also made a read it did not need (`record_read`, `research_query`) before it.
- **fail:** The skill called any other writer (`research_append`, `research_log_append`, `tree_edit`, …).
