---
name: proof-conclusion
description: Writes GPS-conformant proof conclusions — selects the
  confidence tier (Proved/Probable/Possible/Not Proved/Disproved), chooses
  the proof vehicle (Statement/Summary/Argument), and produces a
  self-contained narrative markdown that can be uploaded to FamilySearch.
  Updates tree.gedcomx.json when the tier reaches probable or higher.
  GPS Step 5 — Soundly Reasoned, Coherently Written Conclusion. Use when
  the user says "write the conclusion", "what's the proof?", "summarize
  the evidence", "write a proof statement", "write a proof argument",
  "conclude this question", when assertions and person_evidence exist for
  a question, or when a hypothesis reaches supported status. Do NOT use
  when the user wants to resolve a conflict (use conflict-resolution),
  wants to select the next question (use question-selection), or wants to
  classify evidence (use assertion-classification).
---

# Proof Conclusion

Writes the GPS Step 5 conclusion — the formal proof that transforms
evidence into a defensible genealogical conclusion. This is the
culminating skill in the research cycle. Everything upstream (search,
extraction, classification, person-evidence, timeline, conflict
resolution, hypothesis tracking) feeds into this skill's output.

## What this skill produces

1. A `proof_summaries` entry in research.json with:
   - Confidence tier
   - Proof vehicle
   - Self-contained narrative markdown
   - Structured metadata linking to supporting assertions and
     resolved conflicts

2. Updates to `tree.gedcomx.json` (when tier ≥ probable):
   - Persons: add/update facts with source references
   - Relationships: add ParentChild or Couple with source references
   - Sources: ensure all cited sources have GedcomX descriptions

3. Updates to `project` in research.json:
   - `updated` timestamp
   - `status: "completed"` when all questions are resolved

## Preconditions

Before writing a proof conclusion, verify:
- Assertions exist for the question (extracted, classified)
- Person_evidence links assertions to persons
- Conflicts related to this question are either resolved or
  acknowledged
- Ideally `exhaustive_declaration.declared` is true — but
  preliminary conclusions at `probable` or `possible` are valid
  for `in_progress` questions

## Steps

### 1. Gather the evidence

Read research.json for the target question:
- All assertions linked to the question via
  `extracted_for_question_ids`
- Person_evidence entries for those assertions
- Resolved conflicts related to this question
- Hypotheses related to this question (via `related_question_ids`)
- The exhaustive declaration (if declared)
- The timeline for the subject

### 2. Select the confidence tier

| Tier | Criteria |
|------|----------|
| **Proved** | 2+ independent original sources with primary information agree. All conflicts resolved. Research declared exhaustive. No hedging language permitted — state the conclusion as fact. |
| **Probable** | Strong evidence exists with a clear preponderance, but either: (a) fewer than 2 independent original-primary sources, (b) relies on secondary/indirect evidence, (c) a minor conflict or gap remains, or (d) research is not yet declared exhaustive. |
| **Possible** | A credible hypothesis with some supporting evidence, but significant gaps remain. The conclusion is viable but requires more research. |
| **Not Proved** | Insufficient evidence to lean toward any conclusion. The research has been attempted but the question remains open. |
| **Disproved** | Evidence affirmatively refutes the hypothesis. The conclusion is that the claim is false. |

**Critical rule:** Do NOT use `Proved` with hedging language. If the
tier is Proved, write "Patrick Flynn IS the son of Thomas Flynn" —
not "the evidence suggests" or "it appears likely." Hedging belongs
at the Probable tier.

### 3. Select the proof vehicle

| Vehicle | When to use |
|---------|------------|
| **Statement** | Direct evidence from high-quality sources with no conflicts. 2+ independent sources agree. Simple, clean case. Short format — a paragraph with citations. |
| **Summary** | Multiple sources with minor resolved conflicts or reliance on indirect evidence. Needs more explanation than a statement but doesn't require full narrative argumentation. Bullet-point evidence summary with brief resolution notes. |
| **Argument** | Complex cases involving indirect evidence, negative evidence, competing candidates, identity resolution, or significant resolved conflicts. Requires narrative reasoning that walks the reader through the logic. Full essay format with sections. |

Most real-world genealogy conclusions require a **Summary** or
**Argument**. Statements are reserved for straightforward cases.

### 4. Write the narrative markdown

The `narrative_markdown` is the **authoritative GPS conclusion**.
The structured fields (tier, vehicle, supporting_assertion_ids) are
metadata about it — if they disagree, the narrative governs.

**The narrative must be self-contained:** readable as a standalone
document without reference to the JSON. It will be uploaded to
FamilySearch as a Memory/Document. It cannot include images (it
lives in a JSON string field).

**Structure by vehicle:**

#### Proof Statement

```markdown
## [Conclusion Title]

[Person] is [Proved/Probable] to be [conclusion].

[1-2 sentences citing the key evidence with inline citations.]

### Citations
1. [Full citation 1]
2. [Full citation 2]
```

#### Proof Summary

```markdown
## [Conclusion Title]

[Person] is [tier] [conclusion].

### Evidence Summary

[Numbered list of evidence lines, each with:]
1. **[Source title]** ([Source classification]). [What it shows].
   [Information quality and evidence type]. [Informant analysis
   if relevant.]

### Conflict Resolution (if applicable)

[Brief explanation of any resolved conflicts and the rationale.]

### Assessment

[Why this tier was chosen. What would advance it to the next tier.]

### Citations
1. [Full citation 1]
2. [Full citation 2]
```

#### Proof Argument

