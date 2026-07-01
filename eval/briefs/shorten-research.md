# Shorten: research

**Bucket:** B (craft compression) — pure orchestration/routing prose, no new tool
**Primary owner:** both (developer compresses structure/boilerplate; genealogist
confirms the routing-table semantics and the mentor-gate logic are preserved)
**Current size:** 212 lines → **Target:** ~150–165 lines (~25% reduction)
**Tool migration:** **n/a** — no persistence tool. research is a thin
orchestrator; its only `allowed-tools` entry is `validate_research_schema`
(read-only, and no longer run periodically — only to confirm an external/manual
edit). It isn't in
`docs/specs/skill-rewrites-for-persistence-tools-spec.md` §4 — every write is
delegated to a sub-skill.
**Still needed as a skill?** **Yes, but it's the riskiest of the three to
cut blind** — see "No test floor" below. It's the full-GPS-workflow entry point
and the only autonomous-run driver (`--autonomous`), and Cowork has **no
programmatic skill-to-skill invocation** (`docs/specs/skill-architecture-spec.md`
§1, §2), so all of its orchestration is *prose routing by description*. The
routing signal is the value; the verbosity is the target.

## TL;DR
This is the one brief where you can't lean on the unit harness: **there is no
`eval/tests/unit/research/` directory and no `test_research.py` validator** —
the only `test_research*` files belong to `research-exhaustiveness` and
`research-plan`, and `research` appears in no ownership table. So "re-run and
confirm green" doesn't apply here as a safety net. Cut the **emphatic
keep-going repetition** (the "don't yield" point is stated ~4 times across
Autonomous mode + Iterate + When to stop) and the Re-invocation boilerplate;
**keep the routing table, the mentor-checkpoint protocol, and the stop
conditions intact** — there's no test that will catch you if you damage them.

