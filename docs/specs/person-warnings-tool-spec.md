# Person Warnings Tool — Implementation Spec

## Overview

A deterministic, offline MCP tool that reads `tree.gedcomx.json` from a
project directory and checks person data for impossible or unlikely
genealogical facts. No authentication required — the tool operates
entirely on local file data.

Adapted from FamilySearch's `MobWarnings.java`. This spec starts with
three starter warnings and is designed for easy extension.

### Scope: anchor person and their one-hops

The tool always evaluates warnings **from the point of view of a single
anchor person**, named by the required `personId`. The anchor and their
**one-hop relatives** (parents, spouses, children) plus the
relationships between them are what MobWarnings calls the "relative
mob."

- `personId` identifies the **target/anchor** — it is *not* a scope
  filter and there is no "check every person in the file" mode.
- The `tree.gedcomx.json` file may contain everyone gathered for the
  project so far (potentially many people across generations). The tool
  does **not** check the whole file — only the anchor's mob.
- **Single-person warnings** (e.g. `DEATH_BEFORE_BIRTH`,
  `EVENT_AFTER_DEATH`) report on the anchor person.
- **Relationship warnings** (e.g. `FATHER_TOO_YOUNG`) report on a
  relationship between the anchor and a one-hop relative.

> **OPEN QUESTION (confirm with Richard/Dallan):** do the single-person
> warnings run only on the anchor, or on every member of the mob? This
> spec currently runs them on the anchor; verify against MobWarnings
> semantics before implementing.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectPath` | string | Yes | Absolute path to the directory containing `tree.gedcomx.json` |
| `personId` | string | Yes | The anchor person to check. Names the target; warnings are evaluated over this person and their one-hop relatives |

Example:
```json
{ "projectPath": "/home/user/projects/flynn", "personId": "I1" }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `warningCount` | number | Total warnings produced |
| `warnings` | object[] | Array of warning objects (see below). Empty array when no warnings |

> **Review decision (2026-05-27):** `personsChecked` and the top-level
> human-readable `message` summary were removed — "keep it simple"
> (Dallan). `warningCount` is **kept**: unlike the removed `message` (a
> natural-language summary — the kind of phrasing better left to the
> LLM), `warningCount` is a plain deterministic count produced in code
> (`warnings.length`), so it belongs in the tool output. The per-warning
> `message` field below also survives (see the warning-list note).

### Warning Object

| Field | Type | Description |
|-------|------|-------------|
| `warningId` | string | Warning type identifier (e.g., `DEATH_BEFORE_BIRTH`) |
| `severity` | string | `error` (impossible) or `warning` (unlikely but possible) |
| `personId` | string | Person ID the warning applies to |
| `personName` | string | Display name of the person (see below) |
| `message` | string | Human-readable description of the problem |
| `factIds` | string[] | Fact IDs involved in the check (for UI highlighting) |
| `relatedPersonId` | string? | Person ID of the related person, when the check involves a relationship (e.g., the father in `FATHER_TOO_YOUNG`). Omitted when not applicable |

**`personName` resolution:** Use the preferred name (the one with
`preferred: true`), falling back to the first name in the array. Format
as `"{given} {surname}"`. If the person has no names array or it is
empty, use `"Unknown (personId)"`.

Example output:
```json
{
  "warningCount": 1,
  "warnings": [
    {
      "warningId": "DEATH_BEFORE_BIRTH",
      "severity": "error",
      "personId": "I1",
      "personName": "Patrick Flynn",
      "message": "Death year (1840) is before birth year (1845) for Patrick Flynn.",
      "factIds": ["F1", "F2"]
    }
  ]
}
```

