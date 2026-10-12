# Григорий Захаров Кокоша — death in September 1846, Zhydivska Hreblia, Kiev, Russian Empire

**Source PID:** `GSTD-C4H`
**Григорий Захаров Кокоша is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1818 in Zhydivska Hreblia, Tarashcha district, Kiev governorate; the tree carries an undated Death fact. Son of Захар Иванов Кокошенко and Анастасия Прокопова Чумак; married Татьяна Иванова Гейко on 24 January 1843 in Tarashcha; one child in the tree, Анна, baptised February 1844.

## Research question

> When and where did Григорий Захаров Кокоша, born about 1818 in Zhydivska Hreblia, Tarashcha, Kiev, and married to Татьяна Иванова Гейко in 1843, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GSTD-C4H` with relatives). Nothing was
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
(`filtered-list-samples-3.csv` row 22, `hint-samples.csv` row 768,
flag `adds_death`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Ukraine, Kyiv, Orthodox Consistory Church Book Duplicates, 1723-1931", a death entry for Григорий Кокоша (born about 1821) who died 18 September 1846, recorded at the church of St John the Theologian (Иоанно-Богословская церковь) in Жидовская Гребля, Tarashcha, Kiev.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming the September 1846 death, plus a `required` finding that the report documents
the rejection.

The hint batch lists the country as "Russian Empire"; the parish is in today's Kyiv Oblast and the collection is Ukrainian, so `fixture.json` tags the geography `UA`.

A plausible candidate, thin on identifiers. Name, surname form and village all fit: the tree's sources index him and his brothers Илья and Емельян as Кокоша, and Жидовская Гребля is where the tree has all of them born. The implied birth of about 1821 is three years off the tree's 1818, within the usual drift of an age at death. The timing fits the tree as well: his last appearance is his daughter Анна's baptism in February 1844, and nothing in the tree places him alive after that. His existing sources are that baptism (`ark:/61903/1:1:KXPB-DG6`) and the 1843 marriage (`ark:/61903/1:1:FNGV-JL3`); neither is a re-index of this entry.

What is thin is identity. The index carries only a given name, surname and age: no patronymic (his other entries read Григорий Захариев), no wife, no estate. A second Григорий Кокоша in a village where the family was large cannot be excluded from the index alone. The image's own catalog coverage is labelled as a church-marriage image, so a reviewer should also confirm the entry sits in the death section of the 1846 book. The discriminating check is the register image linked from the hint record: an Orthodox metric-book death entry normally gives the patronymic or names the widow. Захариев, or a widow Татьяна, settles it; a different patronymic makes this another man.
