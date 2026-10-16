# Jantje Willems — baptism and parents (1748 Groningen hint rejected)

**Source PID:** `K8C9-ZZC`
**Jantje Willems is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries only an undated Death fact for her — no birth, baptism or parents. Husband Jacob Jeltes (undated); daughters Trijntje, baptized 23 October 1774 in the city of Groningen (entered twice, as Tryntje and as Trijntje Jacobsen of the Aakerk), and Willemke, baptized 2 July 1777 at the Noorder- or Nieuwe Kerk, Groningen. The couple has no marriage fact.

## Research question

> When and where was Jantje Willems, wife of Jacob Jeltes and mother of Trijntje (baptized 1774) and Willemke (baptized 1777) in the city of Groningen, baptized, and who were her parents?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `K8C9-ZZC` with relatives). Nothing was
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

**Resolved 2026-10-14 (#3338): false match, no substitute found.** The hint
— "Netherlands, Births and Baptisms, 1564-1910", baptism of Jantjen
Willemsen, 10 November 1748, city of Groningen, daughter of Willem Jans and
Ikjen Jans (`ark:/61903/1:1:4G7B-5YMM`) — is very unlikely to be her.
`expected-findings.json` is now two `"polarity": "avoid"` guards, one against
the parents Willem Jans and Ikjen Jans (f1) and one against the 1748 baptism
(f2), plus a required finding that the report documents the rejection and the
unanswered question (f3).

**What decided it: the subject was already a widow in 1772.** FamilySearch
indexes one Groningen marriage of Jacob Jeltes and Jantje Willems, solemnized
29 September 1772 (`ark:/61903/1:1:H5TP-6GPZ`); the index names no parents.
The register page (`ark:/61903/3:1:3QSQ-G9WL-2S47`, the "NB." entry at the top
of the right-hand page, just above the heading "Sabbathi den 12 September
1772") reads:

> Jacob Jeltes J: en Jantje Willems Wedw: van Hindrik Harms Bos beide van
> Groningen pro qua Albert Mackay als Oom. Cop: den 29 September 1772 door
> Ds Calkoen NK

So the bride was the widow of Hindrik Harms Bos and was assisted by an uncle,
not a parent. Her first marriage is indexed twice: Hindrik Harms and Jantje
Willems, Groningen, 28 April 1764 (`ark:/61903/1:1:H5T5-QW2M`), and Hinderk
Harms Bos and Jantjen Willems, Haren, 27 May 1764 (`ark:/61903/1:1:QLRY-B3VZ`).

The girl baptized on 10 November 1748 would have been 15 years 5 months old at
that marriage. A bride of fifteen and a half is not impossible, but in
eighteenth-century Groningen it is very unlikely, and that is the whole of the
case against the hint: neither banns names Willem Jans or Ikjen Jans, and
nothing else ties the subject to them or rules them out. The indexed Groningen
children of Willem Jans and Ikjen Jans are Jantien 1748
(`ark:/61903/1:1:QLD5-F4BM`, the hint's own entry in a second collection),
Tijtien 1751 and Jan Hemmes 1755 and 1759; their marriage was not found.

**The uncle, Albert Mackay — weighed, left open.** If the 1772 "Oom" was
married to a sister of Willem Jans or Ikjen Jans, he would point back to the
hint's family. FamilySearch indexes an Albert Mackay marrying Lutgertjen
Haverkamps in Groningen on 15 March 1746 (`ark:/61903/1:1:FN6Y-K6G`), an Albert
Mackay and Lutgertjen Luitjes baptizing a son Luitje in 1758
(`ark:/61903/1:1:4GHW-XBMM`), and an Albertus Mackay marrying Margaretha Jans on
2 November 1764 (`ark:/61903/1:1:H5T5-8CPZ`). Through Lutgertjen, a daughter of
a Luitje, he cannot be an uncle on the hint's side, since Willem Jans and Ikjen
Jans are both children of a Jan. Through Margaretha Jans he could be, but
nothing indexed says whose sister she was, and Jans is the commonest
patronymic in the province. The 1764 Mackay banns page
(`ark:/61903/3:1:3QS7-99WL-X8HS`) was transcribed to find her assistant, and
the reading failed the read-check (below), so it is not used. The uncle is
therefore consistent with the hint's family only on an assumption nothing
supports, while the age at first marriage conflicts with it directly; the age
carries the call.

**Image readings and the read-check.** Pages were transcribed with
`dev/try-image-transcribe.ts` and checked against entries the FamilySearch
index already holds on the same image.

- 1772 page (`3:1:3QSQ-G9WL-2S47`): passed. Wolter Ties × Engeltje Arents
  (`ark:/61903/1:1:H5TP-6GZM`, married 22 September 1772, matching the page),
  Sibrand Everts × Hilligje Lamberts (`ark:/61903/1:1:H5TP-6GN2`) and Huibert
  Ponson × Johanna Gros (`ark:/61903/1:1:H5TP-6PW2`) match by name, and the
  Jeltes entry's 29 September date matches its index. The check licenses
  names and dates only, and the deciding words are outside that, so the
  genealogist read the 1772 entry on the original page and confirmed
  "Wedw", "Hindrik Harms Bos" and "als Oom".
- 1764 Harms–Willems page (`3:1:3QS7-L9WL-XDLM`): failed. Gerrit Nieborg
  (`ark:/61903/1:1:H5T5-QW6Z`) and Reiner Derks (`ark:/61903/1:1:H5TP-G4MM`)
  are indexed 18 May 1764 against the transcription's "Cop: den 10 Maij".
  Nothing read from that page is used, including the bride's assistant; the
  first marriage rests on its two indexes.
- 1764 Mackay page (`3:1:3QS7-99WL-X8HS`): failed. Egbert Hendriks
  (`ark:/61903/1:1:H5T5-8Z2M`, indexed 11 November against "18 November"),
  Fridrich Merckel (`ark:/61903/1:1:H5T5-8ZW2`, 18 December against "16
  December") and Mackay's own entry (2 November against "22 Novembris")
  differ. Nothing read from it is used.

`image_basis` is on, because the widow link between the 1772 and 1764 brides
exists only on the 1772 page.

**Baseline and re-index check.** The tree's three sources for her are the
daughters' baptisms (`ark:/61903/1:1:X1D6-VBS`, `ark:/61903/1:1:X1F6-9D3`,
`ark:/61903/1:1:X1F7-QF4`), each naming Jacob/Jakob Jeltes and Jantje
Willems. The hint is attached to no tree person (`source_attachments`
returns it unattached) and is not a re-index of any of them.

**Searched and empty for a real substitute.** Jantje/Jantjen Willems(en)
baptisms in Groningen province, 1740-1755, in "Netherlands, Births and
Baptisms, 1564-1910" and "Netherlands, Archival Indexes, Vital Records,
1600-2000" (top 50 results per spelling read): the hint is the only dated
1740-1755 baptism returned, though many Archival Indexes entries carry no
date; the nearest dated other is a 5 December 1732 Jantje Willems
(`ark:/61903/1:1:4YGB-LLPZ`), daughter of Hubert Willems and Gesina Hendrix,
where Willems is a surname, not a patronymic. Willem Jans × Ikjen Jans
marriage, 1735-1750, in "Netherlands, Marriages, 1565-1892" and the Archival
Indexes: not found. When she was baptized and who her parents were remains
unanswered; Albert Mackay and Margaretha Jans are where a later search would
start.

Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-person-read.ts`,
`try-record-read.ts`, `try-record-search.ts`, `try-source-attachments.ts`,
`try-image-transcribe.ts` against live FamilySearch); the identity judgement
was the genealogist's.
