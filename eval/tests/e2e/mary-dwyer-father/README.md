# Mary Dwyer — father Michael Reagan (probable)

**Source PID:** `MNFL-T24`
**Mary Dwyer is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
May 1840, Ireland; died not recorded in the tree (immigrated 1856; last residence 1900, South Windsor, Connecticut).

## Research question

> Who was the father of Mary Dwyer, wife of Michael Dwyer of South Windsor, Connecticut?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `MNFL-T24` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**RESOLVED — hint was a false match, but the real answer is findable: Michael Reagan (probable tier).** This fixture came from a hint batch (`filtered-list-samples.csv` row 3, flag `adds_father`, confidence 3) in which roughly half the hint records are false matches. The hint record — Massachusetts, State Vital Records, 1638-1927: marriage entry, 21 April 1854, Chicopee, Hampden, Massachusetts, for Michael Dwyer (b. 1831, Ireland, son of John Dwyer) and Mary Dwyer (b. 1832, Ireland, daughter of **Patrick Dwyer**) — does not describe this Michael and Mary Dwyer of South Windsor, Connecticut.

**Why the hint fails.** Four independently-checkable details diverge from what is already sourced on the tree, and all point the same direction: this couple's own attached marriage source (`MWFQ-MFS`) documents the marriage a day earlier and in a different, non-neighboring county (20 April 1854, Greenfield, Franklin vs. the hint's 21 April 1854, Chicopee, Hampden), and the tree records both spouses born several years later than the hint's couple (Michael: 1837 vs. 1831; Mary: May 1840 vs. 1832). A single date variant could be a transcription artifact, but four consistent divergences — different county, different day, and both spouses years younger — is the signature of a distinct, same-named Michael/Mary Dwyer couple married in Chicopee, not a mismatched detail on this couple. "Michael Dwyer" and "Mary Dwyer" are common Irish immigrant names, which raises the odds of exactly this kind of same-name, different-family coincidence. Patrick Dwyer has no independent corroboration anywhere in this Mary Dwyer's tree and should not be asserted as her father from this record.

**The hint's rejection is not the end of the story, though.** An initial adjudication pass (checking only the hint record against the tree) concluded the father was simply unproven. A full live benchmark run of the `/research` skill went further — working the census trail (1900 → 1880 → 1870 → 1860 → 1910) and locating a **1922 Massachusetts death certificate for "Mary Reagan Dwyer"** (era vital-records practice encoded a married woman's maiden name as a middle name), which directly names her father as **Michael Reagan** and mother as **Margaret Callahan**. This is independently corroborated: the **1880 federal census** in Greenfield, Franklin, Massachusetts places a widowed **"Margret Reagan"** (b. ~1810, Ireland) in Michael and Mary Dwyer's household, and FamilySearch's own indexing marks an explicit parent-child relationship between that Margret Reagan and Mary Dwyer — consistent with "Margaret Callahan" under her married name. Both records were independently re-verified directly against live FamilySearch (not just taken from the benchmark run's transcript).

The run also surfaced and correctly ruled out a plausible **competing candidate**: an 1860 Springfield, MA household headed by **Daniel Ragan** (b. ~1800, Ireland) with a wife Margaret (matching name/birth year) and a daughter named Mary of the right age. The death certificate's direct naming of "Michael Reagan" as father outweighs this circumstantial same-surname match, and Daniel Ragan is documented in `research.json` as a considered-and-rejected hypothesis rather than silently dropped.

**Confidence tier: probable, not certain or proved.** Only one source (the death certificate, a secondary/informant statement) names the father's given name; no original Irish birth or marriage record independently corroborates "Michael Reagan." The maiden surname "Reagan" itself is corroborated by two independent record types (the death certificate and the 1880 census), which is why the tier is "probable" rather than merely "possible." A correct research response should reflect this same hedging, not overclaim certainty.

`expected-findings.json` now encodes two required findings: a positive `relationship` finding for Michael Reagan (probable tier, not "avoid"), and the original `"polarity": "avoid"` guard against asserting Patrick Dwyer.

**A note on an apparent chronology conflict in the tree itself (Michael & Mary Dwyer's own facts, unrelated to the father question above):** both spouses carry an unsourced `Immigration: 1856` fact, which post-dates the sourced `20 Apr 1854` marriage by two years — on its face, a marriage in Massachusetts before arriving in the country. This is a red herring, not a flaw in the marriage record. Both the `Immigration: 1856` fact and the couple's own household census entry (`M9QT-WW5`, "United States, Census, 1900") independently derive a *third*, different marriage year — 1866 — from that same census's self-reported "years married" question. The census's two self-reported/derived facts (1856 immigration, 1866 marriage) don't even agree with each other, which is the signature of imprecise, decades-later recollection rather than hard evidence. The 1854 date, by contrast, comes from a dedicated, independently-sourced marriage register entry (`MWFQ-MFS`/`FC61-HM9`) naming an exact day. The vital record remains the reliable anchor; the census-derived immigration year should not be read as a hard contradiction.
