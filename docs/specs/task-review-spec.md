# Task review spec

**Status:** live. Implemented by `.claude/agents/task-reviewer.md` (the reviewer)
and `.claude/skills/review-ready/SKILL.md` (the caller). This file is the source
of truth for *why* the gate is shaped this way; the two bodies carry only what
the model must do, because every line in them is billed on each invocation.

## 1. The failure it prevents

The team's developers are juniors working with Claude Code. Its failure mode is
not a stalled PR — it is a **green, plausible, wrong** one: the junior reads only
the issue body, Claude Code does exactly what it says, CI passes, and the change
is incomplete or commits the repo to a decision that was the lead's to make.

Nothing sat between `fill-ready` promoting an issue and a junior starting it. The
gate is that step. Its bar is not "is this issue reasonable" but **can one junior,
reading only this body, land a correct change and know that it is correct?**

## 2. Where it sits in the morning

`triage-standup` files issues into Backlog → `fill-ready` ranks them →
**`review-ready` gates the shortlist** → `fill-ready` promotes what passed →
standup hands the work out.

The gate runs **on the shortlist, before promotion**, not on the Ready column
after it. Both orders work, and the earlier one is cheaper for a reason worth
stating: `fill-ready` §8 requires a deep read of every issue it forms a view on,
and `task-reviewer` does the same read per issue in fresh context. Reviewing
after promotion pays for that read twice. Reviewing before it lets `fill-ready`
defer the promotion-candidate half of §8 to the agent and promote on the verdict.

Reviewing the standing Ready pool is still supported (`/review-ready` bare) and is
what a first run or a run after a gap does. It is not the steady state.

## 3. Verdicts and their apply paths

Exactly one verdict per issue. Every verdict has a write, or explicitly has none —
a verdict the caller cannot act on is a verdict that silently does nothing.

| Verdict | Means | What the caller writes |
|---|---|---|
| `ready` | A junior can land it today | The `reviewed` label. Nothing else. |
| `ready-after-edit` | Ready once the body carries the agent's text | Prepend the text; `reviewed`. |
| `needs-a-decision` | An open fork only the lead can settle | Splice the chosen option's pre-written body text; `reviewed`. |
| `senior` | Any trigger in the agent's `senior` list — green-and-wrong risk, cross-subsystem, inverts a mechanism, commits money or doctrine, or touches schema / credentials / a plugin-agent binding / an MCP tool contract / an ADR / anything hard to undo | Assign `DallanQ`; `reviewed`. Report to `fill-ready` for the swap out of the junior pool. |
| `stale-rewrite` | The premise moved; the issue asks for the wrong thing | **Replace** the ask with the agent's rewrite, keeping the original under `## Original issue`; `reviewed`. |
| `close` | No longer needed, already done, or refuted | `gh issue close --reason "not planned"` with the evidence. No label. |

### 3.1 `senior` is the only risk classification

`docs/task-lifecycle.md` used to carry a third tier, **Risky**, whose seven
triggers overlapped this row and whose consequence was that the lead reviewed the
junior's plan in a draft PR before code. It was retired in favour of this verdict
(ADR-0008). Three reasons, in order of weight:

1. **This gate makes the same call earlier, with more information, and acts on
   it harder.** A `senior` verdict removes the task from the junior pool; the
   tier only gated a plan the junior had already been handed.
2. **The tier asked the least-informed person to make it.** Its tie-break —
   "when in doubt, Risky" — converted junior uncertainty into a lead interrupt,
   which is the cost this gate exists to remove (§1).
3. **Nothing enforced it.** ADR-0007's Enforcement section says the tier and the
   plan are convention and no check blocks a PR that omits them.

Consequence: this row is now the **only** place a risk trigger is written down,
so the agent's list must stay complete. Four of the tier's seven triggers —
schema, credentials, plugin-agent binding, hard-to-undo — were reachable here
only by inference from the blast-radius pass and §9.4, and are now named.

The tier's blast-radius trigger ("more than about three modules") is kept here
and deliberately **not** mirrored into the lifecycle's stop rule: it is precisely
what Pass B #5 computes from the issue body, so it is triage's to catch, not
something a junior should re-derive mid-branch.

What the retirement gives up is stated in ADR-0008's costs: this gate is now the
single point of risk classification. The backstop is the lifecycle's step-4 stop
rule, which fires on the four categorical triggers a junior can only discover in
the code. A stop is a defect report against this row.

`stale-rewrite` is the one case that replaces rather than prepends, and it is why
the caller's "prepend, never replace" rule carries an exception. It is kept
distinct from `ready-after-edit` because the two carry different information to
the lead — one says the body is thin, the other says the board is wrong — and
from `close` because the need survives even though the ask does not.

## 4. Why an agent plus a skill

**A subagent cannot ask a question.** Everything else follows from that.

The reviewer must read one issue in fresh context — a second issue's reasoning
contaminating the first is the whole reason for one agent per issue rather than
one agent for the batch. But roughly a third of the issues in the first run
turned on a fork only the lead could settle. An agent-only design would have
guessed at those, confidently, which is the same failure the gate exists to
prevent, moved one level up.

So the agent surfaces the fork already shaped for `AskUserQuestion` — header,
question, options with the consequence that decides each, recommendation first —
**and pre-writes the resulting issue-body text for every option, not only the
recommended one.** By the time the lead answers, the agent is gone; applying the
answer must be a splice, not a rewrite by someone who did not do the reading.

The caller then does the three things one agent cannot: merge identical forks
across issues into a single policy question, rank the questions across the batch
(`AskUserQuestion` takes four), and drop the ones whose answer would change
nothing.

## 5. The reviewed marker is a label, not body text

An issue is skipped on the next run when it carries the **`reviewed` label**. Two
mechanisms were tried first and are wrong:

