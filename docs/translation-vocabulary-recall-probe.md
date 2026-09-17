# translation vocabulary recall probe

**Issue:** #2543. **Date:** TBD (run not yet complete). **Scope:** cold-recall
probe of the 49 bundled vocabulary rows in
`packages/engine/plugin/skills/translation/references/vocabulary-and-record-structures.md`
against `claude-sonnet-4-6`.

This is a measurement, not a plan. It edits no skill, no test, no fixture,
and proposes no prose change. It answers one question — **does the production
model expand the bundled vocabulary rows cold, without the reference file?** —
and produces only this write-up and the companion raw JSON. The action card is
#2259; this card decides what that card does.

## Pre-registration

*Written before the probe ran. The decision rule and denominator are fixed;
results sections below are filled after grading.*

### Decision rule (primary)

A row is **carried** (deletion candidate for a follow-on card, not this one)
iff **all 3 independent cold trials** produce the correct genealogical meaning
**and no trial produces a plausible-wrong expansion**. A refusal ("I don't
know") is not carried, but is reported separately from plausible-wrong — a
refusal is safe in production, a confident wrong expansion is not.

**Carried rows are deleted** — but that is the follow-on card (#2259), not
this one. This card produces a number and a recommendation only.

### Denominator

**48 rows / 144 trials.** `d. / des` is German genitive — not an
abbreviation — so it is excluded from the carried/kept tally. Its 3 trials
are run and reported in the Special rows section.

### Secondary criteria (reported alongside the primary verdict)

Two rules were rejected as primary rules but are computed from the same 147
trials and reported as secondary tallies:

- **Secondary 1 — 2-of-3 majority:** a row is carried if at least 2 of 3
  trials are correct. Rejected as primary because it can delete a row the
  probe just demonstrated the model gets wrong sometimes, and the asymmetric
  cost (plausible-wrong extraction vs keeping a few tokens) makes 2-of-3 too
  permissive.

- **Secondary 2 — section-level ≥90%:** if a whole section (vocabulary /
  Latin abbreviations / German abbreviations) scores ≥90% carried by the
  primary 3-of-3 rule, the section is nominated for deletion as a whole.
  Rejected as primary because it would ship rows the probe demonstrated are
  redundant purely to avoid a half-table, and because it grows the follow-on
  PR unnecessarily.

Publishing all three tallies is free — they read the same 147 trials — and
naming 3-of-3 as the **primary** rule up front preserves pre-registration: a
secondary tally cannot be swapped in after the results are read.

### What the rule does not cover

The following are settled from the repo before running and are stated here so
the probe is falsifiable:

- **Model: `claude-sonnet-4-6`.** It is the unit harness `DEFAULT_MODEL`
  in `eval/harness/harness/skill_runner.py`, the hosted control plane's
  `default_model` in `apps/server/app/config.py`, and the `model:` recorded in all
  four committed translation run logs. `SKILL.md` carries no `model:` pin
  (all 26 were deleted in `c1fc2a4c2` / #1497). Cowork's model is
  user-selected and out of scope.

- **Temperature: not pinned.** The Agent SDK exposes no temperature for the
  model under test; only the judge is pinned to 0. Pinning the probe to 0
  makes three "independent" trials near-deterministic and hollows out the
  3-of-3 rule, whose whole point is to catch a row the model gets wrong
  *sometimes*.

- **"Independent" means one API call per trial**, not three samples in one
  conversation — a prior answer in the same thread contaminates the next.

- **"Cold" means no SKILL.md, no reference file, no sibling rows** in the
  same prompt. Each prompt contains only the single term or abbreviation being
  tested.

### Definitions

- **Correct:** The response contains the correct genealogical meaning for the
  term or abbreviation. Matching is semantic, not literal. For dual-expansion
  rows (`SS.`, `par.`), correct requires **both** expansions to be named, or
  the ambiguity to be explicitly flagged with both options — the row's value
  is teaching the ambiguity.

- **Plausible-wrong:** A substantive response that gives an incorrect
  expansion that sounds genealogically plausible — e.g. `sep.` → "separated"
  rather than *sepultus* (buried), or `ob.` → "obituary" rather than *obiit*
  (died). For dual-expansion rows, answering with only one of the two
  expansions is plausible-wrong. Plausible-wrong is the dangerous failure
  mode: a confident wrong answer flows silently into extracted assertions.

- **Refusal:** A response of "I don't know," an explicit hedge ("I'm not
  certain of this term"), or a "this may vary" with no substantive expansion.
  Safe in production; tallied separately.

### Special-row grading rules

Fixed before the run:

- **`d. / des`** is ordinary German genitive, not an abbreviation. Its 3
  trials are run and reported, but the row is **excluded from the primary
  denominator** (48 rows / 144 trials) and from all secondary tallies.
  Alternative rejected: grading it as an abbreviation asks the model to
  expand something that is already a word and would score a miss for a correct
  answer.

- **`SS.`** carries two expansions: *sanctissimus* (most holy) and *sanctorum*
  (of the saints). A trial is correct only if it names both, or explicitly
  flags the ambiguity with both options. Answering only "most holy" is
  plausible-wrong.

- **`par.`** carries two expansions: *parentes* (parents) and *parochia*
  (parish). Same rule as `SS.`.

### Grading roles

- **Developer** grades the 22 vocabulary rows (string-comparable; each has
  a deterministic correct answer).
- **Genealogist** adjudicates the 27 abbreviation rows (16 Latin + 11
  German), where `sep.` reading as "separated" rather than *sepultus* and
  `par.` reading as only "parents" are domain calls.
- An LLM grader may do a first-pass classification (correct / plausible-wrong
  / refusal) on all three sections. A human confirms every row the LLM marks
  plausible-wrong or refusal before results are published. The write-up names
  who made each call.

---

## Provenance

*To be filled after the probe runs.*

- **Run by:** [name, role]
- **Timestamp:** [from `meta.run_timestamp` in the JSON]
- **Git commit at run time:** [hash]
- **Total API calls:** 147 (49 rows × 3 trials)
- **Raw JSON:** `eval/harness/e2e/probe_translation_vocab_recall_raw.json`
  (co-committed alongside this write-up)

---

## Per-section graded tally

*To be filled after grading is complete.*

### Common genealogy vocabulary (22 rows) — developer-graded

| Term | Language | T1 | T2 | T3 | Verdict | Notes |
|------|----------|----|----|----|---------|-------|
| *pending* | | | | | | |

### Latin abbreviations (16 rows) — genealogist adjudicates

| Abbreviation | Full form | T1 | T2 | T3 | Verdict | Notes |
|--------------|-----------|----|----|----|---------| ------|
| *pending* | | | | | | |

### German abbreviations (11 rows) — genealogist adjudicates

| Abbreviation | Full form | T1 | T2 | T3 | Verdict | Notes |
|--------------|-----------|----|----|----|---------| ------|
| *pending* | | | | | | |

---

## Special rows

*To be filled after grading.*

### `d. / des` (excluded from tally)

Run: 3 trials (row index 48, german_abbreviations section).
Excluded because this is ordinary German genitive (`des/der` = "of the"),
not an abbreviation. The primary denominator is 48 rows / 144 trials.

**Trial responses:** *pending*

### `SS.` (dual expansion)

Carried only if both expansions are named: *sanctissimus* (most holy) and
*sanctorum* (of the saints). A response naming only one is plausible-wrong.

**Trial responses:** *pending*

### `par.` (dual expansion)

Carried only if both expansions are named: *parentes* (parents) and
*parochia* (parish). A response naming only one is plausible-wrong.

**Trial responses:** *pending*

---

## Primary verdict

*To be filled after grading.*

**X of 48 rows carried by the 3-of-3 rule (Y of 144 trials correct).**

| tally per section | primary (3-of-3) | consequence for #2259 |
|---|---|---|
| all rows carried | section deleted | #2259 loses that section's wiki fetch |
| some carried | section reduced to residue | #2259 re-scoped to residue |
| none carried | section unchanged | #2259's wiki route proceeds as written |

---

## Secondary tallies

*To be filled after grading.*

**Secondary 1 — 2-of-3 majority:** X of 48 rows correct in at least 2 of 3
trials.

**Secondary 2 — section-level ≥90%:**
- Common genealogy vocabulary: X/22 carried by 3-of-3
- Latin abbreviations: X/16 carried by 3-of-3
- German abbreviations: X/11 carried by 3-of-3

---

## Refusal tally

*To be filled after grading.*

Rows with at least one refusal trial, by section:

| Section | Rows with ≥1 refusal | Refusal trial count |
|---|---|---|
| vocabulary | | |
| latin_abbreviations | | |
| german_abbreviations | | |

---

## Grading protocol notes

*To be filled after grading.*

Describe: who graded what, whether an LLM pre-grade was used, which rows the
LLM flagged as plausible-wrong or refusal, and which of those the human
confirmed or overturned.

---

## Does this result generalise beyond translation?

*To be filled by the developer after the primary verdict is known.*

ADR-0012 lists per-language vocabulary and abbreviations among the dense cases
across 22 skills and 4 agents, and the wiki-migration program (#2123, #2251,
#2259, #2262) assumes every such passage must be *fetched*. If the model
carries this class of content cold, address here whether the result looks
specific to translation vocabulary or whether the same probe is worth pointing
at another skill's tables.

---

## Appendix: verbatim raw answers

All 147 trial responses are preserved verbatim in:

    eval/harness/e2e/probe_translation_vocab_recall_raw.json

This file is co-committed alongside this write-up. A grading dispute can be
re-adjudicated without re-running the probe by reading the `"response"` field
of each trial entry in that file.

The JSON structure:

```json
{
  "meta": {
    "model": "claude-sonnet-4-6",
    "temperature": null,
    "trials_per_row": 3,
    "total_rows": 49,
    "primary_denominator_rows": 48,
    "primary_denominator_trials": 144,
    ...
  },
  "trials": [
    {
      "section": "vocabulary",
      "row_index": 0,
      "term": "Taufbuch / Taufregister",
      "trial": 1,
      "prompt": "...",
      "response": "...",
      "stop_reason": "end_turn",
      ...
    },
    ...
  ]
}
```
