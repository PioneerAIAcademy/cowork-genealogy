# Jeanne Houdemon — a son baptised in 1679 at Saint-Michel-de-la-Roë

**Source PID:** `GDD7-55R`
**Jeanne Houdemon is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 4 March 1642 at Saint-Michel-de-la-Roë, Mayenne; died 15 January 1713 and buried there the next day. Daughter of Pierre Houdemon and Marie Houillot. She married Michel Ferré at Saint-Michel-de-la-Roë on 7 February 1663; the tree gives them six children, three of them with baptisms (Michel 1671, Marguerite 1674, Marie 1682) and three undated (Jeanne, Michelle, Renée). Her sister Renée Houdemon (born 1644) is also in the tree.

## Research question

> Jeanne Houdemon married Michel Ferré at Saint-Michel-de-la-Roë, Mayenne, on 7 February 1663; the tree records their children Marguerite, baptised 18 April 1674, and Marie, baptised 29 December 1682. Did the couple have any child baptised between those two dates?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `GDD7-55R` with relatives). Nothing was
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

**Resolved: TRUE MATCH** (Resolved 2026-10-25; index-based, `image_basis: false`).
Retrieval was tool-assisted (MCP `record_read` / `record_search` against live
FamilySearch); the identity judgement is the genealogists'.

**What the index establishes.** The hinted 1679 baptism
(`ark:/61903/1:1:6ZQJ-FPG4`) records François Ferré, baptised 14 April 1679 at
Saint-Michel-de-la-Roë, with the father's indexed name **Michel Ferré**, the
mother's given name **Jeanne**, and the parish — all matching the subject's
couple. The father's name is **strongly discriminating** against the subject's
sister's household: **Renée Houdemon's husband is René Ferré** — named as father
on her children's baptisms (Jacquinne 1675 `6ZQJ-GDNH`; René and Marie 1678
`6Z76-XRNS`, `6Z76-ZSLQ`) — and no other Michel Ferré couple appeared among the
parish's 1678–1680 Ferré baptisms that were examined. The baptism falls in the
gap between the couple's documented children, **Marguerite (18 Apr 1674,
`6ZQJ-62ZH`)** and **Marie (29 Dec 1682, `6ZQJ-RMQL`)**, with the mother about 37.

**The 1686 entry is the couple's own household, not a rival Michel Ferré.** A
marriage record of 14 September 1686 at Saint-Michel-de-la-Roë
(`ark:/61903/1:1:6ZQJ-K65C`) names the bride **Renée Fevre**'s parents as
**Michel Fevre** and **Jeanne Houderoun**, and the starting tree attaches that
record to the subject couple's existing daughter **Renée Fevre (`G6QP-2JS`)**. So
the Michel Ferré/Fevre who appears beside a Renée in 1686 is the bride's
*father* — the husband of the subject, Jeanne Houdemon — not a second Michel
Ferré couple; "Houderoun" is a further variant rendering of the mother's
surname. This rests on the **index and the tree linkage (the 1686 register image
was not examined)**; it adds index-level support for the identification but does
**not** replace the index-based rationale for the 1679 finding.

**The maternal surname — supports, does not prove.** The one field that does not
read "Houdemon" is the mother's surname, and it is rendered differently across
the couple's own entries: **"Janne Houderon"** on the 1674 baptism, **blank** on
the 1682 baptism, and **"Jourdan"** on this 1679 entry. These varying renderings
are consistent with a single hard-to-read surname and **support** the conclusion
that the same woman is meant, but they do **not** independently prove it.

**Direct register reading — supporting context, not a licensed finding.** The
researcher examined the original 1679 register (image
`ark:/61903/3:1:3QHV-V3DF-YZXX`; film 008719491, image 1451) and reads the
mother's surname as **"Houdemoy"**, a plausible variant of Houdemon. This is
**supporting context from direct human examination only.** It is **not** a
calibrated image finding: **Step 1a same-page calibration could not be
completed**, because the two other baptisms on the page (Mathurin Feron,
19 Mar 1679; Brigitte le Bretton, 7 Apr 1679) are not in the FamilySearch index,
leaving fewer than two indexed same-page entries to license a reading. The reading
is therefore **unlicensed** and is not the basis of this resolution. The machine
OCR of the page was unstable across passes (it rendered the surname
"Gaudenoy"/"Gaudrioy") and is **not** the source of the "Houdemoy" reading and is
**not** cited as confirming any reading.

**Conclusion.** On the index evidence — father Michel Ferré, the mother's given
name Jeanne, the parish, and the sibling-gap chronology, with the differing
renderings of the maternal surname taken as variation in the indexed surname
rather than evidence of a different woman — the hint is accepted as a **true
match**: François Ferré (baptised 14 April 1679) is the son of Michel Ferré and
Jeanne Houdemon. `image_basis` is false; the resolution rests on the index and
chronology, not on the unlicensed register reading. Isaac Boateng, a second
genealogist, concurs with the true-match assessment.
