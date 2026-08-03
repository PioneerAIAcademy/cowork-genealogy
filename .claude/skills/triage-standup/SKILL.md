---
name: triage-standup
description: Use whenever the user pastes standup updates, daily reports, or per-person status notes from the ~21-person genealogy team and wants them made sense of — including a bare wall of updates with no instruction at all, or a conversational ask like "anything in here that needs my attention", "what do I need to know from these", "what should I bring up at standup", "triage the standup", or "who didn't report". Verifies every claim against the actual repo before repeating it, because standup reports are routinely wrong in both directions. Output: a roll call of who did not report, standup topics, Backlog tasks tagged lead/junior-genealogist/junior-developer, problematic PRs, and per-person replies, then files what is approved. Do NOT use for the three-person book-to-tree team (Wilson, Nnanna, Praise) — that team has its own triage-standup skill in its own repo, wants a different output, and files nothing. Reports and files only; never starts the work it proposes.
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
---

# Triage standup updates — genealogy team

Buried in the team's written updates are a few things that genuinely need the
lead's authority, several already-solved-by-someone-else duplicates, work that
will silently never ship, and one or two findings that exist nowhere but the chat
window. Your job is to find those, verify them against the repo, and hand him a
short, triaged read — plus a roll call and whatever he approves for filing.

**You produce lists and file issues. You do not start the work.** No branches, no
PRs, no code edits, no eval runs. Everything you propose becomes its own task for
a separate session. This is deliberate: triage is cheap and reversible, the work
is neither, and a session that starts implementing halfway down the list never
finishes the triage.

`Write` exists here for exactly one purpose — the daily summary file in section 6
— and `Edit` deliberately does not. Do not treat `Write` as permission to change
anything else, and note that `Bash` could obviously write anywhere too: the rule
is the constraint, not the tool list.

## 0. Check you have the right team

**If the names are Wilson, Nnanna or Praise, stop — this is the wrong skill.**
That is the book-to-tree team; its standup is triaged from
`/Users/dallan/pioneeradademy/book-to-tree`, which carries its own
`triage-standup` with a different output shape and files nothing. Say so and stop
rather than producing this team's four lists for them.

Everyone else belongs here: check the names against `references/roster.md`.

## 1. Roll call — who did not report

Do this **first**, before reading anything closely. It takes thirty seconds, it
is the easiest thing in the whole triage to forget, and it is the only output
that is about people rather than work.

Read `references/roster.md` and mark off every roster member who posted. Report
the ones who did not, by name. If everyone reported, say so in one line.

Three traps, all of which produce a wrong answer that looks right:

- **Being mentioned is not reporting.** Someone thanked in another person's
  update — "I finished the annotation for Adeyinka" — has not posted. Their name
  appears in the text, so a careless scan marks them present. Match on who
  *authored* an update, never on who is named in one.
- **People post under variants.** "Ebigide Jude" is `jude`; "Cia" is `collins`;
  "John Mark Peter-Brown" is `john`. The roster lists the variants seen so far.
  When you meet a new one, say so — the roster needs updating and that is the
  lead's call, not yours to silently assume.
- **A stale roster reports the wrong people as missing.** If a name in an update
  matches no roster entry, that is a finding: either someone new is posting or
  the roster is out of date. Surface it rather than dropping the update.

Do not editorialise. "Missing today: francis, adeyinka, edmund" is the whole
output. Why someone did not post is not yours to infer, and a guess about it
lands on a real person.

## 2. Verify before you repeat anything

This is the part that earns the skill its cost. A standup update is **a person's
claim about work**, not a fact about the repo. Repeating those claims back with
confidence is worse than useless — it launders an error into the lead's decisions.

Real cases from one morning:

- A report said "24 of our 27 tests flap across runs." The lead's own figure was
  >90% passing consistently. The number had been repeated up the chain unchecked.
- A PR titled for issue #799 ("extract records into research.json") contained
  **zero** changes to any `research.json`. The title was reporting intent, not
  contents.
- Someone reported pushing a graded fixture resolution. The branch had **zero**
  commits ahead of `main` and the issue had no comments — the day's most
  important finding existed only in the chat window.
- Two PRs looked like they conflicted. One was being deliberately split out of
  the other, exactly as intended.
