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

**Resolved: TRUE MATCH** — senior-genealogist sign-off by @mercyokum on PR #3397, on an **index-only** evidence route that does not rely on the uncalibrated death-act image. The June 1981 Rosario de la Frontera death entry is Nicola Domenichelli of the tree (`G2WX-HZ5`).

**The identification rests on the index route (no image needed):**

- **1946 Salta marriage index** (`ark:/61903/1:1:6ZYD-6L8N`): the tree's Nicolás Domenicheli (b. 1898, married Esther Gimenez) has parents indexed as **Miguel Domenicheli** and **Diletta Berardinelli**. Both parents named, from the index, no image.
- **Italian birth index** (`ark:/61903/1:1:6NZZ-HLRL`): Nicolo Domenichelli, b. 23 Apr 1897 Roccasicura, Molise, parents **Michele Domenichelli** and **Diletta Berardinelli** — the **same parents**, tying the tree's Nicola to this birth record from the index alone.
- **Death-hint index** (`ark:/61903/1:1:6ZB1-TVLX`): Nicolas Domenichelli, died 29 Jun 1981, registered 30 Jun 1981, Rosario de la Frontera register, birth year 1897, widower. These indexed facts — name, 1897 birth year, Rosario de la Frontera (Esther's birth-registration town), and widower status (Esther d. 1970) — tie the death record to that same Nicola.

**Name variation (not an exact string match for the father):** the father is **Miguel** in the Spanish-language Argentine marriage index and **Michele** in the Italian records — Miguel is the Spanish form of the Italian Michele; the surname is spelled **Domenicheli** (one L) in the marriage index and **Domenichelli** (two L) elsewhere. The **mother, Diletta Berardinelli, matches exactly** across the marriage and birth indexes, and that distinctive name is the strong link.

**The death-act image is corroborating only, not relied upon.** The image (`ark:/61903/3:1:3Q9M-C336-QQWY-K`, Acta 53) reads consistently — Italian, widower, aged 84, b. 23 Apr 1897 in "Rocasicure" (Roccasicura), death in Rosario de la Frontera, parent fields blank — but its reading is **uncalibrated and UNLICENSED** (single-act page: the only other entry is the margin header of Acta 54, Folio 107, on the next image, so fewer than two other indexed entries to calibrate against, per `docs/e2e-testing-guide.md` Step 1a). The accepted identity does **not** depend on it; `fixture.json` sets `image_basis: false`. The "Viudo Viudo" second person on the death entry is the word *viudo* (widower) read as a name; **no spouse is added**.

**Retrieval:** read-only via the `packages/engine/mcp-server/dev/try-*.ts` scripts against live FamilySearch — `try-record-read` (hint `1:1:6ZB1-TVLX`, marriage `1:1:6ZYD-6L8N`, birth `1:1:6NZZ-HLRL`), `try-image-transcribe` (death-act image), and `try-record-search` for the Italian birth record. Retrieval only was tool-assisted; the identity judgement is the genealogist's (@mercyokum, #3397).
