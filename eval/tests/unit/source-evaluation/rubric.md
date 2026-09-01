# Source Evaluation Rubric

Grading dimensions for source-evaluation unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**Grading constraints (read before scoring any dimension).** You do not have direct access to the scenario's `research.json` or `tree.gedcomx.json`. Your only sources of truth are the scenario README, the user message, the skill's tool calls and the tool responses returned, and the skill's final text response.

Do not assert that a fact is or is not in the tree, in a source, or in any record unless a tool response or the scenario README says so verbatim. This applies symmetrically: do not deduct because the skill missed something you cannot verify, and do not credit it for matching something you cannot verify. When the skill cites a value from a tool response, grade whether the citation matches that response. When it asserts something present in no tool response and no README, that is a Correctness deduction — the skill invented it.

## Remediation doctrine

The core of the skill. When a source disagrees with the profile, does the recommended remedy match the kind of disagreement? An indexing or transcription error — one field wrong in a record that otherwise fits the person — is fixed by re-reading the original image and correcting the index, with the source left attached. Detaching is correct only for a source genuinely about a different person.

- **pass:** Every index-error finding recommends re-reading the original and correcting the index, and none recommends detaching, unlinking, removing or flagging the source. Where a source really is about another person, detaching is recommended and the reason names whose record it is.
- **partial:** The re-read remedy is given but hedged with a detach alternative for an index error; or the misattributed source is correctly identified but the recommendation stops at "this doesn't belong" without saying where it does.
- **fail:** Detaching, unlinking or flagging is recommended for a source whose disagreement is a single mis-transcribed field. This is the failure issue #1606 was filed on and it is a fail even when everything else in the report is right.
- **N/A:** No disagreement was found between any source and the profile. Score `null`.

## Classification before recommendation

Does the skill decide *what kind* of finding it has before saying what to do about it, and does it name the cue that decided it? The distinction that matters is one field disagreeing (index error) versus the record describing a different life altogether (misattribution).

- **pass:** Each finding carries an explicit classification and the evidence for it — "everything else fits: the township, the wife, the son" or "born 1852 against 1875, a different county, a wife and children who are not this family's".
- **partial:** Findings are classified but at least one classification is asserted without the cue, so a reader cannot check it.
- **fail:** Findings are reported as undifferentiated errors with a recommendation attached to each, or the classification contradicts the record the tool returned.
- **N/A:** No findings. Score `null`.

## Signal versus backend noise

Does the report separate what the researcher can act on from FamilySearch storage artifacts? Repeated internal fact, name and person ids across unrelated records are how the system numbers things, not defects. The tester's words in feedback case #1536: *"Having the metadata errors brought to my attention was not helpful."*

- **pass:** The findings list and the stated count contain only user-actionable items. Backend artifacts are absent, or appear once as closing context with no action attached.
- **partial:** Backend artifacts stay out of the numbered findings but the count or the framing still implies they are problems.
- **fail:** A backend artifact appears as a numbered finding, carries a recommended action, or is counted among the errors — the researcher is handed the triage the skill was supposed to do.
- **N/A:** Nothing in the tool responses could be mistaken for a backend artifact. Score `null`.

## Coverage and honesty about what was not checked

Every attached source is either read and judged, or reported as unreadable with the reason. A source that could not be read is never reported as clean.

- **pass:** Each attached source is accounted for. Sources with no record ARK — uploaded documents, memories, external links — are named as unchecked with the reason.
- **partial:** All readable sources are judged, but the unreadable ones are omitted from the report rather than named.
- **fail:** A source is described as clean, or as supporting a fact, without a tool response behind it; or attached sources go unmentioned with no explanation.

## Read-only discipline

The skill audits and reports. It writes nothing and fixes nothing.

- **pass:** No write tool is called, and the report is phrased as recommendations the researcher can act on.
- **partial:** Nothing is written, but the report claims an action as done ("I've corrected the birth year") rather than recommending it, so a reader cannot tell what state actually changed.
- **fail:** The skill writes to `research.json` or the tree, or claims to have detached or repaired something itself.
