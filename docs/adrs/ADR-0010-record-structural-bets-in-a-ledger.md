# ADR-0010: Record every structural bet in one ledger, and treat only a researched rejection as a bar

> **Read before you:** run `/find-big-wins` · wonder what happened to a
> structural idea that was proposed and never filed · want to create a
> `docs/ideas/` folder or any other place to park ideas · cite a ledger row
> against a new proposal · re-propose an idea the ledger says was rejected ·
> add a row here.

- **Status:** Accepted
- **Decided:** 2026-08-09
- **Last updated:** 2026-08-09 (created alongside `/find-big-wins`)
- **Deciders:** Dallan Quass
- **Supersedes:** —
- **Superseded by:** —
- **Applies to:** `.claude/skills/find-big-wins/SKILL.md`, `.claude/skills/fill-ready/SKILL.md` — *linted; keep current*
- **Related:** ADR-0009 (the refutation ledger), ADR-0007 (who writes the plan); `docs/architecture.md` §9.4

## Context

Every mechanism this team has for choosing work improves the next step.
`/audit-board` finds the best handling of the issues that exist, `/fill-ready`
ranks them, `/review-ready` vets them. All of it is a hill-climber, and a
hill-climber cannot see a different hill. `/find-big-wins` exists to propose
changing the shape of the system instead, and it needs somewhere to leave what
it proposed.

Four facts constrain where that can be.

**An idea with no visible age does not get decided; it gets forgotten.**
ADR-0009 records the case: routing-as-a-tool was demoted to a P2 spike, and then
nothing aged it. It sat untouched for months, neither run nor dropped, because
"demoted to a spike" reads identically in week one and week twenty. Whatever
holds these ideas has to make elapsed time visible.

**A queue file is banned, by name and by any other name.** `docs/TODOs.md` was
retired 2026-08-02 and `CLAUDE.md` forbids reintroducing one "under any name."
The reason is on the record and is not about that particular file: a list of
pending items with no forcing function accumulates faster than it is read.
`docs/plan/` demonstrates the same rot inside a directory that has an owner and
a convention — two files there claimed work was "not yet implemented" for weeks
after it shipped, and eight files that were not plans at all had to be moved
out of it.

**Only the ADR tier has a lint.** `adr-links.test.ts` fails CI when a path cited
in a live section stops resolving, and requires every ADR to appear in the
architecture guide's index. No other documentation tier in this repo notices its
own staleness.

**Two very different things end up in the same list, and conflating them is the
expensive mistake.** An idea can leave the pipeline at either of two points, and
they carry opposite weights:

- It was **proposed and not researched** — most commonly because the lead had
  five deep reads that week and this was the sixth. Nothing about the idea was
  tested. Recording that as a rejection would refuse a good idea on the grounds
  that someone was busy, which is precisely the failure ADR-0009's own rows
  illustrate: "431 lines of prose" was a wrong number, not a wrong direction,
  and "the single largest unanchored rule we own" was never measured at all.
- It was **researched and rejected** — a probe ran, or a design was worked
  through with the lead, and the answer came back no. That is real evidence, it
  cost real time, and re-deriving it is exactly the waste ADR-0009 exists to
  prevent.

A ledger that treats those the same is either a veto list that suppresses
untested ideas, or a suggestion box that lets settled questions come back
forever.

## Decision

**Keep one table in this file — one row per structural bet, carrying a verdict —
and make the verdict, not the row's existence, decide whether an idea may come
back.**

Every idea `/find-big-wins` proposes gets a row, including the ones the lead
never reached.

| Column | Holds |
|---|---|
| **First proposed** | The date it was *first* proposed. Never changes, including across re-rankings — this is the column that makes age visible |
| **Claim** | One clause. The bet, not the reasoning |
| **Verdict** | `accepted` · `deferred` · `set aside` · `rejected` |
| **What was learned** | For `rejected`, the reasoning — this is the whole payload of the row. For `set aside`, one clause plus a **direction** / **magnitude** / **arithmetic** tag. For `accepted`, what the research found. Empty while `deferred` |
| **Issue** | The issue number, once the research has produced one |

### What the research produces is an issue, not a plan

An `accepted` idea is worked through by the lead and Claude, and **the artifact
that comes out is a finished issue body** — well-scoped, detailed, and assigned to
a named person. Not a design doc, not a `docs/plan/` file, not a plan.

| Who | Owns |
|---|---|
| **The lead**, in the research pass | The issue body: the constraint, what the probe measured, what was ruled out and on what evidence, the acceptance check, the blast radius |
| **The assignee** | The plan and the implementation — `PLAN.md`, `/critique-plan`, the PR (`docs/task-lifecycle.md`, ADR-0007) |

