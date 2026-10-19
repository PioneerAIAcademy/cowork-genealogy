# Jakub Wojtczak — death in March 1997, Waterbury, Connecticut

**Source PID:** `PM7N-7HV`
**Jakub Wojtczak is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) The tree carries no birth, an undated Death fact, no places and no sources for him. Husband of Helena Bazelak; father of Irena (25 October 1932 – 12 January 2011), Stefan (25 August 1935 – 17 January 2012) and Kazimierz (10 June 1942 – 9 December 2022), none of whom has a place in the tree either.

## Research question

> When and where did Jakub Wojtczak die, the husband of Helena Bazelak and father of Irena (born 25 October 1932), Stefan (born 25 August 1935) and Kazimierz (born 10 June 1942) Wojtczak?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-12, PID `PM7N-7HV` with relatives). Nothing was
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

**Resolved: false match, no substitute found.** The hint — "Connecticut, Death Index, 1949-2001", death index entry for Frank J Wojtczak, born 2 December 1917 in Connecticut, a married retired pattern maker of Naugatuck who died 19 March 1997 in Waterbury, New Haven County, spouse Helen (`ark:/61903/1:1:VZGY-L1L`) — is a different man. `expected-findings.json` is now a `"polarity": "avoid"` guard against that death (f1) plus a required finding that the report documents the rejection and the unanswered question (f2). The heading above still names the rejected hint, as in other resolved false-match fixtures; it is not the answer.

The tree gives nothing to test the hint against: Jakub, Helena and all three children carry no sources and no places, so the hint cannot be a re-index of an attached record, and the tree's dates are unverified. The case therefore rests on who the hint's Frank is, not on the age gap with Irena and Stefan. The indexes alone decide it:

- **The hint is already attached to another tree person.** `source_attachments` returns it on `GG6H-3LY`, Frank Joseph Wojtczak, son of Thomas Wojtczak and Romalda Cesarczyk of Naugatuck, a family sourced from the 1920–1940 censuses, draft cards, NUMIDENT entries and obituaries.
- **1940 U.S. census** (`ark:/61903/1:1:K71Y-ZVG`), the deciding check: Frank Wojtczak, born 1917 in Connecticut, **single**, living as a son in the household of Thomas (born 1882, Poland) and Romanda (born 1885, Poland) Wojtczak, Ward 3, Naugatuck, with siblings Stanley, Jane, Theodore, Constantine, Casimar and Zita. No wife, and no children of about 7 and 4.
- **NUMIDENT** (`ark:/61903/1:1:6KML-34VT`): Frank Joseph Wojtczak, born 2 December 1916 in Union City, Connecticut, died 19 March 1997, parents Thomas J Wojtszak and Romualda M Cesarek. Same death date as the hint, which ties the hint to this son of Thomas. The one-year birth difference from the death index (1916 against 1917) does not matter here.
- **His wife's obituary** (`ark:/61903/1:1:QKPK-M4T8`, "United States, GenealogyBank Obituaries, Births, and Marriages, 1980-2015"): Helen A Wojtczak, born 7 October 1913 in Jersey City, died 15 June 2006, wife of Frank J Wojtczak, daughter of Stanley Zgurzynski and Florence Blecicka, mother of Barry, Richard and John. The hint's "Helen" was born Zgurzynski, not Bazelak, and her children are not Irena, Stefan and Kazimierz.

No image was read; `image_basis` is off.

**Searched and empty for a real substitute** (a death after Kazimierz's birth in 1942): Jakub Wojtczak in FamilySearch record search restricted to Poland, 1942–2023, both as a death and with any event. The Polish collections reaching past 1942 are "Poland, Church Books, 1568-1990", the Częstochowa, Gliwice, Lublin and Radom Roman Catholic Church Books, and "Poland, Evangelical Church Books, 1700-2005". The searches returned only fuzzy matches (Dziatczak, Jachimczak and others). As a positive control, the same Poland death search on the surname alone, 1942–2023, returned 248 Wojtczak deaths. Also searched: a Jakub or Jacob Wojtczak death in any country, 1942–2023 (the US hits are Frank, Walter, Henry and others, none a Jakub); Jakub Wojtczak with spouse Helena Bazelak; children of Jakub Wojtczak and Helena (only 1850s–60s Posen families and the Frank × Helen A Zgurzynski obituaries); and Helena Bazelak, Irena Wojtczak and Kazimierz Wojtczak by name. None places this family. When and where Jakub died remains unanswered. This does not prove that no record exists. It means these searches did not find one.

Retrieval was tool-assisted (`packages/engine/mcp-server/dev/try-person-read.ts`, `try-source-attachments.ts`, `try-record-read.ts`, `try-record-search.ts`, `try-collections-search.ts` against live FamilySearch; spec §3.6). The identity judgement was the genealogist's.
