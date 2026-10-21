# Maria Bracero — marriage in June 1907, Mayagüez, Puerto Rico

**Source PID:** `LL4N-82C`
**Maria Bracero is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1880 in Puerto Rico; living in Hormigueros in 1910 and 1920 and a widow by 1930. The tree couples her with Gregorio Morales (born 1850) and with a second, undated Gregorio Morales, with no marriage fact on either couple and no parents for her; children born 1904–1922.

## Research question

> When and where did Maria Bracero, born about 1880 in Puerto Rico and living in Hormigueros in 1910 and 1920, marry Gregorio Morales, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `LL4N-82C` with relatives). Nothing was
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

**Resolved: TRUE MATCH (index-only).** The 23 June 1907 Mayagüez civil marriage (hint record `ark:/61903/1:1:QVJH-YRN1`) is the marriage of the tree's **Maria Bracero (`LL4N-82C`)** and **Gregorio Morales (`G8M9-59S`)**. Senior genealogist Isaac Boateng reviewed the evidence and concluded a true match. The identification rests on **index evidence**, not the register image (see below).

**What decided it (index + tree corroboration):**

- **The bride's parentage ties the hint's Maria to the tree's Maria.** The marriage index names her parents as **Juan Bracero** and **Juana Irizarri**. The tree's own sources independently carry the same parentage: the 1920 census indexes her "**Maria Bracero Y Irizarry**" (the Irizarri maternal surname) and her 1973 **death registration** (`ark:/61903/1:1:QVJX-8L5R`, Hormigueros) names "**Maria Bracero Irizarry**", daughter of **Juan Bracero** — informant-reported parentage, corroborating but secondary. These corroborate her identity and surname — not, on their own, the 1907 event.
- **The groom matches the tree's Gregorio.** Gregorio Morales b. 1849 (index) matches tree person **`G8M9-59S`** (b. 1850, Hormigueros, well-sourced). The tree's second Gregorio, `GRDB-7WY`, is undated, single-source (only a death fact) — a likely duplicate of the same man; the hint does not resolve that duplication. (Duplicate spouse/child profiles are a separate tree-cleanup matter.)
- **Context fits.** It is the exact tree couple; Mayagüez borders Hormigueros (Maria's 1910/1920 residence) and her children carry Mayagüez birth registrations. The marriage postdates the couple's eldest children (Jovita 1904, Maria Jovita 1905, Julia and Cárlos 1906), consistent with formalizing a consensual union (hence the `adds_marriage` flag) — the children therefore do not themselves date the marriage. No existing tree source is dated 1907 or indexed as a marriage, so this is not a re-index.

**Residual, non-blocking:** Morales and Bracero are common Puerto Rican surnames; the bride's indexed 1883 differs from her census-derived ~1880 (a birth-year review and the duplicate profiles are tree-cleanup matters, not blockers); and the groom's parents (Tomas Morales + Leonarda Bracero) cannot be cross-checked because the tree's Gregorio carries no parents.

**The register image was read but is NOT load-bearing (`image_basis: false`).** The marriage-act image (`ark:/61903/3:1:939Z-RKSD-9G`, act Núm. 665) was transcribed as a check, but **Step 1a calibration was not met**: the page holds only **one** other act — Núm. 664, **Horacio Ramirez × Angela Velez** — and the two-entry control check requires two, so the reading is **unlicensed** and is not relied upon. The act also **named no children and stated no residence** ("natural de Pto Rico" only), so the discriminators the draft anticipated do not exist. The unlicensed VLM OCR of the register image rendered the mother's given name as "Jesusa Irizarry", while the **index** gives "Juana Irizarri" and both the senior reviewer's direct reading of the image and the 1973 death registration support "Juana". The index value "Juana Irizarri" is retained because the image reading was not adequately calibrated, and the alternative reading is not adopted.

**Retrieval** was read-only via the MCP `record_read` / `image_transcribe` tools against live FamilySearch; the identity judgement is the genealogist's (Isaac Boateng).

**f2 is not required (lead, 2026-10-20).** Her 1973 death registration (`ark:/61903/1:1:QVJX-8L5R`) is attached to Maria in the starting tree and names both her parents, Juan Bracero and Juana Irizarry, so once a project extracts the subject's attached records it answers f2 without the hint. f1, the 1907 marriage itself, still needs the hint record. The death registration is listed as starting evidence in `eval/tests/e2e/attached-evidence-allowlist.json`.
