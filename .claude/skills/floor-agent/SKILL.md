---
name: floor-agent
description: Use when moving one plugin agent to a cheaper model or lower effort — "move locality-guide to Haiku low", "find the floor for research-plan", "floor search for X", "why does X fail on Haiku", or "/floor-agent <agent>". Takes one agent from a failing baseline on the target model to a full-suite gate, by measuring which tests fail and why, fixing test gaps, moving rules the model skips into tools, and only then editing the agent body. Runs paid scratch suites, so the lead says when to start. Do NOT use to improve a skill from one run log (improve-skill), to audit a rubric (audit-rubric), or to interpret an e2e run (interpret-e2e-result).
---

# Floor an agent

Take ONE agent to the cheapest model and effort at which every rule its suite tests still holds. The rules hold before the model moves: a failing test is fixed, never deleted to land.

`floor.py` beside this file reads the run logs. Run it as `python3 .claude/skills/floor-agent/floor.py <command>`.

## Before starting

1. Work in a new worktree. Check `gh pr list --search "<agent>"` for open PRs on the same agent: they share its eval slot.
2. Ask the lead whether you may launch scratch runs yourself. A full suite at three runs per test costs about $20 and 15 minutes, mostly the main thread.
3. `floor.py usage <agent> --since <two weeks ago>` — what the agent does in real e2e runs: calls per tool, the largest prompt per spawn, time. A tool in its `tools:` that the list does not show was never called.
4. Size the body and the tool schemas it loads. The prompt is re-read on every turn, so prompt size and turn count are the cost.

## Scratch runs

Set the agent's `model:` and `effort:` in the worktree, `make engine-build`, then from `eval/harness`:

```sh
caffeinate -i uv run python run_tests.py --skill <agent> --runs-per-test 3 --runlogs-root <worktree>/.claude/floor-runs/<label>
caffeinate -i uv run python run_tests.py --test <ut_id> [<ut_id> ...] --runs-per-test 10 --runlogs-root <worktree>/.claude/floor-runs/<label>
```

- Always pass `--runlogs-root` outside `eval/runlogs`, so scratch logs do not prune committed ones.
- One run at a time. Do not edit the agent, its tests, fixtures or the plugin's hooks while a run is in flight, and do not rebuild the engine: the run reads them.
- Read outcomes from the log with `floor.py`, never from the progress lines.

## The loop

1. **Baseline.** Full suite, three runs per test, on the target model and effort. `floor.py reds <log>`.
2. **Sort every red run before changing anything.** `floor.py run <log> <test>:<run>` and `floor.py gaps <log>`. Each red is one of:
   - **Test gap.** A reasonable call had no canned answer and got `fixture_not_found`, which production never returns. A cheaper model stops after one or two such errors where a stronger one keeps varying the call until one matches.
   - **Agent fault.** A rule in the body was not applied.
   - **Grading error.** The judge's reason contradicts the calls in the log.
   Open the run. A test's name and its earlier failures do not say why this run failed.
3. **Find the real offenders.** Three runs per test cannot tell a fix from noise: the same configuration moves by five passes in 117 between runs. `floor.py tally a=<log> b=<log>` across the full runs, then run each test with two or more red runs ten times. Fix what fails 2 of 10 or more.
4. **Fix in this order, one change at a time, each measured over ten runs of the tests it targets.**
   1. **The test.** Add a canned answer for the reasonable call, under a second predicate, listed after the more specific fixture. Do not change what the test accepts on a guess about the upstream service. For a grading error, add a judge note that enforces the test's own stated rule.
   2. **A tool.** Ask whether a tool can state the rule at the moment it applies, on a call the agent already makes (ADR-0011). Patterns that worked:
      - a nil-gated advisory on the search response, keyed on the call's own arguments;
      - a note on the log write that quotes the plan item's rationale on its first nil;
      - a block of facts on the response in place of a lookup the agent was told to make first;
      - a refusal at the writer tool, with the fix in the message.
      Compute it in one exported function that the tool and the eval mock both run (`searchAdvice` in `utils/search-advice.ts`, wired in `eval/harness/harness/mock_mcp.py`). A live tool (`research_log_append`, `research_append`) needs no mock change.
   3. **The body.** One sentence, where the agent makes the decision. Measure it like anything else, and take it back out if ten runs do not move.
5. **Where a rule belongs.**
   - A rule about one country's or one collection's records arrives in the plan item, written by `research-plan` from the wiki. The agent body does not carry it (lead, 2026-11-12). A test of such a rule puts it in the plan item's `rationale` and checks the agent follows it.
   - General craft stays in the body.
   - A fact the agent must look up before acting is supplied by the tool. An instruction to fetch is skipped by a cheaper model whatever the body says.
   - A generic ordered list of things to try, returned by a tool, did not help: the model worked down it and stopped before the item that mattered. Return the one thing that applies.
6. **Cut the prompt.** Drop each tool the agent never called in real runs, with the prose about it. Then run `tests/packaging`: the pinned tool list in `agent-tool-names.test.ts` and the hook's hand-kept lists in `plugin/hooks/guard_project_files.py` both change, and a tool no agent holds any more comes off the hook's agent-only list only on the lead's say.
7. **Gate.** Full suite, three runs per test. Repeat steps 2 to 4 on what is left. Partials do not stop a rung; record each in the annotation.
8. **Land.** Engine and packaging tests green, spec sections for each tool change, one committed `make eval-skill SKILL=<agent>` run, annotated. The e2e panel, three runs per fixture, is the lead's.

## Report as you go

After each run give the lead: passed, partial, failed and aborted counts; what each red was; what you changed; and the agent's median time, median turns, largest prompt and cost per spawn from `floor.py reds`. A tool change that removes a check also removes that check's failures, so compare fails other than the retired check.

A change to a shared tool's contract, to an ADR, or to what a test accepts is the lead's decision: put it to him with the measurement.
