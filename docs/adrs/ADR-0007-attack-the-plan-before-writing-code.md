# ADR-0007: Attack the plan before writing code, with a read-only critic

> **Read before you:** wonder why `/critique-plan` is a command instead of "ask
> Claude to review this" · want to add a third critique round · want to skip
> writing `PLAN.md` because the plan is already in the chat · want per-task
> plans filed under `docs/plan/` · want the critic to fix what it finds · want
> to add a "Risky" tier back to the lifecycle · wonder why a junior does not
> classify their own task's risk · are about to hand a schema, auth, or
> plugin-agent change to a junior.

- **Status:** Accepted
- **Decided:** 2026-08-02 (#1177)
- **Recorded:** 2026-08-02
- **Amended:** 2026-08-02 (#1188) — §2 of Context / Decision / Alternatives /
  Consequences below. The Risky tier is retired; risk is settled at triage.
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `docs/task-lifecycle.md`, `.claude/agents/plan-critic.md`, `.claude/commands/critique-plan.md`, `.claude/agents/task-reviewer.md`, `docs/specs/task-review-spec.md`
- **Related:** ADR-0006, `docs/skill-lifecycle.md`, `docs/specs/task-review-spec.md` §3.1

## Context

### 1. Attacking the plan

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
   output is well-formatted whether or not it is correct. This branch's own
   first commit cited a `/code-review` command that does not exist here — three
   times, inside the document warning about exactly that.

### 2. Where risk is settled *(added 2026-08-02, #1188)*

The original decision gave the **developer** a three-tier choice — Trivial /
Normal / Risky — with seven triggers for Risky, the rule "when in doubt, Risky,"
and the consequence that the lead reviewed the plan in a draft PR before code.

Four days later `review-ready` / `task-reviewer` (#1181) gave the **lead** a
`senior` verdict on the same axis, applied at triage before the task is handed
out, with a stronger consequence: `docs/specs/task-review-spec.md` §3 assigns
the issue to the lead and swaps it out of the junior pool entirely.

The two trigger lists overlapped but were not identical. Four of the tier's
seven — schema change, credentials, plugin-agent `tools:` binding, hard-to-undo
— were absent from the `senior` row, reachable there only by inference from the
blast-radius pass and `docs/architecture.md` §9.4.

Three facts about the tier, all verifiable in the files as they stood:

1. It asked the person with the least context, at the point where they had
   already been handed the work, to re-derive a judgment that requires knowing
   the architecture guide, the ADRs, and the schema site lists.
2. Its tie-break routed junior uncertainty into the lead's inbox as a plan
   review — the interrupt `review-ready` exists to remove.
3. Nothing enforced it. The Enforcement section below: no check confirms a
   Risky plan reached the lead, and nothing blocks a PR leaving the tier blank.

## Decision

### 1. Attacking the plan

**The plan is a file, and a read-only subagent attacks it before any code is
written.** Concretely:

- The plan is written to `PLAN.md` (gitignored) before implementation.
- `/critique-plan` dispatches the `plan-critic` subagent, whose frontmatter
  grants `Read, Grep, Glob, Bash` and nothing else.
- Two rounds maximum. A blocking finding surviving round two escalates to the
  lead as a task problem, not a plan problem.
- Findings are verified by the author before being acted on or relayed —
  proposals included.
- ~~Risky-tier plans are reviewed by the lead **in the draft PR description**.~~
  **Retired 2026-08-02 (#1188)** — superseded by §2.

### 2. Where risk is settled *(added 2026-08-02, #1188)*

**Task risk is classified once, at triage, by `task-reviewer`'s `senior`
verdict.** `docs/task-lifecycle.md` keeps two tiers, Trivial and Normal, and the
`senior` row in the agent body becomes the single written list of risk triggers
— gaining the four the tier had and it did not.

Risk that only becomes visible once a developer is in the code is handled by a
**stop rule** in lifecycle step 4, not by a tier: on hitting one of the
categorical triggers (schema, credentials, plugin-agent binding, a new or
changed tool contract, an ADR reversal, anything hard to undo), the developer
stops and returns to the lead rather than re-planning around it. A stop is a
defect report against the `senior` trigger list.

Separately and not to be confused with it, a developer who is **not confident**
— in a question, a mechanism, or the task as a whole — asks a senior and keeps
working. That is a continue-with-help rule, not a stop rule, and it is not a
`senior` trigger: see Consequences §2 for why it is routed to `task-reviewer`'s
Pass B instead.

## Alternatives considered

### 1. Attacking the plan

| Option | Why rejected | Evidence |
|---|---|---|
| **Ask in prose** — "review this plan", no command, no subagent | Two mechanisms, both silent. Description matching can miss, and a miss hands the job to main-context Claude — which wrote the plan and holds `Edit`/`Write`, so it agrees with itself and may begin implementing. Prose also passes a *paraphrase*; a critique of a paraphrase is indistinguishable from a real one by the time it reaches the author | Argued, not measured. The anchoring half is the same effect `docs/task-lifecycle.md` step 6 exists for |
| **A skill instead of a command** | Same defect — skills fire by description matching. A command is invoked by name and cannot silently no-op | The three deleted subagents (#1161) are the standing evidence that silent `.claude/` failure modes go unnoticed |
| **A general-purpose subagent** | Buys the fresh context but not the tool restriction, which is the only part a prompt cannot buy | ADR-0006 is the general form: capability is restricted by tool identity, not by prompt |
| **Three or more critique rounds** | Round one finds real problems; round two confirms fixes and usually finds one more; round three yields style opinions and a longer plan | Argued, not measured. This branch ran two adversarial passes and found seven real defects; the value was in rounds one and two |
| **Let the critic apply its own findings** | Collapses the verification step the design rests on. Read-only forces someone to decide which findings are real — the part that teaches the codebase | This branch's own round: one finding was rejected as wrong, and one *proposal* was relayed as though it existed when it did not |
| **Risky plans as files under `docs/plan/`** | That directory holds multi-week design docs reviewed with a designer and an engineer; a per-task plan is a different genre with a different lifespan. Filing one there means it lands on `main` and must be deleted when the work ships | `CLAUDE.md` § `docs/plan/`: "Two files here spent weeks claiming 'not yet implemented' and 'not yet branched' for things that had shipped" |

### 2. Where risk is settled *(added 2026-08-02, #1188)*

| Option | Why rejected | Evidence |
|---|---|---|
| **Keep all three tiers** | Two mechanisms deciding one thing, with the weaker one sited where the information is worst and the stakes are already sunk. The tier's only action — a pre-code plan review — is strictly weaker than the `senior` verdict's, which removes the task from the junior pool | `docs/specs/task-review-spec.md` §3 (`senior` → assign `DallanQ`, swap out) vs. the tier (lead reviews the plan) |
| **Collapse to one tier — everything is Normal** | Taxes the highest-frequency, lowest-risk changes: a typo or doc-link fix would carry `PLAN.md` plus a `/critique-plan` round. Trivial is a call a junior makes reliably from the diff in front of them; Risky is one that needs the architecture guide. Deleting both treats two different qualities of judgment as one | Argued, not measured |
| **Keep Risky, drop the pre-code plan review** | The plan review *was* the tier's consequence. Without it the tier is a label with no action, which is the shape that rots — nobody notices when it is wrong | Enforcement below: nothing blocks a PR that leaves the tier blank |
| **Leave the four extra triggers implicit in Pass B #5 and §9.4** | Reachable-by-inference is how a triage miss happens. With the tier gone the `senior` row is the only written list, so completeness stops being a nicety | `.claude/agents/task-reviewer.md` `senior` row as it stood — named neither schema, credentials, plugin-agent binding, nor hard-to-undo |
| **Make "the developer isn't confident" a `senior` trigger** | Not a property of the change, so `task-reviewer` cannot evaluate it — it does not know who will pick the issue up, and confidence varies by person and by week. A trigger the agent cannot check reads as coverage and is not | The other eight triggers are all checkable from the issue and the code; this one is checkable from neither |
| **A CI check that fails a PR touching `src/auth/` without the `senior` label** | The trigger set is about *intent* as much as paths (an ADR reversal, a doctrine commitment), so a path lint would catch the easy third and imply coverage of the rest | Argued, not measured. `doc-links.test.ts` is a staleness lint, not a policy gate |

## Consequences

### 1. Attacking the plan

**Gains.** Bad approaches die in a paragraph instead of a branch. The author,
not the reviewer, discovers implement-vs-plan drift. The lead's review is spent
on whether the approach is right, because everything mechanical is settled.

**Costs, knowingly accepted.**

- A dispatch that finds nothing still costs a subagent run. The agent is
  instructed to report "no blocking findings" plainly rather than manufacture a
  fourth concern, so the floor is one cheap run.
- Two rounds is a stopping rule, not a measurement. The escalation it forces
  (round two still blocking → go to the lead) is the load-bearing part; the
  number is the cheap way to trigger it.
- The author owns verification. A finding acted on unverified is worse than no
  finding — it arrives at whoever you hand it to looking established.

**Risks.** `plan-critic` has no eval the way a shipped skill does, so its
judgement can degrade silently if the prompt drifts. The lint below catches
stale paths, not weak criticism. Nothing currently measures whether the
critique step changes outcomes.

### 2. Where risk is settled *(added 2026-08-02, #1188)*

**Gains.** One classification, made by the party with the whole picture, before
the work is handed out. Risky work leaves the junior pool rather than being
gated inside it. The junior's process choice collapses to a question they can
actually answer — is this a typo or not. The lead stops receiving plan reviews
generated by junior uncertainty.

**Costs, knowingly accepted.**

- **`review-ready` becomes the single point of risk classification.** The
  junior's tier call was a second net. It was weak and unenforced, but it was a
  net, and the first time triage misclassifies something the discovery moves
  from the plan stage to a PR.
- The stop rule is convention, exactly as the tier was. Nothing blocks a branch
  that quietly edits `src/auth/`.
- Two lists now have to be kept in step — the agent's `senior` triggers and the
  lifecycle's step-4 stop rule, which is a deliberate subset. A trigger added to
  one and not the other is invisible.

**Where a confidence escalation lands, and why not here.** A developer saying "I
am not sure I can do this correctly" is a real signal, but it is almost never a
missing `senior` trigger. The `senior` list holds properties of the *change*;
confidence is a property of the *pairing* between a person and a task, which
triage cannot see — it does not know who will pick the issue up. What such an
escalation usually means is that the issue body was thin: the blast radius, the
verifying command, or an open decision was left implicit. That is a **Pass B**
miss, and the verdict that should have fired is `ready-after-edit` or
`needs-a-decision`, not `senior`. Routing it to the `senior` list would
mis-attribute most instances and grow that list with entries nothing can check.
So `task-reviewer`'s `ready` row instead names the part most likely to need a
senior, and `docs/task-lifecycle.md` tells developers to ask.

**Risks.** Nothing measures how often triage misses a category, so the cost
above is unquantified in either direction. The stop rule is the only instrument
that would surface it, and it depends on a junior volunteering that their task
was mis-scoped.

## Enforcement

> `packages/engine/mcp-server/tests/packaging/doc-links.test.ts` — every repo
> path, markdown link, and `make` target cited in `.claude/agents/`,
> `.claude/commands/`, `.claude/skills/`, and `docs/task-lifecycle.md`
> resolves.
> It does **not** check that the critic was run or that findings were verified.
> Those are convention.

`.github/pull_request_template.md` carries the tier and the plan; nothing
blocks a PR that leaves them blank.

For §2: `packages/engine/mcp-server/tests/packaging/adr-links.test.ts` lints
this file's `Applies to` and `Enforcement` paths. Nothing checks that a `senior`
verdict was applied, that the agent's trigger list and the lifecycle's stop rule
agree, or that a developer stopped or asked when they should have. Convention —
the same standing the retired tier had.

## Revisit when

A plan-stage critique demonstrably misses a defect that a third round would
have caught, or when a per-task plan turns out to need review by someone who is
not on the PR — at which point the `docs/plan/` question reopens with a
concrete reader, rather than as a filing preference.

For §2: a junior hits the step-4 stop rule twice for the same class of change,
or a `senior`-shaped change reaches a junior and lands. Either is triage missing
a category, and the fix is a trigger in the `senior` row — not a tier restored
to `docs/task-lifecycle.md`. Also revisit if `review-ready` stops being run on
the shortlist before promotion: §2 rests on every task passing that gate, and a
pool promoted without it has no risk classification at all.
