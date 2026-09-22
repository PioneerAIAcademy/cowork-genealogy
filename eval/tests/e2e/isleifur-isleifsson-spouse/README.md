# Ísleifur Ísleifsson — a son Einar by Thórunn Einarsdóttir (chr. 1856, Kross)

**Source PID:** `KCS6-8SG`
**Ísleifur Ísleifsson is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born and christened 12 October 1832 at Kross, Rangárvallasýsla; died 10 January 1870 and buried 17 January 1870 at Kross.

## Research question

> Did Ísleifur Ísleifsson of Kross, Rangárvallasýsla have a son Einar christened 28 September 1856 by a Thórunn Einarsdóttir — or does that baptism belong to a different Ísleifur Ísleifsson?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `KCS6-8SG` with relatives). Nothing was
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

**Resolved 2026-09-22 — the hint is a TRUE MATCH.** Ísleifur Ísleifsson did have a son
Einar, christened 28 September 1856 at Kross, by Þórunn Einarsdóttir. Both findings stand;
each is enriched with the parish-register evidence below. Outcome 2 per the card, since the
original text was an unverified transcription.

**The deciding record is the Kross ministerial book**, not the index. Landeyjaþing
*prestþjónustubók*, National Archives of Iceland box **BA/0008**, FamilySearch film
**104563914**. Both children of 1856 are in it, in one hand, on facing sections:

| | Page 40, male entry 6 | Page 45, female entry 8 |
|---|---|---|
| Child | **Einar Ísleifsson** | **Steinun Ísleifsd** |
| Born / christened | 23 Sept / **28 Sept 1856** | 16 Sept / 16 Sept 1856 |
| Father | `Í: Ísleifsson` | `Í: Ísleifsson` |
| **Father's farm** | **`á Kyrkjulandi`** | **`á Kyrkjulandi`** |
| Father's status | `báði ógift` | `ógift[r]` |
| Mother | `Þórunn Einarsdóttir`, `ógift`, same farm | `Guðríðr Gunnlaugsd:`, `ógift`, `í Litluhildisey` |
| Godparents | Kristín á Búðarh:, **Bjarni Bjarnason á Kyrkjulandi**, Petreus Petursson | Guðríðr Magnúsdóttir and Gunnlaugr Einarsson, *hjón í Litluhildisey* |

**Same farm on both entries settles it.** The father is entered at Kyrkjuland twelve days apart,
marked unmarried each time. `Kyrkjuland` has a control on each page — `Bjarni Bjarnas: á
Kyrkjulandi` witnesses on page 40 and appears again on page 45 — so the word is not a one-off
reading. He was an unmarried farmhand at Kyrkjuland; Þórunn was on that same farm, and
Guðríður was at Litluhildisey with her parents, who stood as Steinunn's godparents.

**External control on the farm name.** The calibration check below verifies child, father, mother and date against the index — but the index carries **no farm column**, so it cannot license a farm reading, and farm names are exactly the class that failed every earlier attempt. The independent check is this: *Iceland, Church Census, 1744-1965* record `ark:/61903/1:1:6JYM-KK28` places a household at **`Landeyjaprestakall, Kirkjuland`** in 1873 — headed by **Bjarni Bjarnason b. 1823** with his wife Katrín Jónsdóttir. That is the same benefice the film's own archive slip names (`Landeyjaþing prestakall 0000-165`), and Bjarni Bjarnason is the godparent the register enters `á Kyrkjulandi` on **both** page 40 and page 45. So Kirkjuland is a documented farm of this parish and that man lived on it, established from an indexed source with no handwriting involved. The same household also accounts for the index's *other* 1856 Einar — 9 August, father Bjarni Bjarnason, mother Katrín Jónsdóttir.

**Why the README's original argument failed.** It reasoned that twelve days between the two
christenings ruled out one mother, therefore there must be a second Ísleifur Ísleifsson in
the parish. The first half holds; the second never followed. Twelve days rules out one *mother*,
not one *father* — and the register shows the father unmarried, with his two partners on
different farms. The argument also leaned on the tree's marriage to Guðríður, dated
`ABT 1857`; no marriage record for this man exists anywhere in *Iceland, Marriages, 1770-1920*,
so that date is an estimate that excludes nothing, and both 1856 children precede it.

