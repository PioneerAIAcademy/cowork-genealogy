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
{ checks })` takes a subset of `a b c d e g h` so the measurement script can
score each check's absence. Tests also inject `matchPairs`, `imageTranscribe`,
`now` and `deadlineMs`.

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
  variant fold (check d's tables).
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
  calls his wife someone the tree has as his mother — flags it. A role is read
  only from a stated relationship: a census with no relationship column states
  none, so its positional `head_of_household` label and a "Household of" title
  give no role (KW8N-2TB, 2026-11-01).
- **d. Name variants.** The record name against each tree name. Given names are
  related by `lookupNameVariants` / `lookupNameFamily`, surnames by
  `patronymicVariants`, the tables `record_search`'s variant hints use. A name
  no tree name matches or varies is a soft signal. A check-a score below the
  threshold on a name the tables relate is softened to weak: the must-not-flag
  guard for spelling variants, nicknames and patronymics.
- **e. Image read, flagged attachments only.** Decided (Richard, 2026-10-27):
  OCR runs only on attachments the rules already flagged — check a, b or c
  marked it misattributed, or h found a contradiction — truth sets included.
  `imageTranscribeTool` reads the research source's `image_ark` **without a
  `projectPath`**, so nothing is staged or saved, with `lookingFor` the tree's
  value of the disputed field (the person's name, plus the tree's birth or death
  year when b or h raised it). `FOUND` — the page shows the tree's value where
  the index differs — is `indexing_error`; `NOT FOUND` leaves the verdict on the
  rules. No key, no image, a refused transcription slot, an error, or no answer
  is `e: { not_run }` and the verdict stands on the rules.
- **g. Every person the record touches.** Each other tree person holding a live
  link to any persona of the record, whatever its rationale, is scored as in a
  against their own leave-one-out tree. One below the threshold flags the
  attachment.
- **h. Contradictions.** Two attachments on the person whose birth or death
  year or place disagree (the same comparators; a census birth as its window)
  each get `contradicts`, naming the other.

## Verdict

In order, first match wins:

1. `not_scored` — a reason from the table above.
2. `indexing_error` — e found the tree's value on the page.
3. `misattributed` — a below `MISATTRIBUTED_BELOW` (not softened by d), b
   impossible, c party below the threshold or a contradicted relationship, or g.
4. `contradicts` — h alone.
5. `weak` — a in the grey band (`MISATTRIBUTED_BELOW` ≤ score < `WEAK_BELOW`),
   or any soft signal.
6. `fine`.

`contradicts[]` is reported whatever the verdict.

### Thresholds

`MISATTRIBUTED_BELOW = 0.5` starts at the baseline's `DEFAULT_THRESHOLD` and
`WEAK_BELOW = 0.8` is provisional. Both are to be set from the planted-fixture
run (`dev/source-screen.ts score` with this tool's findings beside the baseline
and judge files), and the measured recall per planted type and false-alarm rate,
with fixture counts, are recorded here when that run is made. Until then they
are unmeasured.

## Time budget

Cowork aborts every MCP call at 60 s. All matcher pairs (a, c, g) go in **one**
`matchPairs` call. The image reads run concurrently under one deadline,
`OCR_DEADLINE_MS = 45_000` measured from the call's entry; each gets
`{ ocrTimeoutMs: deadline − now }`, so an overrun is aborted rather than left
billing. A read unfinished at the deadline marks that attachment's
`e: { not_run: "budget" }` and its verdict stands on the rules. A
transcription-slot refusal (`GENEALOGY_MAX_TRANSCRIPTIONS`) is
`e: { not_run: "slot_limit: …" }`.

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
