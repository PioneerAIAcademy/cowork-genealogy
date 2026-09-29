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

**Adjudicated: the hint is a false match** — spec §3.6 outcome (c), no findable
substitute. Second opinion given by **Ikennaya Mbadiwe**, as issue #2314 requires
for this fixture; the identification of the subject's own marriage is his
finding.

**Retrieval was partly tool-assisted** (§3.6 asks that this be recorded). The
research was done by hand on familysearch.org; afterwards the marriage record
`ark:/61903/1:1:X3L8-MFLR` was re-read with the `record_read` MCP tool against
live FamilySearch to confirm its contents, and `image_read` / `image_transcribe`
were attempted on the register scan and failed (see below). No other record here
was tool-retrieved, and the identity judgement was the genealogist's throughout.

The hint record is `ark:/61903/1:1:6BHW-1HG3` — "Italia, Genova, Genova, Stato
Civile (Tribunale), 1866-1929", a birth entry of 30 August 1883 at Genova for
Maria Clementina Angelica Gentile Dondero, naming parents Pietro Dondero and
Carmela Cavagnaro. That ark appears nowhere else in this fixture folder, so it is
recorded here for the next reader.

**What decided it: the subject has a documented husband, and he is not Pietro
Dondero.** The Genova civil registration at `ark:/61903/1:1:X3L8-MFLR` records
her marriage to **Paolo Andrea Vaglio** on **26 Jul 1900 at Bogliasco**. Read
directly, the record names the bride **Matilde Carmela Emanuela Cavagnaro**,
born **1866 at Lima**, *Maestra Elementare*, daughter of **Giuseppe** and
**Maddalena Bitano** — parents, birth year and birthplace all matching
`G4Z4-RJ1`. That is a firm identification of the tree person, not a namesake.
(On birthplace, see "Lima, not Genova" below: the apparent Genova/Lima conflict
was resolved in Lima's favour after this fixture was first written, so the
record's *Lima* is genuine corroboration and not merely agreement with the
tree's own claim.)
The groom is Paolo Andrea Vaglio, b. 1867 Bogliasco, *Segretario Comunale*, son
of **Angelo** and **Maria Fereccio**.

The Carmela Cavagnaro of the hint is a different woman: married to Pietro
Dondero and bearing him children at Genova in at least 1883 (the hint record)
and 1891 (Attilio Omero Dondero, `ark:/61903/1:1:X3TM-QPSS`) — a settled
Genovese household distinct from the subject's. Some records reportedly name her
**Carmela Rosa Cavagnaro**; that reading comes from the second opinion and no
ark for it is recorded here.

The hint identifies its mother only *indirectly*: the 1883 index gives her no
age, no patronymic and no birthplace, so name alone is all it offers, and the
name recurs in the district. The subject's own third given name being Carmela is
what drew the match, and it was never enough. The decisive work was not on the
hint record at all — it was researching the subject's parents and marriage.

**What this does not establish — read before relying on the fixture.** The
Vaglio marriage is dated **1900**, seventeen years after the hint birth, and the
indexed record carries **no *stato civile*** for the bride (*nubile* vs
*vedova*). So it does not by itself exclude an earlier marriage to Dondero
followed by widowhood; the rejection rests on the identification and on the
Dondero household being separately documented, not on chronology. Reading the
bride's civil status off the register image
(`ark:/61903/3:1:3QS7-L9WL-JC3N`) would close that gap outright — *nubile* would
make the rejection airtight. It was attempted here and not completed: the scan
is 1.8 MB, too large for `image_read`, and no OpenRouter key was configured for
`image_transcribe`. A reviewer wanting the conclusive form should ask for that
one field.

**What was searched and came up empty.** Genova birth records were searched for
an entry linking Giuseppe Andrea Cavagnaro to Matilde Carmela Emanuela
Cavagnaro; no record was found. No marriage between the subject and Pietro
Dondero was found, and no substitute answer — a different 1883 child for
Matilde — turned up to put in the hint's place. That absence is why this is
outcome (c) rather than (b).

**Parentage, and a correction to this fixture's own premise.** The subject's
parents are **Giuseppe Cavagnaro and Maddalena Boitano** (`G9WF-FJQ` /
`G4Z4-RJM`), married 28 Apr 1853 at Favale di Malvaro. The second parent set in
the starting tree — Angelo Vaglio (`PQWR-XH7`) and Maria Fereccio (`PQWR-QB9`),
who carry no facts at all — is wrong, but **not for the reason issue #2314
assumed**. Those three "Vaglio" sources (`7PM9-ZQP`, `7PM9-W4L`, `7PM9-W5S`) are
not mis-attached strangers' records: they are the subject's **own marriage
record**, indexed under the groom's line as *Paolo Andrea Vaglio and Angelo,
26 Jul 1900*. Reading the record confirms it — it carries `ParentChild` edges
from **Angelo** and **Maria Fereccio** to *Paolo Andrea Vaglio*, and separately
from **Giuseppe** and **Maddalena Bitano** to the bride. So Angelo Vaglio and
Maria Fereccio are the **groom's** parents, the subject's parents-in-law,
attached to her in error from that record. `SYXS-SC8`
(`ark:/61903/1:1:QVR6-Q9DC`) is the 1877 Genova transcription of her Lima baptism
(see "Lima, not Genova" below).

Of the three "Vaglio" sources, **two belong on her and one does not**. `7PM9-ZQP`
(`X3L8-MFLR`) and `7PM9-W4L` (`X3G7-XG5Y`) are her own personas on the act and are
correctly attached. `7PM9-W5S` (`X3G7-XG52`) is **Paolo's** persona, titled for
him, and attaching it asserts that she *is* him — which is the likeliest route by
which his parents were pulled onto her, and a generator of further bad hints. It
is still attached: see the upstream note below.

(The three cite two ark families — `X3L8-MFL*` and `X3G7-XG5*` — and their
`url` and `citation` fields disagree on the ark, as issue #2314 noted. They
resolve to per-person arks on the same 26 Jul 1900 act; `X3L8-MFLR` is the
bride's persona, which is why it is the one cited above.)

**Corrected upstream 2026-09-29 (issue #2908) — the committed snapshot
deliberately still carries the old state.** Issue #2314 forbade editing live
FamilySearch during adjudication, so PR #2900 left the defect in place and filed
it separately. It has since been fixed on the live tree: the three ParentChild
edges attaching Angelo Vaglio (twice) and Maria Fereccio to `G4Z4-RJ1` were
removed, and her birth date corrected from `1866` to `about 10 May 1866`.
`starting-tree.gedcomx.json` and `unstripped-tree.gedcomx.json` are **unchanged
and still byte-identical** — the snapshot is the benchmark input, the agent is
meant to see the wrong parents, and re-snapshotting would silently rewrite the
test (`docs/specs/e2e-test-spec.md` §3.5). `snapshot --check` went from **16
DRIFT lines to 19**: five added and two removed, not five on top of sixteen. The
two `person changed upstream` lines for `PQWR-XH7` and `PQWR-QB9` were **replaced
by** `person gone upstream` lines, because the pair are no longer her relatives
at all. Added:

```
person gone upstream: PQWR-XH7 (Angelo Vaglio)
person gone upstream: PQWR-QB9 (Maria Fereccio)
relationship gone upstream: Couple PQWR-XH7 PQWR-QB9
relationship gone upstream: ParentChild PQWR-XH7 G4Z4-RJ1
relationship gone upstream: ParentChild PQWR-QB9 G4Z4-RJ1
```

**Open question — needs a ruling, and does not yet have one.** Source `7PM9-W5S`
(`ark:/61903/1:1:X3G7-XG52`) is Paolo Andrea Vaglio's own persona on the marriage
act and is **still attached** to `G4Z4-RJ1`, which asserts she *is* him — the
likeliest route by which his parents reached her, and a generator of further bad
hints. It was not detached because the authorised scope was parents and birth
date only, set before the second opinion found it. Issue #2908 is closed, so this
is recorded here rather than there. Whoever answers it should record the answer
in this paragraph.

**Lima, not Genova — there is no birthplace conflict.** An earlier revision of
this README recorded one; that was wrong and is corrected here. `SYXS-SC8`
(`ark:/61903/1:1:QVR6-Q9DC`) indexes a **birth, 20 May 1866, at San Rocco Sopra
Principe, Genova**. Reading the image shows the entry is a **transcription**:
Giuseppe brought a Spanish-language certificate to the Genova registry to be
copied in, and the original is a baptism at the Parish of Sant'Anna, **Lima**.
The record's own metadata agrees — its `DigitalArtifact` coverage is
`1877/1877`, so the volume is 1877 while the act it carries is 1866. Genova is
where the paperwork was filed, not where she was born, so Lima — which the tree
and the marriage record both carry — is correct and the two sources never
disagreed. Ikennaya Mbadiwe's finding.

**What the 20 May 1866 date is has NOT been established.** It is the date the
entry itself carries (`coverage.date_range` reads *"20 maggio 1866"*), so it is
neither a filing date — the volume is 1877 — nor an indexer's invention. But it
is one day *before* the baptism of 21 May, so it is not the baptism either, and
it is ten days after the birth it implies. Whether it is the date of the original
Lima act, or a transcription slip for the 21st, needs the image re-read. An
earlier revision of this README asserted it was "the filing date read as a birth
date"; that was wrong and is withdrawn.

**On the age question — settled: 17.** Issue #2314 asked whether the subject was
16 or 17 on 30 August 1883, her tree birth fact being year-only (`1866`). She was
baptised 21 May 1866 aged eleven days, so born **about 10 May 1866** — making her
17 years 3 months at the 1883 birth. The answer is 17 on any reading of the
paragraph above: 20 May and 21 May 1866 both give the same age in August 1883.
That was legal and unremarkable in 1880s Liguria, so age never could have
disproved the hint on its own — and in the event the call turned on her marriage,
not her age.

**On the avoid guard and the two WARNs.** `f1` carries `polarity: "avoid"`, which
is what switches `apply_avoid_guard` on for this fixture — before adjudication it
had no polarity and the guard returned early, so the exposure below **arrives
with this fixture's resolution**, it is not pre-existing.

`make e2e-validate` emits a name-overlap WARN on `f2` against `G4Z4-RJ1`. It is
harmless: the guard exempts `subject_person_ids`, which is `["G4Z4-RJ1"]` in
`starting-research.json`, and nothing was stripped in this genre so the subject
legitimately stays in the tree. **That exemption is keyed on PID and spares her
alone.**

`f1`'s `wrong_candidate.name` is deliberately the bare string `"Pietro Dondero"`.
`finding_name_tokens` harvests *every* word of a `name` leaf, so a descriptive
value such as "Pietro Dondero, husband of a Carmela Cavagnaro at Genova" would
put `carmela` and `cavagnaro` into the avoid bag — and since the exemption
covers only `G4Z4-RJ1`, a good run that stubs the *other* Carmela Cavagnaro as a
distinct woman (a reasonable thing to do when the question is whether the two are
the same, and the agent never sees this file) would be force-failed for it.
Measured against the shipped guard: with the bare name, a tree stubbing the other
Carmela returns `f1=true`, a tree over-claiming Dondero onto the subject still
returns `f1=false`, and a clean tree returns `f1=true`. **Do not re-expand that
leaf into a description.** Put descriptive text in the sibling `note`, which the
matcher does not collect.

Note for the corpus: the batch CSV labels this row Peru because she was born in
Lima; every record involved is Genovese.
