# Concepción Alegre — birth, marriage and parents (Paraguay)

**Source PID:** `G384-ZCZ`
**Concepción Alegre is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> When and where was Concepción Alegre of Altos, Cordillera, Paraguay born, who were her parents, and when did she marry Vicente Figueredo?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `G384-ZCZ` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(spec §3.6).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 25, flags `adds_father`/`adds_mother`/`adds_birth`/`adds_marriage`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Paraguay, Catholic Church Records, 1754-2015: marriage entry, 11 May 1940, San Lorenzo, Altos, Cordillera, for Vicente Figueredo and Concepción Alegre (daughter of Juan Delgado and Hipólita Martínez). The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard, plus a `required` finding that the report documents the rejection.

Points a reviewer should weigh: the groom's name "Vicente Figueredo" and the town "Altos" both match the tree's recorded spouse and family location exactly, and the tree currently has **no** birth, marriage, or parent data for Concepción at all, so this record would be the first anchor for all four. The one wrinkle: the tree's eldest recorded child, Paulino, was born **1938** — two years **before** the hint record's 1940 marriage date. A child born before a couple's registered church marriage is common in this region and era (a civil or common-law union formalized later by the church), so this is not necessarily disqualifying, but a reviewer should weigh it.
