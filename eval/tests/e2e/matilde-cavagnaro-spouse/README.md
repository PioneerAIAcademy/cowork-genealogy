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

**Adjudicated: the hint is rejected** — spec §3.6 outcome (c), no findable
substitute. The identification fails; the hint is not supportable rather than
positively refuted, and the distinction is set out under "What decided it"
below. Researched on familysearch.org by hand; retrieval was not tool-assisted.
Second opinion given by **Ikennaya Mbadiwe**, as issue #2314 requires for this
fixture.

The hint record is `ark:/61903/1:1:6BHW-1HG3` — "Italia, Genova, Genova, Stato
Civile (Tribunale), 1866-1929", a birth entry of 30 August 1883 at Genova for
Maria Clementina Angelica Gentile Dondero, naming parents Pietro Dondero and
Carmela Cavagnaro. That ark appears nowhere else in this fixture folder, so it is
recorded here for the next reader.

**What decided it — and what did not.** Be clear about the shape of this call:
**no record positively refutes the hint.** The verdict rests on the
identification failing, not on a disproof. Three things carry it:

1. The hint fixes its mother by **name alone**. The index gives her no age, no
   patronymic and no birthplace, so nothing in it distinguishes this Carmela
   Cavagnaro from any other. The subject's own third given name being Carmela is
   what drew the match, and it is not enough.
2. **The name recurs in the district.** A further Carmela Cavagnaro was born
   14 Jul 1897 at Lorsica to a different Giuseppe Cavagnaro and a Maria
   Cavagnaro — born too late to be the 1883 mother, but evidence that the name
   is not a discriminator. (Note the subject's own father Giuseppe Cavagnaro
   died at Lorsica in 1886 and was married to Maddalena Boitano, so the 1897
   couple is a different one.)
3. **Pietro Dondero and Carmela Cavagnaro were a settled Genovese couple**, still
   producing children in 1891 — the birth of Attilio Omero Dondero, 31 May 1891
   (`ark:/61903/1:1:X3TM-QPSS`), is a further child of the same pair. That
   record's index likewise carries nothing identifying about the mother. Nothing
   ties that Carmela to a woman born 1866 in Lima whose family is recorded at
   Lorsica and Favale di Malvaro.

**What was searched and came up empty.** Genova birth records were searched for
an entry linking Giuseppe Andrea Cavagnaro to Matilde Carmela Emanuela
Cavagnaro; no record was found. No marriage between the subject and Pietro
Dondero was found, and no substitute answer — a real husband or a real 1883
child for Matilde — turned up to put in the hint's place. That absence is why
this is outcome (c) rather than (b).

**What would settle it properly, and was not done.** The register *images* for
the 1883 and 1891 births were not read. An Italian birth act normally states the
mother's age and names her father (*figlia di…*), which is exactly the
patronymic the index omits; so is the couple's marriage act. Either would
convert this from an identification failure into a decision. A reviewer who
wants the stronger form should ask for those before this fixture is used to
grade anything.

**Parentage, resolved.** The subject's parents are **Giuseppe Cavagnaro and
Maddalena Boitano** (`G9WF-FJQ` / `G4Z4-RJM`), the couple married 28 Apr 1853 at
Favale di Malvaro. The second parent set in the starting tree — Angelo Vaglio
(`PQWR-XH7`) and Maria Fereccio (`PQWR-QB9`), who carry no facts at all — is a
mis-attachment. Three of the tree's four sources (`7PM9-ZQP`, `7PM9-W4L`,
`7PM9-W5S`) all index the same entry for *Paolo Andrea Vaglio and Angelo, 26 Jul
1900*; the first two are **titled** for the subject while `7PM9-W5S` is titled
for Paolo Andrea Vaglio, and those mis-titles are what dragged the Vaglio couple
onto her. The one source that genuinely cites her is `SYXS-SC8`
(`ark:/61903/1:1:QVR6-Q9DC`), the 20 May 1866 Genova entry naming her with
Giuseppe Cavagnaro. **Nothing was corrected upstream** — the live FamilySearch
tree was deliberately left untouched so `starting-tree.gedcomx.json` and
`unstripped-tree.gedcomx.json` stay byte-identical and `snapshot --check` can
still audit drift.

**On the age question.** Issue #2314 asked whether the subject was 16 or 17 on 30
August 1883, since her tree birth fact is year-only (`1866`). It is left
unsettled, deliberately. If `SYXS-SC8` is read as her birth registration she was
17y3m, which would have been legal and unremarkable in 1880s Liguria — so age was
never going to disprove the hint on its own, and the call did not turn on it.

Note for the corpus: the batch CSV labels this row Peru because she was born in
Lima; every record involved is Genovese.
