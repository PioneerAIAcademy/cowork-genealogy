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
- Pietro Marchetti's 1923 Rieti death registration (`ark:/61903/1:1:Q2B5-RGQ2`)
  names his wife as **Maria Aquilini**, and Maria Aquilini's 1929 Rieti death
  registration (`ark:/61903/1:1:Q2HC-8Y9F`) names her husband as **Pietro
  Marchetti**. Both are openly readable and already attached to the tree. They
  establish that the tree's Pietro Marchetti and Maria Aquilini were spouses;
  they do not by themselves prove that this Pietro was Giuseppa's father.
- Celestino Marchetti's 1922 Rieti death (`ark:/61903/1:1:Q2HC-47GS`), born
  1893, names the same parents — mother **Maria Aquilini**, father again given
  only as "Pietro". Corroborative, not conclusive; not added as a finding.
- Pietro's own parentage (son of Francesco Marchetti) comes from his 1923 death
  already attached to the tree, not from any record read here.

What was not found, and what stays weak: Giuseppa's **1884 birth act was not
located** in the FamilySearch index (searched the Rieti civil-registration
collection for Giuseppa b. 1882–1886, and Italy-wide birth searches with father
Pietro + mother Aquilini; neither returned a 1884 birth registration). Her death
index names her father only as "Pietro", without his surname. Her own surname,
**Marchetti**, supports the proposed paternal connection — under the Italian
civil-registration naming convention a child ordinarily carries the father's
surname — but it is not conclusive on its own, and no record read here states
"Pietro Marchetti" as Giuseppa's father directly.

Left open, not adjudicated: the tree's **1876** marriage date for the couple
carries no attached source, and there is indexed evidence of a son, Carmine,
whose age-derived birth year (**1874**) would predate it. That birth year comes
from a marriage record that is not openly accessible to every reviewer, so the
discrepancy cannot be settled from the readable records here; no openly readable
marriage record or birth act was found to reconcile it. This tension is noted,
not resolved, and does not bear on Giuseppa's parentage.
