# Person Warnings Tool — Implementation Spec

## Overview

A deterministic, offline MCP tool that reads `tree.gedcomx.json` from a
project directory and checks person data for impossible or unlikely
genealogical facts. No authentication required — the tool operates
entirely on local file data.

Adapted from FamilySearch's `MobWarnings.java`. This spec starts with
three starter warnings and is designed for easy extension.

---

## Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `projectPath` | string | Yes | Absolute path to the directory containing `tree.gedcomx.json` |
| `personId` | string | No | Check only this person (and their relationships). Omit to check all persons |

Example (all persons):
```json
{ "projectPath": "/home/user/projects/flynn" }
```

Example (single person):
```json
{ "projectPath": "/home/user/projects/flynn", "personId": "I1" }
```

---

## Output

| Field | Type | Description |
|-------|------|-------------|
| `personsChecked` | number | Number of persons examined |
| `warningCount` | number | Total warnings produced |
| `warnings` | object[] | Array of warning objects (see below). Empty array when no warnings |
| `message` | string | Human-readable summary (e.g., `"Checked 5 persons, found 2 warnings."`) |

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
  "personsChecked": 3,
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
  ],
  "message": "Checked 3 persons, found 1 warning."
}
```

---

## Tool Schema

```typescript
{
  name: "person_warnings",
  description:
    "Check persons in tree.gedcomx.json for impossible or unlikely genealogical " +
    "data (e.g., death before birth, father too young). Reads the local project " +
    "file — no authentication or network access required. Pass personId to check " +
    "a single person, or omit to check all persons.",
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
          "Check only this person (and their relationships). Omit to check all persons.",
      },
    },
    required: ["projectPath"],
  },
}
```

---

## Authentication

None required. The tool reads a local file only.

---

## Date Parsing Rules

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

### Conservative range principle

When dates are ranges (`YYYY-YYYY`), each warning picks the bound that
gives the data the **most generous** interpretation. A warning fires
only when even the most generous reading produces an impossible or
unlikely result.

---

### W1: `DEATH_BEFORE_BIRTH`

**Severity:** `error`

**Condition:** The person has both a Birth and a Death fact with
parseable years, and the latest possible death is before the earliest
possible birth.

**Logic:**

```
birthFact = person.facts.find(f => f.type === "Birth")
deathFact = person.facts.find(f => f.type === "Death")
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

**Condition:** A ParentChild relationship exists where the parent is
male, and even the maximum possible age at the child's birth is < 14.

**Logic:**

```
for each relationship where type === "ParentChild":
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

**Condition:** The person has a Death fact with a parseable year, and
another fact (not in the exclusion list) whose earliest possible year
is after the latest possible death year.

**Post-death exclusions** (not flagged):
`Burial`, `Cremation`, `Obituary`, `Probate`, `Will`, `Estate`, `Funeral`

**Logic:**

```
POST_DEATH_TYPES = ["Burial", "Cremation", "Obituary", "Probate",
                    "Will", "Estate", "Funeral"]

deathFact = person.facts.find(f => f.type === "Death")
if (!deathFact) → skip

deathYear = extractLatestYear(deathFact.date)
if (deathYear == null) → skip

for each fact in person.facts:
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

Errors fall into two categories:

- **Throw** for tool-level failures the caller cannot act on (bad input,
  corrupt file). These surface as MCP tool errors.
- **Return a result** for data-level conditions (missing file, unknown
  person, empty tree). These are reportable to the user, not crashes.

| Condition | Behavior |
|-----------|----------|
| `projectPath` not provided | Throw: `"projectPath is required"` |
| `tree.gedcomx.json` is invalid JSON | Throw: `"Failed to parse tree.gedcomx.json: {parseError}"` |
| `tree.gedcomx.json` not found at path | Return: `personsChecked: 0`, message `"tree.gedcomx.json not found at {projectPath}. Run tree_read first to populate the tree file."` |
| `personId` specified but not found | Return: `personsChecked: 0`, message `"Person '{personId}' not found in tree.gedcomx.json."` |
| File has no `persons` array | Return: `personsChecked: 0`, message `"No persons found in tree.gedcomx.json."` |
| Date is unparseable | `extractYear()` returns `null`, warning check skips silently |

---

## Files

### `mcp-server/src/types/person-warnings.ts`

- `PersonWarningsInput` — `{ projectPath: string; personId?: string }`
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
npx tsx dev/try-person-warnings.ts /path/to/project          # all persons
npx tsx dev/try-person-warnings.ts /path/to/project I1        # single person
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
| 52 | File not found | `personsChecked: 0`, message mentions "not found" |
| 53 | Invalid JSON | Throws parse error |
| 54 | Empty persons array | `personsChecked: 0`, no warnings |
| 55 | `personId` not in file | `personsChecked: 0`, message mentions "not found" |
| 56 | Person with no facts | `personsChecked: 1`, no warnings |
| 57 | Multiple warnings on one person | All warnings returned |
| 58 | `personId` filter returns only that person's warnings | Only matching warnings |
| 59 | Clean data, no warnings | `warningCount: 0`, empty `warnings` array |

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
| `DUPLICATE_FACTS` | `warning` | Multiple facts of the same type with identical dates |
| `CHILD_TOO_OLD` | `warning` | Child older than parent |

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

- Call `person_warnings({ projectPath: "/path/to/project" })` — checks
  all persons
- Call `person_warnings({ projectPath: "/path/to/project", personId: "I1" })`
  — checks single person
- Call `person_warnings({ projectPath: "/nonexistent" })` — returns
  file-not-found message
- Call `person_warnings({})` — returns validation error

### Manual Layer 2 (Claude Code)

- "Check my tree for data problems" — Claude should call
  `person_warnings` with the project path
- "Are there any warnings for person I1?" — Claude should call
  `person_warnings` with `personId: "I1"`
