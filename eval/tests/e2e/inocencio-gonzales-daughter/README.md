# Inocencio Gonzales — a daughter Juana baptised in July 1895, Sacaca, Potosí, Bolivia

**Source PID:** `GY75-S9D`
**Inocencio Gonzales is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no dates or places for him. He is known only as the father named on two Potosí marriages of a daughter Victoria: to Severino Cruz on 7 May 1905 (bride born about 1887, mother indexed Antonia Elsaque) and to Evaristo Mamani Inuca on 13 October 1914 (bride born about 1886, mother indexed Antonia Uraque). The tree holds these as two wives (Antonia Elsaque `PSPZ-47D`, Antonia Uraque `P9BB-7GZ`) and two daughters Victoria (`PSPZ-CLD`, `GY75-7TJ`), which are very likely one wife and one daughter each. An Antonia Uraque born about 1853 also married Antonio Gonzales in Potosí on 31 October 1903; the tree attaches that entry to `P9BB-7GZ`.

## Research question

> Inocencio Gonzales (also Gonzalo) and his wife Antonia Uraque (also indexed Elsaque) are known from their daughter Victoria's Potosí marriages of 1905 and 1914, which give her birth as about 1886. What other children did Inocencio and Antonia have?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GY75-S9D` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: TRUE MATCH** (adjudicated 2026-10-23). Retrieval was tool-assisted
(MCP `record_read` / `record_search` against live FamilySearch); the identity
judgement is an independent genealogist's (**Isaac Boateng**, second opinion —
the case was borderline, so a second opinion was obtained per the issue).

**Verdict and basis (index-based).** The 1895 Sacaca baptism of **Juana Gonsalo**
(`ark:/61903/1:1:6CB7-Y7JY`; the hinted persona is her father's, `ark:/61903/1:1:6CB7-Y7JB`) — born 19 July 1895, baptised 21 July 1895, event
place as **indexed** *Sacaca, Alonzo de Ibáñez, Potosí, Bolivia*, parents
**Inocencio Gonsalo** and **Antonia Araque** — is accepted as a daughter of the
subject **Inocencio Gonzales** (`GY75-S9D`) and his wife **Antonia**. The
resolution rests on the FamilySearch **index**, not the register image (see
"Image limitation" below), so `image_basis` is false.

**Why the indexed father is the subject.** The conjunction of several index
facts, not any one: **given name** — "Inocencio" is uncommon, borne by both;
**wife** — "Antonia" matches exactly and her surname "Araque" sits in the same
cluster the tree shows ("Uraque" 1914, "Elsaque" 1905); **surname** — "Gonsalo"
is the tree's "Gonzales" (the 1905 marriage spells it "Gonzalo"); **place** —
both Potosí, baptism at Sacaca; **chronology** — Juana (b. 1895) fits as a
younger child of the couple whose daughter Victoria was born about 1886. This is
a most-probable identification — a genealogical judgement that a second, distinct
Inocencio-and-Antonia couple of this surname cluster in Potosí in the same years
is unlikely — not a documentary linkage; such a namesake couple cannot be
formally excluded from the index alone, and the subject's marriages carry no
parish to place the family in Sacaca.

**What the index does NOT establish.** Gonzalo/Gonzales is common, and the
subject's marriages (Victoria's 1905/1914) are indexed only "Bolivia" — no parish
— so nothing in the subject's own records places the family in Sacaca. One
further San Luis de Sacaca baptism (José Miguel Gonsales, Nov 1899,
`ark:/61903/1:1:6ZQR-FS49`) is only **suggestive, not conclusive**: its index is
garbled (father mis-indexed "Inocencio Oraque", no mother persona, junk personas,
mismatched image dates), so it is **not relied upon** as sibling evidence.
Identity rests on the name/place/era conjunction plus the genealogist's judgement.

**Independent second opinion (Isaac Boateng).** Isaac concludes the hint is a
true match — Juana is another daughter of Inocencio Gonzales and Antonia, likely
born 19 July 1895 and baptised 21 July 1895 at Sacaca — considering the surname
differences consistent with the couple's variants, and recommends accepting. He
also cautions there are **possible duplicate profiles** for the wife Antonia and
the daughter Victoria to investigate before any merge, and that the **1903
marriage** of an Antonia Uraque to *Antonio* (not Inocencio) Gonzales **may
concern a different woman** needing verification. These cautions are for
reviewers; they are out of scope for this fixture.

**Image limitation (uncalibrated — not relied upon).** Isaac examined the
original register image and reports "legitimate" daughter, "two days old", and
the mother read as "Antonia **Oraque**". The issue's Step 1a calibration
(compare two other same-page indexed entries to their images before reading the
target) was **not performed**, so under the issue rules that reading is
**unlicensed** and is **not used**. The fixture uses the **indexed** mother name
"Antonia **Araque**" and the **indexed** event place, and sets `image_basis`
false. The baptism image ark (`ark:/61903/3:1:33S7-9Y94-9J21`) and the "San Luis
de Sacaca" parish are collection/image metadata, not a calibrated register
reading, and are noted only for reference.
