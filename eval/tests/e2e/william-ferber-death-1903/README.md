# William Hubert Ferber — death (1903)

**Source PID:** `G7JB-YH6`
**William Hubert Ferber is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> When and where did William Hubert Ferber (father of Charles Hubert
> Ferber, b. 1891, Cincinnati, Ohio) die?

This is the **single-focus death half** split off from the compound
`william-ferber-ancestry` fixture (retired). Its companion is
`william-ferber-origins`. Here the agent must recover only **when and
where William died** — the death date and place.

## What was removed from the starting tree

- Removed fact 0677bc72-f54a-425a-a6a3-75482bc79b01 on G7JB-YH6: Death 11 March 1903 Cincinnati, Hamilton, Ohio, United States
- Removed fact a96396c0-4e00-40c9-ae20-66a4922555d2 on G7JB-YH6: Burial  Cincinnati, Hamilton, Ohio, United States
- Removed source 3JRQ-P44: Web: Cincinnati, Ohio, U.S., Spring Grove Cemetery Index, 1845-2012
- Removed source 3JRQ-P4Z: U.S., Find a Grave Index, 1600s-Current
- Removed source QBZV-2V6: William H Ferber, "Find a Grave Index"
- Removed source SLJX-SCP: Wm. Ferber, "Ohio, County Death Records, 1840-2001"

**No persons or relationships were removed.** The **full family context is
retained** — William's parents Gerhard Ferber and Eva Engermann, his wife
Emma Becker, his son Charles Hubert Ferber, and their relationships. Origins
are *given* here, so the agent's only job is the death.

The answer source is the 1903 Ohio county death record (SLJX-SCP, ark
`1:1:F66M-8JZ`), an original with primary information on the date and place,
reachable through the FamilySearch record tools.

**Burial is deliberately NOT a finding.** William's burial fact and the
burial-attesting sources (both Find a Grave index entries and the Spring
Grove cemetery index) are still stripped — a 1903 burial reveals the 1903
death, so leaving them in would leak the answer — but the agent is **not**
scored on recovering the burial. Those records are not reliably reachable
through the autonomous FamilySearch tools, so a burial finding would fail on
tooling reach rather than agent capability. (In the compound fixture's first
run the agent recovered the death date/place cleanly but missed burial for
exactly this reason.)

## Expected difficulty

easy — The death date and place rest on an original Ohio county death record
that is indexed and reachable through the FamilySearch tools, and the whole
family is already in the tree, so the search space is narrow.

## Notes for reviewers

- **The single expected finding (f1 death) trips a name-overlap WARN** in the
  stripping linter, because the anchor person Charles Hubert Ferber
  (G7JB-Y46) remains in the tree and shares the surname "Ferber" (and given
  "Hubert"). This is a **false positive**: William's death fact was removed
  from William (G7JB-YH6); Charles's *own* death (12 Dec 1967, Fort
  Lauderdale, Florida) is legitimately his. William's 1903 death date is
  **not** present anywhere in the starting tree.
- Burial was dropped as a finding because the burial records are not reliably
  reachable through the autonomous tools; see above. If that tooling reach
  changes, burial could be re-added as a `required: false` bonus finding.
