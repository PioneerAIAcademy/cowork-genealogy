# Research Plan Rubric

Grading dimensions for research-plan unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Record type selection

Did the plan target appropriate record types for the research question? Census, vital, probate, church, and land records each answer different questions — the plan should select based on what information is needed.

- **pass:** Every plan item's `record_type` matches the question's information need (probate for parentage; vital for life events; land for community context); rationale explains why each record type was chosen.
- **partial:** Plan items target reasonable record types but at least one rationale is generic ("more records would help") without naming what specific information the type provides.
- **fail:** Plan items target record types that wouldn't advance the question (e.g., land records when no property is implied; church records in a jurisdiction where they aren't kept).

## Objective scope containment

Do the plan items stay inside the question's scope? A FAN item earns its place by what it would reveal about the **question's subject**, not by a relative's presence in the tree — so this dimension grades the purpose each item serves, not how many relatives it touches.

- **pass:** Every item's rationale ties it to evidence about the question's subject. Where an item targets a relative's records (a parent's marriage, a witness, a neighbor), the rationale states what it would reveal about the subject. No item's deliverable is a relative's own missing facts.
- **partial:** An item is defensible on its face but its rationale leaves the link implicit — it names a relative's record without saying what that record would show about the subject.
- **fail:** One or more items pursue a relative's own record for its own sake — the spouse's birth date, a child's baptism, "restore the wife's records" — or a FAN item appears with no stated bearing on the subject, i.e. a quota filled rather than a purpose served.

## Sequencing logic

Are plan items ordered logically? Free/indexed sources before paid/unindexed. Narrow before broad — the specific county before adjacent counties. A contingency is required only where the lead's 2026-11-20 ruling requires one: a church or probate item whose source may be unavailable, missing or unindexed needs a persisted contingency that says why the primary may fail. A FamilySearch alternative (another indexed collection, a variant name, a neighbouring index) may sit in that item's own `rationale`. An image browse, an archive, a courthouse or another site must be its own item linked by `fallback_for`; the same alternative left in prose, or named only in the reply, counts as no contingency. An item whose source is indexed and expected to hold the subject has no fallback requirement, so a plan is not docked for leaving such an item without `fallback_for`; the contingency clauses in the pass, partial and fail lines below apply only to the items this rule covers, so a census, immigration, naturalization or vital-record item is not docked for lacking one. Grade the plan as finally persisted: a `fallback_for` link the agent corrected before returning is not an error. A `fallback_for` item a test's own judge_context requires (such as a paid-repository item linked to its free primary for the same year) is still graded as that test says. Beyond efficiency, the order must respect evidence dependency: a record that *supplies* an identifier the subject cannot yet be searched by (a maiden name, an unknown given name, an unlocated residence) comes before records that *use* it; a gap between two anchors is bridged by the record in between rather than assumed; and the plan's `date_range`s reach the later part of the question's window, not only its start. Putting a census year that records each person's relationship to the head (a US federal census of 1880 or later, or another country's census whose schedule records it) before an earlier year is a defensible order, per the agent body's Step 4 principle 10; chronological order is not graded.

- **pass:** `sequence` numbers reflect a defensible search order (free/indexed first, narrow before broad), every item the contingency rule above covers carries its persisted contingency (a FamilySearch alternative in its rationale, or an off-FamilySearch alternative as its own `fallback_for` item), and the rationale on each item explains its placement. No item waits on evidence only a later item can produce, and where the question supplies a birth estimate and a death or last-known date, some item's `date_range` reaches the later part of that window. Where neither a missing identifier nor a gap applies, the dependency and intervening-link checks are N/A.
- **partial:** Order is mostly reasonable but one item is out of sequence (paid before free, broad before narrow), an item whose source may be unavailable or unindexed carries no persisted contingency (a FamilySearch alternative in its rationale, or an off-FamilySearch alternative as its own `fallback_for` item), or the `date_range`s cover only the start of the question's window.
- **fail:** Sequence is arbitrary; no logic visible across `sequence` numbers; no persisted contingency on any church or probate item even when its source is likely to fail (no `fallback_for` item for an off-FamilySearch alternative, and no FamilySearch alternative in the item's rationale); or an item is conditioned on an identifier that no earlier item can supply, or continuity across a gap is asserted from name, place and approximate age alone with no bridging record planned.

## Jurisdiction accuracy

Are the jurisdictions correct for the time period? County boundaries, state formations, and jurisdiction changes over time must be accounted for.

- **pass:** Jurisdictions match what existed in the target period (county-level when records were kept at county; pre-statehood jurisdictions for territorial periods).
- **partial:** Modern jurisdictions named correctly but historical boundary changes that affect record location are missed.
- **fail:** Jurisdictions don't exist in the target period, or the skill recommends searching in a state before it had statehood records.

## Plan mode and lifecycle

Did the skill choose the correct plan mode for the project's current state — review an existing active plan, add a new plan after the prior one is completed, supersede an active plan when new information invalidates it, or dispose of the planned items research-exhaustiveness named when it refused a declaration — and preserve the audit trail? Completed and superseded plans (and their items) are the record of what was done and must never be edited in place; at most one plan may be `active` per research question. When there is no prior plan to act on (a first plan for the question) or the skill correctly declines to plan, this dimension is N/A.

- **pass:** The mode matches the project state — review when an active plan still has unfinished items and the request is a recap or ambiguous; add-new when the most recent plan is fully completed but the question isn't yet proved; supersede when new information invalidates an active plan's assumptions; dispose when research-exhaustiveness refused a declaration over named `planned` items (each becomes `completed` if its search was logged, otherwise `skipped` with a `skip_category`, and nothing else changes). Setting a named planned item's status in Dispose mode is the mode working, not an in-place edit. Prior plan items are left intact as the audit trail, and exactly one plan stays `active` for the question (an old active plan is set to `superseded` before a new active plan is written).
- **partial:** The right mode is chosen but a lifecycle step is mishandled — e.g., a new plan is created without setting the prior active plan's `status` to `superseded`, or review mode narrates correctly but also edits an existing item.
- **fail:** The wrong mode is chosen — a duplicate plan is created alongside a still-usable active one, an existing or superseded plan's items are modified in place, or two `active` plans are left for the same question.
