# Issue #2208 — the plan-time survey asks for a link production trees don't have

**Status:** **Built** — the work landed in the PR from branch
`2208-survey-reads-facts-not-source-refs`, not pending. This file is the evidence record
for that PR and supersedes the tool-building plan it held before (two plan-critic rounds).
**Delete it when that PR merges**; `docs/plan/` is for work not yet built.

**Issue:** #2208 — needs rewriting a fourth time; the finding below is sharper than the
card's and points somewhere else.

**Touches:** `packages/engine/plugin/skills/research-plan/SKILL.md`,
`eval/fixtures/scenarios/first-plan-fan-production-shape/`,
`eval/tests/unit/research-plan/first-plan-fan-production-shape.json`,
`eval/harness/validators/test_research_plan.py`,
`eval/runlogs/unit/research-plan/`

---

## 1. What was measured

Three single-test runs, $1.43 total. One variable at a time; the grading bar
(`judge_context` entries 2 and 3) byte-identical to `ut_research_plan_bpx` throughout.

| | fixture-shaped tree (`bpx`) | production-shaped tree (`pshape`) |
|---|---|---|
| **survey rule as shipped** | pass, 8 dimensions at 3 | **partial** — Correctness 2, Completeness 2 |
| **survey rule, trigger retargeted** (shipped) | **pass, 8 at 3** | **pass, 8 at 3** |
| **retargeted + further tightened** | not run | **partial** — Correctness 2, Completeness 2 |

**Every cell is n=1**, on a non-deterministic model, for a rule whose own history records
three wordings plateauing near 50%. One pass and one partial is consistent with the fix and
also with variance; the mechanism evidence below, not the outcome table, is what carries
this. Per the standing rule against re-running to average out noise, none was repeated.

The third row is why the shipped wording is **+15 words** against main rather than shorter,
against the standing "leave every SKILL.md shorter than you found it" rule. The shorter
variant compressed away the ordering cue *"before deciding what to plan for that person"*;
the judge then found the deed content named but the survey no longer presented as a step
distinct from new-search planning.

`pshape` is `bpx`'s scenario with exactly one change: the fact→source ref deleted from
Patrick Sheahan's 1875 Residence fact. S1 stays in the tree's top-level `sources[]`; the
fact keeps its date, place and value.

Judge on the failing run: *"mentions Patrick (I2) as a FAN item in pli_008 but never states
what the source S1 actually records"* … *"should have noted this existing evidence … not
deferred it to a planned search."* Judge on the fixed run: *"correctly reference the deed
details ('Deed Book 42, p. 118')."*

## 2. The finding

**The survey rule asks for a link real FamilySearch imports do not create.**

`research-plan/SKILL.md:87` said to check `tree.gedcomx.json` for *"the source(s) already
attached to their facts and relationships"*. Simplified GedcomX has no person-level source
field (`TREE_PERSON_FIELDS` = `id, ark, living, gender, names, facts`), so the only
source↔person link runs through a fact-level `sources` ref — and real imports do not write
them:

- **0 of 3,606** facts, in **0 of 95** `eval/tests/e2e/*/unstripped-tree.gedcomx.json` —
  the as-pulled FamilySearch snapshots, before any stripping. This is the decisive figure:
  it rules out the obvious objection that `e2e.author strip` deleted the refs.
- **3 of 136** `eval/tests/e2e/*/starting-tree.gedcomx.json` carry any (55 of 4,182 facts).
  All three — `ferber-grandparents`, `ferber-marriage`, `william-ferber-parents` — have no
  `unstripped-tree.gedcomx.json`, so they predate the snapshot tooling and are hand-authored.
- **62 of the 99** hand-authored `eval/fixtures/scenarios/*/tree.gedcomx.json` that existed
  before this change do. (This change adds the 100th, so a reviewer re-running the count
  gets 62 of 100.)

So on a real tree the survey correctly concluded there was nothing to survey, while the
facts sat there with their dates, places and values. The unit suite did not catch it
because it tests a shape production almost never has.

**Nothing observed this.** All 34 validators passed on the run the judge marked down. The
tier-2 watcher shipped for exactly this behavior
(`report_survey_surfaces_already_attached_fan_facts`) gates on the same missing field
(`test_research_plan.py:894`), so it passes vacuously on the trees that matter. On a real
project there is no judge.

## 3. The fix

1. **`research-plan/SKILL.md`** — retarget the survey's trigger from *sources attached to
   facts* to *the facts themselves, sourced or not*. Twelve words; the requirement to state
   each one's date, place and value is unchanged.
2. **Promote the production-shaped scenario and test** into the committed tree. It would be
   the only test in the suite exercising a tree with no fact-level source refs; without it
   this regresses silently at the next rewording.
3. **Widen the tier-2 watcher** off `f.get("sources")` so it can fire on a production-shaped
   tree. Tag-gated on `already-attached`, which only `ut_research_plan_bpx` carries today,
   so the blast radius is the two tests that opt in.

## 4. Acceptance

- `ut_research_plan_pshape` passes; `ut_research_plan_bpx` does not regress. **Both already
  measured** (§1) — the paid suite run confirms them alongside everything else.
- The widened watcher **proven to fail both ways** before landing, per CLAUDE.md § "A new
  lint must be proven to fail":
  - *Red:* a response that names the person but never the fact's content must fail, on a
    tree with **no** fact-level source refs — the case the old gate skipped.
  - *Red, second shape:* a fact carrying a `value` but no `date` must still be checked, not
    skipped into a vacuous pass.
  - *Green:* the existing `bpx` fixture shape still passes, and a person with no facts at
    all is still out of scope rather than a new false positive.
- Three consecutive `make eval-skill SKILL=research-plan` runs with zero `fail` and zero
  `aborted`, annotated through `make eval-ui`.

## 5. Sequencing

`make eval-skill SKILL=research-plan` is this skill's paid slot and **#2685 must clear its
reds first** — its own note: *"A failing validator skips the judge entirely, so a new
dimension added beside a red assertion arrives judge-dark."* The newest committed run is
`v1_2026-09-17_15-04-52` (`_007`/`_010`/`_011` fail, `_005`/`_wzk` abort), not the
`v1_2026-09-14_09-44-05` #2685's table is built on. The PR can be written now; it lands
after #2685.

## 6. What fell away, and why it is recorded here

The previous version of this plan built a new MCP tool (`profile_sources_survey`) to re-read
each in-scope person's FamilySearch profile at plan time. That is no longer justified for
the common case: the data was never missing. It cost a manifest entry, a spec, a
`dev/smoke-calls.ts` row, a 60s-capped aggregated call, and permanent context budget in
every session, to fetch something already on disk.

What survives from #2208 as filed is the case where sources are **genuinely absent** from
the tree — the original #2158 incident, one report. That is a much smaller build and is not
this PR.

## 7. Out of scope, not deferred quietly

Two findings this measurement produced that belong to no card yet, both awaiting a lead
ruling before filing:

- **The watcher blind spot** — a tier-2 check gated on the field its own subject matter
  lacks in production. `nothing-checks` shaped.
- **The fixture-shape gap** — 62 of 99 unit scenarios versus 3 of 136 real starting trees.
  Wider than this card: the unit suite systematically exercises a tree shape production does
  not have, and this issue is one instance of what that hides.
