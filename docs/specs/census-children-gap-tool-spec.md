# `census_children_gap` — census children gap tool — Spec

## 1. Why this exists

The 1900 and 1910 US censuses ask every mother how many children she has borne
and how many are still living. Those two numbers name children the family tree
does not hold — including children who were born and died between censuses and
left almost no other record. Working out how many are missing, and when each was
born, is arithmetic with one awkward rule: a child's window is bounded by the
**census days**, not by the births of the siblings around it.

When init-project did this arithmetic in prose, measured over 9 runs, the counts came
out right 9 of 9 times, but the birth window it stated was wrong 3 of 9 times,
and rewording the instruction changed nothing. This tool does the arithmetic so the
caller only reports it.

It is offline: no FamilySearch read, and the same input always gives the same
answer. It writes nothing. It has two modes. **Explicit mode** takes the known
children as input and is pure. **Tree mode** (`projectPath` + `motherId`) reads
the mother's children and their dates from the project's `tree.gedcomx.json`, so
no caller ever copies dates by hand — the transcription step the tool exists to
remove.

## 2. Callers

- `check-warnings` — the stand-alone tree check: reports the
  missing children next to `person_warnings`' errors whenever counts are
  available. It uses tree mode: it holds no file read, and no other read tool
  returns birth dates (`project_context` gives a person's children, but no
  dates).
- `question-selection` — turns a result into a research question.

`record-extractor` is deliberately not a caller (lead, 2026-10-08:
check-warnings owns errors, question-selection owns gaps).

## 3. Inputs

```
census_children_gap({
  censuses: [{ year: 1900 | 1910, childrenBorn, childrenLiving }],   // 1 or 2, distinct years
  knownChildren?: [{ name?, birthDate, deathDate? }],   // explicit mode
  projectPath?, motherId?                                // tree mode
})
```

| Field | Type | Notes |
|---|---|---|
| `censuses` | array, 1–2 entries | One per census year; the two years must differ. |
| `censuses[].year` | `1900` or `1910` | No other census asked the question in this form. |
| `censuses[].childrenBorn` | integer ≥ 0 | "Mother of how many children". |
| `censuses[].childrenLiving` | integer ≥ 0, ≤ `childrenBorn` | "Number of these children living". |
| `knownChildren` | array (default `[]`) | **Every** child the mother bore that the tree already holds, by any husband. |
| `knownChildren[].name` | string, optional | Used only to label output. |
| `knownChildren[].birthDate` | `YYYY`, `YYYY-MM` or `YYYY-MM-DD` | **Required.** |
| `knownChildren[].deathDate` | same, optional | Absent means the child is treated as living at both censuses (reported in `assumptions`). |
| `motherId` | string, optional | **Tree mode.** A tree person id, or a FamilySearch id one tree person's `ark` links to (the same lookup `person_warnings` uses for its anchor). Not with `knownChildren`. |
| `projectPath` | string | The project folder. Read only in tree mode; ignored otherwise (the eval harness injects one into every call). |

**Where the counts come from.** Decided 2026-10-08 (review-ready): the tool takes the counts as parameters only. The caller supplies
them from the user's message or from a 1900/1910 census record it has read.
There is no new `research.json` or tree field. Two alternatives were considered
and rejected:

- *Census assertions in `research.json`* — no schema field holds
  children-born/living today (`grep -niE "children.?(born|living)"
  docs/specs/schemas/*.json` finds nothing), so this would be a schema change,
  which belongs on a separate senior card.
- *Sources attached to the mother* — those are FamilySearch reads, which would
  turn a pure, offline tool into a network tool.

**Dates, not years.** The card describes the input as birth and death years.
The tool accepts partial ISO dates, which include a bare year, because the census
days fall mid-year: a child born in 1900 cannot be placed before or after
1 June 1900 from the year alone. When the year alone decides it, a bare year is
enough.

Unknown extra keys are ignored.

**Tree mode.** The tool reads `tree.gedcomx.json`, finds the mother, and takes
every child on a `ParentChild` relationship from her, unless its subtype denies
biological parentage (adoptive, step, foster, guardian — read as `person_warnings`
reads them, tolerating case and a `…Parent` suffix; an unknown subtype counts as
biological). A child linked twice counts once. Starting from the mother, not the
couple, is what includes children by an earlier husband. Dates come from each
fact's standard date, read by the same parser `person_warnings` uses:

- birth: every Birth fact; with none, any other birth-like fact (Christening,
  Baptism and the rest of `BIRTHLIKE_FACT_TYPES` in `utils/mob.ts`) bounds it
  from above only (born on or before);
- death: every Death fact; with none, any other death-like fact (Burial,
  Cremation, Funeral, Obituary, Probate — `DEATHLIKE_FACT_TYPES`) bounds it from
  above only (died on or before).

