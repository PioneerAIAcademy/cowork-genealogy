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

**Second opinion: Richard Chesworth (senior developer)**, who confirms the
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

**A stronger record surfaced later, from the graded run — not from this
adjudication.** `ark:/61903/1:1:W5XV-6XPZ` is Marie Badoux's burial, 22 March 1780
at Romenay, recording her death the previous day, **21 March 1780** — nineteen
months before the hinted baptism. That settles the question outright and does not
depend on reading a surname: a woman dead in March 1780 cannot be the mother of a
child baptised in October 1781. The adjudication above reached the right answer by
the weaker surname route because this record was not found by hand; the second
opinion was given on that weaker argument. The record is now carried in `f1`'s
`supporting_sources` as the decisive one, and `f2` accepts either route. It is
listed separately from the table above because nobody opened it during
adjudication — the agent found it.

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
paroissiaux et d'état civil, 1530-1892", Romenay, **1773–1780** — from the Badoux
marriage to Marie Badoux's death on 21 March 1780, which closes the window — holds
no entry naming Marie Badoux as the mother of Claudine Thénot or of any other
daughter. That absence is written into `f2`'s `supporting_sources` as plain prose
with no ark attached, per `docs/specs/e2e-test-spec.md` §3.6.1, so its wording is
the entire warrant: it must not claim a wider search than was actually made. The
window was originally written as 1773–1792, "through the end of plausible
childbearing", before the death date below was known; childbearing in fact ended
at her death.

**What this fixture measures: restraint, not recall.** The snapshot the agent
reads holds only four persons — Marie Badoux, her parents Pierre Badoux and Marie
Fromin, and Philippe Thénot. Neither Marie Joly nor Marie Claudine Bourgeois
appears in it (the string "Joly" is absent from `starting-tree.gedcomx.json`
entirely), and its two sources are both marriage entries from the same collection
as the hint, so nothing independent exists on the tree side. Grade a run on
whether it resisted the hint and said so, not on how much it found.

Be honest about what this does and does not test. The `researcher_question` —
fixed by the card and deliberately unchanged — already states the baptism was "to
Philippe Thénot and Marie Joly", so the agent is handed the mother's name before
it starts. It does **not** have to open the 1781 record to notice the mismatch.
The graded run confirms the leak is load-bearing: it never located
`W5XL-MP3Z` at all, said so, and treated "Marie Joly" as stipulated by the
question rather than verified from a record it read. So this fixture measures
whether the agent declines to attach a child it has been told belongs to someone
else — not restraint against an unqualified hint. Adjacent to issue #2478.

**Encoding: both findings are `required: true`.** `f1` is the whole point of an
outcome-(c) record-hint fixture — a fixture that cannot fail on the restraint it
exists to measure measures nothing — so it gates. Had `f1` been encoded as
`required: false`, the committed run — Claudine present, guard fires, `f1`
labelled `false` — would have reported `pass` rather than `partial`. Un-gating
does not merely soften the guard interaction; it makes it invisible in the
verdict.

**Why the committed run nevertheless reads `partial`, and why that is not a
ceiling on the fixture.** `apply_avoid_guard` (`eval/harness/e2e/judge.py`)
re-checks every `polarity: "avoid"` finding by matching given+surname tokens
against the agent's final tree, with **no view of relationships**, exempting only
the fixture's own subject (`LT9H-SK3`). So it force-fails `f1` on any run in which
a person named Claudine Thénot exists at all — *including* a run that attached her
to her actual parents, which `f1`'s own description calls correct behaviour. That
is what `run-2026-09-17_19-44-23` did (`I8`, attached to Philippe Thénot and Marie
Joly by `R16`/`R17`, with no edge to Marie Badoux), and it is why the run's stored
verdict is `partial` / outcome `fail` while the judge passed both findings in its
own words and the blind human annotation labels both `true`.

That penalty falls only on runs that go **beyond** what the fixture asks. `f2`
asks for a documented negative conclusion and nothing more — "either refuting
route earns this finding" — and does not oblige a Claudine Thénot person in the
tree. This run is its own evidence for that: the judge's `f2` pass rests on
`ps_001` and on the death/burial facts under `LT9H-SK3`, and cites `I8` nowhere,
so deleting `I8` leaves `f2` standing. Replayed against this run's own final tree
through the real `apply_avoid_guard`, with `f1` at `required: true`:

| Tree | `f1` | guard fires | verdict |
|---|---|---|---|
| as committed (Claudine present) | `false` | yes | `partial` |
| Claudine person removed | `true` | no | **`pass`** |

So a plain run that declines the hint and documents the rejection reports `pass`.
Only the supererogatory re-attachment is capped, and the cap is the guard's
relationship-blindness — **issue #2640**, closed `NOT_PLANNED` with the substance
unresolved, of which this fixture is an eighth instance. Do not read this run's
`partial` as a finding about the agent; read the annotation's notes.

**Do not edit the live FamilySearch tree from this fixture.** The duplicated 1773
Marriage facts and the absent second-wife relationship are part of what this
fixture measures, and `starting-tree.gedcomx.json` is committed identical to
`unstripped-tree.gedcomx.json` so `snapshot --check` can audit upstream drift. If
a live-tree correction is genuinely warranted, file it separately.
