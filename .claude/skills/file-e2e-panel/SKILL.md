---
name: file-e2e-panel
description: Use when the lead wants a fresh batch of e2e panel runs filed — "file the e2e panel", "file the e2e runs", "I need more genealogist tasks", "who needs to run an e2e test", or a bare "/file-e2e-panel", any time, as often as wanted. Files one issue per panel fixture — four more on every run, unconditionally — each an unassigned half-day task a genealogist can take, so the e2e corpus gets runs from more than one operator. Also reports each fixture's last run and proposes closing panel issues nobody has taken in two weeks. Proposes first and applies only what the lead approves; never runs an e2e test itself, never writes the project board.
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
---

# File a batch of e2e panel runs

The e2e tier is the only measurement of the whole research loop, and it had one
operator: runs per ISO week fell 43 → 37 → 12 → 4 → 4 → 1 → 1 over the seven weeks
to 2026-09-07, so every corpus report opens on a two-run window and nothing can be
compared week over week. Four issues per batch, filed separately, is how the work
reaches four people instead of one.

**Run this whenever more panel work is wanted — twice in a week, or not at all for
three.** Every run files four more. Nothing here is anchored to a calendar week, and
there is no cadence to keep to.

**You propose, then apply what is approved.** No branches, no PRs, no code edits,
and you never run an e2e test yourself — each issue is someone else's half-day.
You have no `Edit` or `Write` tool on purpose.

**Never write the project board.** `add-to-project.yml` cards each new issue into
Backlog on its own. A `gh` token without the `project` scope fails a board write
*while appearing to succeed*, so do not run `gh project` commands.

## 0. Pool facts

Repo `PioneerAIAcademy/cowork-genealogy`, project **1**. The panel is fixed:

| Fixture | Why it is on the panel |
|---|---|
| `eval/tests/e2e/spriggs-parents-1898/` | deepest run history |
| `eval/tests/e2e/hannah-earnest-children/` | deepest run history |
| `eval/tests/e2e/anders-monsen-ancestry/` | deep history, non-US locality |
| `eval/tests/e2e/cruz-corona-ancestry/` | deep history, Spanish-language records |

**Fixed on purpose.** Fixture difficulty varies enormously, so a month's aggregate
is comparable to the next month's only if the mix is constant. Do not swap a
fixture in because it looks more interesting today — that silently ends the
comparison the panel exists for. The panel is defined once, in `PANEL` in
`eval/harness/e2e/panel_report.py`, and `eval/harness/tests/unit/test_e2e_panel_report.py`
fails if this table and that constant disagree.

## 1. Check the label exists, before anything else

```sh
gh api repos/PioneerAIAcademy/cowork-genealogy/labels/e2e-panel
```

**Non-zero exit: stop and tell the lead.** Everything below depends on this label,
and its absence is invisible in the obvious places — `gh issue list --label
e2e-panel` on a missing label exits **0 with empty output**, which reads exactly
like a clean board, and `gh issue create --label e2e-panel` fails *without filing
the issue*. Skip this check and you report "nothing stale, four filed" on a run
where nothing happened. One-time fix:

```sh
gh label create e2e-panel --repo PioneerAIAcademy/cowork-genealogy \
  --description "One e2e panel run; filed by /file-e2e-panel" --color 1D76DB
```

## 2. Read where the panel stands

```sh
make e2e-panel
```

Per fixture: its last run and how many days ago, plus its run count over the last 28
days. `SINCE=all` for the whole history — the all-time counts are a different number
from the trailing-month ones, and it is the trailing month that says whether the
panel is working.

**This gates nothing.** You file four either way. The number is what you report to
the lead, and the thing to say out loud when it stays at zero: issues are being filed
and not run, which is a staffing problem, not a filing problem.

## 3. File four issues

One per fixture, every run, unassigned. No conditions — not "the ones that have no
run yet", not "the ones whose last issue closed", and not "only if the last batch is
gone". Four more, every time.

```sh
gh issue create --repo PioneerAIAcademy/cowork-genealogy \
  --label genealogist --label e2e-panel \
  --title "e2e panel run <YYYY-MM-DD>: <slug>" \
  --body "..."
```

The date is **today**, the same for all four in the batch, so batches are
distinguishable in a list and the label query stays exact. Two batches on one day is
fine — the issue numbers differ, and that is a deliberate ask for eight, not a
mistake to guard against.

Body, short — the guide holds the detail:

