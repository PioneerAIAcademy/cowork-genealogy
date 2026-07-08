# Did #578 actually cut skill latency? — 2026-07-05

**Status:** measured from committed **unit** run logs; no e2e run required.
**Tool:** `make skill-latency` (`eval/harness/skill_latency_report.py`).
**Context:** Phase-0 baseline ([`research-latency-baseline-2026-07-05.md`](./research-latency-baseline-2026-07-05.md))
found ~98% of an e2e run is model generation, so **output tokens generated** is the
dominant latency lever. #578 ("perf(skills): cut runtime latency") edited 6 SKILL.md
files to that end **but shipped with its effect unmeasured** — it merged *after* every
run in the e2e baseline. This measures it.

## 0. TL;DR

**#578 delivered real, large concision wins on the skills it cleanly touched** —
proof-conclusion **−44%**, timeline **−32%**, conflict-resolution **−23%**,
locality-guide **−14%** output tokens per skill run, prose-only. Two skills are
murkier and flagged below. Because generation is ~98% of the latency budget, these
are genuine latency reductions — but they're measured at the **unit** level; the owed
post-#578 **e2e** run (kenneth, in flight) is what confirms they compound into
wall-clock. **Don't start a second round of prose edits before that e2e lands.**

## 1. Why this is measurable without an e2e run

Every unit run log records the skill's `output_tokens` (and, for newer logs,
`num_turns`) per test. Editing a SKILL.md forces a unit re-run anyway — the run-log
snapshot gate flips the old log inactive. So the re-run the author already does is a
free measurement of the edit's generation-cost effect. `skill_latency_report.py`
diffs the pre- and post-edit run logs, matched by `test_id`.

Two honesty guards, both enforced by the tool:

- **Concision vs. activation.** A test whose output goes to **0** didn't get more
  concise — the skill declined to act or the run aborted before generating (a
  *behavior* change). Counting it would dump its whole before-value into the
  "reduction." The tool reports **concision** over *both-active* tests (non-zero on
  both sides) and lists how many tests flipped 0↔non-0 (excluded). The raw
  all-tests number is shown too, labelled as activation-inclusive.
- **Test-input drift.** The tool compares the two logs' embedded snapshots of
  `eval/tests/unit/<skill>/`. If the test JSON/rubric changed between runs
  (#578 did for citation + record-extraction), the diff is flagged **not
  prose-only** — its deltas conflate prose and test changes.

**Caveat on every number:** unit tests run `runs_per_test=1` with no `temperature=0`
(`eval/CLAUDE.md`), so a single test's token count carries run-to-run variance. Trust
the **direction** and the **aggregate across a skill's tests**, not one test's exact %.

## 2. #578's measured effect

| skill | prose-only? | **concision** (both-active) | raw (all shared) | both-active / flipped-to-0 | turns |
|---|---|---|---|---|---|
| proof-conclusion | yes | **−44.0%** | −53.0% | 8 / 4 | n/a¹ |
| timeline | yes | **−32.1%** | −49.3% | 6 / 3 | n/a¹ |
| conflict-resolution | yes | **−22.7%** | −22.7% | 7 / 0 | 76→83 (+9%) |
| locality-guide | yes | **−13.8%** | −13.3% | 20 / 1 | 449→419 (−7%) |
| citation | **no** (tests changed) | −15.7% | −39.4% | 14 / 4 | n/a¹ |
| record-extraction | **no** (tests changed) | **+17.5%** | +17.5% | 10 / 0 | 234→158 (−33%) |

¹ The pre-#578 run log predates the `num_turns` instrumentation, so no turn delta.

Reproduce any row:
```
make skill-latency BEFORE=eval/runlogs/unit/<skill>/<pre>.json \
                   AFTER=eval/runlogs/unit/<skill>/<post>.json
```

## 3. Reading the result

- **The four clean skills are unambiguous wins.** proof-conclusion, timeline,
  conflict-resolution, locality-guide all shrank output tokens with **identical test
  inputs** and still passing — pure prose concision. proof-conclusion and timeline's
  *raw* numbers (−53%, −49%) overstate it because several negative tests dropped to
  zero output; the **concision** figures (−44%, −32%) are the honest per-turn win, and
  they're still large.
- **conflict-resolution traded turns for concision** (+9% turns, −23% tokens) — more
  round-trips, each much shorter, net token win. **locality-guide won on both** (−7%
  turns, −14% tokens).
- **citation is mostly *not* a concision story.** Its −39% raw is largely 4 tests
  flipping to zero output plus a changed test corpus; the prose-only concision is only
  −16%. Fine — citation's #578 change was partly a de-flake, not just concision.
- **record-extraction needs the turn lens, not tokens.** Output tokens went *up* 18%,
  but turns fell **33%** (234→158). Fewer, longer round-trips. Whether that's a net
  latency win depends on per-turn vs per-token cost and can't be called from tokens
  alone; its tests also changed. Flag for the e2e run to adjudicate.

## 4. Consequence for the roadmap

1. **#578 already banked the first 2a (concision) round.** The baseline's premise —
   "make the model generate less" — is now shown to work at the unit level, with
   double-digit-to-−44% reductions on four skills.
2. **Confirm it compounds to e2e before tuning further.** Unit tests exercise one
   skill each; an e2e run chains ~8 skills over 60–165 turns. The owed post-#578
   kenneth e2e run (in flight) tells us whether −20-to-−44% per skill shows up as
   wall-clock. **A second prose-edit round should wait for that number** — stacking
   edits on an unmeasured change is how you tune the wrong thing.
3. **This tool is the standing 2a feedback loop.** After any future SKILL.md edit,
   `make skill-latency SKILL=<name> --vs-prev` reads the concision effect straight out
   of the re-run the edit already forces — no $5 e2e needed to know if an edit helped.

## 5. Use going forward

```
make skill-latency                          # per-skill token/turn profile, all skills
make skill-latency MD=1                      # ... as a Markdown table
make skill-latency SKILL=timeline            # one skill's latest profile
make skill-latency SKILL=timeline VS_PREV=1  # diff its two newest run logs (last edit's effect)
make skill-latency BEFORE=a.json AFTER=b.json # diff any two run logs
```
