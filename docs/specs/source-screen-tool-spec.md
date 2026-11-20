# Source Screen Tool — Spec

## Overview

`source_screen` reports one verdict per source attached to one tree person:
likely misattributed, likely an indexing error, contradicts another attachment
(naming it), weak, fine, or not scored with its reason. It answers "are the
sources on this profile right?" for the `source-evaluation` agent, and gives
`person-evidence` a verdict for an attachment link it would otherwise re-judge.

**One read-only tool owns every per-attachment verdict** (lead, 2026-10-30).
The tool reports and removes nothing. All scoring lives in one function
(`sourceScreenTool` in `src/tools/source-screen.ts`); no other tool or agent
runs a parallel screen. A writer that removed what the screen flags was
dropped with removal itself, so capability stays split by tool identity
(ADR-0006): every agent that may screen holds only a reader.

It is a new tool, not a `person_warnings` mode: `person_warnings` is offline and
returns a warnings list, while this tool calls the matcher and OpenRouter and
returns one row per attachment. A mode would give one tool two return shapes.

## Input

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `projectPath` | string | yes | The project directory. |
| `personId` | string | yes | A tree person id, or a FamilySearch id a tree person's `ark` links to (resolved as `person_warnings` resolves it, by `findAnchor`). |

`checks` is **not** on the MCP schema. `sourceScreenTool(input, principal,
{ checks })` takes a subset of `a b c e h` so the measurement script can
score each check's absence. Tests also inject `matchPairs`, `imageTranscribe`,
`now`, `deadlineMs` and `matcherDeadlineMs`.

## Precondition: person mode has run

The tool's input is the project after `extraction_append({ projectPath,
personId })`: the tree, the extracted assertions, and the attachment links that
call wrote. **It never extracts and never fetches a record**: each record is read
from the sidecar of the `record_read` log entry person mode wrote
(`log[].results_ref`). If the person has indexed attachments and none of them
has such a sidecar, the call returns `{ ok: false, errors }` naming
`extraction_append({ projectPath, personId })`. A single record without one is a
per-attachment `not_scored: unreadable`, not a whole-call failure.

With no project at `projectPath` the answer is `noProjectResult("read")`.

## Output

```
{ ok: true, personId, attachments: [{ sourceId, recordId, level, verdict,
  reasons[], contradicts?: [sourceId], personaId?, signals }], counts: { <verdict>: n } }
