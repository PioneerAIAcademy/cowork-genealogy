---
name: audit-board
description: Use when the lead wants the whole board looked at as a system rather than item by item — "audit the board", "review all the issues", "are any issues stale", "where are the clusters", "weekly board review", or a bare "/audit-board". Run it weekly and AFTER /merge-issues has merged the pool down, and before /fill-ready. Sets its own close-or-obsolete target from the week's inflow and reports the gap when it falls short. Reads every open issue in Backlog, Ready, In Progress and Review and answers three questions across the pool: which are obsolete against the current repo, where the clusters of related work are, and what cross-cutting handling would beat the per-issue plan each body carries. Merging is NOT this pass — `/merge-issues` owns merge doctrine and the eval-slot queues; this pass hands it what it finds. Maintains `cluster:*` labels and the standing per-skill `next run:` issues, and re-checks each cluster's named next action against the date it was named. Also reports board hygiene — closed issues in active columns, open issues on no column, unlabeled items, and stalled work. Verifies every claim against the repo before repeating it. Proposes first and applies only what the lead approves; never starts the work.
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
This skill looks at the pool **as a whole** — rot, clusters, and cross-cutting
handling.

**Run it weekly, after `/merge-issues` and before `/fill-ready`**, so this pass
reads a pool that is already merged down and `/fill-ready` then ranks one whose
premises are current. This is where premises get corrected and dead items get
dropped.

**Merging is not this pass.** `/merge-issues` owns merge doctrine, the eval-slot
queues and the file-convergence read. Do not propose a merge here and do not
re-derive its verdicts. When this pass turns up a merge candidate — which the
obsolescence and cluster reads routinely do — name it in the hand-off section of
the output and let that skill judge it.

**You propose, then apply what is approved.** No branches, no PRs, no code edits.
You have no `Edit` or `Write` tool on purpose.

**Do not rank on the board.** Almost every applied action is a `gh issue` command
— close, comment, label, retitle. Moving an item *up* the board is `/fill-ready`'s
job and never yours.

The one exception is **hygiene**: a closed issue stranded in an active column, an
open issue sitting in `Done` or `Not planned`, an issue on no column at all. Those are corrections,
not ranking, and fixing them needs `gh project item-edit` with the Status field id
(`gh project field-list 1 --owner PioneerAIAcademy --format json`). Check the
token first — `gh auth status` must list the `project` scope, or the write fails
while appearing to succeed.

## 0. Pull the pool — the limit will bite you

Repo `PioneerAIAcademy/cowork-genealogy`, project **1**.

```sh
gh project item-list 1 --owner PioneerAIAcademy --format json --limit 2000 > /tmp/board.json
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 400 \
  --json number,title,body,labels,assignees,createdAt,updatedAt,comments > /tmp/issues.json
```

**`--limit` defaults to 30 and truncates silently.** The board carried 1269 items
on 2026-09-15, most of them `Done`, and it grows by roughly the week's inflow. A
limit that clips the tail drops real Backlog and Ready items and every count
downstream is wrong with no error. Confirm the returned count is below the limit
you asked for before trusting anything, and raise the limit rather than trusting
the figure here.

Join the two and keep only `Backlog`, `Ready`, `In Progress`, `Review`. Take the
size from what you pulled — `jq length /tmp/issues.json` — never from a number
quoted here or in a body. Read all of them — the yield of this skill is in what
one body says about another, and `updatedAt` does not tell you which bodies share
a gate.

### Reading the pool without silently sampling it

Read the whole pool yourself for the clusters — they need every body in one
head. **Fan the obsolescence checks out.** They are per-issue and
mechanical, and eight of them across ~220 bodies will not fit alongside
everything else. Partition the issue numbers into batches of ~25–30 and give each
batch an explicit, non-overlapping list, so nothing is checked twice and nothing
is missed. Generate the partition — do not eyeball it. Never report a sample as
though it were the whole pool.

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

**This run's close-or-obsolete target is the week's inflow, less what the two
merge passes already took off.** Count those first — they run before this one and
their closures are the bulk of the week's:

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state closed \
  --limit 200 --search "closed:>=$d \"Merged into issue\"" \
  --json number,title -q 'length'
