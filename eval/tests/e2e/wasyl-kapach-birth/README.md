# Wasyl Kapach — birth in Ukraine and immigration to Canada

**Source PID:** `L17M-W4Q`
**Wasyl Kapach is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born
not recorded in the tree; died not recorded in the tree.

## Research question

> When and where in Ukraine was Wasyl Kapach born, and when did he immigrate to Canada?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-07-24, PID `L17M-W4Q` with relatives). Nothing was
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

**DRAFT PENDING ADJUDICATION.** This fixture comes from a hint batch (`filtered-list-samples.csv` row 32, flags `adds_daughter`/`adds_birth`, confidence 3) in which roughly half the hint records are **false matches**, and the authors do not know which. `expected-findings.json` was transcribed from the hint record — Canada, Prairie Provinces, Census, 1926: household entry for Wasyl Capach, Athabasca, Alberta, giving birth 1883 Ukraine and immigration 1906. The genealogist + developer teams must decide (a) true match — keep the findings; (b) different answer — edit `expected-findings.json`; or (c) no findable answer — replace the findings with a `"polarity": "avoid"` guard, plus a `required` finding that the report documents the rejection.

**Note on the `adds_daughter` flag**: the CSV batch flags this hint record as `adds_daughter`, but the FamilySearch `record_read` response for this ark returned only a single indexed person (Wasyl Capach himself) with no household members or relationships — the 1926 census entry likely has other family members captured only in the underlying census image, not surfaced by this API call. No daughter's name is available to draft a finding around; a genealogist adjudicating this fixture should pull the actual census image (`image_read`) to see whether a daughter appears there before deciding how to handle that half of the hint. The tree's known son, Andrew Kapach, was born 1916 — a decade after this census subject's 1906 immigration, consistent with the same family. The wife's name, Tekla Doliney Kapach (d. 1915, Vegreville, Alberta — a different town than the 1926 census's Athabasca), predates this census by over a decade, so she would not appear as a household member in 1926 regardless.