- An analysis script reported a test writing no birth dates. The script was
  collapsing assertions that carried both a date and a place. The test was fine.

So: for every claim you intend to put in front of the lead, either **check it and
cite the evidence**, or **label it as reported-but-unverified**. Cite the way a
reviewer can re-check in seconds — `file:line`, a PR number, a command and its
output, a byte count. Note that the last example above is your *own* tooling
lying to you; when a quick script and the repo disagree, suspect the script
first.

When a check refutes something you already told the lead, say so plainly in one
sentence and move on. Silent correction is how the wrong number survives.

### Check state, not existence

The weakest triage confirms that a thing exists and stops. Each of these found
something a "does it exist?" pass missed:

- **Reachability.** For every PR or branch reported as done, confirm the commit
  is actually on main: `git merge-base --is-ancestor <sha> origin/main`. A PR
  merged into a feature branch *after* that branch already reached main is real,
  green, closed — and will never ship. Nobody notices, because every surface says
  "merged".
- **Where the irreplaceable artifact lives.** When someone reports a baseline, a
  goldset, or a corpus of annotations, ask whether it is in version control. That
  data is accumulated human judgment; it is the one thing in a repo that cannot
  be regenerated, and it is routinely gitignored because it is large.
- **What CI still does not cover.** "We added CI" is worth checking from the
  other side — list `.github/workflows/` and ask what has none. A repo can add
  its first backend suite the same week its frontend has zero.
- **The commit, not the claim.** The most consequential decision of a day is
  often in a commit message and absent from the standup — someone bypassing a
  gate, promoting a baseline, or accepting a diff wholesale. Read the log for the
  branches people mention.
- **Run the suite if it is cheap.** It converts "tests pass" into a number, and a
  failure that is environmental rather than a regression is still worth fixing:
  a suite that is red on every developer's machine teaches everyone to ignore red.
- **Drift in the shared contract doc.** `CLAUDE.md` / `AGENTS.md` carry counts
  and rules the team works from. Compare them against what shipped; stale numbers
  there mislead everyone silently.

## 3. Gather the repo state

Do this before reading the updates closely, so you read them against reality.

```sh
git fetch origin --quiet
gh pr list --state open --limit 60 --json number,title,headRefName,author,isDraft
gh issue list --state open --limit 150 --json number,title,assignees,labels,updatedAt
git log origin/main --oneline -25
```

Then, per open PR that an update mentions or that looks substantive:

```sh
git diff --name-only origin/main...origin/<branch>          # what it really touches
git diff --numstat  origin/main...origin/<branch>           # size, run-logs separated out
git log origin/main --oneline --not origin/<branch> | wc -l # how far behind main
```

For any PR touching `packages/engine/plugin/skills/*/SKILL.md` or
`packages/engine/plugin/agents/*.md`, measure the prose growth in bytes — these
are the product, and their size is budgeted:

```sh
git show origin/main:<path> | wc -c ; git show origin/<branch>:<path> | wc -c
```

Before proposing anything, check it is not **already an open issue** — including
one in the icebox pool, which is deliberately filed out of the way rather than
dropped:

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 300 \
  --search "<a distinctive phrase from the proposal>" --json number,title,labels
