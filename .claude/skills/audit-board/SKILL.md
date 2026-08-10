---
name: audit-board
description: Use when the lead wants the whole board looked at as a system rather than item by item — "audit the board", "review all the issues", "what should be merged", "are any issues stale", "where are the clusters", "weekly board review", or a bare "/audit-board". Run it weekly and BEFORE /fill-ready, since filers search once and then file, leaving this pass to judge fit across the pool. Sets its own merge-or-close target from the week's inflow and reports the gap when it falls short. Reads every open issue in Backlog, Ready, In Progress and Review and answers four questions across the pool: which issues should be merged or closed into each other, which are obsolete against the current repo, where the clusters of related work are, and what cross-cutting handling would beat the per-issue plan each body carries. Maintains `cluster:*` labels and the standing per-skill `next run:` issues, and re-checks each cluster's named next action against the date it was named. Also reports board hygiene — closed issues in active columns, open issues on no column, unlabeled items, and stalled work. Verifies every claim against the repo before repeating it. Proposes first and applies only what the lead approves; never starts the work.
allowed-tools:
  - Agent
  - Read
  - Bash
  - Glob
  - Grep
---

# Audit the board

`/fill-ready` ranks the Backlog, `/review-ready` vets one shortlist,
`/review-icebox` sweeps the frozen pool. All three look at issues one at a time.
This skill is the only pass that looks at the pool **as a whole** — the merges,
the rot, the clusters, and the handling that no single body can propose because
no single body can see the others.

**Run it weekly, and run it before `/fill-ready`.** That ordering is the point:
filers search once and then file, because judging fit needs the whole pool and
cannot be made from inside one PR. This pass is where duplicates get merged,
premises get corrected and dead items get dropped. `/fill-ready` then ranks a
deduped Backlog. Run it the other way round and it ranks duplicates.

**You propose, then apply what is approved.** No branches, no PRs, no code edits.
You have no `Edit` or `Write` tool on purpose.

**Do not rank on the board.** Almost every applied action is a `gh issue` command
— close, comment, label, retitle. Moving an item *up* the board is `/fill-ready`'s
job and never yours.

The one exception is **hygiene**: a closed issue stranded in an active column, an
open issue sitting in `Done`, an issue on no column at all. Those are corrections,
not ranking, and fixing them needs `gh project item-edit` with the Status field id
(`gh project field-list 1 --owner PioneerAIAcademy --format json`). Check the
token first — `gh auth status` must list the `project` scope, or the write fails
while appearing to succeed.

## 0. Pull the pool — the limit will bite you

Repo `PioneerAIAcademy/cowork-genealogy`, project **1**.

```sh
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 1500 > /tmp/board.json
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 400 \
  --json number,title,body,labels,assignees,createdAt,updatedAt,comments > /tmp/issues.json
```

**`--limit` defaults to 30 and truncates silently.** The board carries ~500 items,
most of them `Done`. A limit that clips the tail drops real Backlog and Ready
items and every count downstream is wrong with no error. Confirm the returned
count is below the limit you asked for before trusting anything.

Join the two and keep only `Backlog`, `Ready`, `In Progress`, `Review`. Take the
size from what you pulled — `jq length /tmp/issues.json` — never from a number
quoted here or in a body. Read all of them — the whole yield of this
skill is in what one body says about another, and `updatedAt` does not tell you
which pairs collide.

### Reading the pool without silently sampling it

§1 and §3 need every body in one head — that is where collisions and clusters
come from, and it is why you read them all. **§2 does not.** Its checks are
per-issue and mechanical, and running eight of them across ~220 bodies will not
fit alongside everything else. A pass that quietly does forty and reports as
though it did all of them is worse than one that states its sample.

So split the work: read the whole pool yourself for §1 and §3, and **fan §2 out**.
Partition the issue numbers into batches of ~25–30 and give each batch an
explicit, non-overlapping list, so nothing is checked twice and nothing is
missed. Generate the partition — do not eyeball it.

