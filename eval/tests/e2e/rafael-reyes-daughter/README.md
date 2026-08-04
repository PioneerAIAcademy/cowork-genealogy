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

**Reopened and resolved 2026-08-04: probable true match.** A scored benchmark run against this fixture examined the *original* register image (ark:/61903/3:1:33S7-9TRR-4T4, Parte N°75) rather than relying on the FamilySearch derivative index used in the first pass below. The original text states directly: *"la señora Rita Reyes, quien fué soltera, de oficios domésticos y de este domicilio, hija legítima de Manuel Rafael Reyes y Serapia Benavides, falleció de parto en el mes de Enero de año mil novecientos trece..."* — i.e., Rita was an adult woman ("la señora," unmarried, domestic occupation) who died in childbirth in January 1913, not an infant born and died that year as the index and the original hint record's "birth: January 1913" field implied (a data-entry error duplicating the death date).

This resolves one of the three objections raised in the 2026-07-31 false-match analysis below: the father's name "Manuel Rafael Reyes" is read as a baptismal-name pattern ("Manuel" as an unused first name, "Rafael" as the name in daily use) rather than a discrepant extra given name, since the original document states the filiation outright rather than requiring inference from an index field. The other two objections from the first pass — the different specific town (Santa Elena vs. the couple's 1860 marriage in Usulután) and the 53-year gap with no other recorded children — were **not** independently re-examined in this round; the run's own proof conclusion capped at "probable" tier for exactly this reason (single source, no independent corroboration), and its internal GPS-mentor critique returned an "address_first" verdict rather than a clean pass. This reopening was decided by one genealogist without a second reviewer, unlike the first pass below.

**First resolved 2026-07-31: false match, no findable substitute** (superseded above). This fixture came from a hint batch (`filtered-list-samples.csv` row 16, flag `adds_daughter`, confidence 3) in which roughly half the hint records are false matches. `expected-findings.json` was originally transcribed from the hint record — El Salvador, Civil Registration, 1704-2001: death registration, 22 July 1932, Santa Elena, Usulután, for Rita Reyes (b./d. Jan 1913), naming parents Manuel Rafael Reyes and Serapia Benavides.

Weighed against the tree: Rafael Reyes (MTNY-RXQ) married Serapia Benavides Cueva 19 January 1860 in Usulután, Usulután — a different specific town within the same department as the hint record's Santa Elena. The hint's father carries an extra given name ("Manuel") the tree's Rafael Reyes does not. The claimed 1913 birth falls 53 years after the couple's only recorded event (their 1860 marriage), with zero other children recorded for them in that span, and no birth record for Rita — only the death registration — was located, so the parents' ages at the 1932 registration (which could have settled this independently) could not be confirmed; the original historical document is handwritten and was not legible enough to read further detail from.

One argument was raised in favor of caution before ruling this out: the tree's silence on other children isn't proof they didn't exist, since Rita's own record wasn't captured until 19 years after her death — a genuinely incomplete tree could simply be missing them. A second genealogist's independent review weighed this against the accumulated points of doubt (the name discrepancy, the locality difference, the chronological gap, and the absence of a birth record for Rita) and concluded the balance favors a different, later-generation Rafael Reyes and Serapia Benavides bearing the same recurring family names — consistent with a grandson or great-grandson in the same small community, the same pattern already flagged as plausible in the original draft. No corroborating source ties this specific record to the tree's Rafael Reyes (MTNY-RXQ).