An open-ended date is not evidence for its open side: `Aft 1890` says nothing
about how late, and `Bef 1895` nothing about how early, so that side is read as
unbounded rather than at the parser's ten-year plausibility cap. Otherwise a
child known only to be alive after 1890 would be counted dead by 1910.

A child the tree cannot place — no birth evidence, a date that cannot be read,
a death before its birth — is reported in `undetermined`, never as a failure of
the whole call. Like any unplaceable child (§4.2) it takes each census it cannot
be placed against out of the arithmetic, so a tree with one undated stub child
returns no missing counts; the `undetermined` entry names the child whose date
would unlock them, and contradictions the placed children already prove are
still reported.

The tool refuses a `motherId` that names a person recorded as male: the counts
are the mother's, and walking a father's children would mix in children of
another wife.

## 4. The rules

Source: init-project's "Census fertility gap" paragraph (removed when init-project became an agent;
`git show 63ed17b57:packages/engine/plugin/skills/init-project/SKILL.md`, line 228):

> when a 1900 or 1910 US census gives the mother's children-born and
> children-living counts, born minus living is the number of her children dead
> by that census; each one not already in the tree, having died before the
> census date, is a gap to research — a child born and died before that
> enumeration. Living minus the children already in the tree alive at that date
> is the number of living children still missing. Parity between the living
> count and the children in the tree does not close the deceased-child gap. The
> dead count is cumulative: a child dead by 1900 is still counted among the dead
> in 1910, not an additional one. Apply the same de-duplication to the
> living-missing count — a child missing at both 1900 and 1910 is one missing
> child, not two — but a pre-census deceased child and a between-census living
> child are distinct targets, never merged. Count every child she bore,
> including by an earlier husband.

### 4.1 Census days

| Census | Enumeration day |
|---|---|
| 1900 | **1900-06-01** |
| 1910 | **1910-04-15** |

A child born on or before the day is counted in that census's `childrenBorn`. A
child who died before the day is counted dead; one who died on or after it is
counted living. The enumerator instructions fix the reference date whatever day
the enumerator visited: 1900 includes people living on June 1 or during any
part of that day, and 1910 information relates to April 15. A child born or
dying on the day was alive during part of it, so a date without a time is
enough (checked against the instructions by a senior genealogist, 2026-10-12). **Every birth window the tool reports is bounded by these days
and nothing else** — never by a sibling's birth. A child dead by the 1900 census
is "born on or before 1900-06-01", not "born between James and Catherine".

### 4.2 Placing the known children

For each census, each known child is `not_born`, `living` or `dead` on its day.
A partial date is an interval (`1900` is 1900-01-01 … 1900-12-31). A death
wholly before the census day places the child as dead whatever the birth's
precision (an infant born "1900" who died 1900-03-10 was born before
1900-06-01). Otherwise, when an interval straddles the census day the child cannot be placed, and that census is
reported in `undetermined` and left out of the arithmetic. The other census is
still used. The children that can be placed are still a lower bound, so a
contradiction they already prove (more known dead than the census's dead count)
is reported as a conflict even for an undetermined census. In the census month
itself (June 1900, April 1910) a month is not enough; the day is needed.

### 4.3 The arithmetic

Per census, the missing counts are the census minus the known children:
`mDead = (born − living) − knownDead`, `mLiving = living − knownLiving`.

Every missing child is one of five kinds:

| Kind | Born | 1900 | 1910 |
|---|---|---|---|
| `died_before_1900` (a) | on or before 1900-06-01 | dead | dead |
| `living_1900_died_by_1910` (b) | on or before 1900-06-01 | living | dead |
| `living_1900_and_1910` (c) | on or before 1900-06-01 | living | living |
| `born_between_died_by_1910` (d) | after 1900-06-01, on or before 1910-04-15 | not born | dead |
| `born_between_living_1910` (e) | after 1900-06-01, on or before 1910-04-15 | not born | living |

With both censuses:

```
a         = mDead1900
b + c     = mLiving1900
a + b + d = mDead1910
c + e     = mLiving1910
```

Four equations and five unknowns. The **total** is always determined
(`mDead1910 + mLiving1910`), and so is `a`. `b` can be anything in

```
bMin = max(0, mLiving1900 − mLiving1910)
bMax = min(mLiving1900, mDead1910 − mDead1900)
```

The tool reports each kind's guaranteed minimum (b at `bMin`, c at
`mLiving1900 − bMax`, d at `mDead1910 − a − bMax`, e at
`mLiving1910 − mLiving1900 + bMin`) and `k = bMax − bMin` pairs it cannot
resolve: each is either a child alive in 1900 who died by 1910 plus a living
child born between the censuses, or a child alive at both plus a child born
between who died. It reports them as unresolved and never guesses.

This is the paragraph's de-duplication done as algebra: the dead count is
cumulative (a is inside the 1910 dead), a child missing at both censuses is one
child (c), and a pre-census dead child (a) and a between-census living child (e)
are never merged.

