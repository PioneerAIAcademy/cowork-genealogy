---
name: find-big-wins
description: Use when the lead wants structural bets rather than the next increment — "find the big ideas", "what would change the shape of this system", "we keep hill-climbing", "what should we stop doing", "propose something structural", or a bare "/find-big-wins". Run it after /audit-board and consume that pass rather than repeating it. Reads three layers — the board as a symptom of recurring cost, the repo's own measured evidence (the e2e corpus, run logs, annotations, judge audits, feedback, the `nothing-checks` register, the ADRs), and deliberately OUTSIDE the repo, because internal evidence shows where the walls are and can never show the next hill. Also works the `needs-decision` queue — items blocked on one answer from the lead, which this skill converts into issues a junior can take. Hunts subtractions as hard as additions: retiring a mechanism, dropping a guarantee, deleting a lane. Every proposal names the constraint it removes or the class of work it eliminates, what we would observe if it worked, and the cheapest probe that could kill it in a day. No target count — two or twelve or zero, ranked, with its own confidence stated. Proposes; the lead decides each idea one at a time, and the result of a deep dive is a well-scoped `cross-cutting` issue he assigns. Never starts the work and never writes the plan.
allowed-tools:
  - Read
  - Edit
  - Bash
  - Glob
  - Grep
  - WebSearch
  - WebFetch
---

# Find big wins

Nearly every issue on this board is an increment. That is not a failure of the
board — it is what a board *is*. Issues get filed by people who just hit
something, and every mechanism around them (`/audit-board`, `/fill-ready`,
`/review-ready`) makes the next step better. The whole apparatus is a
hill-climber, and a hill-climber cannot see a different hill.

This skill exists to propose changing the **shape** of the system rather than
improving it one step: a structural bet that makes a class of work stop being
generated, or removes the constraint that generates it. **Scope is not limited
to code architecture.** Review topology, eval economics, team process, and what
the team is *permitted* to do are all in scope.

**Subtractions count, and are usually cheaper than additions.** Retiring a
mechanism, dropping a guarantee, deleting a lane. Hunt them (§4).

**You also clear the decision queue.** The lead assigns himself no issues — his
job is coaching juniors into seniors — so items blocked on one answer from him
pile up under the `needs-decision` label with no assignee. Working them into a
question, options and a recommendation is this skill's other job, and on most
weeks it is the larger half (§1, "The decision queue is your input queue").

**You propose, then apply what is approved.** No branches, no PRs, no code
changes, no eval runs, and **never the plan** — the person assigned the issue
writes that (`docs/task-lifecycle.md`, ADR-0007).

You hold **`Edit` for exactly one file**: the ledger table in
`docs/adrs/ADR-0010-record-structural-bets-in-a-ledger.md`. That is the whole
grant. `Bash` can write any file, so it does not widen it — editing anything else
— a skill, a spec, an issue body on disk, another ADR — is outside it even though
the tools would let you. Nothing mechanical enforces this; it is on you.

## The boundary against `/audit-board`

They read the same board and answer different questions.

| | `/audit-board` | this skill |
|---|---|---|
| Asks | What is the best handling of these issues, **given the current design**? | What change to the **design** stops this class of issue existing? |
| Moves | merge, batch, sequence, close | remove a constraint, eliminate a class, delete a mechanism |
| Output | a disposition per issue | a bet, with a probe that could kill it |

Six issues about one skill's eval slot: `/audit-board` merges them into two so
one paid run carries three. This skill asks why landing a prose edit costs a
paid run at all.

**Run this after `/audit-board`, and consume its pass rather than repeating
it.** That pass is the expensive one — it reads every open body — and it leaves
two durable artifacts you can read directly:

```sh
gh label list --repo PioneerAIAcademy/cowork-genealogy --limit 100 | grep '^cluster:'
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 100 \
  --label "cluster:next-run" --json number,title -q '.[] | "\(.number)\t\(.title)"'
```

Each `cluster:*` label is a scheduling constraint someone already found and
named. Each `next run: <skill>` issue is a queue that exists only because of the
paid-run tax — both are *symptoms already localized for you*.

The **paid-run tax table** lives only in `/audit-board`'s report, not on disk.
If the lead has this week's output to hand, take the table from it. If not, do
**not** rebuild it: derive queue depth from the `next run:` issues, and say in
your report that the tax table was not re-derived and which numbers are
therefore unavailable.