That boundary is load-bearing in both directions. Writing the plan into the issue
removes the step where the person doing the work thinks the problem through and a
critic attacks it, which is the whole mechanism ADR-0007 exists for. Omitting what
the research *learned* is the opposite failure: the assignee re-derives a probe
they never saw, and the reasons things were ruled out are exactly what evaporates.

### The four verdicts, and which of them is a bar

| Verdict | Reached | May it be proposed again? |
|---|---|---|
| `accepted` | Researched with the lead and turned into an assigned issue | n/a — it is work now |
| `deferred` | Not reviewed this run | **Yes** — carried forward and **re-ranked** against fresh ideas next run |
| `set aside` | Considered at proposal stage; **not researched** | **Yes.** The row is a record of what was looked at, not a refusal. A re-proposal carries a higher burden than a fresh idea — name what changed, or bring a materially different design — and must state whether the *direction*, the *magnitude* or the *arithmetic* was the part that was wrong |
| `rejected` | **Researched** in stage 2 and rejected, with reasoning | **No.** Do not re-propose, and do not re-derive it. This row is a bar, and it is the only one that is |

**`rejected` is the only verdict that closes a direction**, and it is earned by a
deep dive rather than by a busy week. That asymmetry is the whole design.

Three rules keep the table from becoming the thing it replaces:

1. **A row holds one clause, never content.** The exception is `rejected`, whose
   reasoning *is* the payload and may run to a few sentences. Everything else —
   the design, the probe, the acceptance criteria — lives in the stage-3 issue.
   Prose growing inside an `accepted` or `deferred` cell is the smell.
2. **`deferred` is re-ranked, not queued.** Every run, `/find-big-wins` pulls the
   deferred rows back into that run's ranking against fresh ideas. An idea does
   not keep its position, and there is no order in this table.
3. **Carried more than twice is a finding.** The skill reports it ahead of its
   proposals, and the outcome is a decision either way — `set aside` if it keeps
   losing on merit, or a capacity finding about the review ceiling if it keeps
   not being reached. Nothing sits in `deferred` indefinitely, which is exactly
   what the spike did.

**Rows are never deleted.** A `deferred` row's verdict is updated in place when
the lead decides; its first-proposed date is not.

**`/find-big-wins` writes its own rows.** The skill holds `Edit` for this file
and nothing else. It also holds `Bash`, so nothing mechanical keeps it inside
that grant — the scoping is prose in the skill's own body. The alternative was a
paste-ready row the lead applied by hand, which makes the ledger's completeness
depend on a manual step at the end of a long session.

### The ledger

*Empty. `/find-big-wins` has not been run.*

| First proposed | Claim | Verdict | What was learned | Issue |
|---|---|---|---|---|

## Alternatives considered

