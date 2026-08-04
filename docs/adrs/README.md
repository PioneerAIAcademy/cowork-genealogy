# Architecture Decision Records

One decision per file. **What each one owes you: why it is this way, what else
was tried, and what it would take to change it.**

These exist so a developer — working with Claude, at the moment of work — can
act on a decision without having to re-derive it or re-litigate it. That is a
different job from the two neighbouring docs:

| Doc | Answers |
|---|---|
| [`CLAUDE.md`](../../CLAUDE.md) | *What rule must I follow?* — auto-loaded every session |
| [`docs/architecture.md`](../architecture.md) | *Where does my change land?* — the map |
| **`docs/adrs/`** | *Why is it this way, and what would change it?* |

## When something is an ADR

**An ADR is a decision with a rejected alternative.** If nothing was rejected,
it is not a decision — it is architecture-guide prose. Write it there instead.

Two more tests:

- **Would a competent developer plausibly do it the other way?** If not, it is a
  fact, not a decision.
- **Has someone already argued for the other way?** Then the ADR is overdue —
  that argument is the most valuable thing in it.

## The rules

**1. Numbered, zero-padded, never reused.** `ADR-0007-short-slug.md`. A deleted
ADR's number stays retired.

**2. Titled as an action.** "Dual-spell every MCP tool name in agent
frontmatter," not "Tool naming." A reader scanning the index should see what was
decided, not what it was about.

**3. These are living documents. Edit them freely.**

Every section is live. When a decision changes, **rewrite the file to describe
what is true now** — no dated amendment subsections, no `~~struck~~` clauses, no
"§2 supersedes §1" scaffolding. Update `**Last updated:**` and move on.

This is a deliberate break from classic ADR practice, which freezes the record
and accretes supersessions. The reason is the reader. These are read far more
often by Claude, in a fresh context, *while doing the work* than by a person
doing history. For that reader a file whose current state must be reconstructed
from struck text and layered amendments is actively dangerous: it costs tokens on
every read, and a model skimming a strikethrough acts on the retired clause. A
coherent document that states one thing is the digestible form.

**The history is in `git log -p docs/adrs/`.** It does not need to be in the
reading path.

**One thing is never deleted: a rejected alternative.** `Alternatives considered`
is not archive — it is the working payload, the thing that stops the next
session proposing the option that was already tried. When a decision reverses,
the old decision does not vanish; it **becomes a row in that table**, with the
evidence that changed the call. That is strictly more useful than freezing it in
place, because it lands in the form the reader actually consults.

**4. Prefer editing an existing ADR to writing a new one.** The set is a routing
surface, and its value falls as it grows: eight ADRs get read, thirty get
skimmed, and a decision split across two files is one nobody holds in their head.

| Situation | Do |
|---|---|
| The decision changed, in whole or in part | **Edit it.** Rewrite for current reality; demote what it replaced to an `Alternatives considered` row. ADR-0007 is the worked example — it absorbed a reversal of its own tier rule this way. |
| A genuinely separate decision that happens to touch the same files | **New ADR.** Sharing a file list is not sharing a decision. |
| The whole ADR is obsolete, not merely changed | **Delete it** and note the removal in the PR. Its number stays retired (rule 1). A `Superseded by` chain is only worth keeping when the old decision is still load-bearing somewhere — which, if it is, means it belongs in an `Alternatives` row instead. |

The test for row two is whether a reader arriving with either question would be
served by one file. If yes, it is one ADR.

**5. Every path is linted.** `tests/packaging/adr-links.test.ts` asserts that
every repo path cited in `Applies to` or `Enforcement` resolves. Move the code,
and CI fails until the ADR is updated or superseded. This is the only thing
keeping the set trustworthy past a few months — do not weaken it.

**6. `Read before you:` is the routing line.** It is the field that decides
whether the ADR is ever opened, so write it like a skill `description`: the
concrete tasks that should send someone here, in their words. Under-trigger and
the ADR is invisible; over-trigger and it dilutes the index.

**7. Say what it costs.** The `Costs, knowingly accepted` paragraph is not
optional and is not a formality. If the answer is "nothing," the decision was
not a tradeoff and probably does not need an ADR.

**8. Evidence, not assertion.** This repo rejects things by measurement — the
`record-extractor` playbook A/B, the compaction-decay audit, the model
downgrade. When that evidence exists, cite it with a number. When it does not,
say "argued, not measured." Both are fine; pretending is not.

## Superseding

Mostly you don't. Rule 4 says edit the ADR in place, so a reversal usually leaves
one file that reads correctly, with the old decision demoted to an `Alternatives
considered` row.

The `Supersedes` / `Superseded by` fields survive for the one case that is not
an edit: a decision that **splits** into two ADRs, or one whose replacement is
genuinely a different decision rather than a revision of this one. Then add
`**Superseded by:** ADR-00NN` to the old header and `**Supersedes:** ADR-00MM`
to the new. Do not reach for this to avoid rewriting a file.

## Writing a new one

First check rule 4 — most of the time the right move is amending an ADR that
already exists, and the new file is the exception.

Copy [`_template.md`](_template.md). Fill every field — an empty section means
"we did not think about this," so write that if it is true.

Then add a row to the index in [`docs/architecture.md`](../architecture.md) §0,
between the `ADR-INDEX-START` / `ADR-INDEX-END` markers. The index line carries
the routing weight, because it is what a reader sees before deciding to open
anything.

## Related

- [`docs/agentic-system-critique.md`](../agentic-system-critique.md) §9 —
  "Refuted in review — do not re-derive." A running ledger of claims that were
  argued and disproved. Several of these ADRs were mined from it, and new
  entries there are candidate ADRs.
- `docs/specs/guardrail-enforcement-spec.md` §9 — "Options set aside," the same
  pattern scoped to guardrails.