## Why this skill is shortenable
The substantive content is: (1) a routing table from `research.json` state →
next sub-skill, (2) the `--autonomous` "keep working in one turn, don't yield"
contract, (3) the `gps-mentor` checkpoint/verdict protocol, and (4) stop
conditions. The verbosity is in (2): the no-yielding rule is hammered home in
"Autonomous mode" (48–63), again in "Iterate — without yielding" (98–105), and a
third time in "When to stop" (176–180). State it forcefully **once**. The rest
is two short boilerplate-ish tails ("What this skill does not do," "Re-invocation
behavior") that restate the routing table's premises.

## The floor: what the unit tests actually grade
- **Deterministic validators:** **none.** There is no
  `eval/harness/validators/test_research.py`. The universal validators only run
  on tests that exist, and **no unit test targets this skill**
  (`eval/tests/unit/research/` does not exist). `research` is also absent from
  `OWNERSHIP_TABLE` / `TREE_OWNERSHIP_TABLE` in `test_universal.py` — consistent
  with it owning no section (it delegates every write).
- **Rubric dims:** **none** — no `eval/tests/unit/research/rubric.md`.
- **Base dims:** would be Correctness / Completeness / Tool Arguments **if** a
  test existed; none does.
- **Negative/boundary tests:** **none for this skill.** Its routing-out
  boundaries (don't use for a single step → the specific sub-skill; don't use for
  a status summary → project-status; don't use when no research.json → init-project)
  live **only in the frontmatter `description`** and are not exercised by a
  negative test the way other skills' boundaries are.
- **End-to-end coverage instead:** the closest real coverage is the e2e GPS
  fixtures (e.g. `eval/tests/e2e/kenneth-quass-death/`), which drive the full
  loop rather than grading a single transcript. Those are slow and not part of
  the per-PR unit gate. **Treat any cut here as e2e-gated, not unit-gated.**

> **Consequence:** the overview's safe lever — "cut what duplicates the
> schema/validator/rubric, then re-run green" — has **no validator or rubric to
> cut against and no unit run to confirm.** Cut only what is *provably*
> repetition (the same sentence three times) or boilerplate. Do **not** trim the
> routing table, the mentor protocol, or the stop conditions on the theory that
> "a test will catch it" — none will.

## CUT — safe to remove (provable repetition / boilerplate only)
- **[194–212] "Re-invocation behavior"** — boilerplate. "Writes: nothing — it
  delegates every write" is already the thesis of the whole skill and the first
  line of "What this skill does not do." Keep at most one sentence ("Safe to
  re-run; it re-reads `research.json` and resumes routing"), drop the rest.
  **(~15 lines)**
- **The triplicated "don't yield" rule** — it appears in full in "Autonomous
  mode" (48–63), is re-argued in "Iterate — without yielding" (98–105), and
  restated again under "When to stop" (176–180). Keep the strong statement
  **once** (in Autonomous mode), reduce the Iterate step to "re-read
  `research.json` and invoke the next step in the same turn (see Autonomous
  mode)," and let "When to stop" just list the stop conditions without
  re-litigating yielding. **(~12–15 lines)**
- **[182–193] "What this skill does not do"** — three bullets that restate
  premises already in "What to do" (no new GPS logic; don't skip steps; route to
  init-project if no research.json). Compress to one sentence, or fold the
  init-project routing into the stop/precondition note. **(~8 lines)**

## KEEP — load-bearing judgment (do NOT cut)
- **The routing table (76–97)** — `research.json` state → sub-skill. This is the
  entire orchestration signal; with no programmatic invocation, this prose *is*
  the mechanism. **Untested, so unprotected — keep every row.** The
  exhaustiveness-is-the-last-gate note (93–96) explains the ordering and stays.
- **The `gps-mentor` checkpoint protocol (111–159)** — the three gated
  transitions, the "check `evaluations/` for a current verdict first" caching
  rule, the on-demand triggers, and the verdict-handling table (interactive vs
  `--autonomous`). This is a distinct, specced behavior
  (`docs/specs/gps-mentor-agent-spec.md`) with no unit test here — **do not
  compress away the verdict semantics or the `address_first` "never auto-route
  in interactive mode" rule.** Tighten prose only.
- **The `--autonomous` contract — once, strong** — proceed without pausing, log
  decisions to the audit trail, keep going in one turn. This is what makes
  autonomous e2e runs work; the e2e harness depends on it.
- **Stop conditions (162–174)** — the three real stop conditions
  (`project.status == "completed"`, user halts, genuine logged blocker). Keep
  the list; drop only the re-argument of yielding.
- **Routing-out boundaries** — keep them present in the body (single step → that
  sub-skill; status only → project-status; no research.json → init-project),
  since there's no negative test backstopping the description.

## TIGHTEN — keep the point, cut the words
- Merge the no-yielding argument into a single forceful paragraph under
  Autonomous mode; reference it from Iterate and When-to-stop rather than
  repeating it.
- The mentor section's prose can lose connective tissue while keeping the two
  tables and the verdict rules verbatim.

## Suggested target structure (~155 lines)
1. Frontmatter + Narration + 2-sentence purpose (thin orchestrator; reads state,
   routes to sub-skills; no programmatic invocation, so routing is by judgment).
2. Autonomous mode — the keep-going contract, stated once + audit-logging.
3. What to do: read state → **routing table (whole)** → iterate (one-line, refers
   back to Autonomous). (The skill no longer runs periodic
   `validate_research_schema`; don't reintroduce it — the writer tools validate
   before persisting.)
4. Mentor checkpoints — the two tables + verdict rules, prose tightened.
5. When to stop — the three conditions, no yielding re-argument.
6. One-line routing-out boundaries (status→project-status, step→sub-skill,
   no-research.json→init-project).

## Verify
```
cd eval/harness && uv run python run_tests.py --skill research
```
**Expect this to run zero tests** (no `eval/tests/unit/research/`). That is the
point: there is no unit safety net. Real verification is the layered e2e
playbooks and the GPS e2e fixtures (e.g. `eval/tests/e2e/kenneth-quass-death/`)
driving the full autonomous loop end-to-end — confirm an autonomous run still
chains question-selection → research-plan → search → … without yielding
mid-loop, and that the mentor gates still fire. Treat cuts here as e2e-gated.

## Owner notes
Flag prominently to the team: **this skill has no unit-test floor.** That makes
it both the safest to *over*-trim accidentally (nothing turns red) and the one
where over-trimming is most dangerous. Confine the pass to the provable
repetition (the thrice-stated no-yielding rule) and the two boilerplate tails.
**Developer** does the structural compression; **genealogist** (or whoever owns
the GPS workflow + the gps-mentor spec) signs off that the routing table and
mentor protocol are semantically unchanged before merge — because no harness
will. The absence of `eval/tests/unit/research/` is **intentional, not a gap**:
research is a thin orchestrator with no isolatable unit (a routing run in the
harness cascades through every sub-skill over a `Skill` tool that Cowork
production lacks), so a unit suite would grade a fictional routing path. The e2e
GPS fixtures are this skill's floor by design — don't author a unit directory to
"bring it onto the same footing" as the others. See the deep-dive brief
(`research.md`) for the full rationale.
