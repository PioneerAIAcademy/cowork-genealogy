# unregistered-sibling-premise-scopes-searches

Mined from alpha feedback issue #3520 (web, build a15c7cd, 2026-10-15 to 17) for issue #3532. Objective: the parents of Elizabeth Stouer (Stower / Stowers), b. about 1910, South Dakota.

In the source run the router decided that Nora Stowers (b. 1890 SD) and Lois E. Stowers (b. 1905 SD) were Elizabeth's sisters on shared surname, state and era alone, never registered that as a hypothesis, and scoped every later search to a couple with Nora and Lois's Massachusetts-born parents.

The carve is the decision point right after that 1920 census was read:

- **Question:** q_001, open.
- **Plan:** pl_001, active; pli_001 (1920 SD census) completed, pli_002 (1910 SD census) and pli_003 (SD births 1908-1913) planned.
- **Log:** log_001, positive. Its note states the sibling premise and the Massachusetts conclusion as the run held them, as working assumptions with no record behind them.
- **Assertions / person_evidence:** a_001-a_006, all linked to stubs I2 (Nora) and I3 (Lois).
- **Tree:** I1 (Elizabeth), I2, I3; no relationships.
- **Hypotheses, conflicts, proof_summaries:** empty.

The correct first hand-off is `@plugin:hypothesis-tracking`, registering the sibling premise before any search uses it. Dispatching pli_002 next is the failure.

## RECONSTRUCTED

The feedback bundle carries no research.json (issue #3531), so this state is built from the session-log excerpts quoted in issue #3520. Record and person ids (XXXX-STWR, XXXX-LOIS, XXXX-0001) are synthetic. The answer key from #3520 is deliberately absent from the scenario, the judge brief and the test's judge_context.

## Used by

No test. `ut_research_9k4` (`eval/tests/unit/research/unregistered-sibling-premise-scopes-searches.json`) was deleted until issue #3737 restores it.
