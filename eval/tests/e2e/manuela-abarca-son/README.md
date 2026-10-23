# Josefa Manuela Abarca Fallas — a son José Vidal born October 1899, San Juan de Dios, Desamparados, Costa Rica

**Source PID:** `G7XQ-GMG`
**Josefa Manuela Abarca Fallas is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born and christened 12 June 1873 at Aserrí, San José; daughter of Rafael de Jesús Abarca Monge (died 1891) and Francisca de Jesús Fallas Alfaro (died 1900), whose family runs through Desamparados and Aserrí. Her marriage information with Juan García Calderón (born about 1862) is dated 30 December 1890 at the San José cathedral, and the civil marriage registration 15 January 1892; the tree's couple fact puts the marriage at Aserrí on 14 January 1892. The tree carries no children for the couple.

## Research question

> Josefa Manuela Abarca Fallas, born 12 June 1873 at Aserrí, San José, daughter of Rafael de Jesús Abarca Monge and Francisca de Jesús Fallas Alfaro, married Juan García Calderón by civil registration in January 1892. What children did Manuela and Juan have?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `G7XQ-GMG` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-4.csv` row 6, `hint-samples.csv` row 209,
flag `adds_son`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Costa Rica, Civil Registration, 1823-2023", the birth registration of José Vidal García Abarca, born 22 October 1899 at San Juan de Dios, naming his parents as Juan García and Manuela Abarca. The index gives neither parent a second surname.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming José Vidal as Manuela's son, plus a `required` finding that the report documents
the rejection.

A plausible candidate. The couple's names match, the child's surnames García Abarca follow from them, and San Juan de Dios is a district of Desamparados, the parish where most of Manuela's siblings were baptised. The birth falls seven years into the marriage, and the tree holds no child of the couple, so this is not a re-index of an attached source.

The weakness is that García and Abarca are both common in the San José valley, and the index carries no second surnames, so a different Juan García and Manuela Abarca cannot be excluded from the index alone. The tree adds a complication. It also holds a **Maria Manuela Abarca Fallas** (`GSJN-6X7`), born 1873 at Desamparados to the same parents, with a civil marriage registration in San José and a death at Desamparados on 13 December 1924. Two daughters both named Manuela born to one couple in the same year is unlikely. Either `GSJN-6X7` duplicates the subject, or she is a different woman wrongly attached to this family. If her husband was also a Juan García, the hint could belong to either record.

The discriminating check is the 1899 birth entry on the register image. Costa Rican civil births of that period usually give both parents' second surnames and often the grandparents. "Abarca Fallas" for the mother, or maternal grandparents Rafael Abarca and Francisca Fallas, makes the hint the subject's child. A different second surname makes it a false match.
