# Marie Badoux — daughter Claudine Thénot (b. 1781, Romenay)

**Source PID:** `LT9H-SK3`
**Marie Badoux is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) No vital dates recorded in the tree; married Philippe Thénot at Romenay, Saône-et-Loire in 1773.

## Research question

> Was Claudine Thénot, baptised 12 October 1781 at Romenay to Philippe Thénot and Marie Joly, a daughter of Marie Badoux — or of a second wife?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LT9H-SK3` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

hard — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-09-17: false match, with no substitute daughter found.** The hint
record `ark:/61903/1:1:W5XL-MP3Z` — the 12 October 1781 Romenay baptism of
Claudine Tenot — names the child's parents as Philipe Tenot and **Marie Joly**.
Marie Joly is neither the subject (Marie Badoux) nor the woman Philippe Thénot is
documented marrying in 1780, and she stands as a person in her own right on the
live FamilySearch tree (`2S86-XWP`). No record was found connecting Claudine
Thénot to Marie Badoux. The fixture therefore resolves to outcome (c): an
`avoid` guard against attaching Claudine to Marie Badoux, paired with a
`required` finding that the report documents the rejection.

**Second opinion: Richard Chesworth (senior genealogist)**, who confirms the
false match. The card required one — difficulty is `hard`, and roughly half the
hints in this batch are false matches.

**Arks opened for this adjudication.** All three were read, not merely cited:

| Ark | What it is |
|---|---|
| `ark:/61903/1:1:W5XL-MP3Z` | 1781 baptism of Claudine Tenot, Romenay — father Philipe Tenot, mother **Marie Joly**. The hint, and the disproving record. |
| `ark:/61903/1:1:W5XG-BTPZ` | 27 Jun 1780 marriage, Romenay — Philippe Thénot and **Marie Claudine Bourgeois**. |
| `ark:/61903/1:1:W5XJ-F7T2` | 22 Feb 1773 marriage, Romenay — Philippes Thénot and **Marie Badoux**, the subject. |

Each tree source carries a second, different ark in its `url` field (`W5XG-BY3Z`,
`W5XJ-FW6Z`); the arks above are the ones inside `citation`, and are the ones
actually opened.

**Two corrections to the draft's reading, both of which change the argument.**
The draft reasoned from "two marriage dates" and guessed the 1781 mother was
Philippe's second wife. Neither premise survives:

1. The couple relationship `R1` carries **three** Marriage facts, not two —
   `22 février 1773`, `22 Feb 1773` and `27 Jun 1780`. The first two are the same
   wedding double-entered (same standardised date; the place strings differ only
   by the Bourgogne / Bourgogne-Franche-Comté region rename). The demonstrable
   duplicate in this tree is the **1773** pair, not 1780, so the draft's
   "1780 is a duplicate-entry artifact" reading is unavailable.
2. The 1780 tree source is titled `Marie Claudine Bourgeois, …`
   (`ark:/61903/1:1:W5XG-BTPZ`), so Philippe's documented 1780 remarriage is to
   **Bourgeois**, not to Marie Joly. The draft's guess that the 1781 mother was
   that second wife is therefore also wrong — Joly is a *third* name.

The hint is a false match for a plainer reason than the draft supposed: the
record simply names a different mother. The competing "mis-indexed Badoux"
reading is not tenable once Joly is a separate person on the tree.

**What was searched and came up empty.** "France, Saône-et-Loire, registres
paroissiaux et d'état civil, 1530-1892", Romenay, **1773–1792** — from the Badoux
marriage through the end of plausible childbearing — holds no entry naming Marie
Badoux as the mother of Claudine Thénot or of any other daughter. That absence is
written into `f2`'s `supporting_sources` as plain prose with no ark attached, per
`docs/specs/e2e-test-spec.md` §3.6.1.

**What this fixture measures: restraint, not recall.** The snapshot the agent
reads holds only four persons — Marie Badoux, her parents Pierre Badoux and Marie
Fromin, and Philippe Thénot. Neither Marie Joly nor Marie Claudine Bourgeois
appears in it (the string "Joly" is absent from `starting-tree.gedcomx.json`
entirely), and its two sources are both marriage entries from the same collection
as the hint, so nothing independent exists on the tree side. The agent has to open
the 1781 record, notice the mother's name matches neither wife, and decline to
attach the child. Grade a run on whether it resisted the hint and said so, not on
how much it found.

**Do not edit the live FamilySearch tree from this fixture.** The duplicated 1773
Marriage facts and the absent second-wife relationship are part of what this
fixture measures, and `starting-tree.gedcomx.json` is committed identical to
`unstripped-tree.gedcomx.json` so `snapshot --check` can audit upstream drift. If
a live-tree correction is genuinely warranted, file it separately.