With one census only:

- 1900: `mDead1900` children `died_before_1900`, and `mLiving1900` children
  `living_1900` (born on or before 1900-06-01; 1910 unknown).
- 1910: `mDead1910` children `dead_by_1910` and `mLiving1910` children
  `living_1910` (born on or before 1910-04-15; 1900 unknown).

### 4.4 Conflicts

Some inputs are impossible. They are findings for the caller to report, not tool
failures: the result is `ok: true` with `conflicts[]` set and nothing computed.

- A census's known dead exceed its dead count (`mDead < 0`).
- A census's known living exceed its living count (`mLiving < 0`).
- 1910 `childrenBorn` < 1900 `childrenBorn`.
- 1910 dead (`born − living`) < 1900 dead.
- `mDead1910 < mDead1900` — a child dead by 1900 must still be dead in 1910.
- `mDead1910 + mLiving1910 < mDead1900 + mLiving1900` — a child counted in 1900
  must still be counted in 1910.

The last two are checked only when nothing above has fired, so their messages
never quote a negative count. They are not implied by the census-level checks: a known child who dies
between the censuses moves from known-living to known-dead. Together with the
first two they are exactly the conditions for `bMin ≤ bMax`, so no count the tool
reports is ever negative.

## 5. Output

```ts
{ ok: true,
  enumerationDays: { "1900": "1900-06-01", "1910": "1910-04-15" },
  censusesUsed: (1900 | 1910)[],
  totalMissing: number | null,     // null when conflicts or no census usable
  missing: [{ kind, count, bornAfter: string | null, bornOnOrBefore: string,
              status1900, status1910, description }],
  unresolved: [{ count, bornAfter, bornOnOrBefore, status1900, status1910, description }],
  conflicts: [{ census: 1900 | 1910 | "both", message }],
  undetermined: [{ census, child, reason }],
  assumptions: string[],
  mother?: { personId, name },                          // tree mode
  knownChildrenUsed?: [{ personId, name, birth, death }] } // tree mode: the dates read
| { ok: false, reason?: "no_project", errors: string[] }
```

In tree mode `knownChildrenUsed` names each child and the standard dates read
(`birth`/`death` are `null` when absent; a christening or burial stands in as
`christened …` / `buried …`), so a caller can name them without reading the tree.

`status1900` / `status1910` are `"dead" | "living" | "not_born" | "unknown"`.
Groups with a count of 0 are left out.

## 6. Errors

`ok: false` (the call could not do what was asked; `convert_calendar`'s
pattern, listed in `OK_FALSE_IS_FAILURE`) for malformed input only:

- `censuses` missing, empty, longer than 2, or a duplicate year
- a year other than 1900 or 1910
- a count that is not a non-negative integer, or living > born
- `knownChildren` not an array, or a child with no `birthDate`
- a date not in `YYYY`, `YYYY-MM` or `YYYY-MM-DD` form, or not a real date
- a death date wholly before the birth date
- tree mode: `motherId` together with `knownChildren`; a `motherId` that names no
  tree person (or names a FamilySearch id linked to more than one); a missing
  `projectPath`, a folder that does not exist, or a broken project (a missing or
  unparseable tree)

A folder that holds no project at all is not an error: tree mode answers
`{ ok: false, reason: "no_project" }`, which the dispatch does not mark as an
error, exactly as `person_warnings` does.

## 7. Not in scope

- Reading `research.json`, or any project file but the tree; writing anything.
- Any census other than 1900 and 1910.
- Deciding which known child is which census child, or naming the missing ones.
- Putting the arithmetic back into agent prose when the tool errors: the caller
  surfaces the error.

## 8. Files

`src/tools/census-children-gap.ts` (`censusChildrenGap`, the pure explicit mode;
`censusChildrenGapTool`, the async entry point that adds tree mode),
`src/types/census-children-gap.ts`, `tests/tools/census-children-gap.test.ts`,
`tests/tools/census-children-gap-tree.test.ts`, `dev/try-census-children-gap.ts`.
Tree mode reuses `findAnchor` and `isNonBiologicalSubtype` from
`src/tools/person-warnings.ts` and the date parser in `src/utils/date-helpers.ts`;
`tests/tools/no-project.test.ts` covers its folder states. Registered in `src/tool-schemas.ts`, `src/server.ts`, `manifest.json`,
`src/tool-result.ts` (`OK_FALSE_IS_FAILURE`, `NOT_A_DOCUMENT_WRITER`),
`dev/smoke-calls.ts`, and the eval harness's `mock_mcp.py` (`LIVE_TOOLS`,
`_COMPILED_TOOLS`, `OK_FALSE_IS_FAILURE_LIVE`), so unit evals run the compiled
tool instead of a canned answer.