## How this run is scoped

Two invocations, because the two jobs have different cadences and should not bid
against each other for the lead's attention.

| Invocation | Does | When |
|---|---|---|
| `/find-big-wins` | Everything: §0, all three evidence layers, the subtraction hunt, the proposals | Weekly, after `/audit-board` |
| `/find-big-wins decisions` | **§0 and the decision queue only** (§1's last section). No evidence layers, no subtraction hunt, no proposals | Midweek, or any time the queue has grown |

The `decisions` run is the cheap one and should stay cheap — it prepares
questions and closes out answered ones. If you find yourself sweeping the corpus
or reading ADRs on a `decisions` run, you have drifted into the full pass.

**Producers outnumber the consumer four to one.** `triage-standup`,
`fill-ready` and `review-ready` all apply `needs-decision`, and they run daily;
this skill is the only thing that removes it. A queue that only drains weekly
grows by construction, which is what the `decisions` invocation exists to fix.

## 0. Carry forward before you look at anything new

The ledger is `docs/adrs/ADR-0010-record-structural-bets-in-a-ledger.md`. Read
its table first, every run. It is the only memory this skill has, and you are
its writer.

Four verdicts, and only one of them closes a direction:

| Verdict | Do this run |
|---|---|
| `deferred` | **Pull it into this run's ranking**, re-ranked against fresh ideas. It does not keep its old position — an idea that was third-best in a thin week is not automatically third-best this week |
| `set aside` | Considered but **never researched**. Available to re-propose, under the higher burden in §6. Not a refusal |
| `rejected` | **Researched and rejected, with reasoning. Do not propose it again, and do not re-derive it.** Read the reasoning; if you believe it is wrong, say so as a correction to that row with new evidence, which is a different act from re-proposing |
| `accepted` | It is an issue now. Nothing to do unless it is evidence for something new |

**Report any idea carried more than twice as its own finding**, ahead of the
proposals. Name it, its first-proposed date, and how many runs it has survived
without a decision. Then say which it is:

- it keeps losing on merit → propose **set aside**, so the ledger records what
  was considered and the row stops consuming a slot every week;
- it keeps not being reached → that is a capacity finding about the review
  ceiling, not about the idea, and the lead should hear it as one.

This is the whole reason the carry-forward exists. The failure it prevents is
recorded in `docs/adrs/ADR-0009-refuted-agent-design-claims.md`: routing-as-a-tool
was demoted to a P2 spike, and then nothing aged it visibly, so it sat untouched
for months and was neither run nor dropped. A row with a date that grows is
visible; an intention is not.

## 1. Layer 1 — the board as **symptom**, never as idea source

**Do not mine the board for ideas.** It is the output of the hill-climb, so
every idea already on it is by construction inside the current basin. Reading it
for proposals is how a run produces twelve incremental suggestions with the word
"structural" in front of them. The one exception is the decision queue at the end
of this section, which is not an idea source either — it is a work queue that was
handed to you.

Read it for one thing: **recurring cost**. Four shapes, all cheap:

**Cluster labels and the `next run:` issues** — above. A cluster is a
scheduling constraint someone hit repeatedly.

**The same undone thing re-filed three times.** The tell is a repeated
*sentence*, not a repeated file: "measure this before graduating," "we need to
decide X first," "this exists so we don't repeat #N." `/audit-board` merges
those. This skill asks what mechanism is missing such that three people
independently re-derived the same undone task. Its worked case is issues #911,
#980 and #1231 — three issues, one calibration, nobody sequencing.

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 400 \
  --json number,title,body,labels,assignees,createdAt,updatedAt > /tmp/bw-issues.json
python3 - <<'PY'
import json, re, collections
issues = json.load(open('/tmp/bw-issues.json', encoding='utf-8'))
pat = re.compile(r'(before graduating|measure (?:this|it) first|so we (?:don.t|do not) repeat'
                 r'|until (?:this|that) is decided|nobody (?:has )?ran|still uncalibrated)', re.I)
hits = collections.defaultdict(list)
for i in issues:
    for m in pat.finditer(i.get('body') or ''):
        hits[m.group(1).lower()].append(i['number'])
for phrase, nums in sorted(hits.items(), key=lambda kv: -len(kv[1])):
    if len(nums) >= 2:
        print(f"{len(nums):3d}  {phrase!r}  {sorted(nums)}")
PY
```

Treat that pattern list as a starting point, not a fixed vocabulary — read the
hits and widen it when the pool has its own phrasing this month.

**Issues that reopen.** Rare and near-free to check; a reopen means the fix did
not hold, which is the cleanest evidence that the *shape* is wrong rather than
the instance. `closed_at` is cleared on reopen, so REST cannot see this:

```sh
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "PioneerAIAcademy", name: "cowork-genealogy") {
    issues(states: OPEN, first: 100, after: $endCursor) {
      pageInfo { hasNextPage endCursor }
      nodes { number title timelineItems(itemTypes: REOPENED_EVENT, first: 1) { totalCount } }
    }
  }
}' --jq '.data.repository.issues.nodes[]
         | select(.timelineItems.totalCount > 0)
         | "#\(.number)\t\(.timelineItems.totalCount)×\t\(.title)"'
