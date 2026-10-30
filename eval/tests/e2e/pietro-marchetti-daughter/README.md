# Pietro Marchetti — a daughter, Giuseppa, born 1884 at Maglianello, who died in 1913 at Rieti, Italy

**Source PID:** `G9WN-C79`
**Pietro Marchetti is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1848 at Rieti and died there on 10 July 1923. He was the son of Francesco Marchetti and Marianna Rosati. He married Maria Aquilini (born 1851, died at Rieti on 20 January 1929) at Rieti in 1876. The tree gives them one child, Domenica, born 1878, whose 1902 Rieti marriage register page is attached.

## Research question

> What children did Pietro Marchetti (born 1848) and Maria Aquilini of Rieti, Lazio, Italy, married in 1876, have besides their daughter Domenica (born 1878)?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `G9WN-C79` with relatives). Nothing was
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

**Resolved: the hint is a true match (identity: same).** Giuseppa Marchetti,
born 1884 at Maglianello (a frazione of Rieti) and died at Rieti on 15 June
1913, is a daughter of the tree couple Pietro Marchetti (`G9WN-C79`) and Maria
Aquilini. The drafted finding stands.

Retrieval was tool-assisted via `record_read` / `record_search` against live
FamilySearch; the identity judgement is the genealogist's. **Index text only —
no record images were read or calibrated.** The target death-registration page
carries only two indexed entries — Giuseppa Marchetti and Elisa Luciani — so the
two-comparator calibration that Step 1a of `docs/e2e-testing-guide.md` requires
cannot be completed, and an image reading of that page could not be treated as
licensed evidence.

What decided it:

- Giuseppa's 1913 civil death registration (`ark:/61903/1:1:Q2HC-CWMP`, "Italy,
  Rieti, Civil Registration (State Archive), 1840-1945") indexes her father
  only as **"Pietro" with no surname** and her mother as **Maria Aquilini**.
- Domenica Marchetti's 1902 Rieti marriage (`ark:/61903/1:1:6K5Z-ZBH9`, same
  collection) names her parents in full as **Pietro Marchetti and Maria
  Aquilini**. Domenica is the known tree daughter (b. 1878), so this anchors
  the indexed "Pietro Marchetti × Maria Aquilini" couple to the tree couple —
  it is the same 1902 marriage already attached to the tree.
- A collection search for children of Pietro Marchetti and Maria Aquilini
  returns a coherent sibling cluster naming that exact parent pair — Carmine
  (`ark:/61903/1:1:X366-7Q8F`), Giovanna (1885), Celestino (1893/1894).
  Giuseppa's mother "Maria Aquilini" (a distinctive maiden surname) sits inside
  that same cluster. These siblings are corroboration only and are **not** added
  as findings.
- Pietro's own parentage (son of Francesco Marchetti) comes from his 1923 death
  already attached to the tree, not from any record read here.

What was not found, and what stays weak: Giuseppa's **1884 birth act was not
located** in the FamilySearch index (searched the Rieti civil-registration
collection for Giuseppa b. 1882–1886, and Italy-wide birth searches with father
Pietro + mother Aquilini; neither returned a 1884 birth registration). Her
**father's surname is absent** from her death index; it is supplied indirectly,
by the sibling cluster around the same mother and by Domenica's marriage, not by
a record that states "Pietro Marchetti" as Giuseppa's father directly.

Left open, not adjudicated: Carmine's indexed birth year of **1874**
(age-derived from his 1911 marriage) predates the couple's **1876** marriage
date recorded in the tree — and the tree's 1876 marriage fact carries no
attached source. No marriage record or Carmine birth act was found to reconcile
the two. This tension is noted, not resolved; it does not bear on Giuseppa's
parentage.
