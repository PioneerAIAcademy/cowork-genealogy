---
name: proof-conclusion
model: claude-sonnet-4-6
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
allowed-tools:
  - validate_research_schema
---

# Proof Conclusion

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Writes the GPS Step 5 conclusion — the formal proof that transforms
evidence into a defensible genealogical conclusion.

**Read `references/gps-proof-writing.md` before writing any conclusion.**
It contains the GPS standards, proof vehicle selection tests, writing
standards, and phrasing guidance this skill depends on.

## What this skill produces

1. A `proof_summaries` entry in research.json with:
   - Confidence tier
   - Proof vehicle
   - Self-contained narrative markdown
   - Structured metadata linking to supporting assertions and
     resolved conflicts

2. Updates to `tree.gedcomx.json` (when tier >= probable):
   - Persons: add/update facts with source references
   - Relationships: add ParentChild or Couple with source references
   - Sources: ensure every cited source has a GedcomX `S` entry with
     a finalized citation

3. Updates to `project` in research.json:
   - `updated` timestamp
   - `status: "completed"` when all questions are resolved

## Preconditions

Before writing a proof conclusion, verify:
- Assertions exist for the question (extracted, classified)
- Person_evidence links assertions to persons
- Conflicts related to this question are either resolved or
  acknowledged

**If preconditions are not met:** Tell the user what is missing and
recommend the appropriate skill (assertion-classification,
person-evidence, or conflict-resolution). Do not write a conclusion
with unclassified or unlinked evidence.

**If research is not declared exhaustive:** You may still write a
preliminary conclusion at `probable` or `possible` tier. State
explicitly that the research is ongoing and what additional evidence
would be needed. Preliminary conclusions are valuable — they capture
reasoning and make gaps visible.

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

| Tier | When to use |
|------|-------------|
| **Proved** | ALL five GPS components met. 2+ independent original sources with primary information agree. All conflicts resolved. Research declared exhaustive. |
| **Probable** | Strong evidence with clear preponderance, but one or more GPS components incomplete (fewer independent sources, relies on secondary/indirect evidence, minor gaps, or research not yet exhaustive). |
| **Possible** | Credible hypothesis with some supporting evidence but significant gaps. Viable but requires more research. |
| **Not Proved** | Insufficient evidence to lean toward any conclusion. Question remains open. |
| **Disproved** | Evidence affirmatively refutes the hypothesis. |

**Decision rules:**

- **Unresolved conflicts are a hard block on Proved.** If any
  evidence conflicts with the conclusion and has not been resolved
  (via conflict-resolution), the tier cannot be Proved.
- **Hedging language blocks Proved.** If you find yourself writing
  "suggests" or "appears to be," the tier is Probable at best.
  Proved means stating the conclusion as fact: "Patrick Flynn IS
  the son of Thomas Flynn."
- **When in doubt, tier down.** An honest Probable is better than
  a premature Proved.

### 3. Select the proof vehicle

See `references/gps-proof-writing.md` for the full selection tests
and descriptions. Quick decision rule:

- **Statement** — Can you state the answer in a few cited sentences
  with no need for explanation? Use Statement.
- **Summary** — Need to present multiple sources and show correlation,
  but weight clearly points one direction? Use Summary.
- **Argument** — Significant conflicts, only indirect evidence,
  competing candidates, or a reader would ask "but what about..."?
  Use Argument.

Most conclusions require a Summary or Argument. Statements are rare.

### 4. Write the narrative markdown

The `narrative_markdown` is the **authoritative GPS conclusion**.
If structured fields disagree with the narrative, the narrative
governs.

**The narrative must be self-contained:** readable as a standalone
document without reference to the JSON. It will be uploaded to
FamilySearch as a Memory/Document. No images (it lives in a JSON
string field).

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

**Key writing rules** (see `references/gps-proof-writing.md` for full
guidance):

- **Organize logically, not chronologically.** Present by significance
  or reasoning chain, not the order you found things.
- **Cite inline.** Every factual claim needs a citation.
- **Name informants** when their identity affects weighing.
- **State source classifications explicitly.** The reader should see
  the three-layer analysis without consulting the JSON.
- **Be specific about what was searched** and what was not.
- **Follow the evidence, not preconceptions.** If evidence points
  away from a preferred answer, the conclusion follows the evidence.

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

### 6. Update tree.gedcomx.json (tier >= probable)

When the conclusion reaches `probable` or higher, update the GedcomX
file:

- **Source descriptions:** Ensure every source cited in the proof has
  a GedcomX `S` entry in the `sources` array. A source description has
  exactly these fields — **no others are permitted** (the file is
  validated with `additionalProperties: false`):

  | Field | Required | Notes |
  |-------|----------|-------|
  | `id` | yes | `S` prefix |
  | `title` | yes | Human-readable source title |
  | `citation` | no | Finalized Evidence Explained citation |
  | `author` | no | Creator/agency |
  | `url` | no | URL to the digital source |

  This is the upload step for citations: copy the finalized
  `research.json` `sources[].citation` into each `S` entry's
  `citation` field. Do **not** add a `description`, `notes`, or any
  other field — they fail schema validation.
- **Facts:** Add/update birth, death, etc. on the person with source
  references. Set `primary: true` on the concluded fact.
- **Relationships:** Add ParentChild or Couple relationships with
  source references.
- **Source references:** Set `quality` based on evidence analysis:
  - `3`: Original + primary + direct
  - `2`: Original + secondary/indirect, or derivative + primary
  - `1`: Derivative + secondary, or single uncorroborated source
  - `0`: Authored/unreliable

**If the tier is later revised downward** (new evidence contradicts),
remove concluded facts/relationships via tree-edit.

**Person merging:** If the conclusion confirms two GedcomX persons
are the same individual, invoke tree-edit to execute the merge.
proof-conclusion decides WHETHER to merge; tree-edit does the
mechanical operation.

### 7. Update project status

- Set `project.updated` to today's date
- If ALL questions in the project are `resolved` or
  `exhaustive_declared`, set `project.status` to `completed`

**Read** question statuses to make this decision — do not write them.
Writing the proof does not resolve the question in the schema. Question
status and `resolution_assertion_ids` are owned by question-selection;
leave the `questions` section untouched.

### 8. Validate and present

Call `validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting.

Present to the user:
- The full narrative markdown (formatted)
- The confidence tier and rationale
- What was updated in tree.gedcomx.json (if anything)
- What would advance the tier (if not yet Proved)
- Suggest next steps:
  - More questions to investigate -> question-selection
  - All questions resolved -> "The project is complete."
  - Tier could advance -> "To advance from Probable to Proved, we
    would need [specific evidence]." -> question-selection or
    research-plan

## Important rules

- **The narrative is authoritative.** If narrative and structured
  fields disagree, update the structured fields to match.
- **Never use Proved with hedging.** "Suggests," "indicates,"
  "appears to be" belong at Probable or below.
- **Cite everything.** Uncited factual claims are GPS violations.
- **Acknowledge limitations.** State what was not searched, what
  conflicts remain at lower tiers, what assumptions are being made.
- **Write for replication.** Another researcher reading only this
  narrative should be able to evaluate the conclusion and find the
  same sources.
- **Never fabricate.** A well-written "Not Proved" is better than
  a fabricated "Proved."
- **Do not resolve conflicts here.** If you encounter an unresolved
  conflict during step 1, recommend conflict-resolution before
  writing the conclusion. This skill CHECKS that conflicts are
  resolved; conflict-resolution DOES the resolution.
- **Do not evaluate exhaustiveness here.** Reference the exhaustive
  declaration from question-selection. If it has not been declared,
  note this as a limitation and tier accordingly.
- **Never write to the `questions` section.** This skill writes only
  `proof_summaries` and `project` (status, updated) on research.json,
  plus `persons`/`relationships`/`sources` on tree.gedcomx.json.
  Marking a question resolved is question-selection's job.

## Re-invocation behavior

**Writes:** entries in the `proof_summaries` section of `research.json`
(`ps_` ids) including the `narrative_markdown` and structured
metadata. Also updates `project.status` and `project.updated`. At
tier `probable` or higher, also updates `tree.gedcomx.json` (the
concluded persons, relationships, and facts derived from the proof).

**On repeat invocation:** refines an existing proof summary by `ps_` id if
the underlying evidence or conflict resolution changed. Creates a
new `ps_` entry only for a different research question. When a
proof's tier is revised downward (e.g. from `probable` to
`not_proved`), correspondingly updates `tree.gedcomx.json` to match
— for example, removing a relationship that was added on the basis
of a now-demoted proof.

**Do not duplicate:** if a proof summary for the same research question
already exists, update that `ps_` in place. Never write a second
proof summary for the same question.