| Option | Why rejected | Evidence |
|---|---|---|
| **A `docs/ideas/` folder** | It is a queue file with a directory around it. `CLAUDE.md` bans reintroducing one "under any name" after `docs/TODOs.md` was retired, and `docs/plan/` shows the failure mode inside a directory that *has* a convention — two files claimed pending work that had shipped, and eight non-plans had to be moved out. It would also be the only place in this list with no lint | `CLAUDE.md` § "Deferring work creates an issue, not a file entry"; `CLAUDE.md` § "Repository layout", the `docs/plan/` entry |
| **Add the table to ADR-0009** | Different contract, and mixing them breaks the one that works. ADR-0009 is scoped to agent-design claims **refuted by measurement**, and owns the six-constraint list for the `same_person` write boundary; three consumers read it as a do-not-re-derive guard. A `deferred` or `set aside` bet nobody has tested is not a refuted claim, and filing it there would make that guard read as a veto over untested ideas | ADR-0009 § "Decision" and its "Read before you" line; `.claude/agents/task-reviewer.md` and ADR-0006 both cite it as a guard |
| **Treat *every* row as a record, never a bar** | The first draft of this ADR. It is right for `deferred` and `set aside` and wrong for `rejected`: a rejection that cost a probe and a working session is evidence, and re-deriving it is the exact waste ADR-0009 was written to stop. Splitting the verdict was cheaper than either extreme | ADR-0009 § "Context" — claims "came back, proposed again, by a different reader, from the same evidence, because nothing recorded that they had already been tried" |
| **Treat every row as a bar** | Suppresses ideas on the grounds that the lead was busy. Most rows will be `deferred` against a five-per-week read ceiling, and ADR-0009's own tables show how often the thing refuted was a number rather than a direction | ADR-0009 rev. 1 table: "431 lines" was the whole file against a 17-row table; "the single largest unanchored rule we own" was unmeasured |
| **Leave it in the skill's report only** | No memory across runs. The skill would re-derive every carried idea weekly, which is the expensive half of the pass, and an unreviewed idea would age invisibly — the precise failure ADR-0009 records for the routing-as-a-tool spike | ADR-0009, rev. 1 table: "Demoted to a P2 spike" that was never run |
| **A GitHub issue per idea, with an `idea` label or a board column** | An untested bet with an issue number reads as a commitment, and `/fill-ready` would rank it against real work every day and it would lose every day. The board already carries 217 open issues; the pool that exists for *decided* candidates with no scheduling decision is `icebox`, and these are a stage earlier than that | `.claude/skills/review-icebox/SKILL.md` § "Review the icebox"; `gh issue list --state open --limit 500 -q length` → 217 on 2026-08-09 |
| **Freeze rows, classic-ADR style** | A `deferred` row exists to be updated — that is its function. Freezing would force an append-only history of the same idea across runs, which is the shape `docs/adrs/README.md` rule 3 rejected for exactly this reader | `docs/adrs/README.md` rule 3 |
| **Require a headline metric before a row is written** | It filters out the structural ideas specifically. A consolidated guardrail system's win is one mechanism instead of four, which has no numerator | Argued, not measured — the failure it prevents is stated in `.claude/skills/find-big-wins/SKILL.md` § "The bar" |
| **Make the research produce a design doc in `docs/plan/`, which the issue then cites** | Two artifacts where one will do, and the second rots: `CLAUDE.md` requires a plan's `**Status:**` line to be maintained and records two files there that claimed unbuilt work for weeks after it shipped. It also blurs the boundary — a design doc written before assignment is most of a plan, and the plan is the assignee's | `CLAUDE.md` § "Repository layout", the `docs/plan/` entry; ADR-0007, which makes the plan the implementer's artifact |
| **Have the lead paste the rows in by hand** | Makes the ledger's completeness depend on a manual step at the end of a long working session, and an unwritten row is indistinguishable from a run that never happened. Granting the skill `Edit` scoped to this one table costs less | Argued, not measured; the risk it replaces is stated under Consequences below |

## Consequences

**Gains.** An idea that is proposed and not decided ages in public, with a date
that grows. The next run starts from a list instead of a re-derivation, which is
the expensive half of the pass. A researched rejection closes a direction once
and stays closed, while an untested idea stays live — so neither failure mode
this ADR's Context describes can happen quietly. And the table lands in the one
tier that fails CI when its pointers rot.

**Costs, knowingly accepted.** The table grows and is never pruned, so it gets
longer and less navigable, exactly as ADR-0009's does. This ADR also holds a
small amount of **live state**, which is not what the tier is for — an ADR
records a decision, and this one records a decision *and* the running consequence
of it. That was judged better than a fifth documentation tier or a second queue
file. Finally, `/find-big-wins` holds `Edit`, which is a wider grant than its
four sibling board skills have; the scoping to this one table is prose in the
skill's own body, and nothing mechanical enforces it.

**Risks.** The one that matters is a `set aside` row being cited to refuse a
re-proposal — the verdict split is the defence, and it is a convention nothing
can check. The mirror risk is a `rejected` row that was wrong: a rejection is a
claim like any other, and the reasoning column is what lets a reader disagree
with it on evidence rather than on instinct. Correct such a row in place with the
new evidence; do not delete it. Third, the table can drift into a queue if work
content leaks into an `accepted` or `deferred` cell.

## Enforcement

> `packages/engine/mcp-server/tests/packaging/adr-links.test.ts` — this file's
> required fields, every repo path in its **Applies to** and **Enforcement**
> lines resolving, and its presence in `docs/architecture.md`'s ADR index.

> `packages/engine/mcp-server/tests/packaging/doc-links.test.ts` — the citation
> to this file from `.claude/skills/find-big-wins/SKILL.md` must resolve, so
> renaming this ADR breaks CI rather than the skill's carry-forward step.

What neither catches: that a row was written after a run at all; that a
`deferred` row is being re-ranked rather than queued; that a `set aside` row is
being read as a bar; or that the skill's `Edit` grant stayed scoped to this
table. All four are conventions, carried by
`.claude/skills/find-big-wins/SKILL.md`.

*Linted: every path in this section must resolve.*

## Revisit when

> Rows are being written but nothing has reached stage 3 in two months — the
> ledger has become a suggestion box, and either the bar or the review ceiling
> is the real problem.
>
> Or: a `rejected` row is shown to be wrong. Correct it in place with the new
> evidence and flip the verdict; do not delete it, because the reasoning is what
> the next reader needs in order to see why it was reversed.
>
> Or: the table passes roughly 40 rows, at which point "read the ledger first"
> stops being a cheap step and the pruning question this ADR deferred has to be
> answered.