```

**Inflow that never falls.** `/fill-ready` measures arrival against closure over
four weeks. A stream that has led closure for a month is a permanent discovery
source, and the three levers that skill names — raise throughput, cut milestone
scope, stop the stream — are all *within* the design. The fourth lever, changing
what generates the stream, is this skill's.

### The decision queue is your input queue

This part is not a symptom read — it is work handed to you, and it is the one
place you legitimately take items *from* the board.

**The lead assigns himself no issues.** His job is coaching juniors into seniors,
so his personal pool is 0. What used to land there now sits in Backlog in one of
two labelled states, and **only one of them is yours** (`/fill-ready` § "Above the
junior pools" owns the split):

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 200 \
  --label needs-decision --json number,title,updatedAt,labels \
  -q '.[] | "\(.updatedAt[0:10])\t#\(.number)\t\(.title)"' | sort
```

**`needs-decision` is the queue you work.** Each item is blocked on one answer
from the lead, and the work behind it is frequently junior. The question is
**not** "should we do this" — `/fill-ready` already ranked it. It is: **what
exactly is the question, what are the options, and which do you recommend?**
Usually one of four shapes:

- a doctrine call, after which the rest is mechanical;
- a spec that has to exist before the code does;
- a design fork left open in the body, closable by a cheap probe;
- a blast radius nobody has written down — the trigger that most often
  disappears once it is written down.

Work these the same way you work a proposal: bring the evidence, the options, the
recommendation and the counter-argument, so he can answer in a sitting.

### You asked, he answered — close it out in the same turn

**The moment he decides, apply it. Do not carry it to a later run, a later
section of your report, or a "to write up" list.** Three writes, in this order,
before you move to the next item:

```sh
# 1. the durable record — his answer, in his words, on the issue
gh issue comment <N> --repo PioneerAIAcademy/cowork-genealogy \
  --body "**Ruling:** <his answer> — <the one-line reason, if he gave one>"

# 2. splice it into the body, so the next reader gets the decision and not the
#    open fork. gh issue view --json body -q .body > body.md, edit, then:
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --body-file body.md

# 3. the label comes off, and the item ranks in a junior pool like anything else
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy \
  --remove-label needs-decision
```

An answer you heard and did not apply is worse than one you never asked for: the
issue still reads as blocked, he sees it on the waiting list next run, and the
work sits unblocked with nobody knowing. **This is the same failure as leaving a
commit unpushed** — the thinking is done and the value is held hostage to a step
nobody can see.

**The `**Ruling:**` comment is the record, not a queue.** It exists so the next
reader — a junior picking the issue up, a later run of this skill, `/audit-board`
— sees the decision and its reasoning. It is not a signal for someone else to
finish your job.

### The residual: an answer given where nothing could act on it

It still happens — he rules at standup, or in a session with no tools, or types
a comment without the marker. Those are the only items that should ever need
finding, and finding them is the *first* thing a `decisions` run does:

