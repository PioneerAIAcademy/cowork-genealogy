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

**What the record is, and why that decides it.** The hint's page image
(`ark:/61903/3:1:3Q9M-CSK6-Y315-G`) is page 744 of the Cape Town Nederduitsche
Gereformeerde Kerk's *Naamlyst van Leden ... Overleden*: deceased **members**
(*leden*, confirmed communicants), 1 October 1875 to 30 September 1877. In this
church a baptised child is not a *lidmaat*; membership follows catechism and
profession of faith. All twenty entries on the page are adults, and nine are
marked as such: *Senior* (Johannes Petrus de Villiers, Melt Jacobus Brink), wife
or widow (*Echtgenoote*, *Huisvrouw*, *Weduwe van*), and Johan Fredrik Luijt
"C: K zoon". So neither an infant grandson nor the nine-year-old boy below could
appear in this list at all. That, not the two empty searches, is what separates
the subject from both alternatives. The index cannot show it (it calls the entry
a burial and says nothing about membership), so the call rests on the page and
`image_basis` is true.

The entry reads only "Februarij 21 Carel Fredrik Kolbe", the surname ending in a
flourish that the index renders as "Kolbey". The register marks same-named men
(*Senior*, *C: K zoon*), and this entry carries no qualifier. That fits there
being one Carel Fredrik Kolbe on the Cape Town roll: the son was confirmed at
Wynberg in April 1867. It is consistent, not decisive: a Carel Frederik Kolbe was
also received into the Cape Town congregation on 4 January 1869
(`ark:/61903/1:1:VRLQ-BRT`, no age or relatives), possibly the son, but the son
died in 1898 and is not the 1876 decedent either way.

The list has no age column and gives no spouse or parents. The small pencil
numbers in its left margin (8, 14, 18, 20) are a running count of entries, not
ages: the "18" beside this line marks it as the 18th entry. The heading, the
qualifiers and the entry were read on the original page by the genealogist and
by two reviewers on PR #3517 (benter-070, EdmondOware).

**Read-check of the page transcription.** Two other indexed entries on the same
image match the transcription on date and given names: Michiel Johan Zeeman
(indexed Zoeman, `ark:/61903/1:1:6P1Y-82HX`, died 21 January 1876) and Adam
Gabriel Justinus Haarlingh (indexed Hurlingh, `ark:/61903/1:1:6P1Y-82HD`, died
6 January 1876). Only the surnames differ in spelling.

**The alternatives, and the supporting evidence against each.**
- *A grandson via the son.* The son Carel Fredrik (b. 23 January 1839) married
  Theodora Jullietta Borstlap on 9 November 1863. A grandson would have been at
  most 12, so not a member. Supporting: no baptism of a Kolbe child to a
  Borstlap mother, or to a father Carel Fredrik, was found 1863-1877 in
  "South Africa, Dutch Reformed Church Registers (Cape Town Archives)"
  (collection 1478678).
- *A boy of the Hartog connection.* A Carel Fredrik Kolbee, born 22 October 1866,
  was baptised in Cape Town on 10 August 1873, mother Magdalena Hartogh
  (`ark:/61903/1:1:XKH7-XHS`). At nine he could not be on a members' list.
  Supporting: he very probably survived; Charles Frederic Dorns Kolbe, 23,
  bachelor, labourer, married in Cape Town on 12 August 1889 and signed
  "C F D Kolbee", the baptism's own spelling (`ark:/61903/1:1:6ZHB-HTYQ`). That
  identification is probable, not proven, and the call does not rest on it.
- *The son himself* died 24 January 1898 (civil death record and 1898 estate file).

The subject, aged 74, married in Cape Town in 1857 and his wife joined the Cape
Town congregation in 1856, which fits a member's entry in this list. None of his
tree sources is dated after 1867, so the hint is not a re-index of an existing
source.

**Searched and not found:** a Cape estate file (death notice) for him in 1876.
The probate index holds only the son's 1898 file; the index is partial, so the
absence is not evidence against the match.