```

Subtract that count from the inflow; the remainder is what this pass owes in
closes and obsoletes. **Do not re-open a merge verdict either pass reached**, in
either direction — neither proposing a merge they declined nor undoing one they
made. A merge candidate this pass turns up goes to the hand-off section, not into
a proposal.

That division is the point of the three cadences. `/merge-recent-issues` catches a
new issue landing on an existing one, the case that decays fastest.
`/merge-issues` catches N issues queued on one eval slot, filed weeks apart, which
no window-based read can see. What only **this** pass catches is obsolescence,
clusters and board hygiene — none of which change materially in a day, and all of
which need every body in one head.

If you cannot reach the target, **say so at the top of the output**: the number
you propose, the target, and the gap. The shortfall is itself a finding — report
it above the closes you did find. The target binds what you propose, not what the
lead accepts.

## 1. Obsolete and out of date

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

**Sweep it, do not read for it.** Run this every pass, before proposing any
promotion — a stale banner is invisible to a body read.

```sh
python3 - <<'PY'
import json, re, subprocess
issues = json.load(open('/tmp/issues.json', encoding='utf-8'))    # written above
BLOCK = re.compile(r'(blocked on|do not start until|wait for|waits on|prerequisite'
                   r'|gated on|land(?:s)? first|must land|queues behind|start(?:s)? after'
                   r'|do after)', re.I)
refs = {}
for i in issues:
    n, b = i['number'], i.get('body') or ''
    for m in BLOCK.finditer(b):                       # only numbers NEAR the phrase —
        for r in re.findall(r'#(\d{3,4})',            # a bare #N anywhere is noise
                            b[m.start():m.start() + 220]):
            refs.setdefault(n, set()).add(int(r))
def state(r):
    for kind in ('issue', 'pr'):
        out = subprocess.run(['gh', kind, 'view', str(r), '--repo',
                              'PioneerAIAcademy/cowork-genealogy', '--json', 'state',
                              '-q', '.state'], capture_output=True, text=True).stdout.strip()
        if out:
            return out
    return 'UNKNOWN'
cache = {}
for n, rs in sorted(refs.items()):
    st = {r: cache.setdefault(r, state(r)) for r in rs}
    if st and all(v in ('CLOSED', 'MERGED') for v in st.values()):
        print(f'FREED #{n}  every blocker closed: '
              + ', '.join(f'#{r} {v}' for r, v in st.items()))
PY
```

Then **confirm the work reached `main`** before calling one freed — closed is not
shipped, which is the very next check below. A blocker closed `not planned` frees
the issue too, but for the opposite reason: nobody is doing that work, so the
dependent item needs its premise re-read, not just its banner deleted.

**Report only the freed items sitting in Backlog.** The sweep reads the whole
open pool, but a freed item already in Ready, In Progress or Review is not a
find — someone holds it, and its banner is their problem. Cross the list against
`/tmp/board.json` before you report.

Each survivor needs its stale banner struck in the body — a
`> **Do not start until #N**` line outlives the blocker and parks the issue again
on the next read — and each is a `/fill-ready` promotion candidate the same week.

**The closed issue it points at never shipped.** The inverse of the check above,
and it fails in the direction nobody looks. `closed` reads as done, so a body or
a code comment that names a closed issue as its tracker is trusted on sight. Do
not trust it — an issue can be closed `completed` with the work never landed.

Resolve every closed issue cited **as a tracker**, in a body or in the code
(`grep -rn '#<N>' packages/ apps/ eval/ docs/ scripts/ CLAUDE.md`), by checking
the artifact, not the state.

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

**Whole clusters can be filed from a tree that is not `main`.** When one issue in
a group fails this check, check its siblings before trusting any of them.

## 2. Clusters — find them, then manage them

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
is canonical. **Those are the lead's and cannot be delegated.** Surface them
under better handling as decisions, not as work.

But **do not record the lead as the standing owner of a cluster** and stop there.
A name on a cluster is unfalsifiable — it reads identically in six weeks, and an
owner with no forcing function is how one task becomes three issues nobody
sequences.

Check every cluster for a **re-filed decision** before writing its Since date:
has this cluster's decision been independently re-filed more than once? If a
second or third issue restates "we need to measure/decide X before graduating"
for a decision an earlier issue in the same cluster already owns, that is one
missing mechanism, not three parallel tasks — hand the set to `/merge-issues`
naming the issue furthest along, and say the tell is the *sentence*, not the
file: "before graduating", "before hard-denying", "measure first", said more than
once in one cluster. It is the one merge candidate this pass finds that no path
read can, since the bodies need not be about the same file at all.

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
- **A cluster converging on one file.** Whoever lands last rebases, and the
  bodies name only the collision that existed the day they were written. This
  kind is usually not a real cluster — it is a transient rebase queue, and it
  wants a merge order stated in a comment, not a label. Take the converging
  files from `/merge-issues`' `slots.py` output, then count the open PRs against
  each: four issues *and* five PRs on one file is a queue nobody is sequencing.

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 60 \
  --json number,files,title,author \
  --jq '.[] | select(.files[].path == "<path>") | "\(.number) \(.author.login) \(.title)"'
