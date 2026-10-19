# Georg Gajdosch — wife Catharina and daughter Anna (b. 1718, Lidečko)

**Source PID:** `K69J-F7Y`
**Georg Gajdosch is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born about 1690, Lidečko, Vsetín, Moravia; death not recorded in the tree.

## Research question

> Did Georg Gajdosch of Lidečko, Moravia have a daughter Anna, baptised 22 April 1718 — and was her mother named Catharina rather than the Dorothea the tree records as his wife?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `K69J-F7Y` with relatives). Nothing was
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

**Resolved: FALSE MATCH** (outcome (c)) — adjudicated 2026-09-16 from issue
#2300. The hint record is a real baptism, correctly indexed; it simply belongs
to a different man. `expected-findings.json` now carries an `avoid` finding
naming the claim the agent must not make, paired with a `required` finding for
the documented negative.

### What decided it

Two baptisms eight days apart, with the same father's name, different mothers
and — in the register — different villages:

| Baptism | Child | Father | Mother | Village *(register)* | Ark *(index)* |
|---|---|---|---|---|---|
| 26 Oct 1714 | Joannes | Georg Gajdosch | **Dorothea** | Frantzowa Lhota | `1:1:FMS8-XF3` |
| 3 Nov 1714 | Martin | Georg Gajdosch | **Catharina** | Lidečko | `1:1:FMS8-6GC` |

No woman bears children eight days apart, so these are two couples, not one —
and for the same reason they cannot be successive wives of one man. The parish
held **at least** two contemporaneous Georg Gajdosch households — the register
shows a third, at Lůžna, further down — which the original draft listed as its
third reading and which is entirely ordinary for an early-modern Moravian
parish.

