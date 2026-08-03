---
name: fill-ready
description: Use when the lead wants the day's work chosen off the cowork-genealogy kanban board — "what should the team work on today", "fill the Ready column", "review the backlog", "groom the board", "what should I take on", or a bare "/fill-ready". The follow-on to triage-standup, which files new issues into Backlog; this skill decides which of them the team starts. Ranks the Backlog against the two committed milestones and holds Ready at three standing depths — ~10 unassigned developer tasks, ~10 unassigned genealogist tasks, 3-5 items assigned to the lead — promoting only what is unblocked and swapping a lower-ranked item back when a pool is at target. Routes by seniority before priority: the team's developers are juniors working with Claude Code, so senior-required work goes to the lead. Gates the developer shortlist through review-ready before promoting. Labels, splits, and grooms; verifies claims against the repo first. Proposes, then applies only what the lead approves; never starts the work.
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

# Fill the Ready column

`triage-standup` puts new issues into Backlog. This skill decides which of them
the team actually starts today, hands the lead the few that need his authority,
and proposes what to clear out. It is the second half of the same morning.

**You propose, then apply what is approved. You never start the work.** No
branches, no PRs, no code edits, no eval runs. You have no `Edit` or `Write`
tool for exactly that reason — a session that starts implementing halfway down
the list never finishes the grooming.

## 0. Board facts

Repo `PioneerAIAcademy/cowork-genealogy`, project **1**.

```sh
PROJ_ID="PVT_kwDOC-DkVc4BUEYb"
STATUS_FIELD="PVTSSF_lADOC-DkVc4BUEYbzhBPBf8"
# Backlog 0207fe08 / Ready f75ad846 / In Progress 47fc9ee4 / Review 4dc1cd86 / Done 98236657
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 1000
```

Each item carries `id` (the item id you need to move it), `content.number`,
`status`, `assignees`, `title`, `labels`.

**Re-read the board immediately before you apply anything.** The lead edits it
while you work — in one session nine items moved to Ready and 23 assignments
were cleared between the opening read and the write-back. A snapshot taken at
the start of a long analysis is stale by the end of it.

Two labels carry the routing:

| Label | Means here |
|---|---|
| `developer` | Lints, CI, validators, harness/Python, MCP tools, refactors, tooling bugs — anything with a mechanical pass/fail |
| `genealogist` | Fixture adjudication, run-log annotation, record research, doctrine prose, prepared doctrine questions |

**Exclude `label:icebox` from the Backlog when ranking.** Those are candidates
with no decision behind them, filed there deliberately; `/review-icebox` owns
that pool and promotes one by removing the label, at which point it ranks here
normally.

`developer` also has a second life: a CI labeler auto-applies it to any PR that
touches Python, and its description still reads "Touches Python — needs a
developer's review." That is fine on PRs and slightly wrong on issues. Don't
re-litigate it; just know the label is doing two jobs.

**Label only. Never set an assignee on a team member.** People self-serve from
Ready and the lead hands work out at standup. The only assignee this skill ever
*adds* is `DallanQ` (§6).

One exception, and it runs the other way: **remove an assignee whose role does
not match the label.** `.claude/skills/triage-standup/references/roster.md`
carries a role column — check it before you believe an existing assignment. A
genealogist holding a `developer`-labeled harness issue is a mis-route, not a
choice; unassign, leave the label alone, and put a line in the body naming what
that person knows that the next taker will need. (This happened with issue
#1023: the genealogist who found a silent grading-credential failure was
assigned the Python fix, and only he had the broken-key window.)

## 1. Measure Ready depth before you rank anything

Ready is a **self-serve menu held at a fixed depth**, not a queue sized to who
happens to be free today. Developers and genealogists pick from it; the lead
picks his own work from it too. Three pools, three standing targets:

