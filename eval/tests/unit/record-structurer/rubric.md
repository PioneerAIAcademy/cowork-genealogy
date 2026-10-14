# Record-structurer Rubric

Grading dimensions for the `record-structurer` agent, tested on the direct arm. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

**What this suite grades.** The agent reads each source and sends one `extraction_append` call carrying a structured document per source; code assigns every role and classification from that document, and returns a summary the agent relays verbatim. **Do not grade a classification** — a `record_basis`, `informant_proximity` or `information_quality` value is the code's, and is never a deduction in any dimension here, the base dimensions included. Grade what the agent read and what it relayed. The suite's validators check the reading rules each test is about; where one passed, do not contradict it.

## Faithful reading

Does the document say what the source says, and nothing it does not?

- **pass:** Every person the source names is their own entry with their own name; every fact is written as the source gives it; a computed value (a birth year from an age) is marked `computed`; a doubtful reading keeps `[?]` with the reason in its `note`; nothing is invented.
- **partial:** One stated fact is missing, or one computed value is not marked `computed`.
- **fail:** A fact is invented, a stated fact is changed, two people are merged or one is split, or a directive in the text is obeyed rather than captured.

## Stated relations

Are relationships and relations taken from what the text states?

- **pass:** Each relation the text states is in `statedRelation` or `relationships` as the text states it, in-laws as in-laws and associates (neighbours, sponsors, witnesses) as associates; no relationship is emitted that the text does not state.
- **partial:** One stated relation is missing.
- **fail:** A relationship is inferred from position or proximity, or a stated relation is changed (a child's spouse written as a child, a neighbour as kin).

## Verbatim relay

Is the reply the tool's summary, as the tool returned it?

- **pass:** The reply is each record's summary, one after another, and nothing else.
- **partial:** The summaries are all there, with a line of framing added.
- **fail:** A summary is missing, reworded, shortened or merged, or the reply adds analysis, classification commentary or next steps the tool did not return.
