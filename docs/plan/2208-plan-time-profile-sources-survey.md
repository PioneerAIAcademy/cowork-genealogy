# Issue #2208 — the plan-time survey asks for a link production trees don't have

**Status:** **Built, awaiting the paid eval run.** Part 1 (§1–§5, the facts-not-source-refs
retarget) and Part 2 (§8, re-reading the question person's FamilySearch profile — added
2026-10-08 on the lead's word, issue #2208 comment from #3244). Test id for §8:
`ut_research_plan_prof`, fixtures `person-read-kerrigan-proposed-parents` and
`person-read-kerrigan-subject`. SKILL.md grows ~85 words net; not offset, because §1's third
row measured that compressing the survey paragraph broke it. Delete this file when the PR merges;
`docs/plan/` is for work not yet built.

**Issue:** #2208 — needs rewriting a fourth time; the finding below is sharper than the
card's and points somewhere else.

**Touches:** `packages/engine/plugin/skills/research-plan/SKILL.md`,
`eval/fixtures/scenarios/first-plan-fan-production-shape/`,
`eval/tests/unit/research-plan/first-plan-fan-production-shape.json`,
`eval/harness/validators/test_research_plan.py`,
`eval/runlogs/unit/research-plan/`; §8 adds
`eval/fixtures/scenarios/plan-reads-question-person-profile/`,
`eval/fixtures/mcp/person-read-*-proposed-parents.json`,
`eval/tests/unit/research-plan/plan-reads-question-person-profile.json`,
`eval/harness/tests/unit/test_research_plan_validator.py`,
`packages/engine/mcp-server/tests/packaging/prompt-sizes.json`

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

What survives from #2208 as filed is the case where data is **genuinely absent** from the
tree — the original #2158 incident (attached sources never imported) and #3244 (a
relative's parents never imported). §8 builds that, with `person_read` — an existing tool —
rather than a new one.

## 7. Out of scope, not deferred quietly

Two findings this measurement produced that belong to no card yet, both awaiting a lead
ruling before filing:

- **The watcher blind spot** — a tier-2 check gated on the field its own subject matter
  lacks in production. `nothing-checks` shaped.
- **The fixture-shape gap** — 62 of 99 unit scenarios versus 3 of 136 real starting trees.
  Wider than this card: the unit suite systematically exercises a tree shape production does
  not have, and this issue is one instance of what that hides.

## 8. Part 2 — read the question person's FamilySearch profile (added 2026-10-08)

### Why

Part 1 fixes the case where the data is in the tree but the rule looked for the wrong link.
Two live reports show the other case — the data is on FamilySearch and **never reached the
tree**:

- **#2158** (2026-09-01): the subject's ~10 attached sources never landed in `sources[]`;
  the decisive birth register was reached only after the tester reminded the agent.
- **#3244** (2026-10-07, Dallan's comment on #2208): subject Mary Maria Fuller (KWJT-3ZT);
  her father David Fuller is I5 with FamilySearch id LZKH-93V, imported as a relative, so
  *his* parents were not imported. `q_001` asks "Who were the parents of David Fuller?",
  its rationale says "David Fuller (I5) has no parents documented in the tree", and the
  12-step plan searches from scratch. FamilySearch already proposes a pair; nothing read
  LZKH-93V.

`research/SKILL.md:112-117` already tells the router to `person_read` "the person" before
any search, but a plan is not a search, the router reads the project subject, and the
question's person is often someone else. Lead (Dallan) asked for it in this PR.

### Why this cannot be a writer-tool precondition

ADR-0011's first question — decidable from the project documents alone? — **no**: the
missing data is upstream. And `questions[]` carries no person link (`$defs/question` has
no person field), so even "did you read the right profile" needs prose to pick the person.
So: skill instruction + `person_read` grant + a deterministic call-log validator.

### Changes

1. **`research-plan/SKILL.md`**
   - `allowed-tools`: add `person_read`. Add one row to the "MCP tools used" table.
   - Step 1, ahead of the survey paragraph, one short paragraph (target ≤ 70 words):
     for each person the question is about whose tree entry carries an `ark`, call
     `person_read({ personId })` with the id at the end of that ark, before writing any
     plan item. What it returns that the tree lacks — parents, spouses, facts, attached
     sources — is a lead already held: state it in the rationale and plan items that
     **test** it, not searches that start as if it were unknown. Say "project tree" vs
     "FamilySearch tree" when stating what is missing. If the call fails, say so and plan
     from the tree.
   - Scope is **the question's person(s)**, not every FAN person — cost is one read (plus
     its sibling fan-out) per question person, not per in-scope relative.
   - Regenerate `packages/engine/mcp-server/tests/packaging/prompt-sizes.json`
     (`UPDATE_PROMPT_SIZES=1 npx vitest run tests/packaging/prompt-budget.test.ts`).
   - Offset the added words elsewhere in the body where possible (standing "leave it
     shorter" rule); if net growth, say so in the PR body with the reason.
2. **New scenario** `eval/fixtures/scenarios/plan-reads-question-person-profile/`
   (`research.json`, `tree.gedcomx.json`, `README.md`), modeled on #3244 with **synthetic**
   ids and names: subject I1 with an `ark`; her father I2 with an `ark`, with facts but no
   parents in the tree; `q_001` = "Who were the parents of <father>?", rationale saying
   none are documented in the tree. Every person carries an `ark` (the production shape).
3. **New MCP fixture** `eval/fixtures/mcp/person-read-<father>-proposed-parents.json`,
   predicate `{ "personId": "<father id>" }` alone (the Driscoll note: the tool ignores the
   flags). Response: the father, a FamilySearch-proposed parent pair, and one attached
   source (e.g. a baptism) naming those parents — none of it in the project tree.
4. **New test** `eval/tests/unit/research-plan/plan-reads-question-person-profile.json`
   (`ut_research_plan_<id>`), tags `profile-reread`, `research-plan-new-plan-for-q-001`,
   `new-plan-items-planned-status`, `issue-2208`. `mcp_fixtures` = the new person_read
   fixture plus the place/collections fixtures it needs. Judge context: the plan names the
   FamilySearch-proposed parents and the attached source's content, and plans to **test**
   that pair; it does not claim the parents are unknown; it distinguishes project tree from
   FamilySearch tree. Also register a minimal subject `person_read` fixture, so an extra
   read of the subject succeeds instead of sending the run down the "call failed" branch.
5. **New validator** `test_research_plan_reads_question_person_profile` in
   `eval/harness/validators/test_research_plan.py`, tier 1, tag-gated on `profile-reread`:
   a `person_read` entry in `tool_calls` whose `matched.kind == "predicate"` and whose
   `response_fixture` is the father's fixture exists, and its index precedes the first
   `research_append` that writes `plans`/`plan_items`. (Every mock call, matched or not,
   lands in `tool_calls`; `matched.kind` is the discriminator — `orchestrator.py`
   `_predicate_matched_count`.) Plan writes are found by parsing `ops` as
   `test_universal.py:720-729` does (JSON string → list; single top-level op → `[args]`),
   matching `section in {"plans", "plan_items"}`. A tagged run with **no** plan write fails,
   it does not skip.
6. **`_TRACEABLE_ID_TOOLS`**: add `person_read`, so ARKs the plan cites from the profile
   are grounded, not flagged as fabrications by V1. (Grounding only ever clears a false
   flag.) Fix `test_research_plan_no_out_of_lane_tools`'s "six-tool lane" wording.
7. **Validator unit tests** in `eval/harness/tests/unit/test_research_plan_validator.py`
   for (5), proven both ways:
   - *Red:* no `person_read` at all; only a `person_read` with `matched.kind == "none"`
     and a `fixture_not_found` response (wrong id); a read matching the *subject's* fixture
     only; the matched read after the plan write; no plan write at all.
   - *Green:* matched read before the write; the same with `ops` sent as a JSON string;
     the same with a single top-level op; skip when untagged.
   - Plus one V1 test: an ARK served only by `person_read` cited in a rationale is not
     flagged.

### Effect on existing tests

22 tests; none of their scenario trees carries an `ark` (checked 2026-10-08), and
`person_read` is unregistered there, so the model never sees it (an attempt by name would
abort `unmatched_tool_call`).

### Acceptance

- `make harness-test` green, including the new validator tests, each red case shown to fail.
- **Baseline first:** one single-test run of the new test against the pre-§8 SKILL.md
  (new fixture + validator in place). The harness grants every registered tool, and
  `person_read`'s description already says it returns parents, so the fixture alone might
  cause the read. If the baseline passes, the PR says the test guards regression but does
  not show the paragraph causes the read.
- `make eval-skill SKILL=research-plan` (one paid run, user approves the spend first):
  the new test passes; `bpx` and `pshape` do not regress; run log + `.ann.json` committed.
- Not covered and said so in the PR: the router's own `person_read` rule in
  `research/SKILL.md` (not touched — it would arm the `research` run-log gate); and e2e —
  e2e trees carry no `ark` and e2e blocks `person_read`, so §8 is exercised only by the new
  unit test.

### Sequencing

- **PR #3118** (issue #2251, open) edits the same frontmatter, "MCP tools used" section,
  `_TRACEABLE_ID_TOOLS` (adds `wiki_read`) and V2's tool-count wording, and adds
  `docs/specs/research-plan-skill-spec.md`. If it merges first: rebase, keep both tools in
  `_TRACEABLE_ID_TOOLS`, word V2 to the final list (no hard count), and add the
  `person_read` step to that spec.
- **Issue #2116** converts research-plan to an agent: its `tools:` must carry `person_read`
  in all three spellings, plus the `AGENT_PERMISSIONS` snapshot in
  `tests/packaging/agent-tool-names.test.ts`. Note this on #2116 when the PR opens.
