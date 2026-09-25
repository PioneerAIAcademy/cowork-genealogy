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
substitute. Researched on familysearch.org by hand; retrieval was not
tool-assisted. Second opinion given by **Ikennaya Mbadiwe**, as issue #2314
requires for this fixture; the identification of the subject's own marriage is
his finding. The marriage record was afterwards re-read with `record_read`
against live FamilySearch to confirm its contents (spec §3.6 permits
tool-assisted *retrieval*; the identity judgement remained the genealogist's).

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
attached to her in error from that record. The sources belong on her; the parent
edges derived from them do not. `SYXS-SC8` (`ark:/61903/1:1:QVR6-Q9DC`) is her
birth entry, 20 May 1866.

(The three cite two ark families — `X3L8-MFL*` and `X3G7-XG5*` — and their
`url` and `citation` fields disagree on the ark, as issue #2314 noted. They
resolve to per-person arks on the same 26 Jul 1900 act; `X3L8-MFLR` is the
bride's persona, which is why it is the one cited above.)

**Nothing was corrected upstream.** Ikennaya's review recommends detaching the
Vaglio parents on the live tree; that is deliberately **not** done here, because
issue #2314 forbids editing live FamilySearch during adjudication so
`starting-tree.gedcomx.json` and `unstripped-tree.gedcomx.json` stay
byte-identical and `snapshot --check` can still audit drift. Tracked in issue
#2908.

**A birthplace conflict, documented not resolved.** Her birth record
(`ark:/61903/1:1:QVR6-Q9DC`) gives **20 May 1866 at Genova**. The marriage record
reports **Lima**, and the tree follows Lima with no day or month. The birth
record is the stronger evidence, but the conflict is recorded here rather than
silently resolved. It is deliberately *not* encoded as a graded finding: the
fixture's question is about her spouse, and grading a birthplace conflict would
widen what the benchmark scores beyond the question asked.

**On the age question — settled: 17.** Issue #2314 asked whether the subject was
16 or 17 on 30 August 1883, her tree birth fact being year-only (`1866`).
`SYXS-SC8` (`ark:/61903/1:1:QVR6-Q9DC`) is her birth entry, **20 May 1866**, so
she was 17 years 3 months. That was legal and unremarkable in 1880s Liguria, so
age never could have disproved the hint on its own — and in the event the call
turned on her marriage, not her age.

Note for the corpus: the batch CSV labels this row Peru because she was born in
Lima; every record involved is Genovese.
