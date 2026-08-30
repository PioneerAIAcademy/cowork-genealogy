# ADR-0003: Anchor cross-turn rules structurally rather than in prose

> **Read before you:** write a new rule into any `SKILL.md` or agent body · fix a
> compliance failure by "making the instruction clearer" · argue that a
> guardrail belongs in prose because a tool check would be too strict · reinforce
> a rule that keeps getting violated.

- **Status:** Accepted
- **Decided:** 2026-07-27 (on the §5.3 rule audit)
- **Last updated:** 2026-08-09 (the ranking fold *is* pinned by a test)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/plugin/skills`, `packages/engine/plugin/agents`, `packages/engine/mcp-server/src/tools/research-append.ts`
- **Related:** ADR-0005, ADR-0006, `docs/plan/research-performance-2026-07-27.md` §5.3, `docs/specs/guardrail-enforcement-spec.md` §2

## Context

Skill bodies are long — 7,730 lines across 27 skills, the largest at 50 KB — and
they are the system's main vehicle for doctrine. A research session runs for
hours. Somewhere in those hours, context is compacted and a skill body is
evicted.

The question is what happens to the rules in it. That was measured rather than
guessed, over 309 turns of one real session
(`docs/plan/research-performance-2026-07-27.md` §5.3):

| Rule | Anchored? | Compliance |
|---|---|---|
| every rule with a structural anchor | yes | **100%** |
| "always call `rank_search_matches`" | no | 77% → **3%** |
| `count: 50` | no | 100% → 45% |
| keep `givenName`, no surname-only | no | 54% → 94% (*rose*) |

The operational figure usually quoted alongside it — **prose survives roughly
three compactions** — is the source's own *extrapolation*, not a counted
quantity: §5.3 reports early/late segments, not compaction counts. Treat it as a
rule of thumb, and treat the compliance percentages as the measurement.

Two things about that table matter as much as the headline. First, the third
unanchored rule *improved* — so the law runs one direction only: an anchor
guarantees survival, its absence merely permits decay. "It is unanchored and it
is fine" is not a counterexample. Second, the audit covers **one skill**
(`search-records`, resident for 228 of the 309 turns) and says explicitly that
the per-skill result should not be assumed elsewhere. It also exempts plugin
agents, which get fresh context per invocation and cannot decay this way.

There is independent public corroboration of the general effect: Shiyang Chen,
*"Governance Decay: How Context Compaction Silently Erases Safety Constraints in
Long-Horizon LLM Agents"*, [arXiv:2606.22528](https://arxiv.org/abs/2606.22528)
(June 2026). Its **ConstraintRot** benchmark measures violation rates rising from
0% under full policy visibility to **30% after compaction — 59% on some models** —
and its "Constraint Pinning" mitigation, which quarantines governance rules from
lossy compression, returns them to 0%. *(Verified against arxiv.org 2026-08-02.
An earlier revision of this ADR wrongly called the citation unverifiable.)*

That paper corroborates the mechanism; it does not carry this decision. **The
§5.3 audit does**, because it is reproducible here and additionally yields a
production decay horizon the benchmark does not. Note also that Constraint
Pinning is a platform-side mitigation not available to us — which is exactly why
the answer here is a structural anchor rather than better prose.

## Decision

**A rule that must hold across turns gets a structural anchor. Prose is for
rules that only have to hold within one invocation.**

A rule is structurally anchored if any of these holds:

1. **The tool rejects the violation.**
2. **The output feeds a step that cannot proceed without it.**
3. **It leaves a durable trace the agent re-reads.** (A trace nothing re-reads is
   not an anchor.)

So the question when writing a new rule is *where it goes*:

| Must hold… | Goes in |
|---|---|
| across hours, past compaction | a tool contract — validate and reject |
| for the main thread, which no allow-list can narrow | a `PreToolUse` hook (ADR-0005) |
| for one delegated agent | that agent's `tools:` — omit the capability — or a narrowed tool (ADR-0006) |
| within a single invocation | skill prose — this is what prose is *for* |

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Reinforce the prose** — repeat the rule, bold it, add a "hard rules" section | This is what the 3% rule already had. Restating a rule does not survive the eviction of the text doing the restating | §5.3 audit; the ranking doctrine was already emphatic |
| **Shorten skill bodies** so less gets evicted | Attacks the wrong variable, and the unit suite cannot gate it — the suite grades a single invocation in fresh context and will happily bless a cut that removes something only a multi-hour session needs. **Declined outright in 2026-08**, not merely set aside: the cost rationale this row used to carry (prompt size is a per-turn cost; the five largest bodies are ~215 KB between them) was never converted into a measurement. The one trim that was measured, `proof-conclusion`, showed −44% output tokens at the unit level and its e2e effect was never confirmed, so the benefit is unquantified while the one controlled split we ran made things worse (6/19 against a 12–14/19 baseline; CLAUDE.md, reverted). Reopen only on a measurement showing body size costs something material end to end — not on a byte count | `docs/architecture.md` §9.2, the `prompt-budget.test.ts` row — it reports growth and never fails; issues #1153 / #1154, closed not-planned |
| **Split the rule into a dedicated per-skill write tool** so the tool name carries the doctrine | Rejected earlier and independently, for a reason that generalises: *"a split tool is exactly as callable by the router as a section branch is."* Splitting names does not constrain a caller | `docs/specs/guardrail-enforcement-spec.md` §9 |
| **A read-only advisory tool** the model calls each turn to be told the next step | "Call the advisory every turn" is itself unanchored prose. Our own data disconfirms it: `project_context`, built for exactly this, is called ~3 times per run against `Read`'s ~19. It also adds a serial tool call — a turn — per routing decision | The 2026-07-30 row-by-row routing analysis; `docs/adrs/ADR-0009-refuted-agent-design-claims.md`, first row |
| **Post-run detection** — let it happen, catch it in grading | Catches it after the user has the wrong answer, and the detectors themselves currently have two open defects and an unquantified false-positive rate | #999, #1006 |

## Consequences

**Gains.** Two rules were converted on the strength of this — the `count: 50`
default and the ranking fold, both now in `record-search.ts`, and both pinned by
`packages/engine/mcp-server/tests/tools/record-search.test.ts` (a `subjectId`
requests the deep pool and returns `ranked`; without one, `count` stays at 20).
The committed e2e corpus agrees: 21 of the 22 searches eligible to be ranked — a
`subjectId` given *and* at least one match — came back with a `ranked` block.
Every invariant moved into `research_append` holds regardless of context
state, model, or how long the session has run — and holds identically in Cowork,
the hosted path, and both harnesses, which prose never does.

**The fold's remaining prose-only step shows a raw supply gap, mostly not
decay — and smaller and less uniform than an aggregate read suggests.**
Supplying `subjectId` itself, from `search-records/SKILL.md`, was left
unmeasured under compaction. A compaction-segment audit of `search-records`
via a different signal (`subjectId` supply rather than ranking-call rate;
`make e2e-compaction`, issue #1155 — **not** the "second skill body" audit
the "Revisit when" clause below names, since this re-checks the same skill)
found early-segment (0–2) supply higher than late-segment (3+) in aggregate
— but not segment by segment, and not by a wide margin before the nudge
shipped. Per segment, post-nudge (`make e2e-compaction` prints this row
unconditionally): 64.0% / 43.8% / 69.4% / 48.1% / 0.0% for segments 0–4.
Segment 1 (43.8%) sits *below* segment 3 (48.1%), so supply is not monotone
across segments, and segment 2 (69.4%) is the single highest of the five. The
aggregate gap does not rest on segment 2 alone, though: dropping it leaves
early at 53.0% (87/164) against the same late 44.8% — an 8.2-point gap where
the full one is 13.2. Review this per-segment row rather than the two-bucket
aggregate before drawing a conclusion from it.
Both `--since` windows are cumulative — a later cutoff is a subset of an
earlier one, not a disjoint slice — so the pre-nudge-only row below is not
one command's output; it is `--since 2026-07-27` minus `--since 2026-08-04`,
call by call: 45.8% vs. 43.6% before `rankingSkipped` shipped
(2026-07-27..08-03, 312 early-segment calls / 101 late-segment calls, 34
segmentable runs) — a 2.2-point gap, not a marked one — against 58.1% vs.
44.8% after (`--since 2026-08-04` itself, 2026-08-04+, 16 runs / 29
late-segment calls, as measured 2026-08-24). The "after" count moves as the
corpus grows — a later run of the exact same command printing a different
number is the corpus growing, not a contradiction to chase down; reproduce
both with the commands in `docs/e2e-testing-guide.md`. The post-nudge late
figure is also sensitive to a single run: `victoriano-macatangay-parents`
contributes 13 of those 29 late-segment calls, all at 0%; excluding it,
late-segment supply is 81.2% (13/16) — see the per-run table
`make e2e-compaction` prints. Comparing the two **disjoint** windows:
early-segment supply rose about 12 points after `rankingSkipped`
(45.8% → 58.1%) while late-segment supply moved barely at all
(43.6% → 44.8%).

The published 58.1%/44.8% comparison is also between-run, and diluted by
runs that never compact at all: of the 15 post-nudge runs with any
`record_search` call, only 5 have both an early- and a late-segment call.
Restricted to those 5 — the **paired**, within-run comparison
`make e2e-compaction` also prints — EARLY is 79/94 = 84.0% against the same
LATE 13/29 = 44.8% (every late-segment call in this window comes from a
paired run, so LATE is unchanged; EARLY rises once the 10 non-compacting
runs are excluded). The within-run gap is larger, not smaller, than the
published headline — the direction holds and strengthens, but 58.1% is not
the decay effect size.

That raw gap is not, on inspection, mostly the decay it looks like. The
tool's own schema permits omitting `subjectId` when the search "is not about
a specific tree person yet," and a call-by-call read of the two runs
carrying most of the post-nudge late-segment sample found that is what most
of those omissions are — searches for a not-yet-tree child or an unconfirmed
parent, the exact population a research session accumulates more of as it
progresses. Only a couple of the late-segment omissions in those runs were
the agent's already-established subject searched without its known
`subjectId` — the narrower case the nudge actually targets, and the one this
measurement does not yet isolate. `compaction_report.py` prints this caveat
with every non-empty report; treat the raw percentages as a starting point
for call-by-call reading, not a decay verdict on their own.

**Costs, knowingly accepted.**

1. **A tool check can false-deny, and that is the worse failure.** A structural
   anchor refuses work; when the check is wrong, it refuses *legitimate* work.
   `guardrail-enforcement-spec.md` is explicit that false-deny is the asymmetric
   risk, which is why the `Bash` route stays open (ADR-0005) and why new gates
   are scoped conservatively.
2. **Not everything can move.** 11 of the orchestrator's 17 routing rows need
   judgment. Those stay prose and stay subject to decay — a known, unfixed
   exposure, not a solved problem.
3. **Anchoring is more work than editing prose**, so there is standing pressure
   to skip it under deadline. That is exactly when the rule matters.

**Risks.** The law was measured on one skill. Applying it as universal is a
generalisation the source does not license, and no compaction-segment audit of
any other body has been done — `research/SKILL.md`, the longest-resident body in
the system, has never been audited.

## Enforcement

**None — convention only.** No lint detects a cross-turn invariant written as
prose. The check is review, and the honest signal is this: two gates identified
as needing anchors — the **tree-encoding gate** and the **mentor gate** — are
still prose today, and both are computable from files `research_append` already
loads.

The one instrument that measures the *effect* is the post-run compliance
detector, and it cannot yet give a rate at all. It is uncalibrated (#999,
#1006), and separately — settled in #1176 — **no committed run resolves `pass`**:
before #972 the violations field was written only when non-empty, so "ran clean"
and "did not emit" are indistinguishable and every post-detector run lands on
`fail` or `not_checked`. **Do not quote a violation rate for this decision or
against it.** `make e2e-corpus [SINCE=…]` reports what is countable — the
violation total, the per-arm split (one arm dominates) and the per-fixture
concentration (one fixture supplies several times its even share) — and refuses
a percentage whose denominator would be doing the work.

## Revisit when

A compaction-segment audit of a second skill body contradicts the §5.3 result —
or the platform's context handling changes such that skill bodies are no longer
evicted mid-session, which would make the whole question moot.