```

## 3. The paid-run tax

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

| Skill | Slot held by | Idle days | Queued behind it | Already stale? |
|---|---|---|---|---|

**Take "queued behind it" from `/merge-issues`, not from a scan of your own.**
Its `slots.py` computes queue depth per slot from `**Touches:**` lines, and a
second derivation here — grepping bodies for `eval-skill`, `run log inactive`,
`rule 2`, `annotation` — produces a different number for the same board:

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 200 \
  --json number,title,files > /tmp/prs.json
python3 .claude/skills/merge-issues/slots.py /tmp/board.json /tmp/issues.json /tmp/prs.json
```

A queue still three or more deep after that pass has run means it judged those
issues irreducible. Do not re-propose merging them. What this pass owes the table
is the *other* three columns — who holds each slot, how long they have sat on it,
and which skills are already stale.

Order matters within a queue: some issues are gated on a free harness-side change
that should land first so the authoring only happens once. #1108 before #995 is
the live example — the matchers can only pin values once the mechanism exists.

### Why it cannot be fixed by scheduling alone

Rule 2 requires the skill's latest run log to be active **against the PR branch's
state**, and the snapshot covers every file under the skill dir — "including a
`references/` doc or even a comment" (`eval/CLAUDE.md`, the snapshot model). So the
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
definition; `/merge-issues` sizes the queues behind it. This pass is the weekly
audit of the result — which slots are held, and which holders have gone quiet.

**Check open PRs against the snapshot set too, not just issue columns.** A PR
holds a skill's slot whether or not the issue that spawned it ever sits in
Ready/In Progress/Review as a separate card — the PR's own file list is what
collides, and an issue-column-only read misses every pair whose second occupant
is a PR.

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 60 \
  --json number,files,title \
  --jq '.[] | select(.files[].path | test("packages/engine/plugin/skills/<skill>/|eval/tests/unit/<skill>/")) | "\(.number) \(.title)"'
