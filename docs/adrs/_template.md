# ADR-NNNN: <The decision, stated as an action>

> **Read before you:** <the concrete tasks that should send someone here, in
> their words — e.g. "add an MCP tool · change an agent's `tools:` frontmatter ·
> grant a tool to a subagent">. This line is the routing surface; write it like
> a skill `description`.

- **Status:** Proposed | Accepted | Superseded
- **Decided:** <when the decision was actually taken — or "pre-YYYY-MM (reconstructed)">
- **Last updated:** <date (#PR) — bump on every edit; these are living documents>
- **Deciders:** <names>
- **Supersedes:** — <or ADR-00MM>
- **Superseded by:** — <rare; see README § Superseding. A changed decision is an edit, not a supersession>
- **Applies to:** `path/or/glob` — *linted; keep current*
- **Related:** <issues, PRs, specs>

## Context

The **forces**, not the solution. What was true when this was decided, what
constraint was non-negotiable, and what goes wrong if nothing is done.

State facts that were *verified*, and say where. If a number appears here, a
reader must be able to reproduce it.

## Decision

One sentence, active voice, present tense. Then at most a paragraph on what that
concretely means at the code level.

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| <the obvious other way> | <the specific failure> | <file:line, a measurement, an incident — or "argued, not measured"> |

Every row needs a **why** *and* an **evidence** cell. An alternative with no
evidence is one nobody actually evaluated — write "argued, not measured" and be
honest, rather than implying a test that never ran.

**Never delete a row.** The rest of the file is rewritten freely as the decision
changes (README rule 3); this table only grows. When a decision is reversed, the
thing it replaced lands here.

Include the alternatives a newcomer will propose. An ADR that only lists exotic
options will not stop the obvious suggestion from coming back.

## Consequences

**Gains.** What this buys, concretely.

**Costs, knowingly accepted.** What it makes worse, and who pays. Not optional.
If the answer is "nothing," this was not a tradeoff and may not need an ADR.

**Risks.** What could bite later, and what we are not doing about it.

## Enforcement

How we would know this broke — a test, a CI job, a lint. Or the words
**"None — convention only,"** which is a legitimate and useful answer.

> `path/to/test` — what it asserts.
> What it does **not** catch.

*Linted: every path in this section must resolve.*

## Revisit when

The specific new fact that would reopen this. Not "if requirements change."

> <e.g. "A bypass is observed using the shell route," or "a skill ships a
> `scripts/` folder that needs `Bash`.">
