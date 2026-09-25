# Thomas Werdmüller — a son David by Regula Steiner (bapt. 1698, Zürich)

**Source PID:** `9MF3-9S6`
**Thomas Werdmüller is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born and christened 22 February 1657 at the Grossmünster, Zürich; died 14 November 1704, Zürich.

## Research question

> Did Thomas Werdmüller of Zürich (b. 1657) have a son David baptised 27 March 1698 by a Regula Steiner, while married to Dorothea von Muralt?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `9MF3-9S6` with relatives). Nothing was
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

**Resolved: false match.** The hinted 27 March 1698 Zürich baptism of David
Werdmüller does not concern this subject. It belongs to a different Thomas
Werdmüller — the one married to Regula Steiner.

**What decided it.** Thomas Werdmüller and Regula Steiner baptised **nine
children in the same Zürich parish across twenty years**: 4 Aug 1692
(`1:1:66JR-QXJG`), 23 Aug 1693 (`1:1:66JR-MQDM`), 18 Dec 1694
(`1:1:66JR-8GWB`), 19 Aug 1696 (`1:1:66JR-FL1K`), 27 Mar 1698 — the hinted
entry (`1:1:66JR-ZV3G`), 23 Jul 1702 (`1:1:66JR-CYCD`), Sep 1705
(`1:1:66JR-6N8J`), 30 Jul 1707 (`1:1:66J5-RH8N`) and 21 Apr 1712
(`1:1:66JR-7TSH`). The index spells the parents inconsistently across that run — the mother is
"Rägula Striner" in 1694 and "Regel Steiner" in 1705, the father "Tomas" in
1707 — which is ordinary register orthography, not a sign of separate couples.
That cadence is a continuous marital family, which is what
rules out the reading the draft could not exclude: an isolated illegitimate
baptism naming both parents. The **disproving record is the 1712 baptism** —
the same couple still baptising seven and a half years after the subject died
on 14 November 1704.

The draft's own argument — that the subject was married to Dorothea von Muralt
and she was alive — is **not** sufficient on its own, and was not relied on
here; a child by another woman during a living marriage can still be his. It
does now have a source, which the draft lacked: Dorothea von Muratt was
**buried at Zürich on 16 January 1735** in a recorded couple relationship with
Thomas Werdmüller (`1:1:66JB-RGNM`), two days after the tree's previously
unsourced 14 January 1735 death. Her christening is `1:1:66JR-D6D2`, 8 Sep
1661. What this contributes is narrow but real: because she outlived the
subject by thirty-one years, Regula Steiner cannot be a successor wife either,
closing the one route by which a second family could have been legitimate.

The draft was also right that the naming pool is narrow, and the register
proves it directly: a **third** couple, Thomas Werdmüller and Elsbeth Esher,
baptised a Heinrich on 20 February 1696 in the same parish (`1:1:66JP-SL8F`),
inside the Regula run. So at least three distinct Thomas Werdmüller fathers
were active in Zürich in those years. A concrete alternative carrier for the
Regula family also exists: **Thomas Werdmüller baptised 5 May 1668 at Zürich,
son of Heinrich Werdmüller and Magdalena Escher** (`1:1:66JR-XK9C`) — aged 24
at its first child and 44 at its last. The subject, christened 22 February
1657, would have been **35** at the first child, which is an unremarkable age
to father one: it is the **last** end alone that excludes him, not both. This
is a candidate, not a proven identification; no attempt was made to close it.

**Searched and came up empty.** No marriage record for Thomas Werdmüller and
Regula Steiner is indexed — searched collection 4138674 and unrestricted,
Zürich, 1680-1700. No burial record for the subject himself at Zürich in
November 1704 — searched Werdmüller deaths and burials 1700-1710. And **no
indexed baptism anywhere in 1686-1710 names Dorothea von Muralt as a mother**,
so the subject has no documented children at all. That last absence cuts both
ways and is reported rather than buried: it is what a true-match reading would
predict, and it also means the cleanest form of this refutation — two families
running in parallel under distinct mothers — cannot actually be shown. The
concurrency here is inferred from one couple's twenty-year cadence, not
demonstrated against the subject's own family.

**Where the refutation is weakest, stated plainly.** Both legs lean on the same
unsourced tree, and an earlier draft of this note wrongly claimed one of them
escaped it. The 1712 baptism disproves the hint only if the subject died in
1704, and that death carries no source. Dorothea's 1735 burial does **not**
rescue the argument independently: the index gives a name, a date and a couple
tie to a person recorded only as "Thomas Werdmüller" — no age, no parents — so
reading it as *this* subject's wife rests on the two-day gap against the tree's
own unsourced 14 January 1735 death. A **second** Thomas Werdmüller and
Dorothea couple was baptising in the same parish in 1711, 1713 and 1715
(`1:1:66J5-12HM`, `1:1:66J5-1ZC1`, `1:1:66JR-4448`), and that Dorothea's maiden
name is not indexed, so nothing in the burial entry distinguishes the two
women. What carries the call regardless is the benchmark's own frame: the agent
is handed the starting tree, which asserts the 1704 death, and against that
tree the 1712 baptism is decisive.

**The Geneanet check named in the issue was attempted and could not be made.**
Issue #2321 points at the tree's second source, the compiled Zürich genealogy
at `gw.geneanet.org/uezuercher`, as the quickest way to list which Thomas
Werdmüllers were alive in 1698 — which is exactly what would separate the
candidate carriers above and say whose Dorothea was buried in 1735. The site
returns **403 to automated fetching** (tried twice, 2026-09-24). It is free and
needs no image access, so a reviewer with a browser can settle both soft spots
in a few minutes; it is compiled work and would be corroboration, never proof.

**Retrieval was tool-assisted** (spec §3.6): `record_read` and `record_search`
against live FamilySearch via `packages/engine/mcp-server/dev/try-*.ts`. The
identity judgement is the genealogist's.

**The register image cannot be read — by anyone, not only by our tools.**
`ark:/61903/3:1:3Q9M-CSXW-Q7WJ-W` returns **403** through both `image_read`
and `image_transcribe` (the FamilySearch token was otherwise valid —
`record_read` succeeded on it throughout). A signed-in browser session on
familysearch.org was then checked directly (2026-09-24) and returns:

> **Image Restricted**
> Image access is typically determined by local laws or the custodian who has
> the original document.

So this is a **custodian restriction on the Zürich register, not a defect in
our image path** — the engine already treats a 403 as a rights-restricted
image and deliberately withholds the malformed-ark guidance it gives for
400/404, because re-fetching returns the same ark (issue #2392, shipped).

The consequence for this fixture: the godparent check the draft recommended —
which would have placed the child in the right branch directly — is
**unavailable to any researcher without on-site or affiliate access**, not
merely unavailable to the tooling. **This call therefore rests on index
evidence alone, and no amount of retrying will change that.** A reviewer
should weigh the conclusion on that basis rather than expect the image to
settle it.