Give each batch the five verdicts rather than a summary instruction: **FIXED**
(name the commit or PR), **STILL BROKEN** (quote the evidence), **PARTLY**
(which half survives), **PREMISE FALSE** (nothing anywhere carries it),
**ON A BRANCH** (name the branch and sha — not obsolete, unbuildable).
Seed each with what is already known about its issues — which got substantive
comments this week, which are `icebox`, which pairs are known not to be
duplicates — or they will re-derive it and contradict it.

Report coverage as a number and a rule: how many you checked and how they were
chosen. If a batch fails, say which issues went unchecked rather than reporting
the remainder as a complete pass.

### The week's arithmetic sets this run's target

Compute inflow and closure for the last seven days before reading any body:

```sh
d=$(date -v-7d +%Y-%m-%d)
echo "filed:  $(gh issue list --repo PioneerAIAcademy/cowork-genealogy --state all \
  --limit 500 --search "created:>=$d" --json number -q 'length')"
echo "closed: $(gh issue list --repo PioneerAIAcademy/cowork-genealogy --state closed \
  --limit 500 --search "closed:>=$d" --json number -q 'length')"
```

**This run's merge-or-close target is at least the week's inflow** — merges,
absorbs, closes and obsoletes combined.

If you cannot reach it, **say so at the top of the output**: the number you
propose, the target, and the gap. Four merges against a week of two hundred
filings is not a successful audit; the shortfall is the finding, and burying it
under the merges you did find misreports the week. The lead still approves every
item — the target binds what you propose, not what he accepts.

## 1. Merges

Four distinct verdicts. Do not collapse them — they cost different amounts.

**Duplicate — close one into the other.** Two issues whose fix is the same edit
to the same lines. Prove it by opening the file both cite, not by comparing
titles. The tell is two bodies filed days apart from two different reviews, each
unaware of the other. Keep the one that is further along (assigned, reviewed,
in a column) and carry any detail the loser adds.

**Absorb — one is a strict subset.** The larger body usually says so already
("both are in scope here", "a generator would close both at once"). Verify the
claim before acting on it, then either close the subset or narrow the superset
so exactly one owns the scope.

**Batch — separate issues, one paid run.** This is the most common and the most
valuable. See §4.

**Schedule together, do not merge.** Two halves that need each other but are
different labor — a `developer` lint and a `genealogist` audit. Merging makes it
unassignable. Say "same week, two people" and leave both open.

### Never replace N issues with one issue holding N rows

There is no fifth verdict. Do **not** close a set of issues into a "batch
tracker", "umbrella", or "index" issue whose body is a table of the work — one
row per item, each with a **Who** column to claim. It reads like tidying and it
destroys the thing the board is for.

A row cannot be assigned, cannot sit in a column, cannot be closed, and does not
appear in anyone's queue. One card that is done when twenty independent
adjudications are done is a card nobody can finish, and the twenty become
invisible the moment the tracker scrolls.

**The merge test is whether the WORK is the same, never whether the TEXT is.**
Ask: does one person, doing this once, finish all of it? If no, they are
separate issues no matter how alike the bodies read.

Template-filled bodies are the trap, because a fleet of them looks like mass
duplication at a glance. This happened, and cost real data: on 2026-08-04 this
skill closed twenty `test <slug>` record-hint adjudications into one tracker,
justifying it as "byte-identical bodies differing only in a name and two URLs".
They were not duplicates in any sense — twenty different people, twenty
different records, four different countries — and the shared text was the
`/resolve-record-hint` boilerplate every one of them carries. The tracker then
asserted three things that were false within days: that eighteen fixtures were
still draft (ten were), that the unlisted ones had no card (three did, all
assigned), and it dropped one fixture's hint ark entirely, pointing at a README
that did not contain it. All four were reopened 2026-08-10 and the tracker
deleted.

If a set genuinely wants shared coordination, the tools for that are the
`cluster:*` label and §4's batching, which keep every issue open and assignable.
A standing `next run:` issue is the one legitimate umbrella, and it schedules
work rather than containing it.