**No second Ísleifur Ísleifsson exists.** Every Iceland baptism 1845-1875 naming a father of
that name was retrieved and grouped by parent couple. Four are at Kross — Steinunn 1856,
Einar 1856, Guðmundur 1859, Jóhann 1861. The only others in Rangárvallasýsla are at
Stóriólfshvoll to Katrín Jónsdóttir in 1845 and 1850, an older man since ours was born 1832;
the rest are at Staður í Aðalvík in the Westfjords.

**On the mother's name — and a reversal in my own reporting.** An earlier comment on issue #2308 stated that *the register* writes `Guðrún`. That came from the low-resolution machine reads which were subsequently shown to be unusable, and it is withdrawn: on the full-resolution scan the register writes `Guðríðr`. **f2's argument does not depend on which of the two it is.** The discriminator between this woman and Þórunn Einarsdóttir is the **patronymic** — Gunnlaugsdóttir versus Einarsdóttir — which is stable across every reading anyone has produced, and the residence, Litluhildisey versus Kyrkjuland.

The index writes "Gudrun Gunnlogsdr" in 1856 and 1861 and "Gudridr" in
1859 for the same woman; the register writes `Guðríðr`. She is one person, confirmed
independently of the handwriting: Guðríður Gunnlaugsdóttir b. 1836 lives with her daughter
Steinunn Ísleifsdóttir b. 1856 and her own mother Guðríður Magnúsdóttir b. 1807 in the
1897, 1898, 1899 and 1900 household registers — three generations, and Guðríður Magnúsdóttir
is Steinunn's godmother on the 1856 entry. **Þórunn Einarsdóttir is not that variance**: the
patronymic differs, and the register holds patronymics steady.

**What was searched and came up empty.** *Iceland, Census, 1860* and every later household
register, for Einar Ísleifsson b. 1856 — absent; he leaves no record after his christening and
almost certainly died an infant. *Iceland, Church Census, 1744-1965* for Þórunn Einarsdóttir —
she has no footprint anywhere beyond this entry, and her only FamilySearch tree presence is a bare
stub (`M36Y-LKL`) created from this record.

**On the ark.** The deciding record is the ministerial book, and *Iceland, Baptisms, 1730-1905* is
index-only — both index entries display "Image Unavailable" and their citations name no film. So
the register page carries no item-level ark, and the ark rule is met by the hint's own confirmed
record, `ark:/61903/1:1:FG58-V8X`, which is correct for a true match. The register is cited by
archive box and film number instead.

**Provenance, stated plainly — including what is NOT evidenced.** The deciding reading of both entries was made by Claude from full-resolution scans supplied by the genealogist. **No independent reader of Icelandic secretary hand has confirmed the word `Kyrkjulandi` on either entry.** The card asks for a second genealogist's read and that has not been obtained on the deciding word; what stands in its place is the external control above plus the calibration below. An earlier reviewer, working from a low-resolution screenshot, returned "cannot verify, too faint" on the status word `ógift`; the full-resolution scan is a different artifact and the word is legible on it, but that is a change of evidence, not a second opinion. Earlier machine
transcriptions of these pages were **wholly unreliable** — six separate reads produced six
different answers, including invented Norwegian names, and two of Claude's own findings had to be
retracted. What broke the deadlock was a calibration check: the FamilySearch index is a human
transcription of this same register, so reading two entries with known answers first exposes an
unreliable source in a minute. Entry 2 (Erlendr Guðmundsson, 9 Mai, father G. Bjarnason) and entry 8 (Jón Þórgilsson, 16 Dec, father Þ. Jónsson) both matched the index **on page 40**, which is what licensed trusting entry 6. **Entry numbering is per page-section, not per year**: page 40's 1856 male entries run 1-8, while the separate section on pages 44-45 runs its own sequence (4-11 male, 7-10 female, then 1857). An earlier comment on #2308 reported the 1856 male entries as 4-11; that was pages 44-45, a different section, and is corrected here. **Anyone resolving another Icelandic fixture in this batch should run that check before anything else** — it is filed for the guide as issue #2831. Note its limit: the index has no farm column, so calibrating on child/father/mother/date does not license a farm reading, which is why the Kirkjuland external control above is separate.

