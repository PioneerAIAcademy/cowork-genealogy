---
name: check-warnings
description: Checks genealogical data for impossibilities and anomalies —
  married before age 12, died after 120, child born after parent's death,
  events on impossible dates, multiple births too close together. A guardrail
  skill invoked after assertions or person_evidence are added. Use when
  another skill's validation-protocol says "invoke check-warnings", when
  the user says "check for warnings", "are there any problems with this
  data?", "sanity check", or when reviewing assertions before writing a
  proof conclusion. Do NOT use for schema validation (use validate-schema)
  or for resolving conflicts between sources (use conflict-resolution).
---

# Check Warnings

Checks genealogical data for impossible or improbable conditions.
These are not conflicts between sources — they're logical
impossibilities that indicate data errors, identity confusion, or
incorrect person linking.

## MCP tool

This skill uses the `check_warnings` MCP tool:

```
check_warnings({
  personData: {
    name: "Patrick Flynn",
    birthDate: "1845",
    deathDate: "1908",
    marriageDate: "1855",
    spouseBirthDate: "1848",
    childBirthDates: ["1870", "1872", "1875"],
    fatherDeathDate: "1840",
    motherDeathDate: "1890"
  }
})
```

The tool returns a list of warnings with severity levels.

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

Use assertions linked via person_evidence (where `superseded_by`
is null) to build the person's profile. For dates, use
`structured_value.year` when available for numeric comparison.

### 2. Call check_warnings

Call the MCP tool with the assembled person data. The tool checks
for:

| Warning | Condition | Severity |
|---------|-----------|----------|
| Married too young | Marriage before age 12 | High |
| Died too old | Death after age 120 | High |
| Born after parent's death | Child birth date after father's death + 9 months, or after mother's death | High |
| Died before birth | Death date before birth date | Critical |
| Child before puberty | Parent was under 12 at child's birth | High |
| Children too close | Two children born less than 9 months apart (to same mother) | Medium |
| Marriage after death | Marriage date after either spouse's death | High |
| Birth before parents' marriage | Child born more than 9 months before parents' marriage | Low (common, but worth noting) |
| Unusually long life | Lived past 100 (plausible but worth verifying) | Low |
| Event date in the future | Any date after the current year | Critical |

### 3. Report warnings

Present each warning to the user with:
- The specific condition detected
- The assertions/facts involved
- The severity level
- Possible explanations

**Example output:**

```
WARNINGS FOR: Patrick Flynn (KWCJ-RN4)

⚠️  HIGH — Child born after father's death
    Patrick's estimated birth (~1845) is after Thomas Flynn's
    claimed death (1840) from hypothesis h_002.
    Assertions: a_002 (birth), a_036 (Thomas Luzerne death)
    
    This suggests Thomas Flynn of Luzerne County is NOT Patrick's
    father (supports ruling out h_002). Or the death date for
    Thomas of Luzerne is wrong.

✓  No other warnings for this person.
```

### 4. Interpret warnings

Warnings are informational — they do NOT block further work. But
they should inform analysis:

- **Critical warnings** (died before birth, future dates) almost
  always indicate data errors or identity confusion. Investigate
  immediately.
- **High warnings** (married too young, born after parent's death)
  suggest either a data error or an identity confusion (two different
  persons merged into one). Recommend checking person_evidence links
  and timeline.
- **Medium warnings** (children too close) may indicate twins, an
  incorrect date, or two different mothers confused into one.
- **Low warnings** (birth before marriage) are common in historical
  records and usually don't indicate errors.

### 5. Connect to research actions

Based on the warnings, suggest:
- "This warning suggests the person links may be wrong — check
  person-evidence for [specific link]"
- "This may indicate two different persons have been conflated —
  check timeline for impossibilities"
- "This data error should be investigated — the [date] on
  assertion [a_XXX] may be a transcription error"

## When NO warnings are found

Simply report: "No genealogical warnings found for [person]. All
dates and relationships are within normal ranges."

## Important rules

- **Warnings are informational, not gates.** They don't block
  further work. They surface conditions that MIGHT indicate
  problems.
- **Don't auto-correct.** Report the warning and let the user or
  other skills (conflict-resolution, person-evidence) investigate.
- **Check after person linking, not just extraction.** An assertion
  in isolation can't trigger most warnings (they require comparing
  dates across persons). The warnings become meaningful after
  person_evidence links assertions to specific persons.
- **Historical exceptions exist.** A 13-year-old bride is unusual
  by modern standards but occurred historically. A 105-year-old
  death is rare but documented. Present warnings with appropriate
  context.
