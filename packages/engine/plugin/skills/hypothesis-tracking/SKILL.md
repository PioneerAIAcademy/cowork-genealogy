---
name: hypothesis-tracking
description: >-
  Creates, updates, and reviews hypotheses about person identity, parentage,
  and relationships. Links supporting and contradicting assertions, manages
  status transitions (active → supported → ruled_out), tracks competing
  candidates, and summarizes hypothesis status. GPS Step 3-4 — Analysis,
  Correlation, and Resolution. Use when the user says "I think [claim]",
  "track this hypothesis", "could this be [candidate]?", "are there competing
  candidates?", "update the hypothesis", "rule this out", "where do hypotheses
  stand?", "review the hypotheses", "summarize hypothesis status", "add
  [person] as a candidate", "add a third candidate", when competing identity
  candidates exist, when a conflict suggests multiple possible explanations,
  or when the user wants to organize or review evidence for and against a
  claim. Do NOT use when the user wants to resolve a specific fact conflict
  (use conflict-resolution), wants to build a timeline (use timeline), or
  wants to write a final conclusion (use proof-conclusion).
allowed-tools:
  - research_append
  - validate_research_schema
---

## Step 0 — Scope gate (MANDATORY, before any file reads)

Classify the user's request into exactly one category:

| Request pattern | Classification | Action |
|---|---|---|
| "resolve this conflict", "weigh these assertions", "choose between", "which is correct" | **conflict-resolution** | Reply: "This is a conflict-resolution task — please use the conflict-resolution skill." Then STOP. |
| "build a timeline", "create a timeline" | **timeline** | Reply: "This is a timeline task — please use the timeline skill." Then STOP. |
| "write a proof", "proof conclusion", "write the conclusion" | **proof-conclusion** | Reply: "This requires proof-conclusion — please use the proof-conclusion skill." Then STOP. |
| Anything about creating, updating, reviewing, or tracking hypotheses | **in scope** | Proceed below. |

If the classification is NOT "in scope": output the one-sentence reply shown above and **produce no other output** — no file reads, no tool calls, no analysis. This is a hard constraint, not a suggestion.

# Hypothesis Tracking

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**All writes to the `hypotheses` section go through `research_append`** — it assigns the `h_` id, validates before persisting, and writes atomically. On `{ ok: false, errors }` it writes nothing — surface those errors and fix the input rather than retrying blindly.

**Call `validate_research_schema` at the end of every interaction** — including read-only reviews. This is mandatory.

**Read-only detection:** If the user asks for a summary, review, or
status check without requesting changes ("where do things stand?",
"give me a quick summary"), this is a **read-only review**. Present
the hypothesis states, note any issues you see, but do NOT modify
`research.json` or `tree.gedcomx.json`. Mention needed changes in your
text response and let the user decide whether to proceed.

**Read `references/hypothesis-gps-guidance.md`** before creating or
evaluating any hypothesis — it covers leads vs hypotheses, the three
categories of assumptions, and compiled-source verification.

## When to use hypotheses

Hypotheses are most valuable when:
- **Multiple candidates exist.** "Patrick Flynn's father could be
  Thomas Flynn of Schuylkill County OR Thomas Flynn of Luzerne County."
- **Identity is uncertain.** "The Patrick Flynn in the 1870 census
  may or may not be our subject."
- **A relationship is claimed but not proven.** "Patrick Flynn's
  father was Thomas Flynn" — a hypothesis until GPS proof standards.
- **A compiled source names a relationship.** A family tree says
  "Phoebe's father was Daniel" — this is a lead, not a fact. Create
  a hypothesis and plan targeted research to verify or refute it.

Simple, uncontested facts don't need hypotheses — they go directly
from assertions to proof-conclusion.

**Decision rule:** Create a hypothesis when (a) multiple candidates
compete, (b) the claim rests on a compiled source needing verification,
or (c) evidence exists on both sides. If all evidence points one
direction with no competition or conflict, skip to proof-conclusion.

## Create a hypothesis

**Source awareness:** Before creating, identify WHERE the claim
originated. If from a compiled source (family tree, online genealogy,
published narrative), mark it as needing verification — compiled
sources are leads, not evidence.

**New hypotheses always start as `active`.** Even if existing
evidence strongly favors the hypothesis, set `status: "active"` at
creation. Promotion to `supported` happens in a separate evaluation
step after evidence is explicitly reviewed against the criteria below.

Create with `research_append({ section: "hypotheses", op: "append", entry: { claim, status: "active", supporting_assertion_ids: [], contradicting_assertion_ids: [], ruled_out: false, ruled_out_reason: null, notes, related_question_ids } })` — the tool assigns the `h_` id.

**Claim requirements:** State the claim positively and specifically,
include enough detail to distinguish from competing hypotheses, and
reference the person(s) involved.

**related_question_ids:** Link the hypothesis to the research
questions it helps answer.

## Link evidence

As assertions are extracted and linked to persons, evaluate whether
they support or contradict each active hypothesis. Update with
`research_append({ section: "hypotheses", op: "update", entryId: "h_NNN", fields: { supporting_assertion_ids: [...] } })` — pass only the fields that change.

**Design research to refute, not just confirm.** For each active
hypothesis, ask: "What evidence would DISPROVE this?" Prioritize
searching for that evidence. A hypothesis that survives deliberate
refutation is far stronger than one with only confirmatory searches.

**Supporting evidence:** Assertions that make the claim more likely —
add to `supporting_assertion_ids`.

**Contradicting evidence:** Assertions that make the claim less
likely — add to `contradicting_assertion_ids`.

**FAN evidence is regular assertions.** Witness patterns, neighbor
correlations, godparent relationships — link them via
`supporting_assertion_ids` like any other evidence. No special FAN
entity.

## Status transitions

