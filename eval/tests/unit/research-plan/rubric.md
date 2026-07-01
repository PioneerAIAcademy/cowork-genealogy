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

## Plan mode and lifecycle

Did the skill choose the correct plan mode for the project's current state — review an existing active plan, add a new plan after the prior one is completed, or supersede an active plan when new information invalidates it — and preserve the audit trail? Completed and superseded plans (and their items) are the record of what was done and must never be edited in place; at most one plan may be `active` per research question. When there is no prior plan to act on (a first plan for the question) or the skill correctly declines to plan, this dimension is N/A.

- **pass:** The mode matches the project state — review when an active plan still has unfinished items and the request is a recap or ambiguous; add-new when the most recent plan is fully completed but the question isn't yet proved; supersede when new information invalidates an active plan's assumptions. Prior plan items are left intact as the audit trail, and exactly one plan stays `active` for the question (an old active plan is set to `superseded` before a new active plan is written).
- **partial:** The right mode is chosen but a lifecycle step is mishandled — e.g., a new plan is created without setting the prior active plan's `status` to `superseded`, or review mode narrates correctly but also edits an existing item.
- **fail:** The wrong mode is chosen — a duplicate plan is created alongside a still-usable active one, an existing or superseded plan's items are modified in place, or two `active` plans are left for the same question.
