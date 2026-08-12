# Anna Marie Findejsová — additional daughter Agnes (b. 1818)

**Source PID:** `P915-7QP`
**Anna Marie Findejsová is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
13 March 1784, Bystré, Polička, Bohemia; died not recorded in the tree.

## Research question

> Did Anna Marie Findejsová and her husband Maxmilián Michl have a daughter named Agnes, born 1818, in addition to their daughter Anna (b. 1823)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `P915-7QP` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: TRUE MATCH** (genealogist adjudication). The hint record's
persona (`ark:/61903/1:1:6PJZ-ZBSM` — Czech Republic, Church Books,
1552-1981; baptism of Agnes, 1 March 1818, Svitavy parish) is the same
couple as tree person Anna Marie Findejsová (`P915-7QP`) and her husband
Maxmilián Michl, so Agnes is their daughter and the finding stands. Three
converging points of agreement, no contradiction:

- **Name.** The register records the mother as "Anna Kristina"; the tree
  records her as Anna Marie Findejsová — the shared given name "Anna" with a
  differing middle name, a routine variation in Czech parish books.
- **Spouse.** Both name the husband Maxmilián / Maxmilian Michl / Michal;
  the Michl↔Michal surname variant is a routine orthographic difference in
  Bohemian and Moravian registers of this period, not a different family.
- **Locality (verified provenance).** The baptism is in the **Svitavy /
  Mährisch Trübau register (Moravia)** — image group 005652359, image 23 of
  321, Pag. 20, Entry 2, house no. 29 (`ark:/61903/3:1:3QS7-89S1-K869`) — not
  the Bystré/Bistrau register (Bohemia). The original Bystré hypothesis was
  **wrong**: Bystré u Poličky had its own parish (register at SOA Zámrsk,
  catalog item 2425217, not digitized on FamilySearch), which is why every
  Bystré-focused search came back empty — the record was never there. The
  family was in Svitavy (house 29) by 1818.

No conflicting husband, birthplace, or date appears in the record, and Anna
Marie (b. 1784) would have been ~34 at the baptism on 1 March 1818 — an
entirely plausible maternal age. Name + spouse + house-number provenance,
with zero contradicting evidence, is sufficient to conclude the record
persona and the tree person are the same individual, so Agnes (b. 1818) is
a real, additional daughter alongside Anna Michlová (b. 16 September 1823,
d. 1833).

**Proof standing: Probable, not Proved.** The date, parents, and house
number converge with the tree evidence, but the child's name and the
father's surname have not been read directly from the original image — the
OCR misread them (child "Clymus" for Agnes, father "Winfal" for Michal) and
the higher-accuracy reader could not process the 2.3 MB scan, so the child's
name Agnes was confirmed through corroborating tree data rather than an
independent image read. A clean direct read of "Agnes" and "Michal" from
image group 005652359 is the one step that would move this to Proved.
