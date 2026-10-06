# Contributor program

Seven very junior developers, called Contributors, each paired with one mentor
from this project, work about 10 hours a week for three months. They get
production experience and a recommendation from the mentor to the mentor's
other company. It is not a hiring pipeline. As in GSoC, mentoring costs time in
month 1; the payback is a helper doing the mentor's real work.

## How it works

- **Week 1:** a one-hour kickoff gets everyone's repo, credentials and Claude
  Code working.
- **From week 2:** the mentor hands over a small piece of their own work that
  nothing waits on: tests, a `dev/try-*.ts` smoke script, a bug repro, a browser
  check of their PR. The Contributor files it as an issue labelled `developer`
  and `contributor`, with a "Done when", and opens its own PR to main, small
  enough to review in half an hour, with a screenshot and "how I verified this".
  They run `/review` before the mentor reviews it.
- **Contact:** a short check-in each working day (done, next, stuck) and a
  30-minute weekly call.
- **Week 3:** no merged PR, or a silent week, means deciding together whether
  to continue.
- **Week 8:** the mentor decides whether the Contributor is ready for an issue
  of their own (usually about four merged PRs) and picks one to run through
  `docs/task-lifecycle.md`. Not ready is fine; they keep helping.
- **Last week:** a ten-minute demo to the team.

Never hand a Contributor Beta critical-path work, a `cluster:` or
`needs-decision` issue, or a SKILL.md or agent-body edit.

## The recommendation

The mentor writes it, from: PR size, checking changes in a browser, reading the
tests they changed, response to review, asking good questions when stuck, and
the demo.

## Before week 1 (lead)

Pair Contributors with mentors, create the `contributor` label, and schedule
the kickoff.
