---
name: triage-feedback
description: Use when the lead wants the kanban Feedback column worked — "triage the feedback", "work the feedback queue", "what feedback came in", "go through the feedback column", or a bare "/triage-feedback". Takes each untriaged alpha-feedback issue one at a time: reports what the tester said, verifies the claim against the repo, checks whether an issue already covers it, and puts one of three verdicts to the lead — Not planned, fold into an existing issue, or Backlog with written instructions for whoever picks it up. The gate between the feedback endpoint, which files raw submissions into the Feedback column, and /fill-ready, which ranks and promotes what reaches Backlog. Proposes first and applies only what the lead approves; never starts the work it scopes.
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

# Triage the feedback column

The feedback endpoint files every alpha submission into the **Feedback** column
labelled `feedback`. Nothing else reads that column: `/fill-ready` skips it,
`/review-ready` excludes it. This skill is the only thing that empties it.

**The `feedback` label means untriaged.** When an item leaves this column for
Backlog, the label comes off. That is the invariant `/fill-ready` depends on —
it treats a `feedback`-labelled item outside this column as a triage slip and
refuses to promote it.

**You propose, then apply what is approved.** No branches, no PRs, no code edits.
You have no `Edit` or `Write` tool on purpose.

**One item at a time.** Report, verify, recommend, wait for the verdict, apply,
move on. Do not batch the report and do not run ahead of the lead.

## 0. The queue

```sh
PROJ_ID="PVT_kwDOC-DkVc4BUEYb"
STATUS_FIELD="PVTSSF_lADOC-DkVc4BUEYbzhBPBf8"
# Feedback 429222f8 / Backlog 0207fe08 / Not planned c44314b0

gh project item-list 1 --owner PioneerAIAcademy --format json --limit 1000 | jq -r '
  [.items[] | select(.status == "Feedback")]
  | sort_by(.content.number)
  | .[] | "\(.content.number)\t\(.id)\t\(.content.title)"'
```

Each item carries `id` (needed to move the card), `content.number`, `status`,
`title` and `labels`. **The list truncates silently at `--limit`** — if the row
count equals the limit you asked for, you lost rows.

**The project API throttles separately from the GraphQL budget.** A burst of
reads returns "API rate limit exceeded" while `gh api rate_limit` still shows
5000/5000. Read the board once at the start of the run and work from that
snapshot, re-reading only before a write.

**Oldest first**, and **cap the run at about eight.** The column is the queue, so
an item you did not reach is still there next run. Say how many are left when you
stop.

Two items with timestamps a few minutes apart are usually one tester resubmitting,
not two bugs. Open both before triaging either.

## 1. Report the feedback

The issue body carries the tester's own words — the five prose fields and their
`worked as expected` verdict. **Read the body; do not download the bundle** unless
the prose is genuinely insufficient, which is rare and worth saying out loud when
it happens. The Drive link is in the body when you need it.

Give the lead, in this order and nothing else:

1. **What the tester asked for**, in one line.
2. **What they say happened**, quoted where the wording matters.
3. **What they say should have happened**, and their `worked as expected` verdict
   — noting when the verdict says "yes" but the prose describes problems, which
   is common and means the prose wins.

## 2. Verify before you design anything

**Separate what the tester observed from what they concluded, and check the
conclusion against the repo.** Their observations are reliable — they were there.
Their diagnoses frequently are not, and a fix designed from a wrong diagnosis
builds the wrong thing. A refuted diagnosis routinely sits on top of a real
observation that is sharper than the report: "feature X is missing" where X ships
and works, but the project state that made them say it is genuinely broken.

For each claim, say which it is:

- **Confirmed** — you found the code, the doc, or the state that shows it.
- **Refuted** — the thing the tester says is missing or broken is present and
  working. Then ask what they actually saw, because something did happen.
- **Unverifiable from here** — needs the bundle, a live session, or a decision.
  Say so rather than guessing; "unverifiable" is a legitimate report.

**Name the files you read.** A verdict with no cited path is an opinion.

## 3. Check whether an issue already covers it

**Before the expensive code read, not after.** One bundle routinely produces
several findings that are already filed, and without this step it becomes several
duplicate issues.

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open \
  --limit 400 --search "<the fix site, not the topic>"
