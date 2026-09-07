# Василий Игнатьев Романов — a wife Klavdiya Dmitrieva and a daughter born 1911 at Samara

**Source PID:** `L8TL-4NY`
**Василий Игнатьев Романов is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of Samara, son of Ignatiy Vasilyevich Romanov, with two daughters born at Samara in 1902 and 1904.

## Research question

> Did Vasily Ignatiev Romanov of Samara have a daughter Raisa, born 16 July 1911 at the Peter and Paul church, by a wife named Klavdiya Dmitrieva?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `L8TL-4NY` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch
(`filtered-list-samples-2.csv` row 25, `hint-samples.csv` row 761,
flag `adds_spouse,adds_daughter`, confidence 3) in which roughly half the hint records are
**false matches**, and the authors do not know which.
`expected-findings.json` was transcribed from the hint record — "Россия, Самарские метрические книги, 1748-1934", a birth entry of 16 July 1911 at the Петропавловская церковь, Samara for Раиса Романова, naming parents Василий Алексеев Романов and Клавдия Димитриева.
The genealogist + developer teams must decide (a) true match — keep the
findings; (b) different answer — edit `expected-findings.json`; or (c) no
findable answer — replace the findings with a `"polarity": "avoid"` guard
naming Klavdiya Dmitrieva as his wife and Raisa as his daughter, plus a `required` finding that the report documents
the rejection.

The patronymic decides this one, and it is the cleanest discriminator in the batch. The subject is **Василий Игнатьев** Романов — Vasily, son of Ignatiy — and the tree corroborates it structurally: his father is Игнатий Васильевич Романов, and his own daughters are Елена and Анна **Васильевны**. The hint's father is **Василий Алексеев** Романов, Vasily son of Alexei. A Russian patronymic is not a spelling variant of another patronymic; it names a different man's father, and no transcription path leads from Алексеев to Игнатьев.

The wife's name says the same thing independently: the tree records Александра Андреева, the hint Клавдия Димитриева.

So the expected shape is (c), a false match. What makes it a fair test rather than a giveaway is that everything *around* the discriminator matches nicely — the surname Романов, the city of Samara, the same metrical-book collection the tree's five sources come from, and a 1911 daughter that would sit plausibly after the 1902 and 1904 daughters already recorded. An agent that matches on surname, place and plausibility will take the bait; one that reads the patronymic will not. Romanov is a common Samara surname, so a second Vasily Romanov in the same city needs no special explanation.
