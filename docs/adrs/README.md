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

**3. Append-only where it is history; live where it is a pointer.**

| Section | Rule |
|---|---|
| Context, Decision, Alternatives considered, Consequences | **Append-only.** History does not rot. Never *rewrite* these to reflect new reality — add to them, under a dated subsection, and strike the clause that no longer holds rather than deleting it. |
| Applies to, Enforcement, Related | **Live.** These are pointers into a moving codebase. Fix them in the PR that moves the code. |

That split is deliberate. Classic ADR practice freezes the whole file, which is
right for an archive and wrong for us — a developer reads these *while working*,
so a stale path is not a curiosity, it is a wrong answer they will act on.

**4. Prefer amending an existing ADR to writing a new one.** The set is a
routing surface, and its value falls as it grows: eight ADRs get read, thirty
get skimmed, and a decision split across two files is one nobody holds in their
head. So the default is to amend.

| Situation | Do |
|---|---|
| The core decision stands; a clause under it is retired or narrowed | **Amend.** Add `**Amended:** <date> (#PR)` to the header, add a dated subsection to each section that gains material, and strike the retired clause with `~~…~~` plus a pointer to what replaced it. ADR-0007 §2 is the worked example. |
| The core decision is reversed | **New ADR**, and mark the old one `Superseded by`. |
| A genuinely separate decision that happens to touch the same files | **New ADR.** Sharing a file list is not sharing a decision. |

An amendment that makes the original unreadable is the signal you were in row
two all along.

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

Add `**Superseded by:** ADR-00NN` to the old file's header and nothing else —
leave its body untouched. Add `**Supersedes:** ADR-00MM` to the new one. A
superseded ADR stays in the directory: the record of a decision that was
reversed is often worth more than the decision that replaced it.

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