```

**Search by fix site, not by symptom.** Issues that collide almost never share a
title — they want different lines in the same file. Read `**Touches:**` lines.
`/audit-board` owns merge doctrine; use its verdicts, do not invent one here.

Search the open pool once, then stop. A second search rarely finds what the first
missed, and this skill is not the whole-board pass.

## 4. The three verdicts

Put one to the lead with a recommendation and the context behind it. He decides.

| Verdict | When | What you do |
|---|---|---|
| **Not planned** | Nothing to build: the agent behaved correctly, the ask is out of scope, the claim is refuted with nothing real underneath, or it is a duplicate submission of another feedback item. | Close with a one-line reason. The card moves itself. |
| **Fold into #N** | An open issue already covers it. | Comment on #N with what this case adds — a second instance, a new cost, a sharper repro. Then close the feedback issue pointing at #N. |
| **Backlog** | Real work nobody has filed. | Write the instructions below, relabel, and move the card. |

**A refuted claim is not automatically Not planned.** Ask what the tester saw
first — the observation under a wrong diagnosis is usually real.

**"Worked as expected: yes" is not automatically Not planned either.** Testers
tick it and then describe four problems. The prose decides.

**When one bundle holds several distinct problems, file one issue per problem**
and close the feedback issue pointing at all of them. Findings from one bundle
routinely belong to different lanes — a tool bug, a doctrine gap, a schema
question — and no one person can take them as a single card. Never leave one
issue holding N findings as rows.

## 5. Writing the Backlog issue

The instructions are the product of this skill. Whoever picks the card up has
none of your context, and `/review-ready` will read it before a junior does.

**Retitle it first.** A submission is titled `[feedback] 2026-08-25T22:22Z`,
which is a filing stamp, not a task. It reaches Ready as an ordinary issue and
someone self-serves from that column by reading titles — and `/fill-ready`,
`/audit-board` and `/merge-recent-issues` all rank, cluster and search on them.
Give it the same shape as every other issue on the board: what is wrong, stated
so it can be recognised without opening it.

```sh
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy \
  --title "<what is wrong, in a line>"
```

Write into the body:

- **`**Touches:**`** — the files the work would change, repo-relative,
  comma-separated, one line, near the top. This is what `/audit-board` and
  `/merge-recent-issues` search on later.
- **What the tester saw**, kept as evidence — leave the reproduced prose in place.
- **What you verified**, with paths, and which claims you refuted.
- **What to do about it**, concretely enough to start: the approach, the files,
  and what would show it worked.
- **What is deliberately not in scope**, when a finding has halves that belong to
  different lanes.

**Prefer a tool rule to skill prose.** If the thing can be decided by reading the
project documents alone, it is a writer-tool precondition, where it binds
everywhere and cannot be argued with — that is ADR-0011's test, and a prompt
sentence is the fallback, not the destination.

**Do not design the fix past the point the evidence supports.** "Diagnose why the
gate did not fire, then add the guard" is a task. A guessed root cause written as
instruction is worse than none, because the next person implements it.

## 6. Applying an approved verdict

**Not planned, or folding into an existing issue:**

```sh
# folding: leave the evidence on the issue that will carry the work
gh issue comment <N> --repo PioneerAIAcademy/cowork-genealogy --body "<what this case adds>"

gh issue close <FEEDBACK_ISSUE> --repo PioneerAIAcademy/cowork-genealogy \
  --reason "not planned" --comment "<why, or: covered by #N>"
```

Closing moves the card to Not planned on its own. Nothing else to do.

**Backlog:**

```sh
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy \
  --body-file <(...)                       # the instructions written above
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy \
  --add-label developer                    # or genealogist, by who does the work
gh issue edit <N> --repo PioneerAIAcademy/cowork-genealogy \
  --remove-label feedback                  # REQUIRED — the label means untriaged

gh project item-edit --id "<ITEM_ID>" --project-id "$PROJ_ID" \
  --field-id "$STATUS_FIELD" --single-select-option-id "0207fe08"
```

**Dropping the `feedback` label is not optional.** Leave it on and `/fill-ready`
reads the item as a triage slip and refuses to promote it, so the work you just
scoped never reaches anyone.

**Label by who does the work**, not by where the bug is: `developer` for anything
with a mechanical pass/fail — lints, CI, validators, harness, MCP tools, tooling
bugs. `genealogist` for fixture adjudication, record research, doctrine prose.

**Check the board write landed.** A `gh` token without the `project` scope fails
it while still reporting success, which looks exactly like it worked. Re-read the
item and confirm the column before you report the item done.

**Never set an assignee.** People self-serve from Ready and the lead hands work
out at standup.

## 7. Report

Per item, as you go: the verdict applied and the issue number it produced or
landed on. At the end of the run: how many you triaged, the split across the
three verdicts, and how many are still in the column.

**Do not propose the work.** Filing it well is the whole job.
