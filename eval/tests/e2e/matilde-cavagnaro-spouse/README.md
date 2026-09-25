# Matilde Carmela Emanuela Cavagnaro — husband Pietro Dondero and a daughter born 1883 at Genova

**Source PID:** `G4Z4-RJ1`
**Matilde Carmela Emanuela Cavagnaro is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1866 in Lima, Peru, to Ligurian parents; death not recorded in the tree.

## Research question

> Was the Carmela Cavagnaro who bore a daughter, Maria Clementina Angelica Gentile Dondero, at Genova on 30 August 1883 with Pietro Dondero the same woman as Matilde Carmela Emanuela Cavagnaro, born 1866 in Lima?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `G4Z4-RJ1` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Adjudicated: the hint is a false match** (spec §3.6 outcome (c) — no findable
substitute). Researched on familysearch.org by hand; retrieval was not
tool-assisted. Second opinion given by **Ikennaya Mbadiwe**, as issue #2314
requires for this fixture.

The hint record is `ark:/61903/1:1:6BHW-1HG3` — "Italia, Genova, Genova, Stato
Civile (Tribunale), 1866-1929", a birth entry of 30 August 1883 at Genova for
Maria Clementina Angelica Gentile Dondero, naming parents Pietro Dondero and
Carmela Cavagnaro. That ark appears nowhere else in this fixture folder, so it is
recorded here for the next reader.

**What decided it.** The civil marriage entry for Pietro Dondero and Carmela
Cavagnaro (`ark:/61903/1:1:X3TM-QPSS`) identifies the Carmela Cavagnaro who was
Pietro Dondero's wife, and she is not the subject. The 1883 birth entry belongs
to that couple. The hint rests on name alone: its index gives the mother no age,
no patronymic and no birthplace, and "Carmela Cavagnaro" is an ordinary Ligurian
name in the one city where the surname is commonest — so nothing in the hint
itself distinguishes this Carmela from any other. The subject's own third given
name being Carmela is what drew the match, and it is not enough.

**What was searched and came up empty.** Genova birth records were searched for
an entry linking Giuseppe Andrea Cavagnaro to Matilde Carmela Emanuela
Cavagnaro; no record was found. So the Carmela Cavagnaro of the Dondero marriage
cannot be tied to the subject on parentage, and no substitute answer — a real
husband or a real 1883 child for Matilde — was found to put in the hint's place.
That absence is why this is outcome (c) rather than (b).

**Parentage, resolved.** The subject's parents are **Giuseppe Cavagnaro and
Maddalena Boitano** (`G9WF-FJQ` / `G4Z4-RJM`), the couple married 28 Apr 1853 at
Favale di Malvaro. The second parent set in the starting tree — Angelo Vaglio
(`PQWR-XH7`) and Maria Fereccio (`PQWR-QB9`), who carry no facts at all — is a
mis-attachment. Three of the tree's four sources (`7PM9-ZQP`, `7PM9-W4L`,
`7PM9-W5S`) are titled for the subject but index the same entry for *Paolo Andrea
Vaglio and Angelo, 26 Jul 1900*, and that is what dragged the Vaglio couple onto
her. The one source that genuinely cites her is `SYXS-SC8`
(`ark:/61903/1:1:QVR6-Q9DC`), the 20 May 1866 Genova entry naming her with
Giuseppe Cavagnaro. **Nothing was corrected upstream** — the live FamilySearch
tree was deliberately left untouched so `starting-tree.gedcomx.json` and
`unstripped-tree.gedcomx.json` stay byte-identical and `snapshot --check` can
still audit drift.

**On the age question.** Issue #2314 asked whether the subject was 16 or 17 on 30
August 1883, since her tree birth fact is year-only (`1866`). The call did not
turn on it: identity was settled on the marriage entry, not on whether a birth at
17 was plausible. If `SYXS-SC8` is read as her birth registration she was 17y3m,
which would have been legal and unremarkable in 1880s Liguria — so age was never
going to disprove the hint on its own, and it is left unsettled here.

Note for the corpus: the batch CSV labels this row Peru because she was born in
Lima; every record involved is Genovese.
