# Carel Fredrik Kolbe — death in February 1876, Cape Town, South Africa

**Source PID:** `G4TS-FV8`
**Carel Fredrik Kolbe is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Baptised 6 December 1801 in Cape Town; the tree carries an undated Death fact. Son of Jacobus Kolbe (Colbeck) and Johanna Magdalena Paulsen; married Dolphina Carolina Hartog on 15 June 1857 in Cape Town (she died 2 September 1895). Their son, also Carel Fredrik Kolbe, was born in 1839 and died in Cape Town on 24 January 1898.

## Research question

> When and where did Carel Fredrik Kolbe, baptised 6 December 1801 in Cape Town, son of Jacobus Kolbe and Johanna Magdalena Paulsen, and married to Dolphina Carolina Hartog in Cape Town in 1857, die?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `G4TS-FV8` with relatives). Nothing was
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

**Resolved 2026-10-16 (issue #3345): true match.** The hint record
(`ark:/61903/1:1:6P1Y-82HK`) is the subject's death, 21 February 1876, Cape Town.
Retrieval was tool-assisted (record search and read, and `image_transcribe` for
the page); the identity call is the genealogist's.

**What the record is.** The hint's page image (`ark:/61903/3:1:3Q9M-CSK6-Y315-G`)
is page 744 of the Cape Town Nederduitsche Gereformeerde Kerk's *Naamlijst van
Leden ... Overleden* (deceased members), 1 October 1875 to 30 September 1877.
The entry reads only "February 21 Carel Fredrik Kolbey". The list has **no age
column**, and gives no spouse or parents, so the age check this hint was expected
to turn on cannot be made. `image_basis` stays false: the call rests on the index
plus other indexed records, not on a field read from the page.

**Read-check of the page transcription.** Two other indexed entries on the same
image match the transcription on date and given names: Michiel Johan Zeeman
(indexed Zoeman, `ark:/61903/1:1:6P1Y-82HX`, died 21 January 1876) and Adam
Gabriel Justinus Haarlingh (indexed Hurlingh, `ark:/61903/1:1:6P1Y-82HD`, died
6 January 1876). Only the surnames differ in spelling. Nothing beyond the entry
text was taken from the page.

**Why it is the subject (b. 1801), not another Carel Fredrik Kolbe.**
- *A grandson via the son.* The son Carel Fredrik (b. 23 January 1839) married
  Theodora Jullietta Borstlap on 9 November 1863. No baptism of a Kolbe child to
  a Borstlap mother, or to a father Carel Fredrik, was found 1863-1877 in
  "South Africa, Dutch Reformed Church Registers (Cape Town Archives)"
  (collection 1478678).
- *A boy of the Hartog connection.* A Carel Fredrik Kolbee, born 22 October 1866,
  was baptised in Cape Town on 10 August 1873, mother Magdalena Hartogh
  (`ark:/61903/1:1:XKH7-XHS`). He would have been 9 in 1876, but he very probably
  survived: Charles Frederic Dorns Kolbe, 23, bachelor, labourer, married in Cape
  Town on 12 August 1889 and signed "C F D Kolbee", the baptism's own spelling
  (`ark:/61903/1:1:6ZHB-HTYQ`). The identification is probable, not proven.
- *The son himself* died 24 January 1898 (civil death record and 1898 estate file).

The subject, aged 74, married in Cape Town in 1857 and his wife joined the Cape
Town congregation in 1856, which fits a member's entry in this list. None of his
tree sources is dated after 1867, so the hint is not a re-index of an existing
source.

**Searched and not found:** a Cape estate file (death notice) for him in 1876.
The probate index holds only the son's 1898 file; the index is partial, so the
absence is not evidence against the match.