```markdown
## [Conclusion Title]

[Person] is [tier] [conclusion].

### Research Question

[State the specific question being answered.]

### Evidence Summary

[Each evidence line, organized by source, with full three-layer
analysis for each.]

### Conflict Resolution

[Detailed analysis of each conflict — independence, weighing,
rationale. This section is the heart of the argument.]

### Elimination of Alternatives (if applicable)

[For competing candidates: which were ruled out and why.]

### Negative Evidence (if applicable)

[Any meaningful absences and their analytical significance.]

### Assessment

[Full reasoning for the tier. What the evidence collectively proves.
What gaps remain. What would change the conclusion.]

### Citations
[Numbered list of all sources cited in the narrative.]
```

**Narrative writing rules:**

- **Cite inline.** Use superscript numbers or parenthetical
  references (e.g., "the 1860 census¹ lists Patrick as Thomas's
  son"). Every factual claim needs a citation.
- **Name the informant.** When the informant's identity matters
  for weighing (and it usually does), name them: "The death
  certificate, with James Brown (son-in-law) as informant..."
- **State classifications explicitly.** "Original source, primary
  information, direct evidence" or "derivative source, secondary
  information, indirect evidence." The reader should see the
  three-layer analysis without consulting the JSON.
- **Resolve conflicts explicitly.** Don't ignore rejected evidence.
  Explain why it was set aside: "The death certificate birthplace
  of 'Pennsylvania' is rejected because..."
- **Be specific about exhaustiveness.** Reference what was searched
  and what wasn't: "Searched 1850 and 1860 censuses, death
  certificate, and probate records. The 1870-1900 censuses were
  not searched."

### 5. Write the proof_summaries entry

```json
{
  "id": "ps_001",
  "question_id": "q_001",
  "tier": "probable",
  "vehicle": "summary",
  "supporting_assertion_ids": ["a_004", "a_010", "a_013"],
  "resolved_conflict_ids": ["c_001"],
  "exhaustive_search_summary": "Searched 1850 census (FamilySearch, Ancestry), 1860 census (FamilySearch), death certificate (FamilySearch), probate records (FamilySearch, Ancestry). Three independent sources confirm parentage. 1870-1900 censuses not yet searched.",
  "narrative_markdown": "## Parentage of Patrick Flynn...\n\n..."
}
```

### 6. Update tree.gedcomx.json (tier ≥ probable)

When the conclusion reaches `probable` or higher, update the GedcomX
file to reflect the concluded state:

**Add/update facts:**
- If the conclusion establishes a birth date/place, add or update
  the Birth fact on the person with source references
- Set `primary: true` on the concluded fact

**Add relationships:**
- If the conclusion establishes parentage, add a ParentChild
  relationship with source references on the relationship
- Include `quality` scores on source references based on the
  three-layer classification

**Add source references:**
- Every fact and relationship added should have source references
  pointing to the sources that support the conclusion
- Set `quality` based on the evidence analysis:
  - `3`: Original + primary + direct
  - `2`: Original + secondary/indirect, or derivative + primary
  - `1`: Derivative + secondary, or single uncorroborated source
  - `0`: Authored/unreliable

**If the tier is later revised downward** (e.g., new evidence
contradicts the conclusion and the tier drops to `not_proved`),
remove the concluded facts/relationships from tree.gedcomx.json.
This is done via the tree-edit skill.

**Person merging:** If the conclusion confirms two GedcomX persons
are the same individual, invoke tree-edit to execute the merge.
proof-conclusion decides WHETHER to merge; tree-edit does the
mechanical operation.

### 7. Update project status

- Set `project.updated` to today's date
- If ALL questions in the project are `resolved` or
  `exhaustive_declared`, set `project.status` to `completed`

### 8. Validate and present

Invoke `validate-schema` after all writes.

Present to the user:
- The full narrative markdown (formatted)
- The confidence tier and rationale
- What was updated in tree.gedcomx.json (if anything)
- What would advance the tier (if not yet Proved)
- Suggest next steps:
  - More questions to investigate → "Would you like me to select
    the next research question?" (question-selection)
  - All questions resolved → "The project is complete. All research
    questions have been answered."
  - Tier could advance → "To advance from Probable to Proved, we
    would need [specific evidence]. Would you like me to plan that
    research?" (question-selection or research-plan)

## Preliminary conclusions

Proof summaries may be written for questions at ANY status —
including `in_progress`. A preliminary conclusion:
- Captures the current state of evidence
- Forces articulation of what's known and what's missing
- Has a tier that reflects the incomplete research (typically
  `probable` or `possible`, not `proved`)
- May be revised as new evidence arrives

Encourage preliminary conclusions — they drive the research forward
by making gaps visible.

## Important rules

- **The narrative is authoritative.** If the narrative and structured
  fields disagree, the narrative governs. Update the structured fields
  to match.
- **Never use Proved with hedging.** "Suggests," "indicates,"
  "appears to be" — these belong at Probable or below. Proved means
  stating the conclusion as established fact.
- **Cite everything.** Every factual claim in the narrative needs an
  inline citation. Uncited claims are GPS violations.
- **Acknowledge limitations.** State what wasn't searched, what
  conflicts remain at lower tiers, what assumptions are being made.
  Transparency about limitations is a GPS requirement, not a weakness.
- **Write for replication.** Another researcher reading only this
  narrative should be able to evaluate the conclusion and find the
  same sources. That's the GPS standard for credibility.
- **Never fabricate.** If the evidence doesn't support a conclusion,
  say so. A well-written "Not Proved" is better than a fabricated
  "Proved."
