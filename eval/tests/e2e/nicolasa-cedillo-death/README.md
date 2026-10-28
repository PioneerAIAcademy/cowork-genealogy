# Nicolasa Cedillo — death 12 February 1945, Santa Lucía, Intibucá, Honduras

**Source PID:** `GJG6-F2L`
**Nicolasa Cedillo is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries an undated Death fact and no birth. Wife of Santiago Cedillo (`GJG6-74S`); mother of seven children baptised between 1899 and 1914 — Yanuario (born at Concepción, christened at San Antonio, 1899), Feliciana (Camasca, 1902), Maria Dolores (Camasca, 1904), Jose Antonio (Candelaria, Lempira, 1906), Eulogia (Camasca, 1911), Maria Eulogia del Carmen (1913) and Elena (Camasca, 1914). Her latest sources are her daughters' marriage entries of 1919 and 1927.

## Research question

> When and where did Nicolasa Cedillo die? She was the wife of Santiago Cedillo, and their children were baptised between 1899 and 1914 in Camasca and neighbouring parishes of southern Intibucá and Lempira, Honduras.

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GJG6-F2L` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the adjudication and the
evidence behind it.

## Notes for reviewers

**Resolved: FALSE MATCH on the hint, with a corrected answer (Outcome 2)** (adjudicated 2026-10-28; index-based. `image_basis` unset — no register image was read or calibrated in this resolution.)

**Verdict.** The hinted 1943 civil death registration (Ma Nicolasa Cedillo, registered 22 May 1943, Santa Lucía — `ark:/61903/1:1:X7KG-W4V1`) is a **different, same-named woman**, not the subject. The subject (`GJG6-F2L`) actually died **12 February 1945** (registered 13 February 1945) at Santa Lucía, Intibucá — `ark:/61903/1:1:X7FM-YRGN`.

**What the index establishes (tool-assisted retrieval: `record_read`; no image was read — see below).**
- The subject's parents, **Ventura (Buenaventura) Cedillo + (María) Jesús Amaya**, are named in full by the 1904 **civil birth registration** of her daughter Maria Dolores at **Santa Lucía** (`ark:/61903/1:1:X7FS-K2SL`), which records Santiago Cedillo and Nicolasa Cedillo as Maria Dolores's parents **and** Ventura Cedillo and Jesús Amaya as Nicolasa's parents. Two further records corroborate the parentage without naming both parents in full: her confirmation as "Nicolasa Cedillo Amaya" (`ark:/61903/1:1:X9CV-TJLX`), whose matronymic carries the mother's surname Amaya, and her 1899 **church marriage** at Camasca (`ark:/61903/1:1:QVRX-VWN1`). (The tree also records a Maria Dolores **church baptism** at Camasca in 1904; it names the same parents, Santiago Cedillo and Nicolasa Cedillo, in the same year, so it is consistent with the same child — civil registration and church baptism being separate systems, a Santa Lucía civil entry alongside a Camasca baptism is not a contradiction.)
- The **hinted 1943 death** indexes the mother as **Julia Cedillo** (a second index of the same registration, `ark:/61903/1:1:X7FM-RFHS`) and a birth of 1868 — conflicting with the subject's mother (María Jesús Amaya). It names a spouse Santiago Cedillo, but that is a genuine same-name couple in the same municipality.
- The **1945 death** (`ark:/61903/1:1:X7FM-YRGN`; duplicate index `ark:/61903/1:1:X7LQ-QZVH`) indexes the parents as **Ventura Cedillo + María Jesús Amaya** and a birth of 1875 — matching both of the subject's parents — and names no spouse, consistent with widowhood.
- The subject's husband **Santiago Cedillo died 4 December 1918** (registered 5 December), Santa Lucía (`ark:/61903/1:1:X7LS-KMLK`, his parents Valentin Cedillo + Patrocia Márquez), which fits the 1945 record naming no spouse.
- The family's **civil** registrations cluster at **Santa Lucía** — the 1904 civil birth (`ark:/61903/1:1:X7FS-K2SL`) and Santiago's 1918 death (`ark:/61903/1:1:X7LS-KMLK`) are both registered there — while the children's **church** events sit in Camasca and neighbouring southern parishes. This suggests, though it does not prove, that Santa Lucía was the family's civil-registration location, so a Santa Lucía civil death for the subject in 1945 is consistent rather than disqualifying (the place gap that made the original hint look doubtful applies to the church/civil split, not to the subject's identity).
- The hinted record carries two dates: a fuller second index (`ark:/61903/1:1:X7FM-RFHS`) gives the **death as 21 May 1943** and the **civil registration as 22 May 1943**. These are death-vs-registration dates for the same (rejected) record, not a conflict.

**No image basis.** The Santa Lucía civil-registration images could not be retrieved: `ark:/61903/3:1:3QHJ-Z7CY-XSSC-N` returned HTTP 403 on every form, and `ark:/61903/3:1:3QHK-YQYY-WSJX` (the 1943 page) and `ark:/61903/3:1:3QHV-5Q11-NK2` (the 1945 page) returned timeout / fetch-failed; the full-text collection (2135627) is not in coverage. **No image was read, so the Step 1a same-page calibration check (`docs/e2e-testing-guide.md`, Step 1a) was not performed** — the register images were inaccessible, not merely left unread. This resolution rests on indexed parentage only — a two-parent match named in full by two independent records (the 1904 civil birth and the 1945 death) and further corroborated by the confirmation and marriage — which is distinct from direct image verification. `image_basis` is left unset and the cited ARKs are index (`1:1:`) records.

**Revisit** if the 1945 death-register image becomes accessible and its parents or informant confirm or contradict the indexed parentage.