```

- `sourceId` is the tree source id; `recordId` the `1:1:` persona ARK the
  attachment names (null when it names none); `level` is `person` for the
  person's own, name and fact refs, `relationship` for a ref on a Couple or
  ParentChild relationship the person is an endpoint of (a source on both is
  `person`).
- `reasons` holds one sentence per signal that fired, each prefixed with its
  check letter, or the not-scored reason.
- `signals` carries each check's raw result (below), or `{ not_run: reason }`
  for a check that could not run.
- `counts` tallies verdicts over every attachment, not-scored included.

`ok: false` is the call's failure (person not in the tree, person mode not run,
unreadable project files), so the tool is in `OK_FALSE_IS_FAILURE` and its
dispatch arm goes through `writerToolResult`. It writes no project document, so
it is also in `NOT_A_DOCUMENT_WRITER`, and it is `READ_ONLY`.

### Not scored

Decided first, before any check:

| Reason | When |
|---|---|
| `unindexed` | The tree source's url holds no `1:1:` record ARK: an image, a document, or a link to another site. |
| `unreadable` | Person mode holds no read of the record. |
| `reused_hint_no_persona` | The record was read, but no persona of it carries the attachment's ARK. |
| `ambiguous_party` | A relationship-level source where `selectSubjectPersona` cannot choose the person's persona, or any other party's. |
| `unlinked` | The chosen persona has no live `person_evidence` link to the person — person mode skips a persona two tree persons claim. A link that a checked link superseded still counts: any live link does, whatever its rationale. |

## Support inference (`src/utils/attachment-support.ts`)

An imported tree fact cites no source, so "supported only by this record" cannot
be read off the tree, and `withoutRecordSourced` (which reads cited refs) removes
nothing on an import. `supportOf(tree, research, personId)` maps each of the
person's tree names and facts, and each relationship they are an endpoint of, to
the records whose live assertions, linked to the person by a live link, agree
with it:

- **Facts:** same type, with `birthplace`/`deathplace` folded into their event
  (`VITAL_EVENT`); years within `YEAR_TOLERANCE` (`yearsOf`); places agreeing at
  any level (`placeForms`, `placesAgree`). No aspect may disagree and at least
  one must agree. A census age with no stated birth year is read as the
  two-year window `birthRangeFromAge` gives. These comparators are the ones
  `unregisteredDisagreements` uses, exported from `question-state.ts`, not
  copied.
- **Names:** given name and surname each the same or related after the
  variant fold: given names by `lookupNameVariants` / `lookupNameFamily` (the
  same, one listing the other, or three or more shared forms — Louis and Lewis
  share Lew, Lou and Louie, while Margaret and Mary share only Mamie and May),
  surnames by `patronymicVariants`.
- **Relationships:** a relationship assertion of the relationship's type whose
  persona and related persona link to the two parties.

`leaveOneOut(tree, support, recordId)` removes what only that record (or record
group: one record read under several persona ARKs) supports. An item no record
supports stays, and the person keeps at least one name.

## The checks

Each check is a signal into one scoring function. Item f — rules written from
the genealogist-confirmed truth-set findings — is not built; it waits on that
review.

- **a. Leave-one-out score.** `matchPairs` on a `tree_record` pair: the
  leave-one-out whole tree, its `Mob(...).matchSubset()` as FamilySearch's tree
  side, and the sidecar persona. The signal is the `score`, never a `matched`
  flag. `same_person`'s project arm is not called: it writes.
- **b. Introduced warnings.** `introducedByLink` on the leave-one-out tree: the
  warnings the record's facts would introduce on the person. An impossible one
  marks the attachment misattributed; an implausible one is a soft signal.
- **c. Relationships.** For a relationship-level source, each other party's
  persona (by `selectSubjectPersona`) is scored against that party, leave-one-out;
  one below the threshold flags it. For every attachment, a stated relationship
  (a `relationship` assertion) between the person and another linked tree person
  that the tree's direct relationship between them contradicts — the record
  calls his wife someone the tree has as his mother — flags it. The stated
  `relationship_type` is read through `relationshipCategory`, so `son`, `Wife`
  and `child_inferred` name their category; a type with no category (a cousin,
  a boarder) is not compared. A role is read
  only from a stated relationship: a census with no relationship column states
  none, so its positional `head_of_household` label and a "Household of" title
  give no role (KW8N-2TB, 2026-11-01).
- **e. Image read, for a disputed vital fact on a flagged attachment.**
  Decided (Richard, 2026-10-27): OCR runs only on attachments the rules already
  flagged — a or c marked it misattributed, b raised any warning (an implausible
  one included: a wrong year in the index is what b sees first), or h named a
  contradiction — truth sets included (`flaggedForImage`, the eligibility gate).
  A flagged attachment is read only for a **specific disputed fact on this
  attachment**: a birth or death year or place where this record's own stated
  value differs from the tree's. The candidate facts are the ones this row's
  contradictions name (`contradicts[]`, after the misattribution filter in h),
  then the events of the record facts a b warning rests on (their year), then,
  when a or c marked it misattributed, any birth or death year or place. The
  first candidate whose stated value disagrees with the tree's is read, with
  `lookingFor` the person's name and the tree's value of that fact
  (`John Boyer, birth 1852`, `John Boyer, birth place Pennsylvania`). With no
  such fact — a flag that names only a name, or an index that already agrees
  with the tree on the fact — there is no read: `e: { not_run:
  "no_disputed_fact" }`. A census age is not a stated birth year, so it is never
  the disputed value. The read is `imageTranscribeTool` on the research
  source's `image_ark` **without a `projectPath`**, so nothing is staged or
  saved. `FOUND` — the page shows the tree's value of a fact this row's index
  states differently — is `indexing_error`, and `signals.e` names the `fact`;
  `NOT FOUND` leaves the verdict on the rules. No key, no image, a refused
  transcription slot, an error, or no answer is `e: { not_run }` and the
  verdict stands on the rules.
- **h. Contradictions.** Two attachments on the person whose birth or death
  year or place disagree (the same comparators; a census birth as its window)
  each get `contradicts`, naming the other — except that a disagreement with an
  attachment a, b or c already marks misattributed is that attachment's
  finding alone: it names the other, and the other is not `contradicts` for it
  and is not image-read for it. `signals.h` still records every disagreement.
  Without this, one wrong record marks every right record that disagrees with it
  `contradicts`, a false alarm on each.

## Verdict

In order, first match wins:

1. `not_scored` — a reason from the table above.
2. `indexing_error` — e found on the page the tree's value of a vital fact this
   attachment's index states differently.
3. `misattributed` — a below `MISATTRIBUTED_BELOW`, b impossible, or c: a party
   below the threshold or a contradicted relationship.
4. `contradicts` — h alone.
5. `weak` — a in the grey band (`MISATTRIBUTED_BELOW` ≤ score < `WEAK_BELOW`),
   or any soft signal.
6. `fine`.

`contradicts[]` is reported whatever the verdict.

### Thresholds

`MISATTRIBUTED_BELOW = 0.5` (the baseline's `DEFAULT_THRESHOLD`) is kept: on the
planted set below, every wrong-person plant but one scores under 0.05, and the
one that does not (0.69) is caught by b. Lowering it would not raise recall, and
the host profiles' own attachments do not separate from the plants by score —
29 of 172 score under 0.05, and the whole-tree score of the same record is as
low in 24 of those, so the matcher, not leave-one-out, puts them there. Whether
those are wrong attachments or matcher misses only the truth set can say.
`WEAK_BELOW = 0.8` is unmeasured.

## Measurement

Planted fixtures (`dev/source-screen-fixtures.json`, 23 copies: 11 wrong-person
plants, 3 index edits, 10 must-not-flag edits), snapshot 2026-11-20, scored by
`dev/source-screen.ts score`:

| planted type | n | baseline | source_screen, no image read | source_screen |
|---|---|---|---|---|
| easy_wrong_person (recall) | 3 | 3 | 3 | 3 |
| hard_wrong_person (recall) | 3 | 2 | 3 | 3 |
| sr_jr_swap (recall) | 3 | 3 | 3 | 3 |
| relative_clash (recall) | 2 | 2 | 2 | 2 |
| indexing_error (recall) | 3 | 0 | 0 | 1 |
| spelling_variant (false alarms) | 2 | 2 | 2 | 2 |
| nickname (false alarms) | 2 | 2 | 1 | 1 |
| maiden_married (false alarms) | 2 | 2 | 1 | 1 |
| census_age_drift (false alarms) | 2 | 2 | 0 | 0 |
| patronymic (false alarms) | 2 | 2 | 0 | 0 |

The baseline's wrong-person catches all rest on its by-construction
multi-attached signal; this tool's do not. Two of the three index edits are in
index-only collections (a death index and the SSDI), which have no page image,
so check e cannot settle them. Of the 217 flagged attachments, 166 named no
disputed vital fact and were not read; of the reads attempted, 1 found the tree's
value on the page (the planted baptism), 14 did not, 22 were cut by the time
budget, 4 failed, 1 gave no answer, and 9 records had no image.

**Every check earns its place** — each scored with and without, no image read,
on an earlier build of the same planted set:

| without | wrong-person caught (of 11) | false alarms (of 10) | result |
|---|---|---|---|
| (none) | 10 | 5 | — |
| a | 4 | 3 | kept |
| b | 9 | 5 | kept |
| c | 10 | 5 | unmeasured: no relationship-level plant |
| h | 10 | 5 | unmeasured: no contradiction plant |
| d (name variants) | 11 | 5 | **dropped**: it softened one sr_jr_swap plant and spared no false alarm |
| g (every person the record touches) | 10 | 4 | **dropped**: it added a false alarm and caught nothing more |

**Uncurated sample (item 6).** 30 persons drawn at random (seed 20261120) from
the e2e fixtures' `source_pid`s, snapshot 2026-11-20, no image read: 313
attachments — 131 fine, 38 weak, 7 contradicts, 97 misattributed, 40 not scored;
21 of the 30 persons have at least one misattributed. a raised 81 of the 97, b
22, c 21, h 17. Read by hand, a random 8 of the 97 split: records whose facts put
an event after the person's death (plausibly wrong), and maiden- or married-name
records (Elizabeth Geach against Elizabeth Slack, Mary Crowther against Mary
Prizer) that the matcher scores low and are likely right. So on real profiles the
screen over-flags name changes; telling which flags are right is the
genealogist review the truth set carries.

c and h are kept pending the truth set, which also has to re-test the d and g
drops: the planted set carries two fixtures per must-not-flag type. The
100-person truth set was not available for this run.

## Time budget

Cowork aborts every MCP call at 60 s. One clock starts at the call's entry. All
matcher pairs (a, c) go in **one** `matchPairs` call, which must finish by
`MATCHER_DEADLINE_MS = 30_000`; unfinished, every pair is `a: { not_run:
"budget" }` and every c party `{ score: null, not_run: "budget" }` (the matcher
offers no abort, so its requests are abandoned, not cancelled). The image reads
then run two at a time (`OCR_CONCURRENCY`, so a `GENEALOGY_MAX_TRANSCRIPTIONS`
cap shared with other users is not taken whole) and must finish by
`OCR_DEADLINE_MS = 45_000`. Each read gets `{ budgetMs: deadline − now }`, an
internal `imageTranscribeTool` option that bounds the image fetch (one attempt)
and the OCR together, so an overrun is aborted rather than left billing. A read
unfinished at the deadline, or not started before it, marks that attachment's
`e: { not_run: "budget" }` and its verdict stands on the rules. A
transcription-slot refusal is `e: { not_run: "slot_limit: …" }`.

## Read-only

The tool writes nothing: not `research.json`, the tree, `results/` or `images/`.
It reads sidecars with `readStagedResults`, scores with `matchPairs` (which
records nothing), and transcribes with no `projectPath`. A test pins every
project file byte-identical across a call that runs every check, OCR included.

## Sites

`src/tools/source-screen.ts`, `src/types/source-screen.ts`,
`src/utils/attachment-support.ts`; `allToolSchemas` and `READ_ONLY`
(`src/tool-schemas.ts`); the `server.ts` arm; `OK_FALSE_IS_FAILURE` and
`NOT_A_DOCUMENT_WRITER`; `manifest.json`; `dev/smoke-calls.ts`;
`dev/try-source-screen.ts`; the plugin hook's `AGENT_ONLY_TOOLS` (held by
`source-evaluation` and `person-evidence`). The eval harness serves it from
fixtures like any network tool: it is not a live tool there.