> **Placeholder warning IDs and messages.** The `warningId` strings and
> the per-warning `message` text below are **placeholders**. Richard
> (ChesworthRM) is sharing the existing FamilySearch quality-score
> warning list; once available, reuse its tags for equivalent warnings
> and emit the **same English sentence** it uses ("just to make the
> LLM's life simpler" — Dallan). Do not finalize these strings until
> that list arrives.

---

## Tool Schema

```typescript
{
  name: "person_warnings",
  description:
    "Check a person in tree.gedcomx.json for impossible or unlikely genealogical " +
    "data (e.g., death before birth, father too young). Reads the local project " +
    "file — no authentication or network access required. personId is the anchor " +
    "person; warnings are evaluated over that person and their one-hop relatives.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description:
          "Absolute path to the directory containing tree.gedcomx.json",
      },
      personId: {
        type: "string",
        description:
          "The anchor person to check. Warnings are evaluated over this person and their one-hop relatives.",
      },
    },
    required: ["projectPath", "personId"],
  },
}
```

---

## Authentication

None required. The tool reads a local file only.

---

## Date Parsing Rules

> **PENDING DECISION (Dallan, by EOD 2026-05-27).** The three v1
> warnings all compare **years**, so the year-extraction helpers below
> are sufficient for them. But the team flagged two related issues:
>
> 1. **Full-date precision for future warnings.** The old Java code kept
>    *both* a full date and a year-only date; some warnings (e.g.
>    mother/father child-spacing, "died months after born in the same
>    year") need day/month precision, not just the year. Those checks
>    are out of scope for v1 but will need a day-difference helper.
> 2. **Standardized date format in simplified GedcomX.** The date field
>    is currently freeform, so every consumer re-parses it. The team is
>    weighing standardizing the date during conversion *into* simplified
>    GedcomX (possibly porting FamilySearch's date standardizer to JS;
>    note it is weak before ~17th century) against the extra LLM tokens
>    a standardized date adds. Dallan will decide by end of day; if the
>    format changes, revisit the helpers below.
>
> The year-extraction approach below stands for v1 regardless of how
> that decision lands.

The tool needs to extract years from the freeform date strings defined
in `simplified-gedcomx-spec.md` Section 4.5. Three exported functions
handle this:

### `extractYear(dateStr)`

```typescript
function extractYear(dateStr: string | undefined): number | null
```

Returns the first/only year from a date string. `undefined` or empty
string returns `null`. Leading/trailing whitespace is trimmed.

**Parsing logic (in order of precedence):**

1. **ISO patterns** — `YYYY-MM-DD`, `YYYY-MM`, or bare `YYYY`. Extract
   the leading 4-digit group.
2. **Approximate** — `~YYYY` → extract `YYYY`.
3. **Before/After** — `before YYYY` or `after YYYY` → extract `YYYY`.
4. **Range** — `YYYY-YYYY` → extract the **first** year.
5. **Free text fallback** — First 4-digit number in `1000–2099`.
6. **No match** → `null`. Warning checks skip the fact silently.

### `extractEarliestYear(dateStr)`

```typescript
function extractEarliestYear(dateStr: string | undefined): number | null
```

For ranges (`YYYY-YYYY`), returns the **start** year. For all other
patterns, delegates to `extractYear()`.

### `extractLatestYear(dateStr)`

```typescript
function extractLatestYear(dateStr: string | undefined): number | null
```

For ranges (`YYYY-YYYY`), returns the **end** year. For all other
patterns, delegates to `extractYear()`.

**Distinguishing ranges from ISO dates:** `1908-03` is a month-precision
date, not a range. The range pattern requires both sides to be 4-digit
years (`\d{4}-\d{4}`).

---

## Warning Definitions

All warnings are evaluated relative to the **anchor person** (the
required `personId`). In the logic blocks below, `anchor` is the person
resolved from `personId`. Single-person checks read `anchor.facts`;
relationship checks only consider relationships in which the anchor
participates (the anchor as parent or as child).

### Conservative range principle

When dates are ranges (`YYYY-YYYY`), each warning picks the bound that
gives the data the **most generous** interpretation. A warning fires
only when even the most generous reading produces an impossible or
unlikely result.

---

### W1: `DEATH_BEFORE_BIRTH`

**Severity:** `error`

**Condition:** The anchor has both a Birth and a Death fact with
parseable years, and the latest possible death is before the earliest
possible birth.

**Logic:**

```
birthFact = anchor.facts.find(f => f.type === "Birth")
deathFact = anchor.facts.find(f => f.type === "Death")
if (!birthFact || !deathFact) → skip

birthYear = extractEarliestYear(birthFact.date)
deathYear = extractLatestYear(deathFact.date)

if (birthYear != null && deathYear != null && deathYear < birthYear)
  → emit warning
```

**Message:** `"Death year ({deathYear}) is before birth year ({birthYear}) for {personName}."`

**factIds:** `[birthFact.id, deathFact.id]`

**relatedPersonId:** omitted

---

### W2: `FATHER_TOO_YOUNG`

**Severity:** `warning`

**Condition:** A ParentChild relationship involving the anchor exists
where the parent is male, and even the maximum possible age at the
child's birth is < 14.

**Logic:**

```
for each relationship where type === "ParentChild"
    AND (relationship.parent === anchor.id OR relationship.child === anchor.id):
  parent = persons.find(p => p.id === relationship.parent)
  child  = persons.find(p => p.id === relationship.child)
  if (!parent || !child) → skip
  if (parent.gender !== "Male") → skip

  parentBirthFact = parent.facts.find(f => f.type === "Birth")
  childBirthFact  = child.facts.find(f => f.type === "Birth")
  if (!parentBirthFact || !childBirthFact) → skip

  parentBirthYear = extractEarliestYear(parentBirthFact.date)
  childBirthYear  = extractLatestYear(childBirthFact.date)

  if (parentBirthYear != null && childBirthYear != null):
    maxAge = childBirthYear - parentBirthYear
    if (maxAge < 14) → emit warning on the CHILD person
```

**Message:** `"Father {parentName} would have been {maxAge} at the birth of {childName} (father born {parentBirthYear}, child born {childBirthYear})."`

**factIds:** `[parentBirthFact.id, childBirthFact.id]`

**relatedPersonId:** `parent.id`

**Note:** The warning is emitted on the child's `personId` (since the
child's data is what typically needs correction), with the father as
`relatedPersonId`.

---

### W3: `EVENT_AFTER_DEATH`

**Severity:** `error`

**Condition:** The anchor has a Death fact with a parseable year, and
another fact (not in the exclusion list) whose earliest possible year
is after the latest possible death year.

**Post-death exclusions** (not flagged):
`Burial`, `Cremation`, `Obituary`, `Probate`, `Will`, `Estate`, `Funeral`

**Logic:**

```
POST_DEATH_TYPES = ["Burial", "Cremation", "Obituary", "Probate",
                    "Will", "Estate", "Funeral"]

deathFact = anchor.facts.find(f => f.type === "Death")
if (!deathFact) → skip

deathYear = extractLatestYear(deathFact.date)
if (deathYear == null) → skip

for each fact in anchor.facts:
  if (fact.type === "Death") → skip
  if (POST_DEATH_TYPES.includes(fact.type)) → skip

  eventYear = extractEarliestYear(fact.date)
  if (eventYear == null) → skip

  if (eventYear > deathYear) → emit warning
```

**Message:** `"{factType} ({eventYear}) is after death year ({deathYear}) for {personName}."`

**factIds:** `[deathFact.id, fact.id]`

**relatedPersonId:** omitted

---

## Error Handling

### Why data-level conditions now throw

This changed as a direct result of the 2026-05-27 review, and the chain
is worth recording so it isn't "fixed" back later by mistake:

1. **What the original spec did.** Data-level conditions (missing file,
   unknown person, empty tree) **returned** a result carrying an
   explanatory string, e.g.
   `{ personsChecked: 0, message: "tree.gedcomx.json not found... Run person_read first." }`.
   The `message` field is what told the user what went wrong and what to
   do next.
2. **What the review removed.** Both `personsChecked` and the top-level
   `message` field were deleted ("keep it simple").
3. **The consequence of that removal.** The success output is now just
   `{ warningCount, warnings[] }`. So an empty result —
   `{ "warningCount": 0, "warnings": [] }` — became **ambiguous**: it
   could mean "checked the anchor, found nothing wrong" *or* "couldn't
   run at all, so nothing was checked." No field is left to tell those
   apart, which risks a silent failure (the user thinks the tree is
   clean when the tool never ran).
4. **What we resorted to.** These data-level conditions now **throw**
   instead of returning. The `index.ts` CallTool handler catches the
   throw and serializes it into a readable `{ error: ... }` result
   (`isError: true`), so the user still gets the actionable message
   ("run person_read first") — it is just framed as a failure rather than
   mistaken for a clean tree. The only normal-result case left is
   "anchor checked, no warnings found."

| Condition | Behavior |
|-----------|----------|
| `projectPath` not provided | Throw: `"projectPath is required"` |
| `personId` not provided | Throw: `"personId is required"` |
| `tree.gedcomx.json` is invalid JSON | Throw: `"Failed to parse tree.gedcomx.json: {parseError}"` |
| `tree.gedcomx.json` not found at path | Throw: `"tree.gedcomx.json not found at {projectPath}. Run person_read first to populate the tree file."` |
| `personId` not found | Throw: `"Person '{personId}' not found in tree.gedcomx.json."` |
| File has no `persons` array | Throw: `"No persons found in tree.gedcomx.json."` |
| Date is unparseable | `extractYear()` returns `null`, warning check skips silently |

> **Flag for sign-off:** the throw approach above is the spec author's
> resolution to the `message`-removal gap, not something the review
> decided explicitly. The alternative would be to add back one small
> diagnostic field instead of throwing. Call this out in the PR so
> Dallan/Richard can confirm throwing is acceptable.

---

## Files

### `mcp-server/src/types/person-warnings.ts`

- `PersonWarningsInput` — `{ projectPath: string; personId: string }`
- `PersonWarning` — the warning object shape
- `PersonWarningsResult` — the output shape

### `mcp-server/src/tools/person-warnings.ts`

- `extractYear(dateStr)` — exported, for unit testing
- `extractEarliestYear(dateStr)` — exported, for unit testing
- `extractLatestYear(dateStr)` — exported, for unit testing
- `personWarningsTool(input)` — main function
- `personWarningsToolSchema` — MCP tool schema

### `mcp-server/src/index.ts`

Registered following the existing tool pattern (import, ListTools,
CallTool).

### `mcp-server/dev/try-person-warnings.ts`

Smoke-test script:

```bash
cd mcp-server
npx tsx dev/try-person-warnings.ts /path/to/project I1        # anchor person (required)
```

### `mcp-server/tests/tools/person-warnings.test.ts`

Unit tests (see Testing section below).

---

## Testing

### `extractYear()` tests

| # | Input | Expected |
|---|-------|----------|
| 1 | `"1908-03-12"` | `1908` |
| 2 | `"1908-03"` | `1908` |
| 3 | `"1845"` | `1845` |
| 4 | `"~1845"` | `1845` |
| 5 | `"before 1850"` | `1850` |
| 6 | `"after 1840"` | `1840` |
| 7 | `"1840-1850"` | `1840` |
| 8 | `"about Spring 1845"` | `1845` |
| 9 | `undefined` | `null` |
| 10 | `""` | `null` |
| 11 | `"unknown"` | `null` |
| 12 | `"  1908-03-12  "` | `1908` |

### `extractEarliestYear()` tests

| # | Input | Expected | What it verifies |
|---|-------|----------|------------------|
| 13 | `"1840-1850"` | `1840` | Range: returns start year |
| 14 | `"1845"` | `1845` | Non-range: delegates to `extractYear` |
| 15 | `"1908-03-12"` | `1908` | ISO date: not a range, delegates |
| 16 | `"1908-03"` | `1908` | ISO month: not a range, delegates |
| 17 | `"~1845"` | `1845` | Approximate: delegates |
| 18 | `"before 1850"` | `1850` | Before keyword: delegates |
| 19 | `"after 1840"` | `1840` | After keyword: delegates |
| 20 | `undefined` | `null` | Undefined input |
| 21 | `""` | `null` | Empty string |

### `extractLatestYear()` tests

| # | Input | Expected | What it verifies |
|---|-------|----------|------------------|
| 22 | `"1840-1850"` | `1850` | Range: returns end year |
| 23 | `"1845"` | `1845` | Non-range: delegates to `extractYear` |
| 24 | `"1908-03-12"` | `1908` | ISO date: not a range, delegates |
| 25 | `"1908-03"` | `1908` | ISO month: not a range, delegates |
| 26 | `"~1845"` | `1845` | Approximate: delegates |
| 27 | `"before 1850"` | `1850` | Before keyword: delegates |
| 28 | `"after 1840"` | `1840` | After keyword: delegates |
| 29 | `undefined` | `null` | Undefined input |
| 30 | `""` | `null` | Empty string |

### W1: `DEATH_BEFORE_BIRTH` tests

| # | Scenario | Expected |
|---|----------|----------|
| 31 | Death 1840, birth 1845 | 1 warning, severity `error` |
| 32 | Death year = birth year | No warning |
| 33 | Death year > birth year | No warning |
| 34 | Birth fact missing | No warning |
| 35 | Death fact missing | No warning |
| 36 | Birth date unparseable | No warning |
| 37 | Birth range `1840-1850`, death `1845` | No warning |
| 38 | Birth `1845`, death range `1830-1840` | 1 warning |

### W2: `FATHER_TOO_YOUNG` tests

| # | Scenario | Expected |
|---|----------|----------|
| 39 | Father born 1845, child born 1850 (max age 5) | 1 warning, severity `warning` |
| 40 | Father born 1830, child born 1845 (max age 15) | No warning |
| 41 | Father born 1832, child born 1845 (max age 13) | 1 warning |
| 42 | Parent is female (mother) | No warning |
| 43 | Father has no birth fact | No warning |
| 44 | Child has no birth fact | No warning |
| 45 | No ParentChild relationship | No warning |

### W3: `EVENT_AFTER_DEATH` tests

| # | Scenario | Expected |
|---|----------|----------|
| 46 | Residence 1920, death 1910 | 1 warning, severity `error` |
| 47 | Burial 1920, death 1910 | No warning |
| 48 | Probate 1920, death 1910 | No warning |
| 49 | Birth 1845, death 1910 | No warning |
| 50 | No death fact | No warning |
| 51 | Event date unparseable | No warning |

### Integration tests

| # | Scenario | Expected |
|---|----------|----------|
| 52 | File not found | Throws; message mentions "not found" |
| 53 | Invalid JSON | Throws parse error |
| 54 | Empty persons array | Throws "No persons found" |
| 55 | `personId` not in file | Throws; message mentions "not found" |
| 56 | Anchor with no facts | `warningCount: 0`, empty `warnings` array |
| 57 | Multiple warnings on the anchor | All warnings returned |
| 58 | File contains a person outside the anchor's mob with impossible data | That person is NOT reported (scoping) |
| 59 | Clean data, no warnings | `warningCount: 0`, empty `warnings` array |
| 60 | `personId` omitted | Throws "personId is required" |

---

## Extensibility

### How to add a new warning

1. Choose a `warningId` (UPPER_SNAKE_CASE, e.g., `MOTHER_TOO_YOUNG`)
2. Add the check function in `person-warnings.ts`
3. Add it to the warning runner loop
4. Add unit tests
5. Update this spec with the new definition

No schema changes needed — warnings are a flat array of the same
`PersonWarning` shape.

### Future warning candidates

These are not included in v1 but are good candidates for extension:

| Warning ID | Severity | Description |
|-----------|----------|-------------|
| `MOTHER_TOO_YOUNG` | `warning` | Mother's age at child's birth < 12 |
| `MOTHER_TOO_OLD` | `warning` | Mother's age at child's birth > 50 |
| `FATHER_TOO_OLD` | `warning` | Father's age at child's birth > 75 |
| `LIVED_TOO_LONG` | `warning` | Age at death > 120 years |
| `BORN_TOO_EARLY` | `warning` | Birth year < 1000 |
| `BIRTH_AFTER_MOTHER_DEATH` | `error` | Child born > 1 year after mother's death |
| `BIRTH_AFTER_FATHER_DEATH` | `error` | Child born > 1 year after father's death |
| `MARRIAGE_BEFORE_BIRTH` | `error` | Marriage year < birth year |
| `CHILD_TOO_OLD` | `warning` | Child older than parent |

> **Removed in review:** `DUPLICATE_FACTS` (multiple facts of the same
> type with identical dates) was dropped — the same birth date
> legitimately appears in, e.g., a civil registration and a christening
> record, so it isn't a problem (Richard). Some candidates above —
> notably mother/father child-spacing checks — need **full-date**
> precision, not year-only; see the date-parsing note.

---

## Verification

### Automated

```bash
cd mcp-server && npm run build && npm test
```

### Manual Layer 1 (MCP Inspector)

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

- Call `person_warnings({ projectPath: "/path/to/project", personId: "I1" })`
  — checks the anchor and its one-hops
- Call `person_warnings({ projectPath: "/path/to/project" })` — throws
  (personId is required)
- Call `person_warnings({ projectPath: "/nonexistent", personId: "I1" })`
  — throws file-not-found
- Call `person_warnings({ projectPath: "/path/to/project", personId: "ZZZZ" })`
  — throws person-not-found

### Manual Layer 2 (Claude Code)

- "Check Patrick (I1) for data problems" — Claude should call
  `person_warnings` with `personId: "I1"`
- "Are there any warnings for person I1?" — Claude should call
  `person_warnings` with `personId: "I1"`
