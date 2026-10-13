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

**DRAFT PENDING ADJUDICATION.** This hint is a plausible but **not yet adjudicated** true match. Confirming it would require tying the death act to Nicola's Italian birth record, and that tie rests on the **exact birth date and birthplace read from the uncalibrated, unlicensed death-act image** (see below). A second genealogist's documented opinion is required before this fixture is resolved. **The identity is not independently established by the index evidence.**

**What each source establishes — keep these distinct:**

- **Death-hint index** (`ark:/61903/1:1:6ZB1-TVLX`): name Nicolas Domenichelli; death 29 Jun 1981; registration 30 Jun 1981; register coverage "Rosario de la Frontera, Salta"; birth **year only** (1897). It gives no exact birth date, no birthplace, no nationality, no parents, and no stated place of death (the register coverage locates the *record*, not the death event).
- **Death-act image** (`ark:/61903/3:1:3Q9M-C336-QQWY-K`, Acta No. 53, Tomo 49, Folio 106): adds Italian nationality, widower, aged 84, an **exact birth of 23 April 1897 in "Rocasicure (Basso Italia)" (Roccasicura, southern Italy)**, and a stated place of death in Rosario de la Frontera. **The act's parent fields are blank.** All of these are **image-derived**. The "Viudo Viudo" second person is the word *viudo* (widower) read as a name; **no spouse is added** from this record.
- **Italian birth-record index** (`ark:/61903/1:1:6NZZ-HLRL`, "Italy, Isernia, Civil Registration (State Archive), 1809-1914"): birth 23 April 1897 in Roccasicura, Molise, with parents **Michele Domenichelli and Diletta Berardinelli** — matching the tree. **Index-derived.**

**Why it is not yet settled.** The only link from the death act to the Italian birth record (and thus to Michele + Diletta) is the **exact birth date and birthplace**, and those come **only from the death-act image**. That image reading is **UNLICENSED** under `docs/e2e-testing-guide.md` Step 1a: the page is a single death act, and the only other entry on it is the **margin header of Acta 54 (Soria Carmen Custodia, Folio 107)**, whose body is on the next image — so there are fewer than two other indexed entries to calibrate against. The hint index alone (name + birth year 1897) does not uniquely establish the link, and the act names no parents. Both conditions the issue flags for non-adjudication are present.

**What a second genealogist should decide.** Whether the true match holds, and in particular whether any **index-only** evidence can carry it without relying on the unlicensed image — for example the 1946 Salta marriage (`ark:/61903/1:1:6ZYD-6L8N`), whose index names Nicola's father as Miguel/Michele, combined with widower-after-1970 (Esther d. 1970) and the Rosario de la Frontera connection (Esther's birth-registration town). A second-opinion request is posted on issue #3325.

**Retrieval:** read-only via the `packages/engine/mcp-server/dev/try-*.ts` scripts against live FamilySearch — `try-record-read` (hint `1:1:6ZB1-TVLX` and birth record `1:1:6NZZ-HLRL`), `try-image-transcribe` (death-act image `3:1:3Q9M-C336-QQWY-K`), and `try-record-search` for the Italian birth record (the only unique Nicola-birth candidate: a second hit, `1:1:XQXG-V4K4`, is the same record dual-indexed by province; others are different people). Retrieval only was tool-assisted; the identity judgement is the genealogist's.
