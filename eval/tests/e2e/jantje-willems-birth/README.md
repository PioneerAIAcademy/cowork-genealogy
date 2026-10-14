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
Ikjen Jans (`ark:/61903/1:1:4G7B-5YMM`) — is a different girl.
`expected-findings.json` is now two `"polarity": "avoid"` guards, one against
the parents Willem Jans and Ikjen Jans (f1) and one against the 1748 baptism
(f2), plus a required finding that the report documents the rejection and the
unanswered question (f3).

**What decided it: the subject was already a widow in 1772.** FamilySearch
indexes one Groningen marriage of Jacob Jeltes and Jantje Willems, solemnized
29 September 1772 (`ark:/61903/1:1:H5TP-6GPZ`); the index names no parents.
The register page (`ark:/61903/3:1:3QSQ-G9WL-2S47`, the "NB." entry at the top
of the right-hand page, under the week of 12 September 1772) reads:

> Jacob Jeltes J: en Jantje Willems Wedw: van Hindrik Harms Bos beide van
> Groningen pro qua Albert Mackay als Oom. Cop: den 29 September 1772 door
> Ds Calkoen NK

So the bride was the widow of Hindrik Harms Bos and was assisted by an uncle,
not a parent. Her first marriage is indexed twice: Hindrik Harms and Jantje
Willems, Groningen, 28 April 1764 (`ark:/61903/1:1:H5T5-QW2M`), and Hinderk
Harms Bos and Jantjen Willems, Haren, 27 May 1764 (`ark:/61903/1:1:QLRY-B3VZ`).
The 1764 page (`ark:/61903/3:1:3QS7-L9WL-XDLM`) reads:

> Hindrik Harms [Bos] van Haren Js. en Jantje Willems van Groningen pro qua
> Doje Willems als broeder. Hier van attestatie gepasseert

— an attestation to marry elsewhere, which matches the Haren index.

The girl baptized on 10 November 1748 would have been 15 years 5 months old at
that marriage. And a brother old enough to stand for the bride in 1764 does
not fit the hint's family: the indexed Groningen children of Willem Jans and
Ikjen Jans are Jantien 1748 (`ark:/61903/1:1:QLD5-F4BM`, the hint's own entry
in a second collection), Tijtien 1751 and Jan Hemmes 1755 and 1759, with no
Doje and nothing before 1748; their marriage was not found. Neither banns
names Willem Jans or Ikjen Jans. The age at first marriage carries the call;
the brother supports it.

**Image readings and the read-check.** Both pages were transcribed with
`dev/try-image-transcribe.ts` and checked against entries the FamilySearch
index already holds on the same image. 1772 page: Wolter Ties × Engeltje
Arents (`ark:/61903/1:1:H5TP-6GZM`, married 22 September 1772, matching the
page), Sibrand Everts × Hilligje Lamberts (`ark:/61903/1:1:H5TP-6GN2`) and
Huibert Ponson × Johanna Gros (`ark:/61903/1:1:H5TP-6PW2`) all match by name,
and the Jeltes entry's 29 September date matches its index. 1764 page: Gerrit
Nieborg × Jantje Huisinga (`ark:/61903/1:1:H5T5-QW6Z`), Paul Cremer × Jantje
Janssen (`ark:/61903/1:1:H5YM-KLT2`, married 17 May 1764, matching) and Reiner
Derks × Etza van Slochteren (`ark:/61903/1:1:H5TP-G4MM`) match by name; the
Nieborg and Derks index dates (18 May) differ from the page's "Cop: den 10
Maij", which reads as index-versus-solemnization rather than a misreading.
The check licenses names and dates only, and the deciding words — "Wedw: van
Hindrik Harms Bos" and "als Oom" — are outside that. The genealogist therefore
read the 1772 entry on the original page and confirmed "Wedw", "Hindrik Harms
Bos" and "als Oom". The 1764 "Doje Willems als broeder" is the model's reading
only and is used as support, not to decide. `image_basis` is on, because the
widow link between the 1772 and 1764 brides exists only on the 1772 page.

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
date; the nearest dated other is a 5 December 1732 Jantje Willems (`ark:/61903/1:1:4YGB-LLPZ`),
daughter of Hubert Willems and Gesina Hendrix, where Willems is a surname and
so does not fit a brother Doje Willems. Doje/Doetje Willems in Groningen
province: only women named Doetje/Dootje Willems returned, no male Doje. Willem Jans × Ikjen Jans marriage, 1735-1750, in
"Netherlands, Marriages, 1565-1892" and the Archival Indexes: not found. When
she was baptized and who her parents were remains unanswered; the 1764 page
gives a brother Doje Willems and the 1772 page an uncle Albert Mackay, which
is where a later search would start (Groningen indexes an Albert Mackay
marrying Lutgertjen Haverkamps in 1746, `ark:/61903/1:1:FN6Y-K6G`, and an
Albertus Mackay marrying Margaretha Jans in 1764, `ark:/61903/1:1:H5T5-8CPZ`).

Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-person-read.ts`,
`try-record-read.ts`, `try-record-search.ts`, `try-source-attachments.ts`,
`try-image-transcribe.ts` against live FamilySearch); the identity judgement
was the genealogist's.