```

There is no staging file to check — the Backlog column on project 1 is the whole
queue. A proposal that duplicates an open issue is worse than no proposal: it
splits the discussion across two numbers.

## 4. The four lists

### List 1 — Standup topics

For the whole group, spoken aloud. Keep it to **about three items**. Two filters
do most of the shortening:

- **If a machine can enforce it, it is an issue, not a talking point.** Asking
  twenty people to remember a convention is strictly worse than a lint that fails
  the PR. When you catch yourself drafting "everyone should remember to X", move
  it to List 2 and drop it from here.
- **Never raise an individual PR with the group.** Those go in List 3, privately.

What survives is genuinely cross-cutting: a policy the team should hear once, a
workflow correction, a metric that is currently misleading everyone.

Match the team's actual tools. They update a branch by clicking GitHub's **Update
branch** button; telling them to rebase is telling them to do something they do
not do.

### List 2 — Proposed Backlog tasks

A table for the lead to approve *before* anything is filed, each row tagged with
who should do it:

| Owner tag | What belongs to them |
|---|---|
| **Lead** | Spend decisions (any paid eval run), doctrine calls, architecture, anything overriding another person's work, security triage, anything needing his authority |
| **Junior genealogist** | Fixture adjudication, run-log annotation, record research, and doctrine *questions* you have prepared for them (see below) |
| **Junior developer** | Lints, CI, validators, refactors, test fixes, tooling bugs, anything with a mechanical pass/fail |

A doctrine question can be handed to a genealogist only if you have done the
preparation: state the question in one sentence, show the conflicting evidence in
a table, give the options, and say what happens to the answer. "Decide this" with
no evidence is not a task.

Also flag, per row:
- **Sequencing** — which tasks collide on the same files, or contend for the same
  paid run, or should go to one person as a pair. The lead will ask "can I do
  these in parallel?", so answer it before he asks.
- **Icebox.** Mark any row that is a *candidate* rather than a decision — worth
  not losing, but nothing the lead has committed to. He is approving the label,
  not just the task, and a row he waves through as "sure, someday" filed without
  it silently joins every morning's ranking.
- **What you deliberately did NOT file, and why.** Over-filing is its own
  failure; a Backlog nobody can read is the same as no Backlog.

### List 3 — Problematic PRs

Private to the lead. **This is an exception list, not a survey of the queue.** A
PR earns a place here only if the lead has to *decide* something or the repo gets
worse without him — the defect changes what should be merged, or merging it does
damage that is hard to undo.

Leave out everything else, even when true and even when you checked it. Not
included: a PR waiting on review, review latency, a red check its author already
knows about, ordinary CI churn, or a PR that is simply fine. A list of eight PRs
where six are "awaiting review" trains him to skim, and then he skims the two
that mattered. Three entries is a good day; zero is a fine answer.

Each entry: the PR, the specific defect with evidence, and a verdict —
**merge / split / hold / needs an Update-branch click**.

Checks that have actually caught things:

- **Does the title match the contents?** Merging a PR that closes an issue it
  never touched leaves that work undone and invisible.
- **Does it grow a `SKILL.md` or agent body, and by how much?** Report bytes. The
  unit suite grades a single invocation in fresh context, so it will bless an
  addition as readily as a cut — a green run is not evidence that new prose
  earned its context.
- **Is it based on a stale `main` in a way a clean merge would silently undo?**
  The dangerous case is not a conflict; it is a hand-maintained file where the
  merge succeeds and the *content* regresses.
- **Does it duplicate or subsume another open PR / branch?** Including one that
  is a strict subset of the same author's newer work.
- **Is it prose patching something that became a tool contract?** Per
  `docs/skill-lifecycle.md` §5, most findings are tooling or eval defects; a
  prose edit never compensates for either.
- **Does it state the same rule three times, or add an unqualified absolute?**
  Appending an exception after an absolute is the shape behind repeated
  contradiction bugs in this repo.
- **Does it commit an unbounded new obligation?** e.g. a mandatory retry per
  name-word multiplies searches without limit.

### List 4 — Individual replies

**One or two sentences each. Name the one thing to do next and stop.**

These are messages the lead pastes to a person, not a briefing about them. He
already read your other lists, so the reply does not need to re-explain the
finding, recap what they said, or justify itself — it needs to be short enough
that he sends it without editing.

Skip anyone who needs nothing, and just say who you skipped.

Too long:

> On #964 the record shows a "conclusion is sound and well-documented" comment
> and then your approval; there's no request for the cited record, and it merged
> at 16:22Z. Can you go back and get the ark? Your own comment on #931 is exactly
> the bar — if it isn't cited that way it needs to be CHANGES_REQUESTED, not an
> approval.

Right:

> **Ruth** — #964 merged with your approval and no ark cited. Can you get the ark
> from Solomon, or flip it to changes-requested?

Lead with the correction where there is one. Route overlaps in a clause, not a
paragraph ("read #942 and #963 first — same problem"). Write in the lead's voice:
direct, no preamble, no praise sandwich.

## 5. File the approved tasks

Only after the lead approves List 2.

```sh
gh issue create --label developer|genealogist [--label icebox] \
  --assignee <login> --title "..." --body "..."