Search for merge candidates **by fix site, not by topic**. Issues that collide
here almost never share a title; they want different lines in one file.

**Two issues wanting different lines in the same file default to one issue.**
Keeping them apart needs a stated reason — different lane, different reviewer, or
a paid-run slot they cannot share. Absent one, merge.

Bodies filed from 2026-08-04 open with a `**Touches:**` line — the instruction
lives in `CLAUDE.md`'s `gh issue create` recipe, and essentially every issue in
this repo is filed by Claude reading that file, so coverage on new issues should
be high. Read it first.

Still treat a missing line as **unknown**, never as "touches nothing": much of the
pool predates the convention, and a `CLAUDE.md` rule can be evicted from context
late in a long session. The fallback grep carries the older half of the pool:

```sh
grep -ho '\(docs\|eval\|packages\|apps\|scripts\)/[A-Za-z0-9._/-]*\.\(py\|ts\|tsx\|md\|json\)' \
  /tmp/bodies.txt | sort | uniq -c | sort -rn | head -40
```

Any file with three or more issues converging on it is either a batch or a
collision, and the bodies rarely say which. **Produce the count, don't eyeball
it** — run the fallback grep above through a tally and report every file at or
above the threshold, even ones that "feel" unrelated by title:

```sh
grep -ho '\(docs\|eval\|packages\|apps\|scripts\)/[A-Za-z0-9._/-]*\.\(py\|ts\|tsx\|md\|json\)' \
  /tmp/bodies.txt | sort | uniq -c | sort -rn | awk '$1 >= 3'
```

**The `>= 3` line is a triage cutoff, not an exclusion filter.** It orders where
to spend attention first on a large pool — it is not a claim that a 2-hit file
never hides a real duplicate. A pair of issues filed close together, before
either has accumulated other unrelated citations, is exactly the shape most
likely to sit at count 2 and be skipped by a skim. Run the 2-hit tier too
(same command, `awk '$1 == 2'`) and give it the same close read — #1395 and
#1396 cited the identical two lines (`research/SKILL.md:147`,
`research-exhaustiveness/SKILL.md:113-116`) and were a clean absorb, but sat
at count 2 in a large pool and were missed on a first pass that only read the
`>= 3` tier. On a small pool, or when re-checking a single
column against itself, drop the threshold to 2 outright rather than reporting
only the head of the tally.

```sh
grep -ho '\(docs\|eval\|packages\|apps\|scripts\)/[A-Za-z0-9._/-]*\.\(py\|ts\|tsx\|md\|json\)' \
  /tmp/bodies.txt | sort | uniq -c | sort -rn | awk '$1 == 2'
```

Same-file convergence is a strong batch signal on its own — verify it, don't
wave it through. Same-*topic* convergence across different files is a weaker
one and is usually not a batch: two issues that both say "the judge fabricated
something" can be unrelated defects on different tests (this happened —
issues #1330 and #1332 read alike by topic and turned out to be distinct
fabrications on different runs). Don't merge on topic resemblance alone; open
the files both cite and confirm they want the same edit.

Cross-check the file-convergence list against open PRs on the same files — a
file with four issues *and* five PRs is a rebase queue nobody is sequencing:

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 60 \
  --json number,files,title,author \
  --jq '.[] | select(.files[].path == "<path>") | "\(.number) \(.author.login) \(.title)"'
```

## 2. Obsolete and out of date

An issue body is a claim written on a particular day. Eight checks, cheapest first.

**The PR already merged.** Look for a merged PR naming the issue number in its
title or body, then confirm the artifact exists on disk.

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state merged --limit 100 \
  --search "<N>" --json number,title,mergedAt
```

An open issue whose lint, tool or fixture is present on `main` is done and
nobody closed it.

**The named test now passes.** Issues titled "Fix <skill> failing tests" name
specific test ids. Read the latest committed run log rather than believing the
body:

```sh
python3 -c "
import json,glob
fs=[f for f in sorted(glob.glob('eval/runlogs/unit/<skill>/v1_*.json')) if '.ann.' not in f]
d=json.load(open(fs[-1],encoding='utf-8'))
print(fs[-1])
for t in d.get('tests',[]): print(' ',t['test_id'],t.get('outcome'))
"
```

**A cited file no longer exists.** Bodies routinely cite docs that have since
been deleted or folded into a spec. Extract every path cited across the pool and
stat it:

```sh
grep -ho '\(docs\|eval\|packages\|apps\|scripts\)/[A-Za-z0-9._/-]*' /tmp/bodies.txt \
  | sort -u | while read f; do [ -e "$f" ] || echo "MISSING $f"; done
```

A missing path is not automatically fatal — an issue may name a file it intends
to create. It is fatal when the missing file is the issue's **premise**: the
measurement it rests on, or the convention it protects.

**The blocker closed.** Bodies carry blockers in prose — "wait for #N", "blocked
on #N", "gated on the #N probe", "land after PR #N". Extract every one and
resolve it. A closed blocker on an issue still marked blocked is the highest-value
find in this section, because nothing else in the workflow notices.

**The closed issue it points at never shipped.** The inverse of the check above,
and it fails in the direction nobody looks. `closed` reads as done, so a body or
a code comment that names a closed issue as its tracker is trusted on sight. Do
not trust it — an issue can be closed `completed` with the work never landed.

Resolve every closed issue cited **as a tracker**, in a body or in the code
(`grep -rn '#<N>' packages/ apps/ eval/ docs/ scripts/ CLAUDE.md`), by checking
the artifact, not the
state. One case: a consolidation issue closed `completed` while all five copies
it was meant to remove are still on `main` — with a source comment pointing
readers at it. Anyone following that pointer lands on a closed ticket and an
unsolved problem.

Where the work did not land, say so on the closed issue and name what actually
owns the scope. Reopening is usually wrong: the right survivor is often a
different, open issue, and reopening a stale one just adds a second.

**The measurement drifted.** Counts, sizes, line numbers and percentages age
badly here. Re-run any figure an issue's decision rests on. Report the delta
rather than silently using the new number — a body that says "46 of 80" against a
current 45 of 83 is not wrong enough to close, but a PR written to the stale
number ships a wrong constant.

**The premise was refuted elsewhere.** Another issue, a PR review, or a standup
may have already disproved the reasoning. Bodies that were reviewed carry
`> **Reviewed <date>**` headers; those are trustworthy. Bodies without one are
as old as their `createdAt`.

**The code exists — on a branch.** The costliest miss in this section, because
every other check reads as *confirmed*. A body says a function shipped. It did —
on a branch that never merged. The merged-PR check above passes it by (there is
no merged PR), and a `grep` of `main` finds nothing, so the natural conclusion is
"the premise is false" when the truth is "the premise is true somewhere nobody
else can see." Search for the **content**, and ask `origin/main` first:

```sh
git fetch --all --prune --quiet                          # --all sees only what you fetched
git log origin/main --oneline -S '<symbol or string>'    # did it ship? ask this first
git log --all --oneline -S '<symbol or string>'          # only if main came back empty
```

Name `origin/main` explicitly. `HEAD` is whichever branch you are standing on,
and a worktree is the normal place to run this from — testing against it answers
a different question than the one you are asking. Do not test whether the sha is
an ancestor of `main` either: this repo squash-merges, so a merged branch's
commits are never ancestors of `main`, and every shipped PR reads as unmerged.

When a body quotes a symbol, test id or string you cannot find on `main`,
**search every branch before calling it invented.** The outcomes need opposite
handling:

| Result | Means | Do |
|---|---|---|
| `origin/main` finds it | It shipped | The body is current. Nothing to do here — the second command is not needed |
| `origin/main` empty, `--all` empty | It never existed anywhere | The body is wrong. Correct it and ask the filer what they meant — do not close, their concern may survive a wrong citation |
| `origin/main` empty, `--all` finds a commit | The body describes a branch | The issue is **blocked on that branch merging**. Name the branch and the sha in a comment |