```sh
# answered, never closed out. Should be EMPTY. Anything here is a session that
# heard an answer and walked away — fix it now, before preparing new questions.
#
# `test` and not `startswith`: a real ruling comment carries a heading above the
# marker and a number after it, so an exact-prefix match reports zero forever.
#
# BOTH WORDS, BOTH MARKUPS. This reads what the LEAD wrote, not what we were
# told to write. We write `**Ruling:**`; he writes `## Decision:` and
# `**Decision (lead, <date>)`. A `**Ruling`-only test missed two real rulings on
# 2026-08-13 (issues #1331, #1394) — and here a miss is silent, because this
# query reports emptiness as health.
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 200 \
  --label needs-decision --json number,title,comments \
  -q '.[] | select([.comments[].body
                   | test("(?m)^#{1,4} +(Ruling|Decision)\\b|\\*\\*(Ruling|Decision)\\b")] | any)
      | "#\(.number)  \(.title)"'
```

**A non-zero result is a defect, not a workload.** Report the count as one — "N
items were answered and left labelled" — because the fix is upstream in whichever
skill dropped it, not in draining the list faster.

Everything else under `needs-decision` is genuinely waiting on him, and is what
you prepare.

An item whose answer turns out to be "this is genuinely hard either way" moves to
`senior` instead — swap the labels, never carry both.

**`senior` is not your queue.** Those are hard regardless of any open question,
and the lead assigns them to a senior in the matching lane. You touch one only
when a *structural* proposal would eliminate it — which is a proposal, not a
conversion.

**Two numbers to report every run**, because nothing else tracks them: how many
`needs-decision` items are open, and how many were answered since the last run.
If that queue is growing, the conversion rate is the finding and it outranks the
proposals — a decision backlog nobody clears is the same failure as the old
two-slot pool, just without the slots to make it visible.

## 2. Layer 2 — internal evidence

This is where the walls are. It is measured, it is ours, and it is the half most
likely to yield a proposal whose claim you can pre-verify.

**The measured corpus.** Every one of these reads committed run logs and costs
nothing:

| Command | What it exposes |
|---|---|
| `make e2e-corpus` | the three axes, violation counts, per-arm split, per-fixture concentration. `SINCE=all` to drop the 14-day window |
| `make e2e-latency` | where wall-clock actually goes, per phase (`BY_SKILL=1` per skill) |
| `make skill-latency` | per-skill output-token profile from the unit run logs |
| `make eval-timings` | the slowest tests per suite, with why |
| `make judge-report` | rubric dimensions whose score never varies across a suite — a flat dimension grades nothing |
| `make e2e-agent-tools` | tools an agent declares and never calls — dead capability |
| `make e2e-guardrail-shadow` | what a shadow guardrail would have denied |

**Do not quote a violation *rate*.** `docs/architecture.md` §9.4 records that
the detectors are uncalibrated and no denominator is trustworthy; `make
e2e-corpus` deliberately prints counts and refuses a percentage. Quote counts,
and read the report's concentration block before quoting any total.

**The standing lists of known holes.**

- **The `nothing-checks` register** — every known way CI can be green while the
  thing is broken. **This is the single densest input to this skill.** It is a
  label on the board, not a table in a file: `gh issue list --state open --label
  nothing-checks`. Read it asking *which of these are one mechanism*, not *which
  should we fix*: four issues that all say "no production telemetry exists in any
  form" are one bet, not four issues. `docs/architecture.md` §9.4 keeps only the
  three gaps that change how a correct change is made — read those too, then the
  register for the rest.
- `gh issue list --state open --label needs-decision` — the open questions, which
  §10 also points at. §10 itself keeps two, stated where they bind.
- `docs/adrs/` — every decision, with what it costs. §3 below is how to read
  these for *expiry* rather than for compliance.
- `docs/specs/guardrail-enforcement-spec.md` § "Options set aside" — a second
  negative record, scoped to guardrails.
- `docs/e2e-run-latency-findings.md` — the measured split between model
  generation and everything else, and the two image-reader latency modes.
- `docs/diagnoses/` — per-run failure write-ups.

**The annotation corpus.** `eval/runlogs/e2e/` and `eval/runlogs/unit/` carry
the blind human `.ann.json` annotations alongside the machine grades. That pair
— what the judge said and what a genealogist said — is the only place in the
repo where the *instrument* is measurable rather than the system.

### The genealogist lane, hunted on its own evidence

The developer lane is louder, better instrumented, and easier to propose
against, so a run that does not deliberately go looking will return nothing from
the genealogist half every time. **There is no quota** — but if a run finds
nothing there, **say so explicitly in the report**, so that a systematic blind
spot cannot be mistaken for a quiet week.

Four places to look, none of which the developer-lane commands above touch:

- **Annotation cost per paid run.** `eval/harness/scripts/check_runlogs.py`
  rule 3 requires the `.ann.json` to carry a correction entry for **every
  dimension of every test** in the suite. That is genealogist hours, and it is
  the binding cost of a skill edit — not the $8–12 of machine time everybody
  quotes. Verify the current per-suite test count before repeating a number.
- **Judge audits.** `docs/record-extraction-judge-audit.md`, and the
  `cluster:judge-overrides` issues, which are cases where the judge ignored an
  explicit rubric instruction. A grader that does not follow its own prompt is a
  different problem from a grader that is miscalibrated, and only one of them is
  fixed by rubric edits.
- **Feedback cases.** The `feedback`-labelled issues are real users' bug
  reports, filed automatically. Read them as a set, not one at a time: what a
  non-expert hits repeatedly is a product-shape finding.

  ```sh
  gh issue list --repo PioneerAIAcademy/cowork-genealogy --state all --limit 200 \
    --label feedback --json number,title,state,createdAt \
    -q '.[] | "\(.createdAt[0:10])\t\(.state)\t#\(.number)\t\(.title)"' | sort
  ```

- **Whether the proof bar itself is right.** Everything downstream — the rubric
  dimensions, the verdict axes, the e2e expected findings — assumes the current
  reading of what counts as proved. That assumption has never been the subject
  of a proposal here, and it is the largest genealogist-lane bet available. It
  is also the one most likely to be wrong in the *cheap* direction: a bar set
  too high costs runs, tokens and annotator hours on every fixture forever.

## 3. Layer 3 — **outside** the repo, and this layer is not optional

Internal evidence shows you where the walls are. **It can never show you the
next hill**, because everything in it was generated by the current design. A run
that skips this layer is `/audit-board` with a longer preamble.

Three sweeps. Use `WebSearch` and `WebFetch`; cite a primary source with a date.

**1. Platform capabilities that did not exist when a decision was made.**
Claude Code, Cowork and the Agent SDK ship weekly; these designs are months old.
This is the highest-yield sweep, because nothing internal can ever surface it —
the repo has no way to know a constraint was lifted.

The method is mechanical:

```sh
grep -H '^\- \*\*Decided:\*\*' docs/adrs/ADR-*.md | sed 's|docs/adrs/||'
```

For each decision older than about a month, ask: **what platform limitation was
this working around, and does that limitation still exist?** Not "is this
decision still good" — that is a compliance read, and it will always come back
"yes."

The worked example of the shape: agent frontmatter must spell every MCP tool
name **three times**, once per registrar, because the three environments
namespace the server differently and no single spelling resolves everywhere
(`docs/adrs/ADR-0004-dual-spell-mcp-tool-names-in-agent-frontmatter.md`). Every
guardrail we own inherits that constraint. If upstream has since made the
namespacing addressable, a consolidated guardrail system gets dramatically
cheaper — and **nothing inside this repo would ever reveal it**, because from in
here the workaround simply works.

Do the same for every constraint of that family: hook lifecycle (which
`SessionStart` behaviour a `CLAUDE.md` note records as inverted from the
upstream issue), tool-search deferral, per-subagent model and effort control,
sandbox capabilities.

**Never propose on "I think X shipped."** Find the changelog entry, the docs
page or the release note, and cite it with its date. A proposal built on a
misremembered capability wastes the lead's scarcest resource, and it is
indistinguishable from a good one until he reads the source.

**2. Current practice in agent systems.** How comparable systems handle the
things we hand-built: guardrails and capability restriction, eval economics,
multi-agent decomposition, prompt-size budgets, grader calibration. The
question is not "what is popular" — it is "has a class of work we do by hand
become a solved commodity."

**3. Published work.** ADR-0009 records that a claim of novelty was falsified by
a paper published a month earlier and found in one search. Before proposing a
mechanism as new, look — and where a published result contradicts an internal
one, say which you believe and why.

## 4. Hunt subtractions

Additions are what a board generates on its own. Subtractions almost never get
proposed, because no one files an issue asking to delete their own mechanism —
so this skill is the only place they surface, and they should be **actively
hunted, not merely accepted when noticed**.

Four shapes, each greppable:

- **Two mechanisms doing one job.** Keep the one the real user uses; delete the
  other. `docs/adrs/ADR-0008-sync-schema-copies-eliminate-generate-or-lint.md`
  is the worked precedent — its first option is *eliminate the copy*, and only
  then generate or lint it.
- **A warn-only check nobody reads.** `docs/architecture.md` §9.2 names three
  lints that never fail, and their warnings compete for GitHub's per-step
  annotation cap against a standing backlog in the dozens — so the edge a PR
  *adds* is not distinguishable from the ones already there. A check whose output
  nobody can read is cost with no signal — either it blocks or it goes.
- **A guarantee nothing consumes.** A held invariant, a preserved field, a
  supported path with no caller. Dropping it can retire a whole validation
  surface.
- **A lane.** A whole category of work — a review stage, a doc tier, a test
  tier — whose absence would cost less than it does.

A subtraction clears the bar in §5 exactly like an addition: it names the class
of work it eliminates and what we would observe. It does **not** need to name a
replacement.

## 5. The bar

An idea qualifies if it names **both**:

1. the **constraint it removes** or the **class of work it eliminates**, and
2. **what we would observe differently if it worked.**

**Do not require a headline metric.** That filter deletes exactly the structural
ideas: a consolidated guardrail system's win is *one mechanism instead of four*,
which is not a number. "We would maintain one deny list, and a new guardrail
would land in one file instead of five" is a complete answer to (2).

What fails the bar, every time:

- It names neither a removed constraint nor an eliminated class. That is an
  increment. It may be a good increment — file it as a normal issue, do not
  propose it here.
- It removes a constraint that is not actually load-bearing. Check what the
  constraint costs before proposing to remove it.
- It is a rename of an existing plan. If `docs/plan/` already carries it, it is
  scheduled work, not a bet.
- It eliminates a class of work by moving that work somewhere unmeasured.

## 6. The ledger check — one kind of row is a bar, the rest are raw material

Two questions, and confusing them is the failure this section exists to prevent.

**First: was it researched and rejected?** A `rejected` row in
`docs/adrs/ADR-0010-record-structural-bets-in-a-ledger.md` means a probe ran or
a design was worked through, and the answer was no. **That is a bar. Do not
propose it again.** If you think the reasoning is wrong, that is a correction to
that row with new evidence, and you say so as a correction — not as a fresh
proposal with the history quietly dropped.

**Second, for everything else — `set aside` rows, ADR-0009's tables, and the
demoted, dismissed and spiked ideas scattered across the repo:** read them, and
**do not treat a row as a veto.**

Most of ADR-0009's rows correct *arithmetic, scope or attribution* rather than
refuting a direction. Three from the ledger itself:

| Row | What was actually refuted |
|---|---|
| "the routing table … is 431 lines of prose" | **Arithmetic.** 431 was the whole file; the table is 17 rows |
| "the single largest unanchored rule we own" | **Nothing.** Never measured at all |
| routing-as-a-tool as the P0 | **Magnitude and attribution** — the router did invoke the skill in all five failures. Demoted to a P2 spike that nobody ever ran |

Those were quick passes under time pressure. A wrong number is not a refuted
idea.

**For any proposal that touches the ledger, state explicitly which was refuted
— the DIRECTION, the MAGNITUDE, or the ARITHMETIC — and re-size it honestly.**
A re-proposal is welcome and carries a **higher burden** than a fresh idea: name
what changed since the refutation, or bring a materially different design. "The
number was wrong" is a legitimate answer and is not the same as "the idea was
fine."

Three standing negative records exist, and all three are raw material here —
none of them is a bar: `ADR-0009`, each ADR's own `Alternatives considered`
table, and `docs/specs/guardrail-enforcement-spec.md` § "Options set aside".
They record arguments that failed, which is not the same as directions that were
researched and closed. Only ADR-0010's `rejected` rows are the latter.

### On the first run

**Make a deliberate pass over the ledger and over every idea that was demoted,
dismissed or spiked but never actually investigated.** That backlog of
under-considered bets is likely this skill's highest-yield output, and it will
never be as rich again. Spend the run on it.

## 7. What every proposal carries, pre-verified

Six fields per proposal, all verified **before** the lead reads it:

| Field | Rule |
|---|---|
| **Claim** | One sentence. What changes about the system |
| **Constraint removed / class eliminated** | §5's bar. Name the constraint, or the class of work that stops being generated |
| **What we would observe** | The difference visible if it worked. Not necessarily a number |
| **Issues it closes or prevents** | Counted against the **real** board, with numbers. "Prevents" needs the shape it prevents, not a guess at volume |
| **The cheapest probe that could kill it in under a day** | With a cost. A probe that cannot come back negative is not a probe |
| **Ledger check** | Which row it touches, and whether the direction, the magnitude or the arithmetic was refuted — or "no ledger row". A `rejected` row means it does not get proposed at all (§6) |

**Verify counts, dates and the ledger check by running the real commands.**
Not the design — the design is stage 2's job, and pre-verifying it is how a
one-week probe turns into a three-week analysis nobody asked for.

The probe field is what makes the whole thing cheap, so hold it to a real
standard. A good probe is a measurement over the committed corpus, a single
paid run with a stated expected outcome, a live check against an upstream
capability, or a one-file spike. State what result kills the idea.

## 8. Verify before you repeat anything

Every factual claim you carry from a body, a doc, a ledger row or a search
result gets checked first — a path, a count, a date, a tool's behaviour. Cite
what you verified as a path, a symbol, or a command and its output.

The three that go stale fastest here, and all three have bitten:

- **Counts.** Issue totals, test counts, suite sizes, tool counts. Re-run them.
- **Costs.** Per-run figures are recomputed by `make e2e-corpus`; the numbers
  frozen into docs are older than the corpus.
- **Upstream capabilities.** A platform fact more than a few weeks old is a
  guess. This one is the whole point of §3 — get it wrong and the proposal is
  worse than nothing.

If you could not verify something, say so rather than repeating it with
confidence. A ledger row is itself a claim written on a particular day, not a
current measurement.

## 9. Rank, state your confidence, and do not pad

**There is no target count.** Report however many clear the bar — two, twelve,
or none — ranked, each with **your own confidence** stated and the reason for
it.

The lead's deep-review capacity is about **five per week**. That is a **ceiling
on what he reads, not a target for what you produce.** Producing four strong
ideas and two filler ones to reach five is strictly worse than producing four,
because the filler consumes the same scarce read.

**A run that returns zero is a successful run.** Say so plainly, say what you
swept, and say which layer came back empty — a zero from §3 means something
different from a zero from §2, and the lead needs to know which.

Rank by expected value, not by confidence: a 30%-confidence bet that eliminates
a class beats a certain increment, and saying "30%" is what makes that
legitimate.

## Stage 2 and stage 3 — what happens after he decides

Three stages. **This skill owns stage 1, and works stages 2 and 3 with the lead
when he asks.** Nobody starts the work in any of them.

| Stage | Who | Output |
|---|---|---|
| **1. PROPOSE** | this skill | breadth, pre-verified claims, ranked |
| **2. RESEARCH** | the lead and Claude together | the probe run or the design worked through — **and a finished issue body** |
| **3. ISSUE** | the lead | a `gh` issue labelled `cross-cutting`, assigned to a named person |

### The boundary that matters: he writes the issue, they write the plan

**Stage 2's artifact is the issue body itself.** Not a design doc, not a plan,
not a `docs/plan/` file. A well-scoped, detailed issue that a named person can
pick up and work.

Then the boundary is clean:

| Who | Owns |
|---|---|
| **The lead** (with Claude, in stage 2) | The issue body — the problem, the constraint, what was already ruled out, what "done" means, and the blast radius |
| **The assignee** | The plan and the implementation — `PLAN.md`, `/critique-plan`, the PR (`docs/task-lifecycle.md`, ADR-0007) |

**Do not put a plan in the issue body.** Steps, a file-by-file edit order, a
phase breakdown — those belong to whoever takes it, and pre-writing them removes
the step where a junior thinks the problem through and a critic attacks it. What
the body owes them is everything stage 2 *learned*, so they are not re-deriving a
probe they never saw:

- the constraint and why it is worth removing;
- what the probe measured and what came back;
- what was ruled out during the research, and on what evidence — the most
  valuable half, and the part that evaporates if it is not written down;
- the acceptance check: what would be observably different, and how anyone can
  tell;
- the blast radius, with the site list from the matching `docs/architecture.md`
  "If you're asked to…" block;
- whether it is `developer` or `genealogist`, and any senior review it needs.

**If the research kills it**, there is no issue. Write a `rejected` ledger row
with the reasoning — that row is a bar, and the reasoning is what makes it one.

### Verdicts — applied only after the lead decides each idea individually

Never batch these. He decides one at a time, and each one gets a row.

| Verdict | Means | Row |
|---|---|---|
| **accepted** | goes to stage 2 | written now; the `Issue` cell filled in when stage 3 files it, and `What was learned` filled in from the research |
| **deferred** | he did not reach it, or reached it and held it | first-proposed date; §0 carries it forward and **re-ranks** it |
| **set aside** | considered at proposal stage, **not researched** | one clause plus a **direction** / **magnitude** / **arithmetic** tag. A record, not a bar |
| **rejected** | **researched in stage 2 and rejected** | the reasoning, in full. **This one is a bar** — §6 stops the next run proposing it again |

`set aside` and `rejected` are not interchangeable, and the difference is whether
a deep dive happened. Never write `rejected` for something nobody researched.

### Filing a stage-3 issue

One command. Do not touch the Projects API — `.github/workflows/add-to-project.yml`
files the card into Backlog on its own, and a `gh` token without the `project`
scope fails a board write *while still creating the issue*, which looks like
success.

```sh
gh issue create --repo PioneerAIAcademy/cowork-genealogy \
  --label cross-cutting --label developer \
  --title "…" --body-file <file>
