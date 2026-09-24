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

The draft was also right that the naming pool is narrow. A concrete
alternative carrier exists: **Thomas Werdmüller baptised 5 May 1668 at Zürich,
son of Heinrich Werdmüller and Magdalena Escher** (`1:1:66JR-XK9C`) — aged 24
at the Regula family's first child and 44 at its last. The subject (b. 1657,
d. 1704) fits neither end. This is a candidate, not a proven identification;
no attempt was made to close it.

**Searched and came up empty.** No marriage record for Thomas Werdmüller and
Regula Steiner is indexed — searched collection 4138674 and unrestricted,
Zürich, 1680-1700. No burial record for the subject himself at Zürich in
November 1704 — searched Werdmüller deaths and burials 1700-1710 — so the
tree's death date rests on the starting tree rather than on an indexed record.
That is the load-bearing weakness in the refutation and a reviewer should know
it: the 1712 disproof assumes the tree's 1704 death. The twenty-year
concurrency argument stands without it, since Dorothea's 1735 burial is
independently evidenced.

**Retrieval was tool-assisted** (spec §3.6): `record_read` and `record_search`
against live FamilySearch via `packages/engine/mcp-server/dev/try-*.ts`. The
identity judgement is the genealogist's.

**The register image was not read.** `ark:/61903/3:1:3Q9M-CSXW-Q7WJ-W` returns
**403** through both `image_read` and `image_transcribe` (the FamilySearch
token was otherwise valid — `record_read` succeeded on it throughout). So the
godparent check the draft recommended, which would have placed the child in the
right branch directly, was not performed, **and this call rests on index
evidence alone.** The 403 was not reproduced in a signed-in browser on
familysearch.org, so it is not established whether the register is
affiliate-restricted or our image path is at fault; these are materially
different findings and a reviewer with browser access should settle it.