The `--all` search reads local refs, so a branch nobody fetched looks identical
to a branch that never existed — hence the `fetch --prune` first, which also
drops refs for branches deleted after merging.

Both showed up in one 22-issue sample: an issue asserting a function had shipped
warn-only when it sat on `origin/<feature-branch>`, with two follow-up comments
written against code `main` does not contain; and a cluster of four issues citing
test ids from an auditor's working tree, one of which had never existed in any
branch. **Whole clusters can be filed from a tree that is not `main`** — when one
issue in a group fails this check, check its siblings before trusting any of them.

## 3. Clusters — find them, then manage them

Group by **shared fix site, shared gate, or shared decision** — not by subject
matter. A cluster is only useful if membership changes how the work is scheduled.

### Membership is a label, not a re-derivation

Record membership as a `cluster:<name>` label so it survives between runs. Without
it every audit re-derives the same groups from prose, which is the single most
expensive part of this pass, and nothing between runs can see a cluster at all.

```sh
gh label create "cluster:guardrail" --repo PioneerAIAcademy/cowork-genealogy \
  --color C5DEF5 --description "Guardrail compliance detectors — sequenced together" || true
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy --add-label "cluster:guardrail"
```

Keep the set small — four or five live clusters, named for what binds them. A
label per topic is a taxonomy; a label per *scheduling constraint* is a tool. When
a cluster's work is done, delete the label rather than leaving it on closed issues.

### The lead owns the decisions; the cluster owns a next action

Every cluster reaches a point where the next move is a spend or doctrine call —
which of two designs, whether to pay for six eval runs, which measurement window
is canonical. **Those are the lead's and cannot be delegated.** Surface them in §5
as decisions, not as work.

But **do not record the lead as the standing owner of a cluster** and stop there.
An owner with no forcing function is how #911 sat uncalibrated for weeks while
#980 was filed specifically to avoid repeating it and #1231 then repeated it
anyway — three issues, one task, no one sequencing. A name on a cluster is
unfalsifiable; it reads identically in six weeks.

