# Research Plan Rubric

Grading dimensions for research-plan unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Record type selection

Did the plan target appropriate record types for the research question? Census, vital, probate, church, and land records each answer different questions — the plan should select based on what information is needed.

- **pass:** Every plan item's `record_type` matches the question's information need (probate for parentage; vital for life events; land for community context); rationale explains why each record type was chosen.
- **partial:** Plan items target reasonable record types but at least one rationale is generic ("more records would help") without naming what specific information the type provides.
- **fail:** Plan items target record types that wouldn't advance the question (e.g., land records when no property is implied; church records in a jurisdiction where they aren't kept).

## Sequencing logic

Are plan items ordered logically? Free/indexed sources before paid/unindexed. Broad searches before narrow. Fallbacks identified for items that might fail.

- **pass:** `sequence` numbers reflect a defensible search order (free/indexed first, fallback chains explicit via `fallback_for`), and the rationale on each item explains its placement.
- **partial:** Order is mostly reasonable but one item is out of sequence (paid before free, narrow before broad), or fallbacks aren't identified.
- **fail:** Sequence is arbitrary; no logic visible across `sequence` numbers; no `fallback_for` chain even when sources are likely to fail.

## Jurisdiction accuracy

Are the jurisdictions correct for the time period? County boundaries, state formations, and jurisdiction changes over time must be accounted for.

- **pass:** Jurisdictions match what existed in the target period (county-level when records were kept at county; pre-statehood jurisdictions for territorial periods).
- **partial:** Modern jurisdictions named correctly but historical boundary changes that affect record location are missed.
- **fail:** Jurisdictions don't exist in the target period, or the skill recommends searching in a state before it had statehood records.
