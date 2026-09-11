# Francis Maria Fisher — husband Alfred George Holding (m. 1895)

**Source PID:** `LZZ9-YL3`
**Francis Maria Fisher is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 23 July 1871, Hobart, Tasmania; died 24 January 1940, Hobart.

## Research question

> Did Francis Maria Fisher of Hobart, Tasmania (b. 1871) marry Alfred George Holding, and if so when?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-09-07, PID `LZZ9-YL3` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

easy — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved 2026-09-09: true match, with the date and place made precise.**

The hint is correct that Francis Maria Fisher married Alfred George Holding in
1895, but the index entry it was transcribed from is not the record that proves
it. Two records in *Australia, Tasmania, Civil Registration, 1803-1933* —
collection 2125029, the same collection the tree already cites for Fisher's
birth — settle it:

- **The marriage registration**, `ark:/61903/1:1:Q279-HRRC`: Alfred George
  Holding (b. 1871) and Frances Maria Fisher (b. 1872), married **23 February
  1895 at Hobart, Tasmania**, registered 1895. Digital image
  `ark:/61903/3:1:3QS7-99CH-CY6T`.
- **The daughter's birth registration**, `ark:/61903/1:1:Q27M-D67V`: Frances
  Maria Holding, born **2 November 1897 at Hobart**, father **Alfred George
  Holding**, mother **Frances Maria Fisher**.

The second record is what makes the identification more than a name collision.
The starting tree already attaches a daughter — Frances Holding, b. about 1898
Hobart, d. 14 July 1918 (`LXW8-PVZ`) — to Francis Maria Fisher **with no father
recorded**. The birth registration supplies that father and names the mother as
Frances Maria Fisher, so the dangling Holding surname is explained by exactly
the marriage the hint proposes, from a direction the hint did not supply.

`expected-findings.json` therefore keeps the hint's claim and sharpens it: the
marriage detail moves from "1895, Australia" to "23 February 1895, Hobart,
Tasmania, Australia", and `supporting_sources` now cites the two registrations
rather than the index.

**One correction to the draft this replaced, and to issue #2295:** both
described the hint record as giving "no place beyond Australia". It is not
placeless — the index entry (`ark:/61903/1:1:XTZG-3QR`) records the marriage
place as "Tasmania, Australia". The rest of that caution was sound: the entry
gives no parents and no registration number, which is why it could not be the
confirming record.

**What was searched and did not resolve.** No record consulted names the
bride's parents, so nothing directly ties this Frances Maria Fisher to the
tree's William Fisher (`GZBM-JS3`) and Alice Smith (`KC1F-ZW3`). The
identification rests on the given name and surname, the town (Hobart), the era,
a `same_person` score of 0.92 on the bride, and the daughter already sitting in
the tree as Francis's child.

**Do not send the next adjudicator to the marriage image for the parents — the
1895 Tasmanian register has no parents column.** The benchmark run read
`ark:/61903/3:1:3QS7-99CH-CY6T` and recorded the form's columns: number; when
married and where; name and surname; age; rank; signature and description of
parties; officiating minister; when registered; registrar's signature. Its own
source note states it plainly — "Register format does not include fathers'
names". That is the M.—1. form behaving normally, not a failed reading, so this
route is a permanent dead end rather than an unexplored one.

**What the register does give toward the bride is the witness line.** J. Fisher,
Sarah Ann Fisher and John Fisher all signed (recorded in the run as
`a_022`-`a_024`). The shared surname makes them likely Fisher family and a live
FAN lead toward `GZBM-JS3` — weaker than an indexed parent field, but real, and
the thread the image actually supports. The other untried route is the district
registers (collection 2514003), which the run's own locality plan says carry
parents' names.

**One discrepancy, recorded rather than smoothed.** The tree gives the
daughter's birth as "about 1898"; the registration gives 2 November 1897. That
is consistent with an age-based estimate taken from her death in July 1918, but
it is a difference, not a match.