That sequence — #911, #980, #1231 — is also a *merge* miss, not only a
staleness one: three issues each re-derived the same undone calibration
instead of one issue tracking it once. Check every cluster for the same
shape before writing its Since date: **has this cluster's decision been
independently re-filed more than once?** If a second or third issue exists
whose body restates "we need to measure/decide X before graduating" for a
decision an earlier issue in the same cluster already owns, that is not
three parallel tasks — merge them into the one that's furthest along and
close the rest as duplicates-of-the-decision (§1's Duplicate verdict), even
if their bodies aren't about the same file. The tell is the *sentence*, not
the file: "before graduating," "before hard-denying," "measure first" said
more than once in one cluster is the same missing mechanism asking to be
merged, not scheduled harder.

Instead every cluster carries, and this skill re-checks weekly:

| | |
|---|---|
| **Decision pending** | The one open question, and that it is the lead's — or "none, unblocked" |
| **Next action** | One concrete step, small enough to finish in a week |
| **Doer** | A person, not a role. May be the lead, but say so |
| **Since** | The date that next action was first named |

The **Since** column is the whole mechanism. An action named three audits ago and
still not done is the finding — report it before anything else in the cluster, and
propose either a different doer or dropping the cluster's ambition. That is the
check the standing-owner model does not have.

### Two shapes to call out every run

- **A cluster with no owner.** Every member says "coordinate with the others" and
  none of them is the coordinator. This is where issues rot at full body quality.
- **A cluster converging on one file.** Count open PRs against it (§1). Whoever
  lands last rebases, and the bodies name only the collision that existed the day
  they were written. This kind is usually not a real cluster — it is a transient
  rebase queue, and it wants a merge order stated in a comment, not a label.

## 4. The paid-run tax

The single largest coordination cost on this board, and the reason to run this
skill weekly.

Editing a `packages/engine/plugin/skills/<skill>/SKILL.md`, an agent body, a
`eval/tests/unit/<skill>/` file, or a scenario fixture flips that skill's run log
inactive under `check_runlogs.py` rule 2. Landing it then costs a fresh
`make eval-skill SKILL=<name>` run plus a genealogist annotation — call it
$8–12 and 45–65 minutes of machine time, plus genealogist hours.

Individually, issues handle this correctly: most say "batch this with the next
<skill> change rather than spending a run on it alone." **Collectively, nothing
schedules the batch**, so each one waits for a volunteer or gets done alone at
full price.

Every run, produce the tax table — one row per skill with anything pending:

| Skill | Slot held by | Idle days | Queued behind it | Already stale? | Merge candidates |
|---|---|---|---|---|---|

Derive "queued" by scanning bodies for `eval-skill`, `run log inactive`, `rule 2`,
`annotation`, and the skill names, filtered to issues that actually touch the
snapshot set. A queue three or more deep is the signal to merge (below), not to
schedule harder.

Order matters within a queue: some issues are gated on a free harness-side change
that should land first so the authoring only happens once. #1108 before #995 is
the live example — the matchers can only pin values once the mechanism exists.

### Why it cannot be fixed by scheduling alone

Rule 2 requires the skill's latest run log to be active **against the PR branch's
state**, and the snapshot covers every file under the skill dir — "including a
`references/` doc or even a comment" (`eval/CLAUDE.md`, § Snapshot model). So the
run log goes stale the moment the *next* edit lands. Six issues landing as six
sequential PRs is six runs, however carefully they are ordered.

**The money is not the binding cost.** A run is $8–12, but rule 3 requires the
`.ann.json` to carry a correction entry for **every dimension of every test** in
the suite — 27 tests for `record-extraction` — and that pass is genealogist hours.
Six runs means six full re-annotations of the same suite.

### One active issue per skill

**No more than one issue that touches a given skill's snapshot is in Ready, In
Progress or Review at a time.** The rest wait in Backlog.

`/fill-ready` enforces this daily as its Gate 4 and owns the snapshot-set
definition; this pass is the weekly audit of the result — which slots are held,
which holders have gone quiet, and which queues have grown long enough that the
answer is to merge issues rather than to wait.

**Check open PRs against the snapshot set too, not just issue columns.** A PR
can hold a skill's slot without the issue that spawned it ever needing to sit
in Ready/In Progress/Review as a separate card — the PR's own file list is the
thing that actually collides. Two live violations existed simultaneously this
way: `record-extraction` had PR #1441 and PR #1294 both open against
`record-extractor.md` at once, and `search-records` had #1319 (an in-progress
issue) *and* PR #1328 open against `search-records/SKILL.md` at the same
time — neither caught by an issue-column-only read, because the second
occupant in each pair was a PR, not a competing issue.

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 60 \
  --json number,files,title \
  --jq '.[] | select(.files[].path | test("packages/engine/plugin/skills/<skill>/|eval/tests/unit/<skill>/")) | "\(.number) \(.title)"'
