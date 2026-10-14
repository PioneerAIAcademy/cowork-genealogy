# Elisabeth Myslisch — marriage in February 1845, Oxhöft, West Prussia

**Source PID:** `KV1W-XVF`
**Elisabeth Myslisch is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth, an undated Death fact, and no marriage; it also records her as Elisabeth Myslisz. Wife of Anton Netzel; children Elisabeth (christened 26 November 1845) and Valentin (christened 14 February 1847), both at Oxhöft, West Prussia. No person in this tree cites any record source.

## Research question

> When and where did Elisabeth Myslisch marry Anton Netzel, the parents of Elisabeth Netzel (christened 1845) and Valentin Netzel (christened 1847) at Oxhöft, West Prussia?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `KV1W-XVF` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium. The marriage is a probable identification from the index alone, and
the agent has to reconcile a bride indexed under another surname. See "Notes
for reviewers" below.

## Notes for reviewers

**Resolved 2026-10-14 (#3334): true match, probable, not proved.** The hint
record `ark:/61903/1:1:6ZMF-97V3` ("Deutschland, Preußen, Westpreußen,
Katholische und Lutherisch Kirchenbücher, 1537-1981") is the 2 February 1845
Oxhöft marriage of Anton Netzel (born about 1808) and a bride indexed as
Elisabeth **Desmer** (born about 1805). It is accepted as the most likely
marriage of tree persons KV1W-XVF and L4NZ-WWK. This is a preponderance call
made on the indexes alone. The hint came from `filtered-list-samples-3.csv`
row 11, `hint-samples.csv` row 407, flags `adds_birth,adds_marriage`,
confidence 3.

**Retrieval.** Records were found by hand on familysearch.org (some via
Ancestry's copy of "Germany, Births and Baptisms, 1558-1898"). They were then
re-found, with their FamilySearch arks, using the
`packages/engine/mcp-server/dev/try-*.ts` scripts against live FamilySearch:
- `try-record-read` on the hint and on `6ZMX-B9G1` and `6ZMX-1V3T`;
- `try-record-search` of collection 4111605 for Desmer, Myslisch, Myslisz and
  the children of Anton Netzel;
- `try-image-transcribe` and `try-image-read`, which could not fetch the image
  (below).

**Baseline.** The live tree cites no record source for anyone, so the hint
does not re-index anything already attached. The tree gives the couple two
children christened at Oxhöft: Elisabeth on 26 Nov 1845 and Valentin on
14 Feb 1847.

**The register image is restricted, and nothing here rests on it.** The hint's
image `ark:/61903/3:1:3Q9M-CSZ5-19VL-2` returns HTTP 403, as does
`3:1:3Q9M-CSZ5-19VL-R`, while a control image from another film downloads.
The assigned genealogist could not open it by hand either. No same-page read
check was possible, so `image_basis` is not set.

**For the identification.**
- **The children's mother is Myslisch.** The couple's children were baptised
  at Oxhöft to Anton Netzel and a mother indexed as:
  - Elisabeth **Myslisch** for Elisabeth, `1:1:6ZM2-63Q4`, dated 26 Oct 1845.
    The Germany Births and Baptisms copy, `1:1:NZ3C-T8Z`, dates it 26 Nov
    1845, which is the tree's date.
  - Elisabeth **Myslisz** for Valentin, 14 Feb 1847, `1:1:6ZM2-J635`.
  - **Eva** Myslisck for Anton, 24 Mar 1850, `1:1:6ZM2-5QNZ`.
- **The timing fits a first child.** The first child was baptised in the same
  parish 8½–9½ months after the wedding.
- **This is the only candidate marriage.** No marriage of an Anton Netzel to a
  Myslisch or Myslisz appears in the collection. A marriage-type search for
  Anton Netzel returns 13 hits, and this one is the only Oxhöft Netzel
  marriage in the window. Marriages were normally held in the bride's parish,
  and the Myslisch family were Oxhöft people, so a Netzel–Myslisch wedding
  would be expected in this same register.
- **Rival scenarios need unfound records.** A different bride would have to
  have died, and Anton remarried, within months, before the first baptism. A
  second Anton Netzel of the right age would have to have married at Oxhöft
  unindexed. Nothing found supports either.

**Against, and why it is not proved.**
- **The surname never matches.** The bride is indexed as Desmer, and a second
  index of the entry, `1:1:6ZMX-B9G1` (undated), has **Dermer**. Neither looks
  like a misreading of Myslisch. The match therefore assumes she was a widow
  using a first husband's surname.
- **No first marriage was found.** Searches of collection 4111605 for Desmer
  marriages (55 hits), marriages of an Elisabeth Myslisz (10 hits), and Desmer
  records with an Elisabeth as spouse or mother found no Desmer–Myslisch
  marriage. Desmer was a living Oxhöft surname: Johann and Michael Desmer had
  baptisms there in 1840–44.
- **The bride's age is at the edge.** A bride of about 40 would have borne
  children at about 40, 42 and 45.
- **The given name varies.** The 1850 baptism calls the mother Eva.

**Ruled out.** The Anton Netzel who married Elisabeth Lohde at Oxhöft on 1 Jun
1856 (`1:1:6ZMX-1V3T`) was born about 1831. He is a different, younger man,
and the father of the 1856–1866 Netzel–Lohde baptisms. A Magdalena Elisabeth
Myslisz baptised at Oxhöft on 19 Nov 1805 (`1:1:6ZM2-1T6V`) fits the bride's
age but is unlinked. It is a lead, not evidence.

**What an agent must find.** The 2 Feb 1845 Oxhöft marriage, recorded for the
couple as a probable identification, with the Desmer/Myslisch surname
conflict stated. f1 fails a run that asserts as fact that the bride was a
widow née Myslisch, because nothing shows it.

**What could overturn this.** A reading of the restricted 2 Feb 1845 register
entry, for example at a FamilySearch Center or affiliate library. If it calls
the bride a single woman with non-Myslisch parents, this fixture is wrong and
should become an `avoid` fixture. If it says widow née Myslisch, or gives
Myslisch parents, the call is proved and `image_basis` can be set.

**How this call was made.** The evidence was retrieved by Claude Code at the
direction of the assigned genealogist (@Emruthwill). The verdict is the
genealogist's: "probably a true match, but not proved", accepted as true match
provided the finding labels it probable. A second opinion was requested on
#3334.
