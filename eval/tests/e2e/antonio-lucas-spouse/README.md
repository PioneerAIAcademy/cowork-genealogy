# Antonio Fernandes Lucas — a second wife, Antonia de Jesus?

**Source PID:** `GK89-82B`
**Antonio Fernandes Lucas is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
1838, Santo António, Funchal, Madeira, Portugal; died not recorded in the tree.

## Research question

> Did Antonio Fernandes Lucas of Funchal, Madeira have a wife named Antonia de Jesus, distinct from his tree-recorded wife Maria Joana (m. 1890), and a daughter named Maria who died young?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `GK89-82B` with relatives). Nothing was
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

**Resolved: false match (outcome c).** This fixture came from a hint batch (`filtered-list-samples.csv` row 27, flags `adds_spouse`/`adds_daughter`, confidence 3) in which roughly half the hint records are false matches. `expected-findings.json` was originally transcribed straight from the hint record — Portugal, Registro Civil, 1437-2023: death registration for Maria (b. Jul 1894, Santo António, Funchal, Madeira), naming parents Antonio Fernandes Fernandes Lucas and Antonia de Jesus de Jesus.

**Why it's rejected**: the tree already records Antonio Fernandes Lucas married to **Maria Joana** on 8 February 1890, with two children (Antonio b. 1896, Julia b. 1899). The hint record instead pairs him with an entirely **different** wife, "Antonia de Jesus", and a daughter "Maria" born 1894 — squarely in the middle of his documented marriage to Maria Joana, yet naming a different mother, with no death or divorce recorded for Maria Joana that would free him to remarry.

Manual research (direct examination of the underlying parish/civil records, not just the FamilySearch index) settled this beyond the timing argument alone. The Antonio Fernandes Lucas who partnered with Antonia de Jesus lived at the sítio of **Encruzilhadas**, Santo António, and the pairing recurs across three burial entries for their children: Maria, b. 1887 d. 30 May 1889 (ark:/61903/1:1:6B2L-FKDP); Maria, b. 1893 d. 5 Sep 1894 (ark:/61903/1:1:6BCT-KZMV, the same death the hint record indexes); and José, b. 1895 d. 12 Aug 1896, explicitly "legítimo" (ark:/61903/1:1:6BCY-B2F4) — a real, recurring household, not a one-off clerical entry. That household's Antonio is independently identified by his own death record — 25 Nov 1895, age 55 (so b. c. 1840), a shoemaker, styled "Junior" in the original record, buried at Encruzilhadas, legitimate son of **Manuel/Manoel Fernandes Lucas and Luiza de Jesus** (ark:/61903/1:1:6YGB-P2V2) — completely different parents from GK89-82B's documented José Fernandes Lucas and Francisca Luisa. His 1895 death date is also, on its own, a chronological impossibility against GK89-82B, whose documented family with Maria Joana continued through Julia's 1899 birth. And a second, independent Registro Civil entry — for Julia's own death in 1967 (ark:/61903/1:1:65Y2-YP94) — names Antônio Fernandes Lucas's wife as **Maria Joana Joana**, not Antonia de Jesus, confirming the 1890 marriage held for the rest of the couple's documented lives.

"Antonio Fernandes Lucas" is a common name combination in the small parish of Santo António, Funchal — common enough that a second, wholly distinct man carrying it (further disambiguated in the original records as "Junior") had his own separate marriage, household, and now-provable parentage. Searched: the subject's own attached vital-record sources, the hint record, and the Encruzilhadas family's other vital entries in "Portugal, Registro Civil, 1437-2023" and "Portugal, Madeira, Registros da Igreja Católica, 1044-1990" for the Santo António parish (c. 1887-1896) — no record ties Antonio Fernandes Lucas (GK89-82B) to Antonia de Jesus. Conclusion: false match to a different, now-identified man — `expected-findings.json` carries a `"polarity": "avoid"` guard against asserting the second marriage/child, paired with a `required` finding documenting the rejection.
