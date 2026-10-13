# Nicola Domenichelli — death in June 1981, Salta, Argentina

**Source PID:** `G2WX-HZ5`
**Nicola Domenichelli is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1898; the tree carries an undated Death fact. Married Esther Jimenez on 2 March 1946 in Salta; she died 3 October 1970.

## Research question

> When and where did Nicola Domenichelli, born about 1898 and married to Esther Jimenez in Salta in 1946, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G2WX-HZ5` with relatives). Nothing was
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

**Resolved: TRUE MATCH** (genealogist Isaac Boateng; second opinion requested because the deciding image reading could not be calibrated — see below). The June 1981 Rosario de la Frontera death entry is Nicola Domenichelli of the tree (`G2WX-HZ5`). Keep `expected-findings.json`.

**Keep the two records' contributions distinct — they settle different things:**

- **The death act** (hint index `ark:/61903/1:1:6ZB1-TVLX`; page image `ark:/61903/3:1:3Q9M-C336-QQWY-K`, Acta No. 53, Tomo 49, Folio 106) *states* the death: **29 June 1981 in Rosario de la Frontera**, registered 30 June 1981; Italian nationality, widower, tailor, aged 84. It gives an **image-derived** birth of **23 April 1897 in "Rocasicure (Basso Italia)"** (i.e. Roccasicura, southern Italy). **Its parent fields are blank** — the act does not name parents. The "Viudo Viudo" second person is the word *viudo* (widower) read as a name; **no spouse is added** from this record.
- **Nicola's own Italian birth record** (`ark:/61903/1:1:6NZZ-HLRL`, "Italy, Isernia, Civil Registration (State Archive), 1809-1914") **independently and from the index** establishes birth **23 April 1897 in Roccasicura, Molise**, with parents **Michele Domenichelli and Diletta Berardinelli** — exactly the tree's parents. These parent and birth fields are index-derived, not read off an image.

**Why it's a match:** the two records share the **exact birth date (23 Apr 1897) and birthplace (Roccasicura)**, correlating them, and the birth record's **indexed** parents match the tree. The parent match therefore rests on the birth-record index, not on the death-act image. Context also fits: the tree's wife Esther Jimenez died 1970 (a widower in 1981 is predicted), and Esther's own birth registration is in Rosario de la Frontera, the town whose register holds the death entry.

**Image-reading calibration: UNAVAILABLE / UNLICENSED.** The death-act image is a single death act (No. 53); the only other entry on the page is the **margin header of the next act, No. 54 (Soria Carmen Custodia, Folio 107)**, whose body is on the next image. With **fewer than two other complete indexed entries on the page**, the image reading could not be calibrated per `docs/e2e-testing-guide.md` Step 1a, and **it is not claimed to be.** The subject's own index fields (name, death 29 Jun 1981, registration 30 Jun 1981, widower) agree with the image, but that is the subject's own entry, not the two independent same-page entries the rule requires. The identification does **not** depend on the uncalibrated image: the Italian birth record (index-derived) carries the decisive birth-date/birthplace/parents correlation.

**Retrieval:** read-only via the `packages/engine/mcp-server/dev/try-*.ts` scripts against live FamilySearch — `try-record-read` (hint `1:1:6ZB1-TVLX` and birth record `1:1:6NZZ-HLRL`), `try-image-transcribe` (death-act image `3:1:3Q9M-C336-QQWY-K`), and `try-record-search` for Nicola's Italian birth record (the only unique Nicola-birth candidate: a second hit, `1:1:XQXG-V4K4`, is the same record dual-indexed by province; others are different people). The identity judgement is the genealogist's; retrieval only was tool-assisted.
