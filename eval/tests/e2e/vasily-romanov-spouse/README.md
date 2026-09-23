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

**RESOLVED — FALSE MATCH (Outcome c), with positive disproof.** The hint
(`ark:/61903/1:1:KX4H-PKY`, the father persona on a 16 July 1911 birth of Раиса
Романова at the Петропавловская церковь, Samara) does **not** belong to Vasily
Ignatiev Romanov `L8TL-4NY`. The 1911 entry names the father **Василий Алексеев**
Романов, a different man.

**The patronymic decides it, and it was verified on the original image — not just
the index.** The Samara register page was examined
(`ark:/61903/3:1:33SQ-GR1P-VTC`, entry No. 391): the родители line reads
"Самарскій мѣщанинъ **Василій Алексѣевъ Романовъ** и его законная жена **Клавдія
Димитріева**." So the patronymic **Алексѣевъ (Alekseev)** is what the priest wrote
— the discrepancy is genuine, not an indexer misreading Игнатьевъ. (A Russian
patronymic is not a spelling variant of another; no transcription path leads from
Алексеев to Игнатьев.)

**A distinct Alekseev family positively disproves the match.** The same Samara
metrical books hold a self-consistent Vasily Alekseev Romanov family: he (b. 1887)
married **Клавдия Димитриева Жильцова** on 14 January 1909 at the same Peter and
Paul church (`ark:/61903/1:1:KX4H-8N5`), and their son Николай was born 29 January
1913 (`ark:/61903/1:1:KXTQ-X5D`), with further children on file. Raisa (1911) sits
inside that family — its godmother is Vasily Alekseev's sister "Елена Алексѣева
Романова", and Raisa's godfather "Сергій Димитріевъ Жильцовъ" is the mother's kin,
matching her married surname Zhiltsova. This is a positive disproof, not merely a
patronymic mismatch.

**The tree person's own family is different and documented.** Vasily **Игнатьев**
(father Игнатий Васильевич `LY1C-S97`) married **Александра Андреева Попреткина**
in 1899 (`ark:/61903/1:1:KXRB-TVF`); his daughters Елена (1902) and Анна (1904)
are Васильевны by Alexandra. Per the issue, those 1902/1904 daughters were **not**
treated as the disproof (a remarriage could explain a different wife in 1911); the
disproof rests on the original-image patronymic and the affirmative Alekseev
family.

**Provenance.** Retrieval was tool-assisted (MCP `record_read`, `record_search`,
`person_read`, `image_transcribe`); the 1911 Samara register image was **actually
examined**, and all other evidence is indexed. The hint's own ark is **not** used
as the disproof, and the tree PID `L8TL-4NY` is not an evidence ark. The identity
judgement is the genealogist's.

What makes it a fair test rather than a giveaway: everything *around* the
discriminator matches — surname Романов, the city of Samara, the same
metrical-book collection the tree's five sources come from, and a 1911 daughter
that would sit plausibly after the 1902 and 1904 daughters. An agent that matches
on surname, place and plausibility takes the bait; one that reads the patronymic
does not. Romanov is a common Samara surname, so a second Vasily Romanov in the
same city needs no special explanation.