| Pool | Target |
|---|---|
| Unassigned **`developer`** items in Ready | **~10** |
| Unassigned **`genealogist`** items in Ready | **~10** |
| Items assigned to **`DallanQ`** in Ready | **3–5** (§6) |

```sh
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 1000
```

Count each pool **separately** — an item's label decides which target it counts
against, and a pool at 16 while the other sits at 8 is invisible in a combined
total. Assigned items do not count toward the two unassigned targets; someone is
already on them.

**Do not size promotions to free people.** An earlier version of this skill
targeted "free people plus a buffer" and concluded that 19-of-21 busy meant
promote zero. That is wrong: busy people finish, and the menu has to be stocked
when they do. How many people are idle right now is not the question. Report
In Progress / Review counts if they are interesting, but never let them set the
number.

### Promotion is a swap, not an addition

At or above target, a Backlog item enters Ready **only** by outranking something
unassigned already there — and then the loser goes back to Backlog **in the same
pass**. Never push a pool past its target to fit a good issue in; say which item
it displaced and why.

Below target, promote freely up to the target, best-first.

Over target with nothing better in Backlog, the whole day's move is draining
back down. State the arithmetic either way so the lead can overrule it:

> Ready holds 11 unassigned `developer` (target 10) and 16 unassigned
> `genealogist` (target 10). Promoting 2 developer and 1 genealogist; returning
> 4 developer and 7 genealogist — net −8, both pools land on 10.

**Promoting zero is a valid answer** when both pools are at target and nothing in
Backlog outranks what is there. Say so plainly rather than padding to a number.

### What loses a swap

Rank the unassigned Ready items with the same §2 heuristics you rank Backlog
with. What tends to lose:

- An item whose body is a bare pointer to a plan doc — it cannot be chosen off a
  menu without opening something else.