**A note on the arks.** One indexed entry carries a separate ark for each
person named in it, so a single baptism has a child ark, a father ark and a
mother ark. The 26 October 1714 entry is `1:1:FMS8-XF3` (child),
`1:1:FMS8-XFQ` (father) and `1:1:FMS8-XF7` (mother). The table above cites the
child persona; the tree cites the father persona, which is why `K69J-F7Y`'s
single source reads `1:1:FMS8-XFQ` in the paragraph below. The hint record
itself — the 22 April 1718 baptism of Anna — is `1:1:FMSZ-MBX` (child),
`1:1:FMSZ-MBF` (father, the form issue #2300 links) and `1:1:FMSZ-MBN`
(mother). Same entry each time, different persona; none of these is a second
record.

Sorting the collection's eight **Georg** Gajdosch baptisms of 1714-1733 by
mother splits them cleanly, with no overlap and no gap that wants explaining:

- **Georg × Dorothea** — Joannes 1714, and no other child *in the index*. The
  register itself holds one more; see "Corroboration from the register" below.
- **Georg × Catharina** — Martin 1714, **Anna 22 Apr 1718** (the hint),
  Catharina 1722, Joannes 1724, Zuzana 1729, Katerina 1731, Tomas 1733 — an
  unbroken run at normal spacing.

Two qualifications on that split, both of which leave it standing.

The collection holds **fourteen** Gajdosch baptisms in that window, not eight.
The other six are five to **Jan Gajdosch × Dorota** (Rozyna 1714, Catharina
1715, Susanna 1717, Dorothea 1720, Christina 1724) and one to **Tomas
Gajdosch × Rozyna** (Rozyna 1728). The Jan household is the larger of the two
and runs from 1709 — Marina 1709 and Anna 1713 fall before the window. A
different father's given name keeps all six out of the sort above, but they
are worth naming for two reasons: a Dorothea/Dorota wife is *not* distinctive
in this family, so the tree's Dorothea cannot be identified by her name alone;
and anyone re-running this search will meet those entries and needs to know
they were seen and set aside.

And the split is clean *in the index*. The register holds at least one further
Gajdosch household it does not carry — see "A third household in the register"
below.

The tree person `K69J-F7Y` hangs on one source only: the 1714 Joannes entry,
the Dorothea one (`sources[0]`, `ark:/61903/1:1:FMS8-XFQ`). So the 1718 Anna
baptism documents the *other* Georg. The tree's Dorothea is not refuted by the
hint, and the agent should not replace her with Catharina.

### What was searched and came up empty

- **A substitute daughter, in the index.** Collection 1784129 (Czech Republic,
  Births and Baptisms, 1637-1889), children of Georg Gajdosch and Dorothea,
  full collection range: returns Joannes 1714 and nothing else.

  The register holds one more — the 1720 Frantzowa Lhota Anna below — but that
  is **not** a substitute for the hint, which is why this stays outcome (c)
  and not (b). The hint asks whether a daughter Anna was baptised at Lidečko
  on 22 April 1718 to a mother named Catharina. The 1720 entry answers a
  different question: it is a different child, two years later, in a different
  village, to Dorothea. It corroborates that the 1718 couple is a different
  Georg; it does not supply the daughter the hint claims.
- **A marriage record.** In the index, "Czech Republic, Marriages, 1654-1889"
  covers the period but contains only one Gajdosch-family entry: Georgius
  Gajdoschik, married at Brumovice, Hustopeče on 29 October 1765
  (`ark:/61903/1:1:XL6G-HFM`). That record is 51 years later, in a different
  district, and with a different surname form. Neither of the Lidečko unions
  appears in the index — there is no entry that dates them, orders them, or
  records a remarriage. The register, however, tells a different story: the
  Lidečko marriage book does include one of the two unions, and this is set
  out under "Corroboration from the register" below.
- **A death for Dorothea.** Nothing indexed from 1714 onward. Her death is the
  precondition for any remarriage reading, and it is undocumented.
- **A census.** Not possible: "Czech Republic, Censuses and Inhabitant
  Registers" begins in **1800**, 86 years after these events. Early-modern
  Moravia has no census layer to check.
- **Other church books.** "Czech Republic, Church Books, 1552-1981" indexes
  Gajdosch entries no earlier than 1792, and the Northern Moravia Opava
  Archive collection returns none at all, so neither reaches 1714-1718.
- **The parish register images — reachable, and read.** Collection 1784129 is
  index-only ("Index to selected Czech baptisms") with no images of its own,
  and an earlier draft of this README wrongly concluded from that the register
  was out of reach. It is not: the Lidečko books are browse-only under image
  group **`005387300`** (baptisms 1707-1742, 142 images). Reading them
  produced the 1720 entry above. So the bullets above describe the **index**;
  the register is a second, richer layer, and anyone extending this work
  should browse it rather than stop at the index.

### Corroboration from the register

The index is not the whole record set. Browsing the Lidečko parish register
turned up a baptism the index does not carry, and it **strengthens** the
false-match call rather than threatening it:

> *Die 11 Ex pago Frantzowa Lhota a D: Joanne Manka Baptisata e Anna Parens
> **Georgius Gajdosch** Mater **Dorothea** Patrini Nicolaus Jurastik et
> Dorothea uxor ejus ex pago eadem.* — **11 February 1720**

Georg is still with Dorothea in 1720. So he did not lose her and remarry
between 1714 and 1718, which is the only way the 1718 Catharina entry could
have been his. Set beside Joannes in October 1714, it brackets the 1718
baptism on both sides with the same wife — and, once the village is read off
the register rather than the index, in the same village too:

| Baptism | Village *(register)* | Georg's wife |
|---|---|---|
| 26 Oct 1714 — Joannes | Frantzowa Lhota | **Dorothea** |
| 22 Apr 1718 — Anna *(the hint)* | Lidečko | Catharina |
| 11 Feb 1720 — Anna | Frantzowa Lhota | **Dorothea** |

Both 1714 baptisms appear on the same register image, recorded consecutively
by the same priest. The Dorothea entry begins *Ex pago Franczowa Lhota*, while
the Catharina entry begins *Ex pago Lidečko*; in this register the trailing
*Ex pago* consistently marks the godparents' village, not the family's. The
1720 Dorothea baptism also points to Frantzowa Lhota.

The key judgment is how to read the index's "Lidečko" against the register's
village. Lidečko is the parish, and the index records it for all three
entries; the register records the family's own village, and there the two
households separate — Dorothea's at Frantzowa Lhota in both 1714 and 1720,
Catharina's at Lidečko in both 1714 and 1718. The village column in the table
above makes that distinction explicit so it cannot be misread, and it
separates the two men without relying on a mother's given name read out of a
derivative index.

This entry has **no index ark**: it is not in the index, and was read from the
register image — image group `005387300`, image 41 (Lidečko baptisms
1707-1742, browse-only). The image does have an ark of its own,
`3:1:005387300_00041`; what the entry lacks is an indexed record to cite. It
is corroboration for the reader, not a citable index entry, which is why
`f2`'s claim is scoped to the indexed collection.

Note that the register covers several villages in one parish — Lidečko,
Frantzowa Lhota, Luzna, Senicza, Strijelna, Pulczin — and names the family's
village at the head of each entry, before the officiant. The village at the
*end* of an entry is the godparents', not the family's; do not read the two as
one. A single family can move between villages, so a difference on its own
proves nothing — what carries weight above is that each household is recorded
in the *same* village on both of its dated entries, six years apart.

### The marriage register

Image group **`005387302`** (Lidečko marriages 1709-1779, browse-only, 143
images) carries the Catharina union, on image 8, under the year heading
*Anno Roku 1714*:

> *Jura syn nebošt: Tomasse Gagdossa, / Katerzynu dczeru nebošt: Martina Manu,
> / oba z Lydeczka. Swetkowe. Jan Nowosad, Jakub Janu. odtudt.*
> — **24 January 1714**

Jura (Georgius) **son of the late Tomáš** Gajdoš married Kateryna, daughter of
the late Martin Man, both of Lidečko. Two things follow. The union is dated
and ordered after all — in the register, not the index, which is why the
indexed-marriage bullet above is scoped to that collection. And it gives this
Georg a **patronymic**, which separates the two men by something firmer than a
wife's given name: Martin, the first child of the Catharina couple, is
baptised at Lidečko nine months later, while Dorothea was already carrying
Joannes when this wedding took place.

### A third household in the register

Image `005387300_00044` carries a Gajdosch baptism the index does not:

> *Die. 29. Ex pago Lůžna. à R. D. Mathia Buczek. Baptisata e Marina: Parens
> **Georgius Gajdoš**, Mater **Anna**: Patrini: Joannes Machowskj, et Anna uxor
> Wenceslai Machowskj. Ex pago Pozdiechowa.*

A third couple: Georgius and **Anna**, at **Lůžna**, with a daughter Marina
baptised 29 October. Neither of the two households above is a Lůžna family,
and the officiant (R.D. Mathias Buczek) differs from the Haldik who wrote the
1714 and 1718 entries.

Three things are stated plainly because a later reader will need them.

**The year is not on the image.** The *Anno 1720* heading sits on image 41,
three images earlier, and the entry falls between October and a November
heading, so the year is inferred as 1720 or 1721 rather than read.

**The surname is an attribution, not a transcription.** It is written in a
form that differs from the *gagdoß* Haldik writes on images 21 and 34, and
machine transcription of this word disagrees with itself across passes. It is
read here as a variant of Gajdoš, because in this volume the form plainly
follows the clerk: Haldik writes *gagdoß* in 1714 and 1718, Joannes Manka
writes a visibly different form on image 41 in 1720, the burial register has
*gagdošska* and *gaydosch*, and the marriage register has *Gagdossa*. Mathias
Buczek, who wrote this entry, appears nowhere else in the Gajdosch material. A
reader who wants to check it should compare image 44 against images 21, 34 and
41 directly.

**The village has independent support.** Two of the three Gajdosch burials
below are at Lůžna, one of them a daughter aged 30 in 1714 — so a Gajdosch
household stood in that village from at least the 1680s, well before this
baptism.

**But nothing indexed corroborates this couple.** No Georgius Gajdosch is
paired with an Anna anywhere in collection 1784129 across its full 1637-1889
range; the only indexed Gajdosch-and-Anna pairings are Martin × Anna (1748)
and Thomas Gajdoschik × Anna (1758-1777), two generations later. The entry is
unindexed, so the index cannot refute it either — it simply does not speak.

None of this moves the verdict. The hint concerns a daughter Anna baptised at
**Lidečko** on 22 April 1718 to a mother named **Catharina**; this entry is a
different village, a different wife, a different child and a different year.
It is recorded so the register is not later mistaken for a clean two-household
split.

### The burial register

Image group **`005387303`** (Lidečko burials 1710-1762, browse-only, 145
images). Images 8, 15, 16 and 17 were read, covering 1714-1715 and
October 1717 through March 1719 — the whole of 1718 included. Three Gajdosch
burials:

| Burial | Entry | Village | Image |
|---|---|---|---|
| 1714 | *Kateržina dcera gagdošska*, 30 roků | Lůžna | 8 |
| 19 Jan 1715 | *Martinus filius Georgij gagdoß*, 8 *septimanarum* | Lidečko | 8 |
| 13 Jan 1719 | *Joannes filius Joannis gaydosch*, 30 y. | Lůžna | 17 |

The 1715 infant is very likely the Martin baptised 3 November 1714 to the
Catharina couple at Lidečko: same village, and the only Gajdosch infant in the
window. The stated age is approximate — 3 November to 19 January is eleven
weeks, not eight — and burial ages in this volume are estimates, so it is a
strong identification rather than a certain one.

The other two sit at **Lůžna**, and both predate or bracket the Lůžna baptism
in the previous section. A Gajdosch daughter dying at 30 in 1714 puts a
Gajdosch household in that village from at least the 1680s, which is the
family context the Lůžna entry above otherwise lacked.

**A correction.** A burial of 3 November 1717 at Senicza — *Catharina filia
Georgij*, 15 years — has been read elsewhere as a Gajdosch. It is not. The
surname on image 15 is **Zawodná**, plainly written, and the entry belongs to
another family entirely. It is named here so the misreading is not repeated.

The negative matters more than any of them: **no burial of a Catharina as wife
or widow of Georgius Gajdosch appears anywhere in the images read, including
the whole of 1718.** Images 1-7, 9-14 and 18-145 of that volume were not
examined, so this is a bounded search, not an exhaustive one.

### Second read

Reviewed independently by John Mark, who concurred: false match. His route to
it was the absence of any evidence of a remarriage between Joannes's 1714
baptism and Anna's in 1718, and he asked for the census and marriage layers to
be checked — they were, with the results above, and they close rather than
open the question. Note that the argument recorded here is stronger than an
absence: the 3 November 1714 baptism makes a remarriage not merely
unevidenced but impossible, since it falls eight days after Joannes's.

### Correction to the issue body

Issue #2300 offers as its first cheap check: "open FMS8-XFQ and see whether it
names a mother at all — if the 1714 entry names no mother, Dorothea is
unsourced and there is no conflict, only a name to add." It **does** name her.
Dorothea is sourced by that entry, the conflict is real, and what resolves it
is the eight-day gap rather than a silent index. The same check is quoted on
the other cards in this batch; it is not a safe shortcut.

### Provenance

Record retrieval used `packages/engine/mcp-server/dev/try-*.ts` against live
FamilySearch, per the decision recorded on issue #2300 (option A) and in
`docs/specs/e2e-test-spec.md` §3.6. The identity judgement was a human call,
not a tool output.

Every register reading this README asserts was checked against the image
itself, not taken from a run log. Images examined:

| Image group | Images | Covering |
|---|---|---|
| `005387302` (marriages) | 8 | the *Anno Roku 1714* heading and January 1714 |
| `005387300` (baptisms) | 19, 21, 22, 34, 41, 44 | 1714, 1718, 1720 and the Lůžna entry |
| `005387303` (burials) | 8, 15, 16, 17 | 1714-1715 and Oct 1717 - Mar 1719 |

OCR was used only to locate entries on a page and is not relied on for any
claim: it disagreed with itself on the day of the 1714 marriage and misread
two surnames that reading the scan corrected. Where a reading is an
attribution rather than a plain transcription, the text above says so.
