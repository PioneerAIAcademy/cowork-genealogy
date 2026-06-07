---
name: check-warnings
model: claude-sonnet-4-6
description: Checks genealogical data for impossibilities and anomalies —
  married before age 12, died after 120, child born after parent's death,
  events on impossible dates, multiple births too close together. Surfaces warnings to the user
  without modifying project files; a guardrail skill invoked after
  assertions or person_evidence are added. Use when
  another skill's validation-protocol says "invoke check-warnings", when
  the user says "check for warnings", "are there any problems with this
  data?", "sanity check", or when reviewing assertions before writing a
  proof conclusion. Do NOT use for schema validation (use validate-schema)
  or for resolving conflicts between sources (use conflict-resolution).
---

# Check Warnings

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Checks genealogical data for impossible or improbable conditions.

**Warnings vs. conflicts:** These are fundamentally different things.
Warnings are logical impossibilities — a single person's data
violates biological, physical, or temporal constraints. Conflicts
are disagreements between two or more sources about the same fact.
This skill handles warnings only. Use `conflict-resolution` for
source disagreements.

## Assumption framework

All checks are grounded in assumption categories. Load
`references/assumption-categories.md` for the full framework.

- **Fundamental** (physical laws) → Critical/High warnings
- **Valid** (biological/social norms) → Medium/High warnings
- **Unsound** (unproven premises) → Do NOT warn

## What triggers this skill

Per the validation-protocol embedded in every writing skill:
- After adding assertions to research.json
- After creating person_evidence links
- After proof-conclusion updates tree.gedcomx.json

It can also be invoked directly by the user.

## Steps

### 1. Gather person data

For each person with recently added/updated assertions or
person_evidence links, assemble their known facts:
- Birth date (from assertions or tree.gedcomx.json facts)
- Death date
- Marriage date(s)
- Spouse birth/death dates
- Children's birth dates
- Parent death dates
- Event locations (for geographic consistency checks)

Use assertions linked via person_evidence (where `superseded_by`
is null) to build the person's profile. For dates, use
`structured_value.year` when available for numeric comparison.

### 2. Run the warning checks

Apply the conditions catalogued in `references/warning-checks.md` to
the assembled person data. These are simple date and relationship
comparisons — birth-to-marriage spans, parent-child age gaps, event
dates against death dates — that you perform directly by reasoning
over the project files. There is no MCP tool: check-warnings is a
pure analysis skill.

Severity levels in brief:
- **Critical** — Physically impossible (death before birth, future
  dates, events after death). Always data errors or identity confusion.
- **High** — Near-impossible biologically or temporally (marriage
  before age 12, impossible travel, child born after parent's death).
- **Medium** — Improbable but with known exceptions (children too
  close together, unusual parent-child age gaps).
- **Low** — Noteworthy but common historically (birth before
  marriage, lived past 100, large sibling gaps).

See `references/warning-checks.md` for the full catalog.

### 3. Report warnings

Present each warning to the user with:
- The specific condition detected
- The assertions/facts involved
- The severity level
- Which assumption category it violates (fundamental, valid)
- Possible explanations, including identity confusion

**Example output:**

```
WARNINGS FOR: Patrick Flynn (KWCJ-RN4)

⚠️  HIGH — Child born after father's death
    [Fundamental assumption: people do not act after death]
    Patrick's estimated birth (~1845) is after Thomas Flynn's
    claimed death (1840) from hypothesis h_002.
    Assertions: a_002 (birth), a_036 (Thomas Luzerne death)
    
    This suggests Thomas Flynn of Luzerne County is NOT Patrick's
    father (supports ruling out h_002). Or the death date for
    Thomas of Luzerne is wrong.

✓  No other warnings for this person.
```

### 4. Interpret warnings as identity signals

Load `references/warnings-as-identity-signals.md` for the full
interpretive framework. Apply these rules:

- **Critical/High warnings** → Investigate immediately. These almost
  always indicate data errors or conflated identities (records from
  two different people merged into one profile).
- **Medium warnings** → Note and recommend verification. May indicate
  twins, blended families, or transcription errors.
- **Low warnings** → Report but do not escalate. Common in historical
  records.
- **Clustered warnings** → Escalate the overall concern. Multiple
  warnings on one person — especially across severity levels —
  strongly suggest identity confusion. See the escalation table in
  `references/warnings-as-identity-signals.md`.

### 5. Suggest next steps

Based on warning type, recommend a specific handoff:

- **Fundamental-assumption violation** → "Review person_evidence
  links — these records likely belong to two different individuals.
  Use `timeline` to find the identity split point."
- **Valid-assumption violation** → "Verify [specific assertion]
  against the original source. If confirmed, document the exception."
- **Jurisdictional/geographic issue** → "Verify whether the original
  record used a later jurisdiction name retroactively, or whether
  this event belongs to a different person."
- **Clustered warnings** → "Build a timeline to find where the
  identity diverges." Hand off to `timeline`.

## When NO warnings are found

Simply report: "No genealogical warnings found for [person]. All
dates and relationships are within normal ranges."

## Important rules

- **Warnings are informational, not gates.** They don't block
  further work. They surface conditions that MIGHT indicate
  problems.
- **Don't auto-correct.** Report the warning and let the user or
  other skills (conflict-resolution, person-evidence) investigate.
- **Don't warn on unsound assumptions.** Never flag the absence of
  evidence for assumptions that require proof. Only flag conditions
  that violate fundamental or valid assumptions.
- **Check after person linking, not just extraction.** An assertion
  in isolation can't trigger most warnings (they require comparing
  dates across persons). The warnings become meaningful after
  person_evidence links assertions to specific persons.
- **Historical exceptions exist.** A 13-year-old bride is unusual
  by modern standards but occurred historically. A 105-year-old
  death is rare but documented. Present warnings with appropriate
  context.
- **Jurisdictions change over time.** Always consider whether a
  stated county, parish, or town existed at the date of the event.
  A birth recorded in a county created 20 years later is a
  significant error signal.

## Handoff rules

- **Warning involves two sources disagreeing** → This is a conflict,
  not a warning. Hand off to `conflict-resolution`.
- **Warning suggests identity confusion** → Suggest `timeline` to
  find the split point, then `person-evidence` to reassign records.
- **User asks to fix a warning** → Do NOT fix it here. Hand off to
  the appropriate skill (person-evidence, conflict-resolution, or
  the user's manual correction).
- **Timeline skill invoked check-warnings** → Return results to
  timeline's caller; do not start a new investigation.

## Edge cases

- **Approximate dates:** When both dates being compared are
  approximate (e.g., "~1845" and "~1840"), allow a margin of error
  equal to the combined uncertainty. Do not fire High/Critical
  warnings when the impossibility falls within the estimation range.
- **Multiple persons to check:** When triggered after a batch of
  person_evidence updates, check ALL affected persons, not just the
  first. Report each person's warnings separately.
- **Partial data:** When a person has only a birth date and nothing
  else, most checks cannot fire. Report "Insufficient data for
  meaningful warning checks" rather than "no warnings found."

## Re-invocation behavior

**Writes:** nothing. This skill is a read-only diagnostic — it reports
data integrity warnings (orphan IDs, missing required fields, schema
violations) but does not modify any project file.

**On repeat invocation:** safe to run as often as needed. Each run is a
fresh read.

**Do not duplicate:** N/A — no writes.
