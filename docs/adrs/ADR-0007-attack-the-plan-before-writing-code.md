# ADR-0007: Attack the plan before writing code, with a read-only critic

> **Read before you:** wonder why `/critique-plan` is a command instead of "ask
> Claude to review this" · want to add a third critique round · want to skip
> writing `PLAN.md` because the plan is already in the chat · want per-task
> plans filed under `docs/plan/` · want the critic to fix what it finds.

- **Status:** Accepted
- **Decided:** 2026-08-02 (#1177)
- **Recorded:** 2026-08-02
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `docs/task-lifecycle.md`, `.claude/agents/plan-critic.md`, `.claude/commands/critique-plan.md`
- **Related:** ADR-0006, ADR-0008 (retires the Risky tier this file's Decision
  bullet 5 and `docs/plan/` alternatives row refer to; the rest stands),
  `docs/skill-lifecycle.md`

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
   output is well-formatted whether or not it is correct. This branch's own
   first commit cited a `/code-review` command that does not exist here — three
   times, inside the document warning about exactly that.

## Decision

**The plan is a file, and a read-only subagent attacks it before any code is
written.** Concretely:

- The plan is written to `PLAN.md` (gitignored) before implementation.
- `/critique-plan` dispatches the `plan-critic` subagent, whose frontmatter
  grants `Read, Grep, Glob, Bash` and nothing else.
- Two rounds maximum. A blocking finding surviving round two escalates to the
  lead as a task problem, not a plan problem.
- Findings are verified by the author before being acted on or relayed —
  proposals included.
- Risky-tier plans are reviewed by the lead **in the draft PR description**.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Ask in prose** — "review this plan", no command, no subagent | Two mechanisms, both silent. Description matching can miss, and a miss hands the job to main-context Claude — which wrote the plan and holds `Edit`/`Write`, so it agrees with itself and may begin implementing. Prose also passes a *paraphrase*; a critique of a paraphrase is indistinguishable from a real one by the time it reaches the author | Argued, not measured. The anchoring half is the same effect `docs/task-lifecycle.md` step 6 exists for |
| **A skill instead of a command** | Same defect — skills fire by description matching. A command is invoked by name and cannot silently no-op | The three deleted subagents (#1161) are the standing evidence that silent `.claude/` failure modes go unnoticed |
| **A general-purpose subagent** | Buys the fresh context but not the tool restriction, which is the only part a prompt cannot buy | ADR-0006 is the general form: capability is restricted by tool identity, not by prompt |
| **Three or more critique rounds** | Round one finds real problems; round two confirms fixes and usually finds one more; round three yields style opinions and a longer plan | Argued, not measured. This branch ran two adversarial passes and found seven real defects; the value was in rounds one and two |
| **Let the critic apply its own findings** | Collapses the verification step the design rests on. Read-only forces someone to decide which findings are real — the part that teaches the codebase | This branch's own round: one finding was rejected as wrong, and one *proposal* was relayed as though it existed when it did not |
| **Risky plans as files under `docs/plan/`** | That directory holds multi-week design docs reviewed with a designer and an engineer; a per-task plan is a different genre with a different lifespan. Filing one there means it lands on `main` and must be deleted when the work ships | `CLAUDE.md` § `docs/plan/`: "Two files here spent weeks claiming 'not yet implemented' and 'not yet branched' for things that had shipped" |

## Consequences

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

## Enforcement

> `packages/engine/mcp-server/tests/packaging/doc-links.test.ts` — every repo
> path, markdown link, and `make` target cited in `.claude/agents/`,
> `.claude/commands/`, `.claude/skills/`, and `docs/task-lifecycle.md`
> resolves.
> It does **not** check that the critic was run or that findings were verified.
> Those are convention.

`.github/pull_request_template.md` carries the tier and the plan; nothing
blocks a PR that leaves them blank.

Decision bullet 5 (lead review of Risky-tier plans) no longer applies — ADR-0008
retired that tier, and risk is classified at triage instead. The bullet stays as
written because this section is history.

## Revisit when

A plan-stage critique demonstrably misses a defect that a third round would
have caught, or when a Risky plan turns out to need review by someone who is
not on the PR — at which point the `docs/plan/` question reopens with a
concrete reader, rather than as a filing preference.
