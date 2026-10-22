<!-- Written 2026-10-14, before the runs, so the bar cannot move afterwards. -->

# R2 — the activation measurement, as a procedure

R2 is the single acceptance left for *Before phase 2*. It is a **measurement**, not a
build task: nothing needs writing, and the only way to fail it badly is to run it under
conditions that make the result meaningless and then spend three runs finding out.

## What R2 actually asks for

From `docs/plan/research-as-a-job-later-REVISED.md`, the *Acceptance* paragraph:

> a new browser session under the shipped profile, on an objective whose answer was
> checked not to be on the live tree before the run, with no slash command, invokes
> `research` in its first turn **on three consecutive runs, not one** […] and ends
> `completed` or `decision`, never `budget` or `no_progress`, and its feed is committed
> to the repo

Six conditions. All six must hold on all three runs.

| # | Condition | How it is satisfied |
|---|---|---|
| 1 | New browser session | Created through the web client, NOT seeded from a fixture |
| 2 | Shipped profile | `init-project` writes it; seeding would copy a fixture's "concise" profile instead |
| 3 | Answer absent from the live tree | A property of the QUESTION — see below |
| 4 | No slash command | Type the objective in plain words |
| 5 | `research` invoked in turn 1 | What is being measured |
| 6 | Ends `completed` or `decision` | Not `budget`, not `no_progress` |

Plus: each feed is committed.

## One objective, three runs — not three objectives

R2 cites "the repo's own protocol for a behaviour measured to flap", which is
`eval/CLAUDE.md` § "Clearing a card that names specific tests": `--runs-per-test 3` on
**the same test**. Three runs of one objective is therefore the correct reading, and it
is also the better measurement — holding the objective constant leaves the trigger as the
only variable, and the trigger is the thing #2927 measured as a coin flip.

## Choosing the objective: the trap

> "A `strip`-genre e2e fixture would NOT have worked here, and this is the trap to
> remember: those hide the answer by having the HARNESS block tree reads, and a browser
> session blocks nothing. **The answer has to be absent from the live tree as a property
> of the question.**"
> — `docs/captures/2026-09-29-mcandrew-children/README.md`

So of the 167 e2e fixtures, the 29 `strip` ones are disqualified outright: they hide the
answer by blocking reads, and a browser blocks nothing.

What survives is a question the tree **cannot** answer however completely it is read:

- **Completeness.** "Besides the five already in the tree, are there more?" A tree can
  show five; it can never show that five is all of them.
- **Hint adjudication.** "Is this record hint the same person?" The tree holds neither
  the comparison nor the verdict.
- **Conflict.** "Two sources give different dates — which is right?" The tree holds both,
  so reading it answers nothing.

A corpus scan found exactly **three** completeness-shaped `record-hint` fixtures:
`KN3K-9Q3` (Chresten Nielsen), `9VX4-1C3` (Heinrich Dewus), `G13G-P68` (Mary McAndrew).

## Recommended objective

> Did Mary E. McAndrew (G13G-P68) and her husband John Mogan of Detroit have any children
> besides the five already in the tree?

Three reasons over the other two:

1. It has already produced a **`completed`** run under exactly these conditions
   (2026-09-29, 133 minutes, 2,697 events), so condition 6 is known to be reachable.
2. Its answer-absence was verified against the live tree once already, so the check below
   is a re-confirmation rather than a first attempt.
3. Its true answer is that the record hint is a **false match** from a different Detroit
   family, so the run has to reason to "no" rather than accept a suggestion — which
   exercises the behaviour, not just the trigger.

**Not to be confused with R10.** The same person is named in the R10 clause — *"create a
research plan for Mary E. McAndrew (G13G-P68), wife of John Mogan of Detroit, but leave it at
that"* — which checks that a plan-only request stops at a rendered plan. That is a different
acceptance, a different question, and a different expected outcome. Do not substitute one
phrasing for the other: R2 needs the **children** question, which must run to a research
conclusion, not stop at a plan.

The 2026-09-29 run does **not** count as one of the three: it predates #3372 (the
delivered-exit enforcement) and #3393 (the nudge cap), so it measured a different build.

## Before spending anything: verify the answer is still absent

Free, and the step most likely to invalidate the whole exercise. On
familysearch.org, signed in normally — this needs no working app sign-in:

- [x] Open **G13G-P68** (Mary E. McAndrew) on the live tree.
- [x] Count the children attached to her and John Mogan. The 2026-09-29 check found
      **exactly five**.
- [x] If the count is still five, condition 3 holds: the tree cannot say whether five is
      all of them.
- [ ] (not triggered) **If a sixth has been attached since**, the question is now partly answerable by
      reading, and the objective is burned. Switch to `9VX4-1C3` or `KN3K-9Q3` and repeat
      this checklist against it.
- [x] Record the date and the count here before run 1, so the condition is evidenced
      rather than asserted.

**Verified 2026-10-14 by Praise: five children, unchanged from the 2026-09-29 check.**
The question stays unanswerable by reading the tree, so condition 3 holds and the three
runs may start. If this is being read after a later date, re-count before trusting it —
an attached sixth child burns the objective.

## Running it

Per run, three at a time, **one after another — commit each feed before starting the next**
so a failure costs one run rather than three.

1. New session through the web client. Do not seed, do not open an existing one.
2. Paste the objective in plain words. **No `/research`, no flags.**
3. Let it run. Do not intervene; a Stop makes the outcome `stopped` and the run void.
4. When it ends, record: did `research` fire on turn 1, and what was the outcome?
5. Export the feed and commit it under `docs/captures/`.

| Run | Date | `research` in turn 1? | Outcome | Feed committed |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

## Pass / fail

**Pass:** 3/3 invoke `research` in turn 1, and all three end `completed` or `decision`.

**Fail:** any run does not invoke `research` in turn 1 — that is the coin flip #2927
measured, and the point of the 3× bar.

**Void, re-run rather than count:** a run ending `budget` or `no_progress`, or one that was
stopped by hand. These measure the spend bound or an interruption, not the trigger.

## Cost

Three full research runs, with **no spend meter on this plane** (lead ruling 2026-09-25). `SESSION_SPEND_CAP_USD`
is defined in `app/agent/spend.py`, but every importer of that module is under `proto/` —
`real_agent.py` does not mention spend at all, so nothing meters or stops an alpha run. The one prior run of this
objective took **133 minutes**. Nothing stops a run automatically short of the sandbox
pausing about an hour after `LIVE_WINDOW_S` (4 h since the browser last attached).

Budget three runs of that order, watch them, and accept that a stop voids the run rather
than salvaging it.

## Currently blocked on one allowlist entry

Sign-in works. The earlier reading — that FamilySearch had dropped `email` from
`/platform/users/current` and shut the alpha to everyone — was wrong, and the measurement
behind it was one account. `email` is optional **per account**: it is returned only when
the account has a recovery email registered (churchofjesuschrist.org → Account Settings →
Recovery and Notifications), and the key is absent otherwise. Other people were signing in
normally throughout.

What remains is ordinary: `praisenato@gmail.com` has to be added to `ALLOWED_EMAILS`.
Nothing in the code needs to change for R2 — the gate works as designed, and only
allowlisted accounts sign in.
