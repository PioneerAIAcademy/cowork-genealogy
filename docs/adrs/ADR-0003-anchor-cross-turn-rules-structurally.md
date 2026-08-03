# ADR-0003: Anchor cross-turn rules structurally rather than in prose

> **Read before you:** write a new rule into any `SKILL.md` or agent body · fix a
> compliance failure by "making the instruction clearer" · argue that a
> guardrail belongs in prose because a tool check would be too strict · reinforce
> a rule that keeps getting violated.

- **Status:** Accepted
- **Decided:** 2026-07-27 (on the §5.3 rule audit)
- **Recorded:** 2026-08-02
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
| for one delegated agent | that agent's `tools:`/`disallowedTools:`, or a narrowed tool (ADR-0006) |
| within a single invocation | skill prose — this is what prose is *for* |

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Reinforce the prose** — repeat the rule, bold it, add a "hard rules" section | This is what the 3% rule already had. Restating a rule does not survive the eviction of the text doing the restating | §5.3 audit; the ranking doctrine was already emphatic |
| **Shorten skill bodies** so less gets evicted | Attacks the wrong variable, and the unit suite cannot gate it — the suite grades a single invocation in fresh context and will happily bless a cut that removes something only a multi-hour session needs. Worth doing for cost reasons (critique §6 lever 4), but it is not a correctness mechanism | `docs/agentic-system-critique.md` §6 |
| **Split the rule into a dedicated per-skill write tool** so the tool name carries the doctrine | Rejected earlier and independently, for a reason that generalises: *"a split tool is exactly as callable by the router as a section branch is."* Splitting names does not constrain a caller | `docs/specs/guardrail-enforcement-spec.md` §9 |
| **A read-only advisory tool** the model calls each turn to be told the next step | "Call the advisory every turn" is itself unanchored prose. Our own data disconfirms it: `project_context`, built for exactly this, is called ~3 times per run against `Read`'s ~19. It also adds a serial tool call — a turn — per routing decision | critique §3 P2 |
| **Post-run detection** — let it happen, catch it in grading | Catches it after the user has the wrong answer, and the detectors themselves currently have three open defects and an unquantified false-positive rate | #998, #999, #1006 |

## Consequences

**Gains.** Two rules were converted on the strength of this — the `count: 50`
default and the ranking fold, both now in `record-search.ts`. (The critique
reports the fold "verified 7/7"; the *conversions* are verifiable in the code,
the 7/7 result is not recorded in any test or runlog here.) Every invariant moved
into `research_append` holds regardless of context
state, model, or how long the session has run — and holds identically in Cowork,
the hosted path, and both harnesses, which prose never does.

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
detector, and it is uncalibrated (#998, #999, #1006), so its 8-of-25 violation
rate is a floor with an unquantified false-positive rate and should not be
trended.

## Revisit when

A compaction-segment audit of a second skill body contradicts the §5.3 result —
or the platform's context handling changes such that skill bodies are no longer
evicted mid-session, which would make the whole question moot.