```
active ──► supported ──► (to proof-conclusion)
  │
  └──► ruled_out
```

**`active`** — Evidence accumulating, no threshold crossed. Starting state.

**`supported`** — Transition when ALL of these are true:
- At least one line of direct evidence supports the claim (an
  assertion with `evidence_type: "direct"` in the supporting list)
- No unresolved contradictions remain (contradicting assertions have
  been explained, resolved via conflict-resolution, or outweighed)
- The evidence is consistent — no timeline impossibilities

**Do NOT downgrade from `supported` to `active` for minor
discrepancies.** Census age rounding (e.g., a 5-year birth year
difference) is normal in 19th-century records and does not constitute
an "unresolved contradiction." Adding contradicting evidence does not
automatically require a status downgrade — only link the evidence and
leave the status unchanged unless the contradiction is material enough
to undermine the core claim. When the user explicitly tells you a
discrepancy "doesn't disprove anything," respect that assessment if
it is genealogically reasonable.

**`ruled_out`** — Transition when ANY of these are true:
- Evidence affirmatively refutes the claim (e.g., a will names all
  children and Patrick is absent — negative evidence)
- Exhaustive elimination logic excludes the candidate
- A chronological or biological impossibility makes the hypothesis
  untenable (candidate was dead before subject was born, or too young
  to be a biological parent)

**Act on impossibilities immediately — unless this is a read-only
review.** When the user asks you to update or evaluate a hypothesis
and the age arithmetic shows a candidate was 10 years old at the
subject's birth, that is a biological impossibility — rule it out in
this interaction. Do NOT defer to conflict-resolution or hedge on
person_evidence confidence when the link is rated `confident`
(match_score >= 0.80) — treat the identification as settled and apply
the ruling. **Exception:** if the user explicitly asks for a read-only
summary/review, do NOT modify research.json — identify the issue in
your response text but defer changes to a follow-up request.

When ruling out, `ruled_out_reason` is REQUIRED — the validator
rejects the entry if it is missing. Be specific: state the
affirmative refutation, not just "insufficient evidence."

## Competing hypotheses

When multiple hypotheses compete for the same conclusion (e.g., two
candidate fathers): create one hypothesis per candidate, share
`related_question_ids`, and note that the same assertion may support
one and contradict another. Rule out candidates as evidence
accumulates — the GPS process of elimination.

## Example: Tracking the elimination process

| Hypothesis | Candidate | Status | Supporting | Contradicting |
|---|---|---|---|---|
| h_001 | Thomas Flynn, Schuylkill Co. | supported | a_004, a_010, a_013 | (none) |
| h_002 | Thomas Flynn, Luzerne Co. | ruled_out | a_035 (same-name, right age) | a_036 (died 1840), a_037 (will excludes Patrick) |
| h_003 | James Flynn, Carbon Co. | active | a_040 (Patrick age match) | (none yet) |

## Connect to downstream skills

- **timeline:** Request a hypothesis-testing timeline to check event coherence.
- **conflict-resolution:** When supporting and contradicting evidence exist, specific conflicts may need resolution.
- **proof-conclusion:** When a hypothesis reaches `supported`, it's ready for a proof conclusion.

## Present

After writes succeed, present the hypothesis state clearly:

```
Hypothesis: h_001 — Patrick Flynn's father was Thomas Flynn
            of Schuylkill County
Status:     SUPPORTED

Supporting evidence (3):
  + a_004  1850 census: Patrick in Thomas's household (indirect)
  + a_010  1860 census: Patrick in Thomas's household (indirect)
  + a_013  Death certificate: "Father: Thomas Flynn" (direct)

Contradicting evidence (0):  (none)

Competing hypotheses:
  h_002  Thomas Flynn of Luzerne County — RULED OUT
  h_003  James Flynn of Carbon County — ACTIVE (needs more research)

Next steps:
  - h_001 is ready for proof-conclusion
  - h_003 needs more evidence — suggest question-selection
```

## Important rules

- **Scope discipline — only modify what the user asked about.** If the
  user asks to create h_003, only create h_003. Do NOT proactively fix,
  update, downgrade, or rule out other hypotheses you notice have issues
  — even if you believe the status is wrong. Never change a hypothesis's
  status unless the user explicitly asked you to evaluate that specific
  hypothesis. Mention observations in your response text and let the
  user decide.
- **Never modify the `conflicts` section.** Owned exclusively by
  conflict-resolution. Create entries in `hypotheses` only.
- **Never create or modify the `questions` section.** Managed by
  question-selection and research-exhaustiveness. Leave
  `related_question_ids` as `[]` if no questions exist.
- **Never modify `tree.gedcomx.json`.** This skill only writes to the
  `hypotheses` section of `research.json`.
- **Hypotheses are claims, not facts.** Status reflects actual
  evidence, not researcher preference.
- **ruled_out_reason is mandatory.** The reason is the audit trail —
  it prevents accidentally resurrecting a ruled-out candidate.
- **Don't confuse hypothesis status with proof tier.** A `supported`
  hypothesis is ready for proof-conclusion, but the proof tier
  (Proved/Probable/Possible) depends on the full body of evidence.
- **Never ignore conflicting evidence.** Every assertion that conflicts
  with a hypothesis MUST go in `contradicting_assertion_ids`. Record
  it first, resolve later via conflict-resolution.
- **Check for unstated assumptions.** When linking evidence, ask: "Does
  this actually support the claim, or am I relying on an unstated
  assumption?" See the three assumption categories in
  `references/hypothesis-gps-guidance.md`.

## Re-invocation behavior

Updates existing hypotheses in place. Creates a new `h_` entry only for a genuinely new hypothesis. If a hypothesis about the same claim already exists, update it (or mark it superseded via `superseded_by`) — do not duplicate.
