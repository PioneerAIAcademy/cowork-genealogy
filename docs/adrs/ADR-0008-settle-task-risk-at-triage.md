# ADR-0008: Settle task risk at triage, not in the developer's tier call

> **Read before you:** want to add a "Risky" tier back to
> `docs/task-lifecycle.md` · wonder why a junior does not classify their own
> task's risk · are about to hand a schema, auth, or plugin-agent change to a
> junior · find yourself mid-branch in `src/auth/` or a closed enum · want the
> lead to review a plan before code is written.

- **Status:** Accepted
- **Decided:** 2026-08-02
- **Recorded:** 2026-08-02
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `docs/task-lifecycle.md`, `.claude/agents/task-reviewer.md`, `docs/specs/task-review-spec.md`, `.github/pull_request_template.md`
- **Related:** ADR-0007 (this retires its Decision bullet 5; the rest stands), `docs/specs/task-review-spec.md` §3.1

## Context

The team's developers are juniors working with Claude Code. Two mechanisms were
independently deciding how much care a task needs, and they were built four days
apart:

- `docs/task-lifecycle.md` (#1177) gave the **developer** a three-tier choice —
  Trivial / Normal / Risky — with seven triggers for Risky and the rule "when in
  doubt, Risky." A Risky task's consequence was that the lead reviewed the plan
  in a draft PR before code was written.
- `review-ready` / `task-reviewer` (#1181) gave the **lead** a `senior` verdict
  on the same axis, applied at triage before the task is handed out. Its
  consequence is stronger: `docs/specs/task-review-spec.md` §3 assigns the issue
  to the lead and swaps it out of the junior pool entirely.

The two trigger lists overlapped but were not identical. Four of the tier's
seven — schema change, credentials, plugin-agent `tools:` binding, hard-to-undo
— were not named in the `senior` row, reachable there only by inference from the
blast-radius pass and `docs/architecture.md` §9.4.

Three facts about the tier, all verifiable in the files as they stood:

1. It asked the person with the least context, at the point where they had
   already been handed the work, to re-derive a judgment that requires knowing
   the architecture guide, the ADRs, and the schema site lists.
2. Its tie-break routed junior uncertainty into the lead's inbox as a plan
   review — the interrupt `review-ready` exists to remove.
3. Nothing enforced it. ADR-0007's own Enforcement section: the lint "does not
   check … that a Risky plan reached the lead. Those are convention," and
   "nothing blocks a PR that leaves them blank."

## Decision

**Task risk is classified once, at triage, by `task-reviewer`'s `senior`
verdict.** `docs/task-lifecycle.md` keeps two tiers, Trivial and Normal, and the
`senior` row in the agent body becomes the single written list of risk triggers.

Risk that only becomes visible once a developer is in the code is handled by a
**stop rule** in lifecycle step 4, not by a tier: on hitting one of four
categorical triggers (schema, credentials, plugin-agent binding, hard-to-undo,
plus an ADR reversal or a new/changed tool contract), the developer stops and
returns to the lead rather than re-planning around it. A stop is a defect report
against the `senior` trigger list.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Keep all three tiers** | Two mechanisms deciding one thing, with the weaker one sited where the information is worst and the stakes are already sunk. The tier's only action — a pre-code plan review — is strictly weaker than the `senior` verdict's, which removes the task from the junior pool | `docs/specs/task-review-spec.md` §3 (`senior` → assign `DallanQ`, swap out) vs. `docs/task-lifecycle.md` (Risky → lead reviews the plan) |
| **Collapse to one tier — everything is Normal** | Taxes the highest-frequency, lowest-risk changes: a typo or doc-link fix would carry `PLAN.md` plus a `/critique-plan` round. Trivial is a call a junior makes reliably from the diff in front of them; Risky is one that needs the architecture guide. Deleting both treats two different qualities of judgment as one | Argued, not measured |
| **Keep Risky, drop the pre-code plan review** | The plan review *was* the tier's consequence. Without it the tier is a label with no action, which is the shape that rots — nobody notices when it is wrong | ADR-0007 Enforcement: nothing blocks a PR that leaves the tier blank |
| **Leave the four extra triggers implicit in Pass B #5 and §9.4** | Reachable-by-inference is how a triage miss happens. With the tier gone this row is the only written list, so completeness stops being a nicety | `.claude/agents/task-reviewer.md` `senior` row as it stood — named neither schema, credentials, plugin-agent binding, nor hard-to-undo |
| **A CI check that fails a PR touching `src/auth/` without the `senior` label** | Considered and not built: the trigger set is about *intent* as much as paths (an ADR reversal, a doctrine commitment), so a path lint would catch the easy third and imply coverage of the rest | Argued, not measured. `tests/packaging/doc-links.test.ts` is a staleness lint, not a policy gate |

## Consequences

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

**Risks.** Nothing measures how often triage misses a category, so the cost
above is unquantified in either direction. The stop rule is the only instrument
that would surface it, and it depends on a junior volunteering that their task
was mis-scoped.

## Enforcement

> `packages/engine/mcp-server/tests/packaging/doc-links.test.ts` — every repo
> path, markdown link, and `make` target cited in `docs/task-lifecycle.md` and
> `.claude/agents/` resolves. `packages/engine/mcp-server/tests/packaging/adr-links.test.ts`
> does the same for this file's `Applies to` and `Enforcement`.

Neither checks that a `senior` verdict was applied, that the two trigger lists
agree, or that a developer stopped when they should have. Those are convention —
the same standing that the retired tier had.

## Revisit when

A junior hits the step-4 stop rule twice for the same class of change, or a
`senior`-shaped change reaches a junior and lands. Either is triage missing a
category, and the fix is a trigger in the `senior` row — not a tier restored to
`docs/task-lifecycle.md`.

> Also revisit if `review-ready` stops being run on the shortlist before
> promotion. The whole decision rests on every task passing that gate; a pool
> promoted without it has no risk classification at all.
</content>