- **A verdict in a comment.** The caller writes findings to the *body*, because a
  finding in a comment thread evaporates. A skip check reading comments looks
  where the verdict is not, so every run re-reviews the whole pool.
- **A dated marker as the body's first line, skipped unless `updatedAt` is
  later.** `updatedAt` moves on any comment, label, or assignment — not just a
  body edit — so any activity on an issue triggers a full re-review. And two
  skills write "the first line of the body": `fill-ready` Gate 3's reciprocal
  collision note and this marker. Whichever runs second displaces the other, and
  a position-dependent check misses it.

A label survives both, is visible on the board, and answers the whole question in
the `gh project item-list` call the caller already makes — rather than one
`gh issue view` per candidate.

The body marker is still written, for the human: the junior who picks the issue
up should see that it was reviewed and what was settled. It is prose for a
reader, not state for a machine.

Re-review is explicit: `/review-ready <N>`.

## 6. Scope: the developer pool

The default candidate set is **unassigned `developer`-labeled items**. The
genealogist pool is opt-in (`--all`) and that is a scope judgment, not a priority
one: the three passes are developer-shaped — blast radius from
`docs/architecture.md`'s "If you're asked to…" block, the command that verifies
the change, §9.4 exposure. Pointed at a `test <slug>` fixture adjudication they
mostly return "checked, clean" at full token cost.

Gating that pool needs a different and much shorter agent — does the hint record
exist, is the ark resolvable, is anyone else on this fixture — not a wider
fan-out of this one. That agent does not exist yet.

## 7. Measurements

From the first run, 2026-08-02, over the unassigned `developer` pool:

- **~110k tokens per issue reviewed.** This is what makes the skip check
  load-bearing: re-reviewing a full standing pool of ~20 costs ~2.2M tokens for
  no new information. The fan-out is capped at 20 per run, and a run that hits
  the cap must name the candidates it did not review — a silent cap reads as
  "everything is clear" when it is not.
- **Eleven open forks surfaced; six were settled by the agent** from a spec, an
  ADR, or the code, and reached the lead as stated assumptions rather than
  questions. Nine issues at three questions each is thirty questions, and he
  stops reading at the fourth — so settling what is already answered somewhere is
  a first-class part of the agent's job, not a nicety.
- **Two issues asked the same question.** Issues #945 and #1094 both turned on
  "blocking, or warn-only against a frozen baseline?", and both agents
  independently recommended warn-only. Merging them was one question and two
  issues unblocked — the clearest evidence for the caller's cross-issue pass.

### Why Pass A #3 exists: read the mechanism before agreeing it needs building

Two cases from 2026-08-01 grooming, both of which changed the *disposition*
rather than a detail. They are why "already built" is a pass of its own and not a
line in the staleness check:

- **Issue #995** asked for "value-level ground truth" as a new harness mechanism.
  Reading `test_expected_classifications` showed the matcher already selected on
  `record_role` + `fact_type` + an `attribute` facet enumerated `"date" | "place"`,
  with normalization, list-of-alternatives and an `optional` flag — everything but
  the value comparison. A build became a ~15-line extension, and the *real*
  finding was that the test which motivated it declared no matchers at all
  (10 of 27 did).
- **Issue #607** asked for diminutive name searching across "search". Reading the
  four search tools showed `record_search` already ships two candidate mechanisms
  (`.exact` is opt-in, plus unused `givenNameAlt` slots) and Ancestry handles it
  upstream — so half the issue was work nobody needed to do, and the half that
  remained sharpened: `fulltext_search` sets `m.queryRequireDefault=on`, which
  makes an unexpanded given name a hard *exclusion*, not a ranking miss.

## 8. Alternatives considered

- **A gate inside `fill-ready`.** Rejected: `fill-ready` already runs long, and a
  single context ranking twenty issues cannot also read each one's cited code
  without the later reads being coloured by the earlier ones. Fresh context per
  issue is the mechanism, and it requires a fan-out.
- **A `.claude/commands/` file**, matching how `/audit-rubric` and
  `/improve-skill` dispatch to their agents. Rejected: a command fires only when
  typed, and this needs to fire on "vet these before I hand them out". It is a
  second pattern for one job, knowingly — and ADR-0007 rejects the skill form for
  `/critique-plan` on the opposite ground (description matching can silently
  no-op). Both are right for their case; the repo has no rule that decides it.
- **One agent for the whole batch.** Rejected: cheaper, and it is exactly the
  contamination the fresh-context rule exists to stop.
- **Extending the fan-out to the genealogist pool.** Rejected for now — see §6.

## 9. What nothing checks

- **The agent's read-only guarantee is prose.** `task-reviewer` holds `Bash`, so
  `gh issue edit` is reachable; only its Hard rules forbid it. This matches
  `rubric-critic` and `skill-improver`, which have the same shape. Claude Code
  subagent frontmatter has no `disallowedTools` equivalent to the plugin agents'
  deny list (`CLAUDE.md` → Cowork plugin agents).
- **Nothing checks that a `.claude/agents/` subagent's declared tools bind** —
  the same gap `docs/architecture.md` §9.4 records for plugin agents.
- **The trigger-disambiguation cases are not run.** The `evals/` sets under
  `.claude/skills/triage-standup/` are advisory: `eval/triggering/build_eval_set.py`
  derives its query set from `eval/tests/unit/` and resolves skills under
  `packages/engine/plugin/skills/` only, so it cannot see a hand-written set under
  `.claude/skills/`. They document the intended boundary; nothing enforces it.
  Wiring them is issue #1184, which also asks whether they are worth keeping.
- **Nothing checks that a verdict was applied.** The `reviewed` label says an
  issue was looked at, not that the body carries what the agent supplied.
