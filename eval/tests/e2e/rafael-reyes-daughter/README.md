# Rafael Reyes — daughter Rita (b./d. 1913)

**Source PID:** `MTNY-RXQ`
**Rafael Reyes is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> Did Rafael Reyes and his wife Serapia Benavides Cueva of Usulután, El Salvador have a daughter named Rita, born and died in 1913?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `MTNY-RXQ` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-07-31: false match, no findable substitute.** This fixture came from a hint batch (`filtered-list-samples.csv` row 16, flag `adds_daughter`, confidence 3) in which roughly half the hint records are false matches. `expected-findings.json` was originally transcribed from the hint record — El Salvador, Civil Registration, 1704-2001: death registration, 22 July 1932, Santa Elena, Usulután, for Rita Reyes (b./d. Jan 1913), naming parents Manuel Rafael Reyes and Serapia Benavides.

Weighed against the tree: Rafael Reyes (MTNY-RXQ) married Serapia Benavides Cueva 19 January 1860 in Usulután, Usulután — a different specific town within the same department as the hint record's Santa Elena. The hint's father carries an extra given name ("Manuel") the tree's Rafael Reyes does not. The claimed 1913 birth falls 53 years after the couple's only recorded event (their 1860 marriage), with zero other children recorded for them in that span, and no birth record for Rita — only the death registration — was located, so the parents' ages at the 1932 registration (which could have settled this independently) could not be confirmed; the original historical document is handwritten and was not legible enough to read further detail from.

One argument was raised in favor of caution before ruling this out: the tree's silence on other children isn't proof they didn't exist, since Rita's own record wasn't captured until 19 years after her death — a genuinely incomplete tree could simply be missing them. A second genealogist's independent review weighed this against the accumulated points of doubt (the name discrepancy, the locality difference, the chronological gap, and the absence of a birth record for Rita) and concluded the balance favors a different, later-generation Rafael Reyes and Serapia Benavides bearing the same recurring family names — consistent with a grandson or great-grandson in the same small community, the same pattern already flagged as plausible in the original draft. No corroborating source ties this specific record to the tree's Rafael Reyes (MTNY-RXQ).
