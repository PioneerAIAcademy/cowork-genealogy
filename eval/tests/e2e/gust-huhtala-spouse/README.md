# Gust Johs Huhtala — wife Lisa Jöransdotter and son Jöran (b. 1820, Kauhava)

**Source PID:** `K46D-YPY`
**Gust Johs Huhtala is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; of Kauhava, Vaasa, Finland, with five children christened there between 1817 and 1830.

## Research question

> Did Gust Johs Huhtala of Kauhava, Vaasa have a son Jöran, born 3 February 1820 to a wife named Lisa Jöransdotter — or does that baptism belong to a different Huhtala household?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K46D-YPY` with relatives). Nothing was
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

**Resolved 2026-09-17 — the hint is a FALSE MATCH.** The 7 February 1820 Kauhava
baptism of Jöran belongs to a different Huhtala household. Lisa Jöransdotter was
not this man's wife, and Jöran was not his son. Encoded as a `"polarity": "avoid"`
finding paired with a `required` negative conclusion.

**What decided it: the Kauhava communion book (rippikirja), not the baptism index.**
Volume IAa:12, 1816-1823, FamilySearch image group `100775028`. The alphabetical
farm index on image `00002` gives Huhtala as folia 177-179; the folio-to-image
offset is **+5**, so those are images `00182`-`00184`. Two different men named
Gustaf Johansson held households at Huhtala farm N:o 40 at the same time:

| | Folio 177 (image `00182`) | Folio 179 (image `00184`) |
|---|---|---|
| Born | 6 October **1794** | 22 October **1780** |
| Wife | Caisa Johansdotter, b. 1794 | **Lisa Jöransdotter, b. 22 Nov 1788** |
| Standing | son of the head household | ***måg*** — son-in-law in Torpare Jöran Ericsson's croft |
| Sons 1817-22 | Johan 12/10 1817; Gustaf 22/3 1820 († 25/8 1821); Gustaf 28/6 1822 | **Jöran 3/2 1820**; Gustaf 1821 |

Fourteen years apart, different wives, adjacent pages of one farm book in one
hand. The tree person is the 1794 man on folio 177 — his three sons there match
the tree's baptism records exactly, date for date. The hinted Jöran is the 1780
man's son.

The register also supplies two things the index cannot. It explains the **name**:
Jöran Gustafsson was called after his maternal grandfather Jöran Ericsson, in
whose croft his parents lived. And it records that the tree couple's Gustaf born
22 March 1820 **died 25 August 1821**, which is why they named another son Gustaf
in June 1822 — previously only an inference from the repeated name.

**The draft's two objections both hold, and are now explained rather than merely
noted.** The seven-week interval is impossible because the births are to two
different mothers. The patronymic differs because the women are two different
women: Caisa Johansdotter and Lisa Jöransdotter, the latter being the daughter of
the Jöran Ericsson in whose household she and her husband appear.

**What was searched and came up empty.** Every Huhtala baptism at Kauhava in
*Finland, Baptisms, 1657-1890* for 1812-1835 was retrieved and grouped by parent
couple. No record places a son Jöran with Gust Johs Huhtala and Kaisa
Johansdotter. That couple's five children in the collection are Johan (1817),
Gustaf (22 March 1820), Gustaf (28 June 1822), Maria (12 November 1824) and Matts
(28 April 1830) — the five already attached to the tree. The tree's existing
wife, Kaisa Johansdotter (`KCBJ-P4K`), is correct and unchanged; there is no
substitute answer to encode, which is why this resolves to the `avoid` shape
rather than a corrected finding.

**Provenance, stated plainly.** The three communion-book folios were read by
machine transcription (a vision model), not by a genealogist's eye on the film.
Three checks were applied.

First, folio 177 independently reproduces all three of the tree person's children
at the exact dates the baptism index carries — dates the transcriber had no way to
fabricate.

Second, folio 179 was transcribed twice under different prompts. The two passes
agree on every **year** (Gustaf Johansson 1780, Lisa Jöransdotter 1788, Jöran 1820,
the younger Gustaf 1821) and on the days, but disagree on several **months**
(Jöran 3/2 vs 3/3; the younger Gustaf 29/3 vs 29/5; Lisa 22/11 vs 22/7). Month
digits in this hand are therefore **not reliable from transcription**, and the
indexed dates are preferred wherever the two sources overlap. The verdict does not
rest on any month: it rests on the folio 179 man's birth year being 1780 rather
than the tree person's 1794. Both passes read 1780, and the only alternatives
either offered — 1790 and 1786 — are likewise not 1794.

Third, a genealogist confirmed in the FamilySearch viewer that this is folio 179,
Huhtala N:o 40, that the household matches the one described, and that the birth
year on the relevant entry reads closer to 1780 than to 1794. A line-by-line human
reading at full resolution has **not** been done; anyone revisiting this should
start there, at image `00184` of group `100775028`.

**On the ark.** The record that actually disproves the hint is the communion book,
and FamilySearch serves no item-level ark for browsable film — the image service
exposes only an APID (`TH-909-49105-33679-30` for image `00184`). The ark rule in
`validate_fixture.py` is therefore satisfied by the two index records that
corroborate the same conclusion: `ark:/61903/1:1:XBL6-V7M` (the tree couple's
Gustaf, born seven weeks after the hinted Jöran) and `ark:/61903/1:1:XBL6-V78`
(the second household's other child, establishing it in the index as a real
family). Neither is the hint's own ark and neither is a tree PID. A reviewer who
wants the deciding record itself citable is looking at a missing dgs-to-ark
capability in the engine, not a defect in this fixture.
