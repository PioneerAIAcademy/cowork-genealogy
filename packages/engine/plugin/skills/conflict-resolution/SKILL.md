---
name: conflict-resolution
model: claude-sonnet-4-6
allowed-tools:
  - place_search
  - place_search_all
  - place_distance
  - research_append
  - convert_calendar
description: Identifies and resolves conflicting genealogical evidence —
  both fact-level conflicts (three different birthplaces) and identity-level
  conflicts where multiple candidate persons or records genuinely compete
  (two Thomas Flynns in the same county; a 1870 census record that might
  be our subject or a same-named neighbor). Performs source independence
  analysis, applies the GPS preponderance hierarchy, and writes defensible
  resolution rationale. GPS Step 4 — Resolution of Conflicting Evidence.
  Use when the user says "these sources disagree", "resolve this conflict",
  "which source is right?", "why do these records conflict?", "compare
  these assertions", "are there two people with this name?", when
  conflicting assertions exist in research.json, or when timeline
  impossibilities suggest an identity conflict. Do NOT use for
  confidence-calibration review or auditing existing person_evidence
  links — that's person-evidence's territory; conflict-resolution applies
  only when multiple candidate identifications genuinely compete. Do NOT
  use when the user wants to classify evidence (use
  assertion-classification), wants to build a timeline (use timeline), or
  wants to write a conclusion (use proof-conclusion).
---

# Conflict Resolution

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

Identifies, analyzes, and resolves conflicts in the evidence. GPS
Element 4 requires ALL conflicting evidence to be resolved before a
conclusion can be proved. An unresolved conflict acknowledged honestly
is acceptable; an unacknowledged conflict is a GPS violation.

The intellectual process for every conflict: (1) Acknowledge what the
contradictory evidence says, (2) Analyze the reliability of each source
and informant, (3) Explain which version is most likely correct and why
the other exists.

Reference files in `references/`:
- `weighing-evidence.md` — Seven factors, four defensible rationales,
  independence assessment
- `historical-contradictions.md` — Common historical reasons for
  discrepancies (calendar changes, boundary changes, term meanings)
- `resolution-writing.md` — Four-part structure for written resolutions,
  informant analysis protocol

## Two types of conflicts

### Fact-level conflicts

Two or more assertions disagree about a specific fact:
- Birthplace: Ireland (1850 census) vs. Pennsylvania (death certificate)
- Birth year: 1845 (census age) vs. 1843 (delayed birth certificate)
- Surname spelling: Flynn vs. Flyn vs. Flinn

These use `conflict_type: "fact"` and require `disputed_attribute`
(e.g., `birthplace`, `birth_year`, `surname_spelling`).

### Identity-level conflicts

Uncertainty about whether a record refers to the research subject:
- "Is the Patrick Flynn in the 1870 Allegheny County census our
  Patrick Flynn from Schuylkill County?"
- "Are there two Thomas Flynns in this county, or one?"

These use `conflict_type: "identity"` and require `identity_question`.
May have only one assertion in `competing_assertion_ids` (unlike
fact conflicts which require at least two).

## Steps

### 1. Identify conflicts

Read `research.json` assertions, person_evidence, and timelines.
Look for:

**Fact conflicts:**
- Same person, same fact_type, different values. Compare assertions
  linked to the same person_id via person_evidence.
- Use `structured_value` for programmatic comparison where available
  (birth year as number, place as string).

**Identity conflicts:**
- Timeline impossibilities (from the timeline skill) — two events
  that can't belong to the same person
- Same name appearing in multiple records with ambiguous ages or
  locations
- person_evidence entries with `speculative` confidence — these
  are unresolved identity questions

**Already-identified conflicts:**
- Check existing `conflicts[]` for `status: "unresolved"` — these
  need attention

### 2. Create the conflict entry