```

Use `--body-file`, not an inline `--body`: these bodies are long, and the shell
mangles the ones written inline. Open the body with a `**Touches:**` line naming
the files the work would change, per `CLAUDE.md`.

Keep the `developer` or `genealogist` label alongside `cross-cutting` so the lane
stays visible. The lead assigns it; `/fill-ready` exempts assigned
`cross-cutting` items from its seniority routing and its Ready depth targets, and
holds each person to **one active `cross-cutting` item at a time** — these are
multi-week structural projects, not weekly items.

### Writing the ledger

**Every proposal gets a row, including the ones he never reached** — those are
`deferred`. That is what makes §0's carry-forward complete rather than a
best-effort recollection of a long session.

Write them yourself, into the table in
`docs/adrs/ADR-0010-record-structural-bets-in-a-ledger.md`, once he has decided.
Four rules:

- **Append; never delete a row.** A `deferred` row's verdict is updated in place
  when he decides it later — its **First proposed** date never changes.
- **One clause per cell**, except a `rejected` row's reasoning, which is the
  payload and may run to a few sentences. Content growing in an `accepted` or
  `deferred` cell means it belongs in the issue.
- **Write nothing he has not decided.** An idea he did not reach is `deferred`,
  which is a decision about the run, not about the idea.
- **This table and the `Last updated:` line only.** Bump that line every time you
  write a row — `docs/adrs/_template.md` requires it on every edit, and a header
  two weeks older than the rows beneath it is what a reviewer catches instead of
  the reasoning. Your `Edit` grant does not reach anything else, including the
  rest of this ADR.

## Output shape

0. **Carried forward** — ideas from previous runs, with first-proposed dates and
   how many runs each has survived. Anything carried more than twice leads, as
   its own finding (§0). Skip the heading on a first run and say it is the first.
1. **Headline** — how many cleared the bar, and the one thing you would spend
   his first read on. If the answer is zero, this section is the report: what
   you swept, and which layer came back empty.
2. **The proposals** — ranked by expected value, each with the six fields from
   §7 and your confidence. Most consequential first. Do not pad to five.
3. **Subtractions** — kept as their own list even though they clear the same
   bar, because they are the ones a reader skims past. Say "none found" if none.
4. **Genealogist lane** — what §2's genealogist pass found, or explicitly that
   it found nothing this run.
5. **Outside evidence** — what §3's sweep turned up, each with a dated primary
   source. If a platform constraint was checked and still holds, say so: that is
   a real result and it stops the next run re-checking it.
6. **The decision queue** — how many `needs-decision` items are open, how many
   were answered since the last run, and the two or three you worked into a
   question this run (§1). If the queue grew, that line moves to the top of the
   report. Note separately any item you would move from `needs-decision` to
   `senior` because the answer turned out to be "hard either way".

Then stop and wait. He decides one idea at a time; you write a ledger row for
each decision, including `deferred` for everything he did not reach. Do not begin
any of the work, and do not write anyone's plan.