```

Run this per skill with anything in the paid-run tax table. Two PRs (or a
PR plus an issue) against one slot is the same "who rebases last" problem
as §1's file-convergence check — report it as a reconciliation finding, not
a new merge, since the fix is usually sequencing the two PRs, not combining
their issues.

This is a *collision* rule, not a cost rule, and the distinction matters when
reporting on it. It stops two people editing one SKILL.md at once and invalidating
each other's run — PRs #929 and #924 both edited `search-records/SKILL.md`
concurrently. It does **not** by itself reduce the number of runs.

Three things this pass owes the rule:

**1. Key the lock on paths, not on the skill's name.** An issue holds a skill's
slot only if its work lands under that skill's snapshot set:

- `packages/engine/plugin/skills/<skill>/**`
- `eval/tests/unit/<skill>/**`
- a plugin agent the skill references via `@plugin:` — `record-extractor.md` gates
  every skill naming it, so one agent edit can hold several slots at once

Issues that only touch tool or harness code do **not** take the lock even when
their title names the skill. #1073 is about `record-search.ts` and says in its own
DoD *not* to edit `search-records/SKILL.md`; locking search-records for it would
be wrong. The `**Touches:**` line is what makes this decidable (§1).

**2. Reclaim a stalled slot.** A held slot blocks a whole skill, so a card that
has not moved in ~10 days hands its slot back to Backlog and the next issue is
promoted. Report every reclaim with the assignee and the idle days — today's board
carries six cards untouched for a week or more, so this rule will fire.

**3. Make the queue's size the finding.** A skill whose queue is five deep is not
a scheduling problem, it is a sizing problem — see below.

### Merge the issues, not the branches

This is where the cost saving comes from, and it costs juniors nothing to learn:
they keep doing one issue, one branch off `main`, one PR.

If a skill's queue is long, the fix is to **merge related issues into fewer,
larger ones during this pass**, so that one run carries what would have been
three. Seven issues serialized is seven runs; the same work merged into three
issues is three. Same economics as batching branches, no new git process.

Merge when the issues share a lane — the same doctrine question, the same test
files, the same agent body. Do not merge across lanes to save a run: a
`developer` harness fix and a `genealogist` fixture adjudication in one issue is
unassignable, which costs more than the run saved.

**Sharing a lane is necessary and not sufficient.** The run being paid once is
what makes a merge pay, so this only applies where a single run covers the
merged work — one snapshot, one suite, one annotation pass. It does **not**
apply to N independent pieces of research that merely happen to be filed by the
same lane against the same directory. Twenty record-hint adjudications are
twenty separate investigations of twenty different people; merging them buys no
run at all, because each still costs its own. Same-lane plus same-directory is
where this rule has misfired — apply the "does one person finish all of it in
one sitting?" test from §1 before merging on lane alone.

Do **not** reach for `eval-cosmetic-skip` to squeeze a second edit past the gate.
It is for behavior-neutral changes only, and a gate too expensive to satisfy
trains people to bypass it on exactly the edits that are not neutral.

### The standing "next run" issue

Give each mature skill with a real queue **one open issue** — titled
`next run: <skill>`, labelled `cluster:next-run` plus the skill's lane — listing
the issues waiting on that skill's slot, in order, one line each.

It is the queue made visible. Without it, an issue that is merely *waiting its
turn* looks identical to one nobody wants, and the person who filed it has no way
to see which. It holds pointers only — `#N — one clause` — never content.

Rules that keep it from becoming a queue file — the failure the repo's retired
staging queue was closed for:

- **It holds pointers, never content.** Each line is `#N — one clause`. The work,
  the reasoning and the acceptance criteria stay in the real issue. If someone
  starts describing work here, that is the smell.
- **One per skill, and only for skills that actually have a backlog.** Do not
  pre-create twenty-five.
- **It closes when the run lands**, and a fresh one opens only when a second edit
  queues up. An empty `next run:` issue sitting open is the same rot.
- **This audit is the only writer.** Others add by filing a normal issue; you
  add the pointer here.

When a skill's list is long enough to justify a run, that becomes the cluster's
**next action** under §3, with a doer and a date — not a standing intention.

Check `check_runlogs.py` rule 2 directly for skills that are *already* stale, since
those cost a run before any new work lands:

```sh
cd eval/harness && uv run python scripts/check_runlogs.py
```

## 5. Better handling than the bodies propose

The section the lead actually wants. Each body optimizes for itself; this is
where you propose something that only makes sense across several.

Ask these, and answer only the ones with a real finding:

- **Is a family of near-identical issues better as one worklist?** Many issues
  with byte-identical bodies differing by a name and a URL generate one board
  card, one assignment decision and one PR each, and are discussed in none of
  them. A tracking issue plus a checklist table costs less and loses nothing.
- **Has the same decision been made more than twice?** If the lead has
  independently decided the same tradeoff on three issues, that is doctrine and
  belongs written down once — an ADR the next issue cites instead of
  re-litigating. Name the decision and the issues that repeated it.
- **Is a discipline being re-derived per instance?** Watch for issues whose body
  says it exists to avoid repeating an earlier issue's mistake — and then a third
  issue repeats it anyway. That pattern means the *mechanism* is missing, not the
  three instances. Propose the mechanism.
- **Do two issues want the same thing generated rather than guarded twice?** Two
  lints over two hand-maintained mirrors of one source usually collapse into one
  codegen decision.
- **Is a blocked-on edge invisible?** Blockers live in prose, so `/fill-ready`
  and the lead re-derive them by reading bodies every time. Emit the dependency
  edges as output, and propose whichever is cheapest: a `blocked` label, a title
  suffix, or accepting that this skill's weekly output is the record.
- **Did a warn-only check ship without a triage owner?** A lint that emits N
  warnings nobody reads becomes its own issue. If the board already carries one of
  those, say so before endorsing another warn-only check.

## 6. Board hygiene

Cheap, mechanical, and it finds something almost every run.

```sh
python3 - <<'PY'
import json
board=json.load(open('/tmp/board.json',encoding='utf-8'))
issues={i['number']:i for i in json.load(open('/tmp/issues.json',encoding='utf-8'))}
cols=('Backlog','Ready','In Progress','Review')
onboard={}
for it in board['items']:
    n=(it.get('content') or {}).get('number')
    if n: onboard[n]=it.get('status')
print('closed but in an active column:',
      [n for n,s in onboard.items() if s in cols and n not in issues])
print('open but on no column:', sorted(set(issues)-set(onboard)))
print('open but in Done:', [n for n,s in onboard.items() if s=='Done' and n in issues])
print('unlabeled:', [n for n,s in onboard.items() if s in cols and n in issues
                     and not issues[n]['labels']])
print('unassigned in Ready/In Progress/Review:',
      [n for n,s in onboard.items() if s in cols[1:] and n in issues
       and not issues[n]['assignees']])
PY
```

Also report **stalled** work: anything in `In Progress` or `Review` whose
`updatedAt` is more than a week old, with its assignee. In Progress is a promise;
a card that has not moved in three weeks is either done and unclosed, blocked and
unsaid, or abandoned.

An unlabeled item is invisible to `/fill-ready`, which routes on
`developer` / `genealogist`. Propose the label; do not guess between the two when
the body genuinely leaves the lane open — several issues are deliberately
unlabeled because picking the lane *is* the task. Say which.

## 7. Verify before you repeat anything

Every factual claim you carry from a body into the report gets checked first — a
path, a line number, a count, a test outcome, a tool's behaviour. Cite what you
verified as `path:line` or as a command and its output.

This matters more here than in the per-issue skills. A weekly audit that repeats
a stale measurement launders it into something that looks freshly confirmed.

If you could not verify something, say so rather than repeating it with
confidence.

## Output shape

Open with the week's arithmetic (§0) — filed, closed, and whether this run's
proposals meet the target, naming the gap when they do not. Then the two or three
things that change what happens this week. Then:

1. **Merge and close** — the duplicates and absorbs, with the evidence for each
   and the exact `gh` command. Then the batch-together and schedule-together
   pairs, kept separate from real merges.
2. **Obsolete** — what to close outright, and what needs a body correction rather
   than a close. One line of evidence each. Keep **blocked on an unmerged branch**
   as its own group: those are not obsolete, they are unbuildable, and the fix is
   naming the branch rather than closing the issue.
3. **Clusters** — one block each: members, what binds them, decision pending, next
   action, doer, and **Since**. Lead with any next action that has not moved since
   a previous audit.
4. **The paid-run tax** — the table, which run to schedule this week, and any
   `next run:` issue that needs opening or closing.
5. **Decisions for the lead** — pulled out as its own list, phrased as questions
   with the options and what each costs. These are the spend and doctrine calls
   from §3 and §5; they should not be buried inside a cluster block.
6. **Cross-cutting proposals** — only the ones with a real finding behind them.
   Two good ones beat six speculative ones.
7. **Board hygiene** — the mechanical list, terse.

Then stop and wait for approval. Apply only what he approves, one `gh` command
per approved item. Do not begin any of the work.
