# kolonica-greek-catholic-earliest

**Source:** Issue #3178, patron row 2273 (Kolonica, Slovakia locality-guide session)  
**Behaviour guarded:** The locality-guide agent reports the Kolonica Greek Catholic registers exactly as the FamilySearch Catalog returns them: start date, catalog entry, and the archive named in the entry's notes.

## Scenario

A patron asks for a locality guide for Kolonica, Slovakia, for the 1700s through the 1890s. The catalog_search fixture (measured live 2026-11-04) returns one entry: koha:727653, "Cirkevná matrika, 1824-1924", created by the Greek Catholic parish office of Kolonica (Snina). Its notes say the registers are in Latin and Hungarian and that the originals were microfilmed at the Štátny oblastný archív v Levoči. The keywords variant also returns koha:385993, an 1869 census of Zemplén county.

## What the test checks

The guide gives 1824 as the start of the registers FamilySearch holds, names catalog entry 727653, and names the Levoča archive. It must not claim registers earlier than 1824, and must not name another archive (such as Prešov) as holding the originals. The patron's window starts in the 1700s, so the guide has to say plainly that the catalogued registers begin later than that.

## PII note

Subject is a placeholder person (no real individual). Kolonica is the real place name; keeping it is essential to the test since the fixture predicate matches on "~Kolonica".

## Caveats

- The carve is the pre-failure state: no bad output is in the scenario, so the test reruns the skill fresh.
- An earlier version of this fixture held two invented catalog entries (711474 from 1783, 1162429 from 1758). The live Catalog holds neither; 1824 is the real start date.
- PII scrub: person A is a placeholder; no real identifiers present.
