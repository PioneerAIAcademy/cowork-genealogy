# ADR-0007: Attack the plan before writing code; settle task risk at triage

> **Read before you:** wonder why `/critique-plan` is a command instead of "ask
> Claude to review this" · want to add a third critique round · want to skip
> writing `PLAN.md` because the plan is already in the chat · want per-task
> plans filed under `docs/plan/` · want the critic to fix what it finds · want
> to add a "Risky" tier to the lifecycle · wonder why a junior does not classify
> their own task's risk · are about to hand a schema, auth, or plugin-agent
> change to a junior.

- **Status:** Accepted
- **Decided:** 2026-08-02 (#1177), risk half 2026-08-02 (#1188)
- **Last updated:** 2026-08-02 (#1188)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `docs/task-lifecycle.md`, `.claude/agents/plan-critic.md`, `.claude/commands/critique-plan.md`, `.claude/agents/task-reviewer.md`, `docs/specs/task-review-spec.md`
- **Related:** ADR-0006, `docs/skill-lifecycle.md`, `docs/specs/task-review-spec.md` §3.1

## Context

Working with Claude moves the expensive mistake. Writing code is no longer the
slow part; deciding what code to write is — and a wrong decision now gets
implemented fast and completely. A plan wrong in one sentence becomes a branch
wrong in forty files.

The cheapest place to kill a bad approach is a paragraph in a plan. The second
cheapest is the author's own review of their own diff. Peer review is third and
the lead's review is last and most expensive.

Two properties of the collaborator shape the mechanism:

1. **A session is anchored on its own reasoning.** The session that wrote the
   plan will confirm the plan. The same holds for a diff: asked whether the
   implementation matches the plan, the session that wrote both says yes.
2. **A confident wrong answer is indistinguishable from a right one.** Critique
   output is well-formatted whether or not it is correct. The originating branch
   cited a `/code-review` command that does not exist here — three times, inside
   the document warning about exactly that.

**Who decides how much care a task needs** is a separate question, and for four
days two mechanisms answered it. The lifecycle gave the *developer* a three-tier
choice — Trivial / Normal / Risky — with seven triggers and the tie-break "when
in doubt, Risky." `review-ready` / `task-reviewer` (#1181) then gave the *lead* a
`senior` verdict on the same axis, applied at triage, with a stronger
consequence: `docs/specs/task-review-spec.md` §3 assigns the issue to the lead
and swaps it out of the junior pool entirely. The tier asked the person with the
least context — at the point where the work had already been handed to them — to
re-derive a judgment requiring the architecture guide, the ADRs, and the schema
site lists; and its tie-break routed junior uncertainty into the lead's inbox as
a plan review, which is the interrupt `review-ready` exists to remove.

## Decision

**The plan is a file, a read-only subagent attacks it before any code is
written, and task risk is classified once — at triage, not by the developer.**

Concretely, for the plan:

- The plan is written to `PLAN.md` (gitignored) before implementation.
- `/critique-plan` dispatches the `plan-critic` subagent, whose frontmatter
  grants `Read, Grep, Glob, Bash` and nothing else.
- Two rounds maximum. A blocking finding surviving round two escalates to the
  lead as a task problem, not a plan problem.
- Findings are verified by the author before being acted on or relayed —
  proposals included.

And for risk:

- `docs/task-lifecycle.md` has two tiers, **Trivial** and **Normal**. There is no
  Risky tier and no pre-code plan review.
- The `senior` row in `.claude/agents/task-reviewer.md` is the **single written
  list of risk triggers**, and carries all of what the tier had — including the
  four the `senior` row originally lacked: schema, credentials, plugin-agent
  `tools:` binding, hard-to-undo.
- Risk visible only once a developer is in the code is a **stop rule** in
  lifecycle step 4: on hitting a categorical trigger, stop and return to the
  lead rather than re-plan around it. A stop is a defect report against the
  `senior` trigger list.
- A developer who is **not confident** — about a question, a mechanism, or the
  task as a whole — asks a senior and *keeps working*. That is a
  continue-with-help rule, not a stop rule, and it is deliberately not a `senior`
  trigger (see Alternatives).

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Ask in prose** — "review this plan", no command, no subagent | Two mechanisms, both silent. Description matching can miss, and a miss hands the job to main-context Claude — which wrote the plan and holds `Edit`/`Write`, so it agrees with itself and may begin implementing. Prose also passes a *paraphrase*; a critique of a paraphrase is indistinguishable from a real one by the time it reaches the author | Argued, not measured. The anchoring half is the same effect `docs/task-lifecycle.md` step 6 exists for |
| **A skill instead of a command** | Same defect — skills fire by description matching. A command is invoked by name and cannot silently no-op | The three deleted subagents (#1161) are the standing evidence that silent `.claude/` failure modes go unnoticed |
| **A general-purpose subagent** | Buys the fresh context but not the tool restriction, which is the only part a prompt cannot buy | ADR-0006 is the general form: capability is restricted by tool identity, not by prompt |
| **Three or more critique rounds** | Round one finds real problems; round two confirms fixes and usually finds one more; round three yields style opinions and a longer plan | Argued, not measured. The originating branch ran two adversarial passes and found seven real defects; the value was in rounds one and two |
| **Let the critic apply its own findings** | Collapses the verification step the design rests on. Read-only forces someone to decide which findings are real — the part that teaches the codebase | That branch's own round: one finding was rejected as wrong, and one *proposal* was relayed as though it existed when it did not |
| **Per-task plans as files under `docs/plan/`** | That directory holds multi-week design docs reviewed with a designer and an engineer; a per-task plan is a different genre with a different lifespan. Filing one there means it lands on `main` and must be deleted when the work ships | `CLAUDE.md` § `docs/plan/`: "Two files here spent weeks claiming 'not yet implemented' and 'not yet branched' for things that had shipped" |
| **A developer-chosen Risky tier, with the lead reviewing the plan pre-code** *(the original #1177 decision, retired in #1188)* | Duplicated the `senior` verdict at the worst-positioned point: least context, work already handed over, and a weaker consequence than the verdict it duplicated. Its "when in doubt" tie-break converted junior uncertainty into lead interrupts. Nothing enforced it | `docs/specs/task-review-spec.md` §3 (`senior` → assign `DallanQ`, swap out) vs. the tier (lead reviews the plan). Enforcement below: nothing blocks a PR leaving the tier blank |
| **Collapse to one tier — everything is Normal** | Taxes the highest-frequency, lowest-risk changes: a typo or doc-link fix would carry `PLAN.md` plus a `/critique-plan` round. Trivial is a call a junior makes reliably from the diff in front of them; Risky is one that needs the architecture guide. Deleting both treats two different qualities of judgment as one | Argued, not measured |
| **Keep Risky but drop the pre-code plan review** | The plan review *was* the tier's consequence. Without it the tier is a label with no action, which is the shape that rots — nobody notices when it is wrong | Enforcement below |
| **Leave the four extra triggers implicit in Pass B #5 and §9.4** | Reachable-by-inference is how a triage miss happens. With the tier gone the `senior` row is the only written list, so completeness stops being a nicety | `.claude/agents/task-reviewer.md` `senior` row as it stood — named neither schema, credentials, plugin-agent binding, nor hard-to-undo |
| **Make "the developer isn't confident" a `senior` trigger** | Not a property of the change, so `task-reviewer` cannot evaluate it — it does not know who will pick the issue up, and confidence varies by person and by week. A trigger the agent cannot check reads as coverage and is not. It routes to Pass B instead | The other eight triggers are all checkable from the issue and the code; this one is checkable from neither |
| **A CI check that fails a PR touching `src/auth/` without the `senior` label** | The trigger set is about *intent* as much as paths (an ADR reversal, a doctrine commitment), so a path lint would catch the easy third and imply coverage of the rest | Argued, not measured. `doc-links.test.ts` is a staleness lint, not a policy gate |

## Consequences

**Gains.** Bad approaches die in a paragraph instead of a branch. The author, not
the reviewer, discovers implement-vs-plan drift. Risk is classified once, by the
party with the whole picture, before the work is handed out — and risky work
leaves the junior pool rather than being gated inside it. The junior's process
choice collapses to a question they can actually answer: is this a typo or not.
The lead's review is spent on whether the approach is right, because everything
mechanical is settled.

**Costs, knowingly accepted.**

- A dispatch that finds nothing still costs a subagent run. The agent is
  instructed to report "no blocking findings" plainly rather than manufacture a
  fourth concern, so the floor is one cheap run.
- Two rounds is a stopping rule, not a measurement. The escalation it forces
  (round two still blocking → go to the lead) is the load-bearing part; the
  number is the cheap way to trigger it.
- The author owns verification. A finding acted on unverified is worse than no
  finding — it arrives at whoever you hand it to looking established.
- **`review-ready` is now the single point of risk classification.** The junior's
  tier call was a second net — weak and unenforced, but a net. The first time
  triage misclassifies something, the discovery moves from the plan stage to a
  PR.
- The stop rule is convention, exactly as the tier was. Nothing blocks a branch
  that quietly edits `src/auth/`.
- Two lists must be kept in step: the agent's `senior` triggers and the
  lifecycle's step-4 stop rule, a deliberate subset of them. A trigger added to
  one and not the other is invisible.

**Where a confidence escalation lands, and why not in the `senior` list.** A
developer saying "I am not sure I can do this correctly" is a real signal, but it
is almost never a missing `senior` trigger. That list holds properties of the
*change*; confidence is a property of the *pairing* between a person and a task,
which triage cannot see. What such an escalation usually means is that the issue
body left the blast radius, the verifying command, or an open decision implicit
— a **Pass B** miss, whose right verdict was `ready-after-edit` or
`needs-a-decision`. Routing it to the `senior` list would mis-attribute most
instances and grow that list with entries nothing can check. So `task-reviewer`'s
`ready` row names the part most likely to need a senior, and
`docs/task-lifecycle.md` § "Ask early" tells developers to ask.

**Risks.** `plan-critic` has no eval the way a shipped skill does, so its
judgement can degrade silently if the prompt drifts. The lint below catches stale
paths, not weak criticism. And nothing measures how often triage misses a risk
category, so that cost is unquantified in either direction — the stop rule is the
only instrument that would surface it, and it depends on a junior volunteering
that their task was mis-scoped.

## Enforcement

> `packages/engine/mcp-server/tests/packaging/doc-links.test.ts` — every repo
> path, markdown link, and `make` target cited in `.claude/agents/`,
> `.claude/commands/`, `.claude/skills/`, and `docs/task-lifecycle.md` resolves.
> `packages/engine/mcp-server/tests/packaging/adr-links.test.ts` — the same for
> this file's `Applies to` and `Enforcement`.

Neither checks that the critic was run, that findings were verified, that a
`senior` verdict was applied, that the agent's trigger list and the lifecycle's
stop rule agree, or that a developer stopped or asked when they should have.
`.github/pull_request_template.md` carries the tier and the plan; nothing blocks
a PR that leaves them blank. All convention.

## Revisit when

A plan-stage critique demonstrably misses a defect that a third round would have
caught, or a per-task plan turns out to need review by someone who is not on the
PR — at which point the `docs/plan/` question reopens with a concrete reader,
rather than as a filing preference.

On the risk half: a junior hits the step-4 stop rule twice for the same class of
change, or a `senior`-shaped change reaches a junior and lands. Either is triage
missing a category, and the fix is a trigger in the `senior` row — not a tier
restored to `docs/task-lifecycle.md`. Also revisit if `review-ready` stops being
run on the shortlist before promotion: this rests on every task passing that
gate, and a pool promoted without it has no risk classification at all.
