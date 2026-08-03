# ADR-0006: Restrict capability by tool identity, not by prompt or parameter

> **Read before you:** need a delegated agent to do *part* of what a tool can do
> · find yourself writing "you must only use this for X" in an agent body · add a
> `mode` or `section` parameter to a writer tool to scope it · design a boundary
> that must hold against a caller who wants to cross it.

- **Status:** Accepted
- **Decided:** 2026-07-18 (#695/#736, after the birkeland lane breach — the agent itself shipped 2026-07-12 in #650 carrying the *prose* lane this replaced)
- **Recorded:** 2026-08-02
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `packages/engine/mcp-server/src/tools/extraction-append.ts`, `packages/engine/mcp-server/src/tools/research-append.ts`, `packages/engine/plugin/agents/record-extractor.md`
- **Related:** ADR-0003, ADR-0004, ADR-0005, `docs/specs/research-append-tool-spec.md` §11

## Context

`record-extractor` is delegated one record at a time and owns exactly two
sections of `research.json`: `sources` and `assertions`. It must not write
identity links, conflicts, proof summaries, or anything else — those belong to
`person-evidence`, `conflict-resolution`, and `proof-conclusion`, and the whole
point of extracting in fresh context is that the extractor has not seen, and
cannot be steered by, the session's prior conclusions.

The boundary was originally prose in the agent body. It did not hold. In the
birkeland re-run, a delegation message prompted the extractor past its stated
lane and **it fabricated a `match_score`** (0.92) — a number that belongs to the
identity decision it is specifically not supposed to make.

> *Sourcing note:* this incident survives only as a quotation. It is recorded in
> `src/tools/extraction-append.ts` and `research-append-tool-spec.md` §11, but
> the primary write-up it cites is not in the repo, so the run cannot be re-read.

That failure is instructive about *why*, not just *that*. The caller composes the
delegation message. A boundary written in the callee's prompt is being enforced
by the same text the caller is arguing with, and the caller wins often enough to
matter.

The obvious next idea — put the restriction in the tool's input — fails for a
sibling reason: **the caller supplies the input.** A `sections: ["sources"]`
parameter is a request, not a constraint.

## Decision

**Where a boundary must hold against a misdirected caller, narrow the tool, not
the prompt.**

`extraction_append` is `research_append` restricted to `sources` and
`assertions`. It is the *same implementation*, gated by a **second function
parameter**:

```ts
researchAppend(input, { allowedSections, toolName })
```

A tool caller structurally cannot reach that second argument, because dispatch
builds only the first one from tool input. The restriction is not in the payload,
so there is nothing for the model to set.

The agent then holds `extraction_append` and **not** `research_append` — omitted
from `tools:` and additionally named in `disallowedTools:` under both spellings
(ADR-0004), because a deny binds even under `bypassPermissions`.

The general form:

| Lane | Holds? | Why |
|---|---|---|
| Prose in the agent body | **No** | the caller can prompt past it |
| A parameter on the tool input | **No** | the caller supplies the input |
| **Tool identity** | **Yes** | the capability is absent from the agent's world |

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **Prose in the agent body** — "only write sources and assertions" | This is what was there. A delegation message prompted past it and the agent fabricated a `match_score` | The birkeland re-run; `research-append-tool-spec.md` §11 |
| **A `sections:` parameter** on `research_append` | The caller supplies the input; a parameter is a request. Same class of failure as prose, one layer down | `research-append-tool-spec.md` §11.2 |
| **A separate per-skill write tool for every lane** (`person_evidence_append`, `conflict_append`, …) | Rejected earlier and independently: *"a split tool is exactly as callable by the router as a section branch is."* Splitting names does not constrain a caller who holds all of them — the constraint comes from *not holding* the broad one, which is what `disallowedTools:` provides | `docs/specs/guardrail-enforcement-spec.md` §9 |
| **A `PreToolUse` hook** discriminating by caller | A design exists, but it is less portable than it looks. `eval/harness/harness/context_policy.py` denies `image_read` on **three** conditions — the tool is guarded, `agent_id` is absent, **and** the calling skill did not declare it in its own `allowed-tools` (`search-images` declares it and legitimately calls it on the main thread). The discriminator is therefore the skill's declaration, which the production path has no equivalent of, and the module says the e2e orchestrator cannot use it either. Unported and gated on calibrating the shadow window first (#911). Tool identity needed no new machinery | #911; `context_policy.py` ("Membership here is necessary but NOT sufficient") |
| **Duplicate the implementation** into a genuinely separate `extraction_append` | Two copies of the validation logic drift. Same implementation, different entry point, keeps one contract | Code-reuse convention, `CLAUDE.md` |
| **Trust the eval suite to catch lane violations** | Grades after the fact and only on cases the corpus covers. `research-append-tool-spec.md` is explicit that for `match_score` specifically *"the lever there is eval/rubric, not tooling"* — which is precisely the gap this pattern closes for sections | `research-append-tool-spec.md` |

## Consequences

**Gains.** The boundary is unforgeable from the callee's side: there is no
argument, no parameter, and no prompt that lets `record-extractor` write a proof
summary, because the capability is not in its world. It composes with ADR-0004 —
the deny binds even under `bypassPermissions`, which is the hosted path's mode —
and it needed no new enforcement machinery. This is textbook least-privilege by
2025 standards (OWASP Excessive Agency); what is worth keeping is the specific
mechanism, the second function parameter that dispatch cannot populate.

**Costs, knowingly accepted.**

1. **Every narrowed lane is another tool in the catalog**, and tool count is
   context budget in every session (ADR-0002). This does not scale to a lane per
   skill — it is reserved for boundaries that have actually been crossed.
2. **The pattern only covers what a *tool* can express.** It scopes *which
   sections* the extractor writes. It does **not** stop it writing a wrong value
   into a section it legitimately owns — `match_score` remains caller-fabricable,
   and the spec says so plainly.
3. **Two places must agree.** The tool must be narrowed *and* the agent's
   frontmatter must omit-and-deny the broad one. Getting only the first gives an
   agent that can still call `research_append` directly.

**Risks.** Nothing verifies the deny actually binds at runtime — the lint checks
spelling only (#1084/#1085, ADR-0004). And the same reasoning is wanted for
identity scoring (`same_person`), where it has **not** been made to work: three
candidate discriminators have now failed adversarial review, and the next
deliverable there is a gate spec with five named design constraints, not a code
change. **Do not assume this pattern generalises to that problem** — read
`docs/agentic-system-critique.md` §3 P0 and §9 before proposing a fourth.

## Enforcement

> `packages/engine/mcp-server/tests/packaging/agent-tool-names.test.ts` —
> asserts `disallowedTools:` entries carry both spellings, so the deny binds
> wherever the server is registered.

The structural half needs no test: dispatch builds only the first argument, so
the second is unreachable from tool input by construction. That is the point of
choosing this mechanism over a parameter.

What is **not** covered: that the deny binds at runtime; that a *value* written
into an owned section is correct.

## Revisit when

A second lane needs narrowing — at which point the question is whether a
per-context `PreToolUse` policy (#911) has become the cheaper general mechanism,
since it discriminates by caller without adding a tool per lane. Or when the
`same_person` gate spec lands, which may establish a different pattern for
boundaries that depend on *values* rather than sections.
