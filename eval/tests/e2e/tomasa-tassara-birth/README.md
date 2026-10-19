# Tomasa Tassara — birth about 1864, Buenos Aires, Argentina

**Source PID:** `GW82-2VP`
**Tomasa Tassara is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth and an undated Death fact for her. Wife of Juan Rossello; mother of Juan Felipe Marcelo (born 18 June 1885, christened 15 August 1885), Catalina (born 1888), Angela (born 31 July 1889), Bartolome (born 1892, died 1975) and Maria (born 19 November 1898, christened 25 February 1899), all in Mercedes, Buenos Aires.

## Research question

> When and where was Tomasa Tassara born, the wife of Juan Rossello and mother of Juan Felipe Marcelo (christened 15 August 1885), Angela (born 31 July 1889) and Maria (christened 25 February 1899) Rossello at Mercedes, Buenos Aires, Argentina?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `GW82-2VP` with relatives). Nothing was
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

**Resolved: OUTCOME 1 (true match).** The hint
`ark:/61903/1:1:MW49-LBB` ("Argentina, censo nacional, 1895") is the tree person
Tomasa Tassara (`GW82-2VP`). The research question — when and where she was born —
is answered: **about 1864, Buenos Aires, Argentina**, as the hint indexes. One
required finding (f1), kept as drafted with the confirming arks appended.

**Indexed facts.** The hint entry indexes Tomasa Tassara, **married**, **Birth
1864, Buenos Aires, Argentina**, Census 1895, Cuartel 01 (Población rural),
Mercedes. The same 1895 census independently indexes, all in that same cuartel,
the rest of the tree family: husband Juan Rossello `ark:/61903/1:1:MW49-LBT`
(b.1858 Italy, married); children Juan `ark:/61903/1:1:MW49-LB5` (b.1886),
Catalina `ark:/61903/1:1:MW49-LBY` (b.1888), Angela `ark:/61903/1:1:MW49-LB1`
(b.1890) and Bartolome `ark:/61903/1:1:MW49-LBR` (b.1892). Each child's indexed
year matches the tree within ±1, and Maria (tree b.1898) is correctly absent,
being born after the census. The tree's three existing sources for her are her
children's baptisms, which index her as Tomasa Passara (1885,
`ark:/61903/1:1:66M1-15HH`), Pasara (1889) and Tassaro (1899) — none gives an age
or birthplace, and none is a re-index of the census, so the hint adds genuinely
new information. The surname spelling variants (Passara/Pasara/Tassaro) are not
evidence against the match.

**Image examined, but not relied upon (`image_basis` omitted).** The census
register image `ark:/61903/3:1:S3HY-674Q-DT3` shows Tomasa Tassara enumerated as a
married woman among a Rossello household (lines 4–9: Juan Rossello 37, Tomasa 31,
Juan 9, Catalina 7, Angela 5, Bartolomé 3). A Step 1a two-entry check was
attempted on the page, and a discrepancy surfaced: **Pedro Ratti the father**
(`ark:/61903/1:1:MW49-L1W`) read age **40** by OCR against an indexed **60** — a
mismatch on the age column, the same field a census birth year is derived from.
Under Step 1a's rule ("either differs: discard everything that transcription read
from the page"), the transcription is therefore **not** relied upon, and the
fixture does **not** set `image_basis`. (Andrés Ballestrero
`ark:/61903/1:1:MW49-L19` and Pedro Ratti the son `ark:/61903/1:1:MW49-L1Q` did
match the index, but one same-page mismatch is enough to withhold the licence, and
a higher-resolution re-read is not the fix per the guide.)

**Identity rests on the index alone, which is sufficient.** As the indexed facts
above show, the 1895 census records the husband Juan Rossello and all four children
— each as its own record in the same Cuartel 01 (Población rural), Mercedes, each
child's year within one of the tree's, Maria (tree b.1898) correctly absent, born
after the census. The husband's name, the four children's names, the matching years
and the same specific rural cuartel make this a confident match without the image.

**Limits / precision.** The birth is kept at **"about 1864"** — an age converted
to a year, good to about a year, not an exact date. The birthplace is kept at
**"Buenos Aires, Argentina"**: census column F ("provincia donde ha nacido") reads
only "Bs Aires", which can mean the province or the city, so it is **not** sharpened
to the city (FamilySearch's own standardization is inconsistent — the search stub
read "Buenos Aires City" while `record_read` gave plain "Buenos Aires"). A
marriage or death entry for her would fix the year and place more closely than an
age can; neither was pursued, as the question is answered at the precision the
census gives.

**Retrieval** was read-only via the MCP `person_read` / `record_read` /
`record_search` / `image_transcribe` tools against live FamilySearch; the image
was examined but its transcription was not relied upon (Step 1a check above), so
the identity judgement rests on the indexed household and is the genealogist's.
The call is a confident true match, not borderline.
