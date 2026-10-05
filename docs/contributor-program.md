# Contributor program

Seven very junior developers, called Contributors, start together, each
working about 10 hours a week for three months, with a Claude Code subscription
and FamilySearch and OpenRouter credentials. Each has their own mentor, one of
seven developers on this project who also work at another company; no mentor
has more than one Contributor. The program is for the
Contributor: real production experience, and a mentor who can recommend them to
that company from first-hand experience. It is not a hiring pipeline.

## How it works

- **Week 1 is a cohort start.** The lead runs a one-hour kickoff where everyone
  gets the repo, credentials and Claude Code working together, then starts
  V0 from `docs/contributor-issue-drafts.md`.
- **From week 2, Contributors are their mentor's helpers.** The mentor names a
  piece of their own work in one line: tests for code they just wrote, a
  `dev/try-*.ts` smoke script for their tool, the viewer or web half of a
  feature whose engine half they own, reproducing a bug report, or running the
  "Done when" check on their PR in a browser. The Contributor writes the issue,
  labelled `developer` and `contributor`, with its own "Done when"; the mentor
  approves it. When the mentor has nothing suitable, they pick a draft instead.
- **Nothing waits on a Contributor.** A piece can take two weeks, so the
  mentor's own PR must never be blocked on it. Each piece is its own PR to main,
  never a branch stacked on the mentor's.
- **Review:** the Contributor runs `/review` on their own PR first; the mentor
  does the required review. Every PR carries a screenshot and a "how I verified
  this" section.
- **Check in with your mentor every day you work:** done, next, stuck on.
  Stuck for an hour after asking Claude? Send your mentor what you tried.
- **A 30-minute call with the mentor every week**, on what is next and where they
  are stuck.
- **Week 3:** a Contributor with no merged PR, or a week without a check-in and
  no notice, decides with the mentor whether to continue.
- **Week 6:** in that week's call the mentor decides whether the Contributor is
  ready for their own issues. Three merged helper PRs is the usual bar. A ready
  Contributor takes one issue through `docs/task-lifecycle.md`: plan,
  `/critique-plan`, implement, review.
- **A ten-minute demo to the team in the last week**, mentor invited.

Never hand a Contributor anything on a Beta critical path, anything labelled
`cluster:` or `needs-decision`, or a SKILL.md or agent-body edit (draft V19 has
the one exception).

## The recommendation

The recommendation is the mentor's to write to their own company. What counts:
sensibly sized PRs, checking the change in a browser and not just in tests,
reading the tests they changed, how they respond to review, whether they ask the
right question when stuck, whether their plan survives `/critique-plan`, and the
demo.

## Before week 1 (lead)

Pair each Contributor with a mentor, file V0, create the `contributor` label,
and schedule the kickoff.