```

Run this per skill with anything in the paid-run tax table. Two PRs (or a
PR plus an issue) against one slot is the same "who rebases last" problem the
converging-cluster check names — report it as a reconciliation finding, not a
merge, since the fix is usually sequencing the two PRs, not combining their
issues.

This is a *collision* rule, not a cost rule, and the distinction matters when
reporting on it. It stops two people editing one SKILL.md at once and
invalidating each other's run. It does **not** by itself reduce the number of
runs.

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
be wrong. The `**Touches:**` line is what makes this decidable.

**2. Reclaim a stalled slot.** A held slot blocks a whole skill, so a card that
has not moved in ~10 days hands its slot back to Backlog and the next issue is
promoted. Report every reclaim with the assignee and the idle days.

**3. Make the queue's size the finding, and then stop.** A skill whose queue is
five deep is not a scheduling problem, it is a sizing problem — and sizing it is
`/merge-issues`, which ran before this one. Report the depth and who holds the
slot. Do not propose the merges; if a queue is still deep, that pass has already
judged those issues irreducible and written a reason per survivor.

The exception is a queue that grew **since** that pass ran, or one whose survivor
reasons this read contradicts — the body turns out to be obsolete, or its blocker
closed. Say which, and hand it back rather than merging it here.

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

Rules that keep it from becoming a queue file:

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
**next action** on that cluster, with a doer and a date — not a standing
intention.

Check `check_runlogs.py` rule 2 directly for skills that are *already* stale, since
those cost a run before any new work lands:

```sh
cd eval/harness && uv run python scripts/check_runlogs.py
```

## 4. Better handling than the bodies propose

The section the lead actually wants. Each body optimizes for itself; this is
where you propose something that only makes sense across several.

Ask these, and answer only the ones with a real finding:

- **Is a family of near-identical issues waiting on one missing mechanism?**
  Bodies differing only by a name and a URL usually point at a generator, lint or
  convention nobody has built — propose that. Do **not** propose folding them
  into a tracker, umbrella or worklist issue whose body is a table of the work:
  a row cannot be assigned, cannot sit in a column and cannot be closed, so the N
  items go invisible the moment it scrolls.
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

## 5. Board hygiene

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
print('open but in a terminal column:',
      [(n,s) for n,s in onboard.items() if s in ('Done','Not planned') and n in issues])
print('unlabeled:', [n for n,s in onboard.items() if s in cols and n in issues
                     and not issues[n]['labels']])
# `senior` cards in Ready are unassigned by design — seniors self-serve from
# their own pool — so they are counted separately, not reported as anomalies.
def _senior(n): return any(l['name']=='senior' for l in issues[n]['labels'])
_unass=[n for n,s in onboard.items() if s in cols[1:] and n in issues
        and not issues[n]['assignees']]
print('unassigned in Ready/In Progress/Review:',
      [n for n in _unass if not (onboard[n]=='Ready' and _senior(n))])
print('  of which senior-pool cards in Ready (expected, not a finding):',
      [n for n in _unass if onboard[n]=='Ready' and _senior(n)])

# `high-priority` — /fill-ready applies it to Ready cards only. Anywhere else
# it is a filing that slipped past the recipe or a card that moved with it on —
# except a card whose body carries the lead's `lead:` line, which ranks from
# any column (fill-ready, "The lead's `lead:` line ranks first").
# The body line is what /fill-ready re-derives against.
import re
def _lead(n): return re.search(r'^> \*\*High priority \([^)]*\):\*\* lead:', issues[n]['body'] or '', re.M)
def _hp(n): return any(l['name']=='high-priority' for l in issues[n]['labels'])
def _lane(n, lane): return any(l['name']==lane for l in issues[n]['labels'])
hp=[n for n in issues if _hp(n)]
print('high-priority outside Ready (Ready-only label):',
      [(n, onboard.get(n)) for n in hp if onboard.get(n)!='Ready' and not _lead(n)])
print('high-priority without a `> **High priority (` body line:',
      [n for n in hp if '> **High priority (' not in (issues[n]['body'] or '')])
for lane in ('developer','genealogist'):
    pool=[n for n,s in onboard.items() if s=='Ready' and n in issues
          and not issues[n]['assignees'] and _lane(n,lane)]
    marked=[n for n in pool if _hp(n)]
    if pool and 2*len(marked) > len(pool):
        print(f'{lane}: high-priority on {len(marked)}/{len(pool)} unassigned Ready — the ordering says nothing')
PY
```

The `high-priority` lines are reports, not removals — `/fill-ready` owns the
label and re-derives it on its next run.

Also report **stalled** work: anything in `In Progress` or `Review` whose
`updatedAt` is more than a week old, with its assignee. In Progress is a promise;
a card that has not moved in three weeks is either done and unclosed, blocked and
unsaid, or abandoned.

An unlabeled item is invisible to `/fill-ready`, which routes on
`developer` / `genealogist`. Propose the label; do not guess between the two when
the body genuinely leaves the lane open — several issues are deliberately
unlabeled because picking the lane *is* the task. Say which.

## 6. Verify before you repeat anything

Every factual claim you carry from a body into the report gets checked first — a
path, a line number, a count, a test outcome, a tool's behaviour. Cite what you
verified as `path:line` or as a command and its output.

This matters more here than in the per-issue skills. A weekly audit that repeats
a stale measurement launders it into something that looks freshly confirmed.

If you could not verify something, say so rather than repeating it with
confidence.

## Output shape

Open with the week's arithmetic — filed, closed, and whether this run's
proposals meet the target, naming the gap when they do not. Then the two or three
things that change what happens this week. Then:

1. **Obsolete** — what to close outright, and what needs a body correction rather
   than a close. One line of evidence each. Keep **blocked on an unmerged branch**
   as its own group: those are not obsolete, they are unbuildable, and the fix is
   naming the branch rather than closing the issue. Keep **freed — every blocker
   closed** (the blocker sweep) as its own group too, and put it first: those are the
   opposite of obsolete. They are startable work that has been parked, invisibly,
   for as long as the blocker has been closed, and they are this week's
   `/fill-ready` candidates.
2. **Clusters** — one block each: members, what binds them, decision pending, next
   action, doer, and **Since**. Lead with any next action that has not moved since
   a previous audit.
3. **The paid-run tax** — the table, which run to schedule this week, and any
   `next run:` issue that needs opening or closing.
4. **Hand to `/merge-issues`** — merge candidates this pass turned up and did not
   act on: re-filed cluster decisions, queues that grew since that pass ran, and
   any survivor reason this read contradicts. One line each, naming the issue
   furthest along. **Never a merge you already applied** — this section exists
   because this pass does not apply them.
5. **Decisions for the lead** — pulled out as its own list, phrased as questions
   with the options and what each costs. These are the spend and doctrine calls
   from the cluster and better-handling passes; they should not be buried inside
   a cluster block.
6. **Cross-cutting proposals** — only the ones with a real finding behind them.
   Two good ones beat six speculative ones.
7. **Board hygiene** — the mechanical list, terse.

Then stop and wait for approval. Apply only what he approves, one `gh` command
per approved item. Do not begin any of the work.
