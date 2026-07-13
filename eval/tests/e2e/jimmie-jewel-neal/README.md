# Jimmie Jewel Neal

**Source PID:** `KNXW-M3T`
**Jimmie Jewel Neal is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> Who were the maternal grandparents of Jimmie Jewel Neal (born 10 July 1884 in Hillsboro, Hill, Texas, died 7 March 1938 in Carlsbad, Eddy, New Mexico) — the parents of her mother, Martha J Wood?

## What was removed from the starting tree

- Removed person P1: J. H. Sampson
- Removed person P2: Louisa Sampson
- Removed person P3: Thomas R. Sampson (a sibling of Martha, kept in the unstripped tree only as corroborating context)
- Removed relationship R4 (ParentChild P1/LKYG-VKB): cascaded from a removed person
- Removed relationship R5 (ParentChild P2/LKYG-VKB): cascaded from a removed person
- Removed relationship R6 (Couple P1/P2): cascaded from a removed person
- Removed relationship R7 (ParentChild P1/P3): cascaded from a removed person
- Removed relationship R8 (ParentChild P2/P3): cascaded from a removed person

## Correction (2026-07-13)

This fixture originally named the maternal grandparents as **Manley Madison Wood**
and **Martha Patsey Ford** of Blount County, Alabama, based solely on the compiled
FamilySearch tree profile for Martha J Wood. During John Mark Peter-Brown's live
`/research` replay of this fixture, the agent found that claim rests on an uncited
tree entry with no corroborating record — and that Martha's own 1875 Nevada County,
Arkansas marriage record (a document she personally signed) states her maiden
surname as **Sampson**, not Wood. "Wood" turns out to be a married name from an
earlier marriage that predates her 1875 marriage recorded under her own birth
surname. The FamilySearch tree's Wood/Ford entries were never corroborated by any
record — most likely a case of an online contributor mistaking a household
companion's shared surname for a parent-child relationship (the household in
question was almost certainly Martha's first husband's, not her father's).
`unstripped-tree.gedcomx.json`, `expected-findings.json`, `fixture.json`, and this
file were updated accordingly; `starting-tree.gedcomx.json` did not need to change,
since it never carried grandparent persons under either identity.

## Expected difficulty

moderate — The compiled FamilySearch tree's grandparent claim (Wood/Ford) is
uncorroborated and, in fact, wrong. Recovering the correct grandparents requires
rejecting that claim on the strength of Martha's own 1875 marriage record (which
gives her maiden surname as Sampson), then independently searching Sampson-surname
census records in Nevada/Ouachita County, Arkansas — not simply reading a name off
the tree. It also involves a minor internal conflict (the 1870 census indexes the
grandfather's initial as "T", the 1880 census as "J. H." — most likely a
transcription misreading of the same person, confirmed by continuity of son Thomas
R. Sampson across both households) and an unresolved one (his birthplace is Georgia
per 1870, North Carolina per 1880 — not decisively resolvable from records found,
and should not be asserted as one or the other).

## Notes for reviewers

Maternal grandparents J. H. Sampson and Louisa Sampson (both b. about 1820) are
established by Martha's 1875 marriage record (maiden surname Sampson) plus the 1870
and 1880 U.S. censuses for a Sampson household in Nevada/Ouachita County, Arkansas —
the 1880 census's relationship column ties the household together as a family via
son Thomas R. Sampson. None of this is visible on the compiled FamilySearch tree,
which instead carries the uncorroborated (and incorrect) Wood/Ford claim — grade
the agent on whether it notices the tree claim is unsupported and searches
independently, not on whether it repeats the tree's wording.

The starting tree was trimmed to the subject, her parents, and her maternal
grandparents only — Jimmie's two husbands, her ten children, and Martha J Wood's
other marriages/half-siblings were excluded from the snapshot as irrelevant to this
question, following the same minimal scope used by other `*-grandparents` fixtures
(e.g. `ferber-grandparents`). Paternal grandparents were not investigated and are
out of scope for this fixture.