For each new conflict identified, append it to the `conflicts`
section with `research_append`. Pass the entry in snake_case
**without an id** — the tool assigns the next `c_` id, validates
the whole project, and writes atomically:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "conflicts",
  op: "append",
  entry: {
    "conflict_type": "fact",
    "description": "Patrick Flynn's birth year: 1845 (1850 census, age 5) vs. 1843 (delayed birth certificate)",
    "disputed_attribute": "birth_year",
    "identity_question": null,
    "competing_assertion_ids": ["a_002", "a_025"],
    "independence_analysis": null,
    "weighing_analysis": null,
    "preferred_assertion_id": null,
    "resolution_rationale": null,
    "status": "unresolved",
    "blocks_question_ids": []
  }
})
```

For identity conflicts, use the same call with `conflict_type: "identity"`,
`identity_question` instead of `disputed_attribute`, and a single-entry
`competing_assertion_ids`.

Set `blocks_question_ids` when the unresolved conflict prevents
safe downstream work — e.g., you can't conclude parentage if you
don't know which census records belong to the subject.

If the call returns `{ ok: false, errors }`, the entry was **not**
written — read the errors, fix the entry shape (or the referenced
assertion ids), and call again. Do not retry blindly.

### 3. Analyze source independence (GPS Standard 46)

**The question:** Are the competing sources truly independent, or
do they derive from the same underlying information? Related
information items must be grouped into a unit that gets no more
credibility than its strongest single member.

**Write the analysis as prose.** Independence depends on context —
the same two sources may be independent for one fact but not for
another. Analyze per-conflict, not per-source-pair.

See `references/weighing-evidence.md` for the full independence
checklist and examples.

### 4. Apply the seven weighing factors (GPS Standard 47-48)

Write the `weighing_analysis`. Load `references/weighing-evidence.md`
for the full list of factors and rationales.

Evaluate the seven factors (relevance, record category, format,
informant proximity, directness, consistency, plausibility) for each
side. Focus on the factors that create meaningful differentiation —
not all apply to every conflict.

**After weighing, articulate a defensible rationale (Standard 48).**
The GPS recognizes four defensible rationales for setting aside
evidence on the losing side. If none applies convincingly, the
conflict cannot be resolved (Standard 49).

**Do not mechanically score factors.** Write a narrative argument
that another researcher could evaluate. The goal is a reasoned
explanation, not a point total.

**For identity conflicts involving location-based evidence:** when
evaluating whether two events could belong to the same person, use
`place_search` to resolve each event's location to a standard place name
(the `standardPlace` field), then call
`place_distance({ standardPlace1, standardPlace2 })` with those two names
to get the actual distance in kilometers. Compare the result against era travel norms
(pre-1830: ~30-50 km/day; 1830-1870: rail where available; 1870+:
extensive rail networks). A quantified distance strengthens or
eliminates a travel-impossibility argument far more than a subjective
description of "distant locations."

**For date conflicts that a calendar transition might explain:** when
you suspect the discrepancy is a Julian→Gregorian artifact rather than a
genuine error (see the calendar-change pattern in
`references/historical-contradictions.md`), do not compute the
10/11/12/13-day offset by hand. Call
`convert_calendar({ date, corrections: { julianToGregorianDay: true } })`
on the recorded date and read `applied[].offsetDays` for the
era-appropriate offset. If the two competing dates differ by exactly that
offset, the conflict is an artifact of the calendar switch, not a
substantive disagreement — note that in the weighing analysis. (You still
decide *whether* a calendar correction applies; the tool only does the
arithmetic.)

### 5. Resolve or defer

**If the preponderance is clear:** update the conflict entry with
`research_append`, filling all four resolved fields plus the status on
the same write — the tool enforces the resolved-completeness invariant
(every field non-null) and `preferred_assertion_id ∈
competing_assertion_ids`, validates, and writes atomically:

```
research_append({
  projectPath: "<absolute-path-to-project-directory>",
  section: "conflicts",
  op: "update",
  entryId: "c_002",
  fields: {
    "independence_analysis": "<prose>",
    "weighing_analysis": "<prose>",
    "resolution_rationale": "<four-part prose, see below>",
    "preferred_assertion_id": "a_002",
    "status": "resolved"
  }
})
```

If the call returns `{ ok: false, errors }`, nothing was written —
read the errors (a half-filled "resolved", or a `preferred_assertion_id`
not among the competing set, will be rejected here), correct the
`fields`, and call again. Do not retry blindly.

The `resolution_rationale` must follow the **four-part structure**
(see `references/resolution-writing.md` for full guidance):

1. **State the problem** — What fact is in dispute and why it matters
2. **Lay out the conflicting evidence** — Present each side with its
   source, informant, and plain-language reliability assessment (do
   NOT use technical jargon like "original" or "secondary" — explain
   in terms any reader can evaluate)
3. **Explain which version is more reliable and why** — Cite the
   specific weighing factors and defensible rationale that apply
4. **Explain why the less reliable evidence exists** — Provide a
   historically grounded reason for the error, drawn from the
   *named pattern* in `references/historical-contradictions.md`
   (calendar changes, boundary shifts, age estimation,
   immigration-origin confusion, relationship-term confusion,
   derivative transcription errors) — cite the specific documented
   source class, not a generic "informants make mistakes." Tie it
   to the informant's epistemic position: who provided the fact,
   whether they could have known it firsthand, how much time had
   passed, and what they were likely reporting instead. ("A
   son-in-law reporting a birth he did not witness, decades later,
   from what he was told — where the family's American home was the
   locally familiar answer" is grounded; "the informant was
   probably wrong" is not.)

**Evidence integrity (Standard 43):** Do not trim, tailor, or ignore
evidence to fit a preconception. If the evidence points away from a
preferred answer, the resolution must follow the evidence.

**If more evidence is needed (Standard 49):** Deferral is a
documented finding, not a stopping point — persist it to the
conflict record (a `research_append` `op: "update"` call as above),
not only to your reply. On the same write, fill
`independence_analysis` and `weighing_analysis` with the work you
did (these are required regardless of outcome — you analyzed the
conflict even if you could not resolve it), keep `status:
"unresolved"` and `preferred_assertion_id: null`, and use
`resolution_rationale` to record *why* it cannot yet be resolved
and **which specific record types would be decisive** (e.g., an
1880 census showing continued residence, a city directory entry,
naturalization papers, a marriage or probate record). Naming "we
can't know" without writing the analysis and the decisive-evidence
path is under-delivering. Then recommend returning to
question-selection to create a question targeting that evidence. A
conclusion depending on this conflict cannot be proved until it is
resolved — this is acceptable and honest.

**If the conflict is moot:** Set `status: "moot"` when subsequent
evidence makes the conflict irrelevant (e.g., the disputed person
turned out to be a different individual entirely).

### 6. Handle identity conflicts

Identity conflicts follow the same analysis but with different
resolution patterns:

**Same-name disambiguation protocol:**
1. Treat individuals with the same name as DISTINCT until proven
   otherwise
2. The co-enumeration rule: two persons with the same name on the
   same census page or tax list is definitive evidence of two
   distinct persons
3. Build candidate timelines (use the timeline skill) to test
   whether events cohere into one life
4. Check: do the ages fit? Do the locations make sense? Are there
   impossibilities?

**Do not confirm identity by the absence of an alternative.** Not
finding a competing same-name candidate in a later record is not
positive proof that your subject is the one who remained — the other
person may have moved, died, married into another household, or
simply been missed by the enumerator. Absence of evidence is not
evidence of absence. Confirm a same-name match by *positively*
placing your subject (continuous residence, consistent ages across
records, corroborating relationships or named associates), never by
the alternative candidate's disappearance. If you cannot place your
subject with positive evidence, the conflict is unresolved — defer
and name the record that would decide it.

**Resolution of identity conflicts** (record only the `conflicts`
section here; recommend the owning skill for any person/link work):
- **"These are the same person"** → the record *is* our subject, so
  the assertion whose person-link was in question is now the
  confirmed answer. This resolves the conflict: set
  `status: "resolved"` with that assertion as
  `preferred_assertion_id` and a full `resolution_rationale`. Then
  recommend `person-evidence` to update the person links and
  `hypothesis-tracking` to record the conclusion — do not edit those
  sections here.
- **"These are different persons" (the record is not our subject)**
  → you are rejecting the only assertion in question, so there is no
  assertion to prefer and the conflict cannot be `resolved` under the
  current schema. Keep `status: "unresolved"` with
  `preferred_assertion_id: null`, and document the exclusion — plus
  the evidence that would confirm it — in `resolution_rationale`.
  Recommend `person-evidence` to
  create or separate the GedcomX persons; do not create them here.
- **"Insufficient evidence"** → keep `status: "unresolved"` with
  `preferred_assertion_id: null`, write the `independence_analysis`
  and `weighing_analysis` fields anyway, and name the records that
  would decide it (see "If more evidence is needed" above).

### 7. Present

`research_append` validates the whole project before persisting and
writes nothing on `{ ok: false }`, so a successful write is already
schema-valid — no separate validation pass is needed. Present each
conflict with:
- The competing assertions and their classifications
- The independence analysis
- The weighing analysis
- The resolution (or why it remains unresolved)
- What this means for the research (does it change any hypothesis?
  does it unblock any questions?)

Suggest next steps:
- Resolved conflict → "This conflict is resolved. Would you like
  me to update the hypothesis?" (hypothesis-tracking) or "Ready
  for a proof conclusion?" (proof-conclusion)
- Unresolved → "More evidence is needed to resolve this. Would
  you like me to create a research question targeting [specific
  evidence]?" (question-selection)
- Identity conflict → "Would you like me to build candidate
  timelines to test whether these records are the same person?"
  (timeline)

## Important rules

- **Never ignore a conflict.** GPS Element 4 requires ALL conflicts
  to be addressed. An unresolved conflict is acceptable (with
  explanation); an unacknowledged conflict is a GPS violation.
- **When several conflicts are unresolved at once, address one per
  turn.** If the user asks what to work on first, briefly enumerate
  the open conflicts, then state which one you will resolve and
  *why* — prefer the most foundational (e.g., an identity question
  that determines whose records the others even compare), the one
  that blocks the most downstream questions, or the one with
  evidence actually available to resolve. Then do the full
  independence/weighing/resolution work on **that one conflict
  only**, leaving the others' fields untouched this turn. Resolving
  several in a single pass produces tangled rationale and skips the
  prioritization judgment the user asked for; note the others as
  next steps instead.
- **Do NOT modify `proof_summaries`.** When a conflict resolves and
  a proof summary already exists for the relevant question, updating
  `proof_summaries[].resolved_conflict_ids` (or any other
  proof-summary field) is `proof-conclusion`'s job — not this
  skill's. Add the resolved conflict to the `conflicts` section
  only; in your text reply, recommend the user invoke
  `proof-conclusion` to refresh the affected proof summary.
- **Write only the `conflicts` section.** Do not modify `assertions`,
  `person_evidence`, `sources`, or `tree.gedcomx.json`. If resolving
  a conflict reveals needed changes, report it and recommend the
  owning skill.
- **Independence analysis and weighing are separate steps.** Do not
  skip the independence analysis (Standard 46).
- **A conflict transitions to `resolved` only when fully populated.**
  Setting `status: "resolved"` requires ALL of the following fields
  to be non-null on the same write: `independence_analysis`,
  `weighing_analysis`, `preferred_assertion_id`, and
  `resolution_rationale`. If any is missing — even after thorough
  weighing — leave `status: "unresolved"` and note what's still
  needed. A half-filled "resolved" conflict misrepresents the
  research state downstream (proof-conclusion will treat it as
  decided when it isn't). A `resolved` conflict always names a
  winning assertion in `preferred_assertion_id` — that is the test
  for whether you may set `resolved` at all. If you cannot point to
  one of the `competing_assertion_ids` as the preponderant answer,
  the conflict is not resolved; it is deferred.
- **Consider negative evidence.** The absence of expected information
  can be evidence in a conflict. A will that names all children but
  omits one is negative evidence against that person's membership in
  the family. But a nil search result is NOT negative evidence unless
  the search was reasonably exhaustive and the record should exist.
- **Check assumptions.** When resolving a conflict, distinguish
  fundamental assumptions (people cannot act after death),
  valid-until-contradicted assumptions (mothers conceive between ages
  12 and 49), and unsound assumptions (a man's widow was the mother
  of his children). Unsound assumptions carry zero weight without
  supporting evidence and must not be used to tip a resolution.
- **Consider historical context.** Spelling variation, calendar
  changes, boundary changes, and historical term meanings explain
  many apparent conflicts. See `references/historical-contradictions.md`.
- **Don't merge persons to resolve identity conflicts.** This skill
  identifies and analyzes the conflict. Merging is a conclusion
  (proof-conclusion) and a data operation (tree-edit).
- **Err on the side of leaving conflicts unresolved.** An honest
  "unresolved" is better than a premature resolution (Standard 49).

## Re-invocation behavior

**Writes:** entries in the `conflicts` section of `research.json`
(`c_` ids), and their `status`, `analysis`, and
`preferred_assertion_id` fields. Mutable in place; entries are
superseded with a status field, never deleted.

**On repeat invocation:** updates `status`/`analysis` on an existing
conflict if the underlying assertions or resolution evolved.
Creates a new `c_` entry only for a conflict not already tracked.

**Do not duplicate:** if a conflict between the same set of assertion IDs
already has a `c_` entry, update that entry in place. Do not write
a second `c_` covering the same assertion set.