```
**Touches:** eval/runlogs/e2e/<slug>/

Run the `<slug>` e2e fixture, grade it, and land the run log. Half a day, most of
it waiting.

The fixture is already authored, so this is the short route through
`docs/e2e-testing-guide.md`: steps **0, 5–9**. Skip 1a/1b/2/3 (authoring) and 4
(live debugging) — a debug pass only delays the measurement.

    make e2e-preflight            # Windows: eval\CheckSetup.bat
    make e2e-login                # Windows: eval\Login.bat   (~24h token)
    make e2e-run TEST=<slug>      # Windows: eval\RunE2E.bat   20–60 min

Then in Claude Code, in this checkout:

    /interpret-e2e-result         # what happened, in plain language
    /grade-e2e-run                # blind grading -> run-<ts>.ann.json

If it fails, read `narration[]` alongside `tool_calls[]` before blaming a skill —
guide step 7. Then one PR carrying `run-<ts>.json`, `run-<ts>.ann.json` and both
`.final-*` siblings. `check_e2e_fixtures.py` blocks a run log that ships without
its annotation, so the grading is same-PR by construction.

Close this issue yourself once that PR merges. Nothing closes it for you — the
sweep below skips assigned issues, and a run-log PR carries no closing keyword.

Cost: $5–12 of API spend. `make e2e-latency TEST=<slug>` shows this fixture's own
last recorded figure.
```

**Do not paste a run's expected findings into the body.** The grading pass in step
8 is blind by design, and a body that names the answer corrupts the calibration
number this whole tier rests on.

## 4. Sweep the panel issues nobody took

Unconditional filing accumulates: a batch nobody picks up is still there when the
next one lands, and a genealogist facing sixteen near-identical issues cannot tell
which is live.

```sh
gh issue list --repo PioneerAIAcademy/cowork-genealogy --state open --limit 300 \
  --label e2e-panel --json number,title,assignees,createdAt
```

**`--limit` defaults to 30 and truncates silently**, newest first — so the default
hides exactly the old issues this step exists to close, and the pool it hides can
then only grow. Confirm the returned count is below the limit you asked for before
trusting it.

Propose closing each one that is **older than 14 days**, **unassigned**, and has
**no linked PR**.

**Age, not "the previous batch."** Filing twice in one week is a supported thing to
do, and a sweep that closed whatever predates today's batch would delete the first
half of a deliberate double-fill. Fourteen days is the line: past it, nobody was
going to take it.

Check the no-PR half two ways and treat a hit from either as linked:

```sh
gh pr list --repo PioneerAIAcademy/cowork-genealogy --state open --search "<N> in:title,body"
gh issue view <N> --repo PioneerAIAcademy/cowork-genealogy --json closedByPullRequestsReferences
```

Neither alone is enough, and both failure modes propose closing work that is in
flight. `closedByPullRequestsReferences` sees only PRs carrying a **closing
keyword**, which a panel-run PR has no reason to use. And `in:body` alone misses
this repo's own convention of naming the issue in the **PR title** — measured:
PR #2151 is titled "person-evidence becomes a skill-agent pair (#1853)" and
`--search "1853 in:body"` returns nothing for it, while `in:title,body` finds it.

```sh
gh issue close <N> --repo PioneerAIAcademy/cowork-genealogy --reason "not planned" \
  --comment "Unclaimed for over two weeks; the <today> batch supersedes it."
```

**One at a time, and only what the lead approves.** Never batch this, and never
close an assigned issue — an assignee who has not finished is a conversation, not
a sweep.

## 5. Verify before you repeat anything

Every number you report comes from a command you ran this session — the coverage
from `make e2e-panel`, the open issues from `gh`. Do not carry a figure over from
last week's report, and do not quote a per-run cost median: nothing in this repo
computes one, so a dollar figure in prose is a hand-maintained copy that rots.

## Output shape

1. **Filed** — the four issues, one line each: fixture, title, and the fact that
   motivates it ("no run since 2026-07-13, 56d").
2. **Where the panel stands** — the `make e2e-panel` table, and one sentence on the
   trend. Say it plainly when the answer is that nobody has run it.
3. **Sweep** — panel issues proposed for closing, one line of reasoning each; and
   separately, the ones you are leaving because they are assigned or have a PR.
4. **Panel health** — how many open panel issues there are now, and whether the same
   fixture keeps going unrun. A pile of open panel issues means the panel is being
   filed and not staffed, which is the lead's to act on, not a reason to file fewer.

Then stop and wait for approval. File and close only what he approves. Do not
begin any of the runs yourself.
