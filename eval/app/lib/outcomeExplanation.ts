import type { TestEntry } from '@/lib/types';

export interface OutcomeExplanation {
  /** Mantine color for the Alert (red = hard gate, orange = routing). */
  color: string;
  title: string;
  body: string;
}

/**
 * Explain a fail/aborted outcome that the dimension rows below do NOT
 * account for.
 *
 * The harness decides each run's outcome through a sequence of gates that
 * run *before* the dimension scores are consulted (see `_compute_outcome`
 * in eval/harness/harness/orchestrator.py): aborted → validators →
 * judge-skipped → activation/routing → dimensions. When an earlier gate
 * fires, every dimension can still read "pass" (3) yet the outcome is
 * "fail" — e.g. a positive test where Claude routed to a *different* skill,
 * so the skill under test never ran. Without this, that fail looks
 * mysterious on screen: all-green dimensions, a red outcome, no reason.
 *
 * Returns null for pass/partial, and for fails the dimension rows already
 * explain (some dimension scored 1) where no earlier gate fired.
 *
 * A declared-xfail test gets its own explanation: whether its failure is
 * suppressed (a real `fail` beside an `expected_outcome: xfail` marker) or it
 * unexpectedly passed (a `pass` beside that marker) comes from the marker, not
 * from anything visible in the dimension rows. Without a note a suppressed
 * failure reads as a "green-ish failure" and an unexpected pass as an
 * unexplained oddity. These two checks run before the fail/aborted gate below,
 * because a suppressed failure has `outcome: fail` and would otherwise fall
 * through to the routing-miss explanation.
 */
export function deriveOutcomeExplanation(
  entry: TestEntry,
  skillUnderTest: string,
  /**
   * True for a direct-agent test (#2246), whose `skills_invoked` is empty by
   * construction. Passed in rather than read from a module-scope value so the
   * routing-miss branch cannot silently go back to guessing.
   */
  isDirect = false,
): OutcomeExplanation | null {
  if (entry.expected_outcome === 'xfail' && entry.outcome === 'fail') {
    return {
      color: 'gray',
      title: 'Expected failure (xfail-marked)',
      body:
        'This test is marked expected_outcome: xfail, so its failure is not counted as a ' +
        'regression. The reason lives on the test definition — open the test to see it, and ' +
        'remove the marker once the underlying issue is fixed.',
    };
  }
  if (entry.expected_outcome === 'xfail' && entry.outcome === 'pass') {
    return {
      color: 'orange',
      title: 'Unexpected pass (xfail-marked)',
      body:
        'This test is marked expected_outcome: xfail but it passed. Either the underlying ' +
        'issue is fixed — in which case clear the marker so future failures register as ' +
        'regressions — or the test no longer exercises what its xfail reason describes.',
    };
  }
  if (entry.outcome !== 'fail' && entry.outcome !== 'aborted') return null;

  // Pick the run that actually exhibited the test-level outcome; fall back
  // to the first run (single-run tests are the common case).
  const run = entry.runs.find((r) => r.outcome === entry.outcome) ?? entry.runs[0];
  if (!run) return null;

  const output = run.output as
    | { activated?: boolean; skills_invoked?: string[] }
    | undefined;
  const activated = output?.activated;
  const skillsInvoked = output?.skills_invoked ?? [];
  const validators = run.validators as
    | { passed?: boolean; results?: Array<{ name: string; passed: boolean }> }
    | undefined;

  // Gate order mirrors _compute_outcome.
  if (run.aborted_reason) {
    return { color: 'red', title: 'Run aborted', body: run.aborted_reason };
  }
  if (validators?.passed === false) {
    const failed = (validators.results ?? [])
      .filter((r) => !r.passed)
      .map((r) => r.name);
    return {
      color: 'red',
      title: 'Validator failure',
      body:
        (failed.length
          ? `Deterministic validators failed: ${failed.join(', ')}. `
          : 'A deterministic validator failed. ') +
        'Validators gate the outcome before the dimension scores below are considered.',
    };
  }
  if (entry.test_type === 'positive' && run.judge?.skipped) {
    return {
      color: 'red',
      title: 'Judge did not grade',
      body:
        (run.judge.error
          ? `The judge raised an error (${run.judge.error}). `
          : 'The judge was skipped. ') +
        'A positive test cannot be scored pass without judge dimensions.',
    };
  }
  if (entry.test_type === 'positive') {
    // A direct-agent test (#2246) invokes no skill at all — the main thread
    // spawns the pair's agent — so `skills_invoked` is empty BY CONSTRUCTION.
    // Without this guard every red twin is explained to the annotator as a
    // routing miss it cannot be, which is a wrong diagnosis handed to the
    // person whose grading the arm exists to inform.
    if (isDirect) {
      // The direct arm's counterpart. `activated` derives from the recorded
      // spawn rather than from `skills_invoked`, so false here means the main
      // thread never spawned this pair's agent. Skipping the branch entirely
      // (the first version of this guard) returned null and showed the
      // annotator a red test with nothing said about why — the one reader this
      // panel exists for.
      if (activated === false) {
        return {
          color: 'orange',
          title: `Spawn miss — the "${skillUnderTest}" agent never ran`,
          body:
            `This is a direct-agent test: a bare main thread is asked to relay the ` +
            `delegation into Agent{subagent_type: "${skillUnderTest}"}. No such spawn was ` +
            `recorded, so the run graded whatever the main thread produced on its own. ` +
            `Read output.builtin_tool_calls for the Agent/Task calls it did make — a spawn ` +
            `carrying no subagent_type is a general-purpose subagent and does not count.`,
        };
      }
    } else if (activated === false || !skillsInvoked.includes(skillUnderTest)) {
      const others = skillsInvoked.filter((s) => s !== skillUnderTest);
      const routedTo = others.length
        ? `Claude routed to ${others.map((s) => `"${s}"`).join(', ')} instead.`
        : 'No skill fired at all.';
      return {
        color: 'orange',
        title: `Routing miss — "${skillUnderTest}" did not activate`,
        body:
          `This is a positive test: it expects the "${skillUnderTest}" skill to handle the request. ` +
          `${routedTo} A positive test fails when the skill under test never activates — ` +
          `regardless of how the dimensions below scored.`,
      };
    }
  } else if (activated) {
    return {
      color: 'orange',
      title: `"${skillUnderTest}" activated on a negative test`,
      body:
        `This is a negative test: the "${skillUnderTest}" skill should have declined, but it activated. ` +
        `That fails the test regardless of the dimensions below.`,
    };
  }
  return null;
}

/**
 * Mantine color per test outcome. A declared-xfail test that failed as declared
 * is deliberately neutral (gray — a declared, non-regressing failure), and one
 * that unexpectedly passed is orange rather than green — a passing xfail test is
 * a prompt to investigate the stale marker, not a clean result. Suppression is
 * read from the `expected_outcome` marker beside the outcome, so both are passed
 * in. Everything else is the usual green/yellow/red.
 */
export function outcomeColor(
  outcome: TestEntry['outcome'],
  expectedOutcome?: TestEntry['expected_outcome'],
): string {
  if (expectedOutcome === 'xfail' && outcome === 'fail') return 'gray';
  if (expectedOutcome === 'xfail' && outcome === 'pass') return 'orange';
  switch (outcome) {
    case 'pass':
      return 'green';
    case 'partial':
      return 'yellow';
    default:
      return 'red';
  }
}