- An item that is really a question, not a task ("I'm not sure if this is an
  issue… worth an investigation") — that is Gate 2, and it belongs to the lead.
- Surplus from a **homogeneous pool**. When one batch supplies many
  interchangeable tasks (the 32 record-hint `test <slug>` adjudications), keep
  enough for real choice — about half a pool's target — and return the rest.
  Nothing distinguishes them on merit, so trim **oldest-first-kept**: return the
  highest issue numbers, so the longest-waiting stay pickable.
- Anything the team should not start until a gate lands. If a Backlog item is
  about to make a pool's output verifiable (an ark requirement, a validator),
  every task it gates that gets done first produces work nobody can check.

Staleness is a signal, not the rule: an unassigned item untouched for two weeks
is usually losing on merit anyway, but being **outranked at target** is what
returns it.

### Seniority routes the item before priority does

**Anything that needs a senior developer goes to the lead — never into the
unassigned pool.** The team's developers are juniors working with Claude Code.
The unassigned `developer` pool is therefore a **junior** pool by definition, and
a senior-required item sitting in it is worse than one sitting in Backlog: it
looks pickable, and whoever picks it produces a green, plausible, wrong change.

Decide seniority **first**, then rank. A high-priority senior item does not win a
place in the unassigned pool by being important; it wins a place in the lead's.

**Junior-safe with Claude Code** — all of these, not most:

- The issue names the file, the line, and the change.
- The blast radius is one or two files, or a mechanical sweep of many.
- Correctness is checkable by something that runs: a test, a lint, a validator,
  a type error.
- No design fork left open, and no invariant spanning subsystems that has to be
  held in your head to get it right.

**Senior-required** — any one of these is enough:

- The issue itself says so ("this is not a beginner task").
- It inverts or replaces an existing mechanism, so a wrong version is *worse than
  today* rather than merely incomplete (process-group teardown, a permission
  gate, an interrupt path).
- It spans subsystems that cannot be tested together — harness and hosted server,
  engine and plugin, CI and the release process.
- Correctness rests on judgment nothing checks, so the failure mode is
  **green and wrong**.
- It commits real money or a doctrine position (a paid measurement design, a
  retention rule that deletes tracked artifacts, a model/effort sweep).
- The obvious implementation is already known to be wrong, and the issue's own
  measurement says so — someone has to design past it.

That list is the repo's existing **`senior` label** description. Apply the label
when you route an item here, so the routing is visible on the board and not only
in your report. `task-reviewer`'s `senior` verdict is the authoritative version of
this same test — yours is the cheap pre-filter that decides what reaches it.

**Report the mix every time.** Count the Backlog's developer-oriented issues into
*junior-safe and unblocked*, *junior-safe but blocked*, *junior after one decision
from the lead*, and *senior*. That ratio is the health metric for the junior pool:
when the unblocked-junior count is smaller than what the team burns in a week, the
pool is about to run dry, and the cheapest fix is usually the lead answering the
Gate-2 questions that convert senior items into junior ones. Say that in the
report — it is more actionable than the promotion list.

### Arrival vs. closure — the trend that outranks the day's move

Ranking cannot fix a board where work arrives faster than it leaves. Measure
both, every run, over the last four weeks:

```sh
for w in 1 2 3 4; do
  a=$(date -v-${w}w +%Y-%m-%d); b=$(date -v-$((w-1))w +%Y-%m-%d)
  echo "$a..$b  filed: $(gh issue list --repo PioneerAIAcademy/cowork-genealogy --state all --limit 500 --search "created:$a..$b" --json number -q 'length')  closed: $(gh issue list --repo PioneerAIAcademy/cowork-genealogy --state closed --limit 500 --search "closed:$a..$b" --json number -q 'length')"
done
```

Baseline measured 2026-08-01, for comparison only — recompute, never quote it:
the board ran at equilibrium (~17 filed / ~17 closed per week) through late July,
then an audit wave pushed open issues to 118 with ~90% of them filed in two
weeks. Median cycle time was 7 days, p90 37.

When arrival exceeds closure for **three consecutive weeks**, say so at the top
of the report with the arithmetic, and name the three levers plainly, because
none of them is this skill's to pull: raise throughput, cut scope from a
milestone, or stop a discovery stream (an audit, a sweep). Note which streams are
*permanent* — alpha feedback already is, and beta will add a second — so a plan
that assumes the wave subsides on its own is wrong.

## 2. Rank the Backlog

### The two dates the ranking serves

The board is not ranked in the abstract. Two committed dates decide what
"important" means, and both are external — neither moves because the backlog is
full (`docs/sponsor-status-update.html`, slide 11):

| Milestone | When | What changes |
|---|---|---|
| **Beta** — wider in-house users, all roles and skill levels | **Oct–Nov 2026** | People outside the senior-genealogist alpha use it without an expert watching |
| **Public rollout** at RootsTech | **2027-03-04** — a fixed conference date, confirmed by the lead 2026-08-01. It cannot slip a week to absorb an overrun | Strangers use it, including the Temple open-house helpers |

Compute the slack at the top of every run — urgency has to be live, not a
number frozen into this file:

```sh
python3 -c "import datetime;d=datetime.date.today();print('beta slack:',(datetime.date(2026,11,1)-d).days//7,'wks | rootstech slack:',(datetime.date(2027,3,4)-d).days//7,'wks')"
```

### Which items gate a milestone

**Re-derive membership every run; never trust a list of issue numbers, including
the one below.** This repo's issues go stale in days (§8), and a gating set
copied forward becomes wrong exactly when it matters. Derive it by asking the
milestone's own question:

- **Beta gate** — *would a non-expert user hit this, or would we be unable to
  tell that they had?* That covers a trustworthy quality signal, silent failure
  modes, guardrail holes reachable without expertise, and the delivery vehicle
  actually shipping. Today that is the compliance-detector calibration
  (issues #998 / #999 / #1006), halt-on-tool-layer-loss (issue #941), and the
  Electron release blocker (issue #1070).
- **Public-launch gate** — *does a stranger's use, at volume and unsupervised,
  break the product or us?* That covers untrusted input reaching a
  write-capable agent, seeing quality for real users rather than fixtures, the
  grader being trustworthy, and unit economics. Today that is prompt-injection
  defense (issue #847, unstarted), the production tool-call ledger (issue
  #1054), and judge calibration (issue #1090).

`docs/agentic-system-critique.md` §3 is the current map of this work and its
sequencing; read it before ranking, and treat its own claims per §8 — it is a
document, not repo state.

**Instrument before fix.** An item that restores a broken measurement outranks
the fixes that measurement is supposed to evaluate — that is already heuristic 2
below, and it is doubly true against a deadline: quality work done while the
quality signal is uncalibrated cannot be shown to have worked, so it buys a date
nothing.

Read every Backlog title. Read the **bodies** only of the plausible candidates —
usually 10–20 of them. Ranking heuristics, in order:

1. **Live harm shipping to users now.** Silent data corruption, a wrong
   conclusion reaching a user, a guardrail hole in a production path. These
   outrank everything, including work that is cheaper.
2. **Anything that makes a number untrustworthy.** Ground truth, the judge, the
   verdict, the gates that override the judge. When measurement is broken, work
   downstream of it is speculative — and the team will keep filing issues
   against numbers that do not mean what they say.
3. **Highest impact on research success or performance.** Does landing this make
   the agent reach a *right* answer it currently misses, or reach the same answer
   *faster or cheaper*? A search that dead-ends on a narrow locality, a skill the
   router sends the wrong question to, an unbounded hunt that burns a two-hour
   cap — these change what the product does. Rank on that, not on effort.
4. **Everything else.**

### Critical path beats rank when the slack runs out

The four heuristics rank by **value**. Milestones add **time**, and the two
disagree in one specific case you must catch: an item that gates a date, whose
remaining lead time is longer than the slack left to that date. Doing that item
later is not doing it later — it is not doing it.

So, after ranking: for each milestone-gating item, estimate the lead time
honestly, including the parts that are not coding — a doctrine call the lead has
to make, a spec that has to survive review, a paid eval run, a genealogist
annotation pass, senior review of a junior's PR. If lead time exceeds slack, it
goes to the top of its pool this week whatever the four heuristics said, and the
report says which higher-ranked item it displaced.

**Long-lead work starts a milestone early, not when it becomes urgent.** The
standing example is prompt-injection defense (issue #847): it gates the public
rollout, not beta, so it loses every impact ranking today — and its junior half
cannot begin until a senior settles the doctrine, which means an item that
"isn't due until March" has to enter the lead's pool in the fall or it will not
land at all. A pure impact-ranker promotes it the week it is already too late.
When you find one of these, say so in the escalation line, not in a footnote.

**Cheapness is a tiebreaker, not a rank.** An issue that names the file, the
line and the change is worth more than its size suggests — *between two items of
comparable impact*. It never promotes a low-impact item over a high-impact one.
Unblocked-and-high-impact usually wins; cheap-and-unblocked is fine every once in
a while, so cap it at **one** such item per fill and say that is why it is there.

This was rank 3 until 2026-08-01, and the failure it produced is the one to
watch for: a lint-hardening item (#1014, a loose substring matcher in a lint that
had shipped the day before) was promoted over #945 and #1085 purely for being
cheap, unblocked and independent of an open policy call. Zero research or
performance impact. The correction the lead gave, verbatim: *"I'm ok with cheap
and unblocked every once in a while, but unblocked and high-impact usually wins."*

**Say the impact out loud for every promotion.** One clause naming what it makes
better — a right answer reached, a wrong one prevented, wall-clock or spend
recovered. If that clause comes out as "it's small and nothing blocks it," the
item has not earned the slot; find the one that has.

Deprioritise, explicitly and out loud: anything downstream of a broken
measurement (assigning it buys numbers nobody can read), and anything whose
cost is a paid eval run that a nearby issue is about to spend anyway.

## 3. The three gates — nothing enters Ready that fails one

A Ready item must be startable *today* by one person who reads only that issue.
Check all three. They fail differently and the distinction matters.

### Gate 1 — hard blocker

The task's answer is unknowable, or its work would be thrown away, until
something else lands.

Read the body for the language this repo actually uses: "Blocked on…",
"Prerequisite:", "Wait for #N", "land this after…", "X must land first",
"Settle that first". These issues are unusually good at stating it — trust the
prose, then **verify the blocker's real state.**

Checking that the blocker issue *exists* is not enough. Confirm it is genuinely
done: closed **and** the work reachable on main.

```sh
gh issue view <blocker> --repo PioneerAIAcademy/cowork-genealogy \
  --json number,state,stateReason,closedAt
git merge-base --is-ancestor <sha> origin/main   # a PR merged into a feature
                                                 # branch is closed and still unshipped
```

Also check *why* it closed. One issue was closed in a sweep as "low value,
nobody has hit it since July" while a newer issue documented the same root cause
producing silent data corruption. A closed blocker whose closing rationale is
contradicted by newer evidence is not a cleared blocker — it is a finding.

**A hard blocker disqualifies the item.** Leave it in Backlog and name the
blocker in your report.

### Gate 2 — unanswered question inside the issue

An issue that ends with "open sub-questions for whoever takes it", or offers two
designs without choosing, is **not Ready** regardless of its dependencies. A
junior handed it either guesses at a decision that was the lead's, or stalls.

These are not blocked on a task — they are blocked on the lead. Route them to
§6 as a decision, and note that answering unblocks a Ready-able task. That pairing
is often the strongest argument for the lead's own queue.

### Gate 3 — soft collision (does *not* disqualify)

Two items that edit the same files, or contend for the same paid eval run, are
sequenced, not blocked. Promote them — but the pairing has to survive into the
issues themselves, because the two people who pick them up will never read your
report.

**Write a reciprocal note at the top of both bodies** — below a `> **Reviewed …**`
marker if `/review-ready` already left one — in the lead's own form:

```
**IMPORTANT**: If you do this, do #999 at the same time.
```

Both directions, every time. A one-sided note means whoever picks up the other
issue learns nothing — which is the whole failure you are preventing.

```sh
gh issue view 998 --repo PioneerAIAcademy/cowork-genealogy --json body -q .body > body.md
# prepend the line to body.md, then:
gh issue edit 998 --repo PioneerAIAcademy/cowork-genealogy --body-file body.md
```

Match the wording to the relationship:

| Relationship | Note on each |
|---|---|
| One change split in two — do together | "If you do this, do #N at the same time." |
| Same files, must be ordered | "Do #N first — it threads the same five write paths." |
| Contend for one paid eval run | "Batch with #N — landing them separately costs two runs." |

Then say it in your report as well, so the lead can hand both to one person.

## 4. Split before you promote

A Ready item should be one person's task, start to finish. If it has two halves
that different people would do — or a cheap measurement that decides whether the
expensive half is needed at all — split it **before** promoting.

The worked case: one issue asked for (1) verify on a Windows box whether Ctrl-C
kills in-flight processes, and (2) if it doesn't, re-architect the harness onto
owned subprocesses. Step 1 is thirty minutes on a machine only the genealogist
team has. Step 2 inverts how interrupts work and the issue itself warned it was
not a beginner task. Combined, it was assignable to nobody. Split, step 1 became
a same-day genealogist task whose *outcome decides whether step 2 is ever
funded*.

Split when any of these holds:

- **Two disciplines.** One half is `developer`, the other `genealogist`. Being
  unable to pick a single label is the tell.
- **A measurement gates a build.** "Check X; if X fails, build Y." Y is
  speculative until X is answered, and X is usually cheap. Almost always split.
- **Two skill levels.** A junior-safe half, and a half the issue itself flags as
  not a beginner task.
- **Different sequencing.** One half is unblocked today, the other waits on
  something else. Promoting the whole thing strands the ready half.

Do **not** split for size alone. Three edits to one file by one person is one
task; splitting it triples the review and merge cost for nothing.

How:

```sh
gh issue create --repo PioneerAIAcademy/cowork-genealogy \
  --title "..." --body-file <file> --label genealogist
```

Then rewrite the parent so it describes only what remains:

- Open it with a dated scope note — what moved out, and to which issue.
- Retitle it if the old title now oversells what is left.
- State the sequencing explicitly ("wait for #N before funding this").
- **Carry across every constraint the original stated.** A warning that only made
  sense in the combined issue is exactly what gets dropped, and it is usually the
  trap that made the work hard in the first place.

Promote only the ready half. The remainder stays in Backlog with its blocker
named. If the two halves must instead be done together, that is Gate 3 — give
them reciprocal notes.

## 5. Label and promote

For each promoted item, add exactly one of `developer` / `genealogist`:

```sh
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --add-label developer
```

**Leave it unlabeled when it is genuinely both or genuinely contested**, and say
why in one line. One issue's fix could have been skill prose or a harness change
and a second open issue disputed which — labeling it would have picked a side
the board had not picked. Unlabeled with a reason beats a confident wrong label.

Then move it:

```sh
gh project item-edit --id "$ITEM_ID" --project-id "$PROJ_ID" \
  --field-id "$STATUS_FIELD" --single-select-option-id "f75ad846"
```

Verify with a fresh `gh project item-list`. New issues land in Backlog via an
auto-add workflow that sets nothing else — a freshly filed issue that belongs in
Ready still needs this move.

**Gate the unassigned `developer` shortlist through `/review-ready` before you
promote it.** Your seniority test (§1) is a pre-filter read off the issue body;
that skill fans out one agent per item to check the same call against the cited
code, the architecture guide's site list, and §9.4's what-nothing-checks list —
which is where a "junior-safe" item turns out to hide an open API decision.

Promote what comes back `ready` or `ready-after-edit`. A `senior` or
`needs-a-decision` verdict is a §1 miss caught in time: route it to the lead's
pool (§6) instead, and it never enters the junior pool at all. Running the gate
after promotion instead works, but pays for the same deep read twice — see
`docs/specs/task-review-spec.md` §2.

## 6. The lead's pool — 3–5 assigned, in Ready

His pool is the third target from §1, and it works exactly like the other two:
hold it at **3–5**, and add only by swapping.

What qualifies is **cross-cutting development work that is unblocked** and
either high-priority in its own right or unblocking other high-priority issues:
architecture spanning several subsystems, doctrine calls, spend decisions,
anything overriding someone else's work, security triage, and the Gate-2
decisions from §3.

**He is also the only senior developer**, so §1's seniority test routes here:
every senior-required item is his or it is nobody's. That produces more senior
work than five slots hold — which is fine. Senior work **waits in Backlog**; what
it must never do is sit unassigned in Ready looking pickable. When his pool is
full, say plainly which senior items are queued behind it and in what order.

Prefer, among equally-ranked candidates, the ones that **convert senior work into
junior work** — a Gate-2 decision that unblocks a well-specified task is worth
more than a bigger item that unblocks nothing, because it feeds the pool the rest
of the team picks from.

### Reserve at least half his pool for the milestones

**This pool, not the two junior pools, is what decides whether the dates are
met.** Nearly every milestone-gating item is senior-class by §1's test — a
doctrine call, a gate that is worse wrong than absent, a design spanning harness
and hosted server — so it is his or it is nobody's, while the junior pools do
alpha content work that cannot stop and does not burn these down.

So: **at least 2 of the 3–5 are milestone-gating** — for the nearest milestone,
or a long-lead item for the one after it. Below that, propose a swap that
restores it and say which non-gating item you are returning.

Two failure modes to name out loud when you see them:

- **A pool full of interesting architecture that gates no date.** Every item
  defensible on its own merits, no date moved. This is the likeliest way the
  fall is lost, because nothing about it looks like a problem week to week.
- **The critical path not moving.** If no milestone-gating item has entered *or
  left* his pool across two consecutive fills, that is the loudest line in the
  report — ahead of the promotion table. Say which item has been sitting, for how
  long, and what it is waiting on.

When he is at 5 with all five gating, that is the right shape; say so and
propose zero.

Rank by **how much each unblocks, not by its own size.** An issue that gates
three others outranks a larger one that gates nothing. That is usually the whole
argument — make it explicitly:

> #972 — splitting the verdict axes. Unblocks reading #963, #913 and #911;
> until it lands nobody can read a pass count.

Count what he already holds in Ready before proposing anything:

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --assignee DallanQ \
  --state open --limit 100 --json number,title
```

At 5, propose a **swap** with the reason, never a silent addition:

> You hold 5. I'd return #987 to Backlog (waits on a decision in #976 anyway)
> for #940 — a production path is shipping wrong conclusions with no signal today.

The swap is the same shape as §1's: the loser goes **back to Backlog**, and it
stays assigned to him unless it is no longer his to make. Below 3, top it up
from Backlog best-first. If nothing new outranks what he holds and he is inside
3–5, propose **zero**.

For each one, give the dependency chain: what must land first, and what it
unblocks. His items are allowed to have blockers — that is often the point of
them — but he should never be surprised by one.

**Assign and move to Ready** — both, in that order. He picks his own work off
Ready like everyone else; the assignment is what keeps it out of the unassigned
pools and what carries it into a session that has none of today's conversation.

```sh
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --add-assignee DallanQ
gh project item-edit --id "$ITEM_ID" --project-id "$PROJ_ID" \
  --field-id "$STATUS_FIELD" --single-select-option-id "f75ad846"
```

One thing that does **not** belong in his pool: an issue with an empty or
one-line body. It is unactionable in a fresh session no matter who owns it.
Leave it in Backlog and ask him for a scope line — that is §7's `rewrite`
verdict, not a promotion.

## 7. Grooming

Same read, nearly free. Cap it at about **eight** proposals — a grooming list
longer than the promotion list means the day's output was grooming.

Candidates: empty-bodied issues months old; issues superseded by a newer, better
one; issues whose premise the team has since abandoned; duplicates. Give one
line of reasoning each, and a verdict — **close / rewrite / delete / leave**.

Default to **close as not planned with a one-line reason** — it is reversible and
preserves the rationale.

```sh
gh issue close <N> --repo PioneerAIAcademy/cowork-genealogy \
  --reason "not planned" --comment "<why>"
```

**Deletion is irreversible and needs the lead to say so for that specific
issue.** Never batch a delete under a general approval, and never infer one from
"clean this up." Note that deleting destroys the rationale along with the issue.

## 8. Verify before you repeat anything

Inherited from `triage-standup` §2, and it earns its cost here too. An issue
body is **a claim written on a particular day**, not current repo state. The
sharpest findings in a real run were both stale issue bodies:

- An issue proposed a fix "also fixes #609" — #609 had been closed hours
  earlier, on reasoning the proposing issue's own evidence contradicted.
- A retention issue measured "147MB tracked"; `du -sh` said **269MB**. It had
  nearly doubled in twelve days, which changes the priority, not just the number.

**Read the code behind every issue you form a view on** — not just the ones you
are promoting. This repo moves fast enough that an issue body is usually written
against code that has since changed, and the stale half is normally the part the
recommendation rests on. Standing instruction from the lead, 2026-08-01: *"A lot
of code has changed since the issues were originally written. They are likely
based on old assumptions or code."*

That is a real cost, so spend it where it changes an answer: the promotion
candidates, the lead's pool, and **any issue you are about to recommend a
disposition for** (split, consolidate, close, or route to the lead). Skimming a
title is never enough to close or consolidate.

```sh
grep -n "<the symbol or line the issue cites>" <path>   # does the cited code still exist?
gh issue view <cross-referenced N> --json state,stateReason
du -sh <path>                                            # do the cited measurements hold?
git log --oneline -5 -- <cited path>                     # did someone already fix it?
git log --diff-filter=D --all -- '<cited path>'          # was it deliberately deleted?
```

**Read the mechanism the issue proposes to build, before agreeing it needs
building.** A near-miss extension of something that exists is a different,
smaller, safer task than a new mechanism, and finding that out changes the
disposition rather than a detail. Worked cases:
`docs/specs/task-review-spec.md` §7.

**Do not repeat this read for the shortlist you are about to gate.**
`/review-ready` (§5) does it per issue in fresh context, which is the point of
the fan-out. Spend §8 here on what the gate never sees: the items you are about
to close, consolidate, split, or route to the lead.

Cite so the lead can re-check in seconds: `file:line`, an issue number, a
command and its output. When a check refutes something you already said, correct
it in one sentence and move on. When it refutes the *issue*, say so in the issue
— a stale body left unannotated will mislead the next reader exactly as it
misled you.

## Repo-specific costs to respect

**A paid eval run is the hidden price of most eval fixes.** Editing a skill body,
a rubric, or a test file flips that skill's run log inactive, so landing it needs
a fresh `--skill <name>` run plus a genealogist annotation — roughly $8–12 and
45–65 minutes of machine time, plus real human hours. So:

- Two Backlog items touching the same skill are **one** promotion, to one person.
  Say it.
- A one-line fix that costs a full run should ride along with a run already being
  spent. Name which.
- Never propose a standalone one-line eval fix without naming its run cost.

**Label every reference.** "issue #995", "PR #994" — never a bare `#994`. GitHub
numbers issues and PRs from one sequence, so a bare number sends the reader to a
list it does not appear in. Add state when it matters.

## Output shape

0. **Milestone standing** — first, and short. Slack to each date in weeks; which
   gating items are in flight, which are queued behind the lead's pool, and
   whether the critical path moved since the last fill. If it did not move for a
   second consecutive fill, or a long-lead item is inside its lead time and not
   started, that sentence goes here and nowhere else — it is the reason the
   report exists on a week when the promotions are routine.
1. **Ready depth** — the three pools against their targets, and the net move for
   each. Show the arithmetic.
1b. **Seniority mix** — the Backlog's developer issues split junior-unblocked /
   junior-blocked / junior-after-a-decision / senior, and whether the junior pool
   is about to run dry. Add the arrival-vs-closure line for the last four weeks,
   flagged if arrival has led for three.
2. **Splits** — anything you broke in two, and which half is going to Ready. Skip
   the heading if you split nothing.
3. **Promote to Ready** — a table: issue, the **impact clause** from §2 (what
   right answer it wins, what wrong one it prevents, what wall-clock or spend it
   recovers), the milestone it gates (or `—`), `developer`/`genealogist`, what it
   displaced (if the pool was at target), and any soft-collision partner. Most
   consequential first — and if any row's impact clause reduces to "small and
   unblocked", it is the one cheap slot, or it should not be in the table.
4. **Return to Backlog** — what lost each swap, with the one-line reason.
5. **Yours** — the 3–5 pool: what to add, what to return, each with what it
   unblocks and its own dependency chain, and how many of the 3–5 are
   milestone-gating (§6 wants at least 2).
6. **Held back, and why** — the items that failed a gate, named with the gate.
   This is the section that stops the lead re-asking about them tomorrow.
7. **Grooming** — capped, with verdicts.

Then stop and wait for approval. Apply only what he approves, re-reading the
board first. Do not begin any of the work.
