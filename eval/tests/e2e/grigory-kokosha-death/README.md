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

**Resolved: answerable, but differently (outcome 2) — the death is genuine, the identity is qualified.** Adjudicated 2026-10-15 by the assigned genealogist (#3343). This fixture comes from a hint batch (`filtered-list-samples-3.csv` row 22, `hint-samples.csv` row 768, flag `adds_death`, confidence 3). The hint, `ark:/61903/1:1:KX55-44K`, is the death of a Григорий Кокоша, aged 25 (born about 1821), on 18 September 1846, in the 1846 register of the church of St John the Theologian (Иоанно-Богословская церковь), Жидовская Гребля, Tarashcha. It is a real entry in his own parish: his daughter Анна was baptised at the same church on 2 February 1844 (`ark:/61903/1:1:KXPB-DG6`). What the evidence cannot establish is that it is *him*, so the expected finding is that the report engages the entry and leaves the identification qualified. It is not a guard against the 1846 date: the record may well be his.

The hint record is not attached to anyone, so it is not a re-index of one of his sources. His own sources are the 1843 marriage (`ark:/61903/1:1:FNGV-JL3`, Григорий Захариев and Татианна Ивановна Гейпонка) and Анна's baptism, both of which name him Григорий Захариев. The death index carries only a given name, surname and age, with no patronymic and no spouse. The indexer did record patronymics for the other entries on the same page, which is consistent with the entry giving none, but that is an inference from the index, not a reading of the page.

**Why the record cannot decide it.** The register image is `ark:/61903/3:1:33SQ-GPQ7-HSWV` (image 847). A `dev/try-image-transcribe.ts` reading put the entry in the death section (часть третия, о умерших) as nº 13 and showed no patronymic or widow, but it **failed calibration** and was discarded in full. The two indexed neighbours on the same image are nº 12, Георгий Матфеев Снисаренко, aged 1, died 27 August 1846 (`ark:/61903/1:1:KX55-44V`), and nº 14, Игнатий Симионов Греска, aged 1, died 1 December 1846 (`ark:/61903/1:1:KX55-442`). The transcription read the first as "Описаренко" and the second as "Прокопенко", died 1 October. Nobody's reading of the page has passed the check, so neither the death-section placement, the village, nor the absence of a patronymic or widow is taken from the image. `image_basis` is off: the index decided this.

**What was searched.** In "Ukraine, Kyiv, Orthodox Consistory Church Book Duplicates, 1723-1931" (collection 1503045): Григорий Кокоша/Кокошенко, 1810–1870, found no other Григорий of the right age in this parish (the others are in Kiev city, in other eras, or Григорий Лукианов Кокошенко, died 3 January 1843 at Poberezhka); children of a Григорий Кокоша, 1844–1860, found only Анна; Татьяна Кокоша/Кокошиха/Гейко, 1843–1880, including marriages 1846–1860, found no remarriage as a widow. The index is not complete for this parish, and Kokosha was a numerous family there (for example Сидор Сидоров Кокоша, `ark:/61903/1:1:KXRN-C7Y`, and Андрей Исидоров Кокоша, `ark:/61903/1:1:KXRN-ZMK`, both died 1848), so an unindexed namesake cannot be excluded. A reader of the original register who passes the neighbour check could settle it: a patronymic Захариев or a widow Татьяна makes it him, a different patronymic makes it another man.

**Method.** Retrieval was tool-assisted (`dev/try-person-read.ts`, `try-record-read.ts`, `try-record-search.ts`, `try-source-attachments.ts`, `try-image-transcribe.ts`); the identity judgement was the genealogist's.