```

Add `--label icebox` to every row the lead approved as a candidate. That label is
the only thing separating a task from an idea once both are cards in Backlog:
`fill-ready` skips icebox items instead of re-ranking them every morning, and
`review-icebox` sweeps them on their own cadence. An icebox body must state its
**unblock condition** — the trigger to watch, the blocking issue, the gate that
must land — because that is what the sweep reads. An icebox card with no stated
trigger is the shape that rots.

**Everything you file lands in Backlog and stays there. Never set Ready.**
`.github/workflows/add-to-project.yml` fires on `issues: opened` and puts the
card in Backlog; that is the finished state for a triage-filed issue. Do not
call `gh project item-edit`, and do not move a card to Ready even for a fully
prepared doctrine question — preparing it well is what makes it *rankable*, not
what makes it started.

Promotion is `fill-ready`'s job, and it is a separate decision made against the
milestones with the whole Backlog in view. Triage cannot make that call from one
morning's updates, and a card jumped straight to Ready skips the `review-ready`
gate that vets work before a junior picks it up.

Assignee and label are yours to set, and both matter: an issue with no label
routes by whoever happens to pick it up. If the lane is genuinely undecided,
leave it unlabeled **and say so in the body**, so the missing label reads as a
decision rather than an oversight.

Then verify placement with `gh project item-list 1 --owner PioneerAIAcademy` —
every card you filed should read `Backlog`.

Write issue bodies so a fresh session can act with no other context: the
evidence, the file paths, the sequencing constraint, and what *not* to re-derive.
These issues exist precisely because the lead will open them in a different
session with none of today's conversation.

## 6. Write the day's summary file

Every run, after the lists are delivered, to
`/Users/dallan/pioneeradademy/cowork-status-updates/YYYY-MM-DD.md`. This builds
the institutional memory the lead reviews periodically to spot recurring
problems, regressions, and improvements — so it is not optional and not a nicety.

**Read `references/daily-summary-format.md` for the template and field rules, and
read the most recent existing file in that directory before writing.** That prior
file carries the `still_open` items you must carry forward and the `predictions`
you must resolve. Skipping it turns a memory into an archive.

Two things make this file worth its cost, and both are easy to skip:

- **`corrections`** — every claim verification refuted, including your own.
  Nothing else in the stack records what people believed and got wrong, and
  over months it shows which kinds of claims are unreliable and from where.
- **`still_open` with its original `since:` date** — an item whose date is two
  weeks old announces itself as a recurring problem without anyone running a
  retrospective.

Do not re-transcribe what GitHub already keeps forever. Merged PRs, commit
history and issue timelines are recoverable; who believed what, what was decided
in conversation, and which findings had no home are not.

Mention the file path in one line at the end of your response so the lead knows
it was written.

## Repo-specific costs to respect

**A paid eval run is the hidden price of most eval fixes.** Editing a skill body,
a rubric, or a test file flips that skill's run log inactive
(`check_runlogs.py` Rule 2), so landing it needs a fresh `--skill <name>` run plus
a genealogist annotation — roughly $8–12 and 45–65 minutes of machine time, plus
real human hours. Consequences for your lists:

- **Batch fixes per skill.** Three one-line fixes to the same skill, filed
  separately, cost three runs. Say so.
- Never propose a standalone one-line eval fix without naming its run cost.
- If a fix can ride along with a run already being spent, say which.
- When a re-run is needed, **name the directory it must happen in** — the change
  usually lives in a worktree, and a run from the wrong directory produces a run
  log that still fails Rule 2.

**Which findings have no home?** Scan the updates for anything reported only in
chat — no issue, no PR, no commit. The most consequential finding of the day is
often in this category precisely because it did not fit anyone's current task.
Say who should write it down and where.

**Label every reference.** Write "PR #994" or "issue #995", never a bare `#994` —
GitHub numbers issues and PRs from one shared sequence, so a bare number sends
the reader to a list it does not appear in. Add state when it matters ("PR #991,
already merged").

## Output shape

The roll call first — one or two lines — then the four lists in order, with
headings. Put the single most consequential item first inside each list rather
than ordering by author or by PR number.

End with what needs the lead's decision before anything else can move, and stop.
Do not begin any of it.

Close with **one thing worth saying back to the team** — a habit visible in the
reports that is worth making standard. It costs a sentence, it is the only
positive signal in the whole triage, and it is what makes the good practice
spread instead of just the corrections.
