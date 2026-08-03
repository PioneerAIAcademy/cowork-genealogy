# Daily summary format

One file per day, written after the lists are delivered, to
`/Users/dallan/pioneeradademy/cowork-status-updates/YYYY-MM-DD.md`.

The date is the date of the standup being triaged, not today's date if you are
catching up.

## Why the structure matters

A year of these has to answer questions like *"how many times did an agent
fabricate a source?"*, *"is review latency getting better or worse?"*, *"what did
we think was true in July that turned out wrong?"* — by grep and diff, in
seconds. Free prose cannot do that. So each file is **structured frontmatter a
machine reads, over prose a human reads**, and the frontmatter fields are fixed.

The other half of the reason: this file must hold what git **cannot** recover.
Merged PRs, commit history, and issue timelines are in GitHub forever — do not
re-transcribe them. What disappears is who *believed* what, what was decided in
conversation, which findings had no home, and which claims turned out to be
wrong. Write that.

## Template

```markdown
---
date: 2026-07-30
team: genealogy
reported: [mercy, israel, ruth, adedotun]
missing: [francis, adeyinka, edmund]
themes: [fabricated-evidence, eval-instrument, untracked-finding]
issues_filed: [970, 971, 972]
still_open:
  - id: senior-review-missed-ark
    since: 2026-07-30
    what: "PR #964 merged a TRUE-MATCH adjudication citing zero arks, past senior review"
    owner: lead
predictions:
  - claim: "record-extraction 024 will fail on the next run once matchers land"
    made: 2026-07-30
    resolved: null          # next run fills this in: true | false | unresolved
corrections:
  - who: adedotun
    claimed: "24 of 27 record-extraction tests flap across runs"
    actual: "9 of 27 changed outcome across the two committed runs; >90% pass consistently"
    kind: metric
  - who: ruth
    claimed: "I asked the PR for the cited record"
    actual: "no request in the review record — a comment and an empty approval"
    kind: action-not-taken
---

## What happened

Three to six sentences. The shape of the day, not a list of merges.

## Decisions and their reasons

Only decisions made in conversation that the repo will not record. Skip if none.

## Notes

Anything worth a future reader's time that does not fit above. Keep it short.
```

## Field rules

- **`themes`** — from the controlled vocabulary below, nothing else. A new theme
  is a deliberate act: add it to this file in the same run and say you did. If
  every day invents labels, the pattern-matching this exists for stops working.
- **`still_open`** — carry forward yesterday's entries that are still unresolved,
  keeping their original `since:` date. That date is the signal: an item whose
  `since` is two weeks old is a recurring problem, and it says so without anyone
  running a retrospective.
- **`predictions`** — anything asserted about what a future run or change will
  do, including your own. Next run resolves it. This is the only mechanism that
  distinguishes a real improvement from variance.
- **`corrections`** — every claim in the updates that verification refuted, with
  `kind:` one of `metric`, `action-not-taken`, `wrong-target`, `stale`,
  `overstated`. Record your own refuted claims here too, attributed to `triage`.
  Over months this is the most valuable field in the file.
- **`issues_filed`** — numbers only. The issue itself holds the detail.

## Controlled theme vocabulary

Add deliberately; never invent inline.

| Theme | Use when |
|---|---|
| `fabricated-evidence` | an agent or person asserted a source/record that does not exist |
| `eval-instrument` | the measuring apparatus (judge, rubric, harness) is the problem, not the thing measured |
| `untracked-finding` | something important lived only in chat, with no issue/PR/commit |
| `stale-base` | work built on an out-of-date base, or a clean merge that regressed content |
| `unreachable-work` | merged/complete work that will never reach main |
| `silent-failure` | a system did nothing and looked fine |
| `prose-vs-tooling` | a prose edit used where a tool or eval fix was the real lane |
| `over-merge` | two different people or records combined on insufficient evidence |
| `review-latency` | work sat waiting on review long enough to matter |
| `duplicate-effort` | two people independently doing the same thing |
| `context-budget` | prompt/context size growth, or the cost of it |
| `spend` | a decision that costs real money (paid runs, infra) |

## Before writing: read yesterday

Read the most recent existing file in the same directory first. It gives you
`still_open` to carry forward and `predictions` to resolve. Without that step
this is an archive; with it, it is a memory.

If the directory is empty, this is day one — say so in `## What happened` and
carry nothing.
