# Benny Raphael Taylor

**Source PID:** `KNJ1-TRX`
**Benny Raphael Taylor is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) He was born
19 Jul 1921 in McCammon, Bannock, Idaho and died 9 Jul 1991 in
Tillamook, Oregon.

## Research question

> Who were the parents of Benny Raphael Taylor (born 1921 in McCammon, Bannock, Idaho; died 1991 in Tillamook, Oregon)?

## What was removed from the starting tree

- Removed person KW8G-33L: Silvester Jay Taylor
- Removed person KWZ8-3RD: Autossie Ann Bair
- Removed person L7BB-SP1: Hildagard Bernadine Duclos
- Removed person LL9V-56G: Jolene Eleanor Bartchy
- Removed relationship R1 (Couple KNJ1-TRX/LL9V-56G): cascaded from a removed person
- Removed relationship R2 (Couple KNJ1-TRX/L7BB-SP1): cascaded from a removed person
- Removed relationship R3 (Couple KW8G-33L/KWZ8-3RD): cascaded from a removed person
- Removed relationship R4 (ParentChild KW8G-33L/KNJ1-TRX): cascaded from a removed person
- Removed relationship R5 (ParentChild KWZ8-3RD/KNJ1-TRX): cascaded from a removed person
- Removed relationship R7 (ParentChild L7BB-SP1/G6J6-NK4): cascaded from a removed person
- Removed relationship R9 (ParentChild L7BB-SP1/GDTJ-WV6): cascaded from a removed person

The starting tree keeps Benny with his two children (Jacques Francis
Taylor, GDTJ-WV6, biological; LeRoy Dominic Taylor, G6J6-NK4, step) and
all 25 of his attached record sources (census, marriage, draft, SSA,
obituary), so the record-evidence trail to his parents is intact — only
the answer (parents) and, for the reason below, the two spouse records
were removed.

## Expected difficulty

medium — Benny is heavily documented (1930/1940/1950 census, WWII draft,
SSA NUMIDENT, Oregon death/marriage indexes, obituaries), and the 1940
census enumerates him in the household of "Jay Taylor" — a direct lead to
his father. The agent still has to assemble the census + SSA evidence,
identify both parents, create the person records, and link the
parent-child relationships. Distinctive given names (Autossie, Silvester)
keep namespace-confusion risk low.

## Notes for reviewers

Parents are **Silvester Jay Taylor** (KW8G-33L, b. 29 May 1877 Fairview,
Franklin, Idaho; d. 10 Mar 1944 Garibaldi, Tillamook, Oregon) and
**Autossie Ann Bair** (KWZ8-3RD, b. 21 May 1883 Richmond, Cache, Utah;
d. 24 Nov 1962 Winnemucca, Humboldt, Nevada), married 21 Oct 1901 in
Logan, Cache, Utah (bonus finding f3). The family migrated from
McCammon, Idaho to Garibaldi, Oregon c.1925-26 (per Silvester's residence
fact "Moved from McCammon, Idaho"), so Benny's birth is in Idaho but the
1930/1940 household censuses that establish parentage are in Oregon.

**Why both spouses were stripped, not just the parents.** The
FamilySearch relatives-expansion for this tree reused the same fact GUIDs
across unrelated persons (e.g. `248eaba5-…` was the Birth fact id on
Benny, Autossie *and* Silvester; `ebe0d4fe-…` on both wives; `a3ca8aea-…`
on Benny and Jolene). The strip tool requires snapshot-unique fact ids,
so the duplicate-carrying spouse records (Hildagard Bernadine Duclos and
Jolene Eleanor Bartchy) had to be removed alongside the parents to
produce a clean starting tree. This does not affect the parents question;
it only means the starting tree does not carry Benny's marriages. The two
children remain attached to Benny.
