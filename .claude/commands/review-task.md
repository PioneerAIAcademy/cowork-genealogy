---
description: Vet ONE issue before handing it to a junior developer. Dispatches to the read-only task-reviewer agent; never edits the issue, a label, or the board without approval.
argument-hint: <issue-number>
---

Run the **`task-reviewer`** agent against the issue named in `$ARGUMENTS`.

For a whole shortlist, use `/review-ready` instead — it fans out one agent per
issue in parallel and collates the verdicts. This command is the single-issue
door to the same agent, for when one task needs vetting and a fan-out is
overkill. Rationale and contracts:
[`docs/specs/task-review-spec.md`](../../docs/specs/task-review-spec.md).

## Step 1 — Resolve the issue, and check it needs reviewing

`$ARGUMENTS` must name one issue number. Empty, or more than one → say so and
stop; a fan-out is `/review-ready`'s job.

Then read it and skip in two cases, saying which:

- **It already carries `reviewed`.** Re-reviewing costs ~110k tokens and
  produces the same verdict. Only re-run when the user explicitly asks, or when
  the body has changed since — check `updatedAt` against the review.
- **The body is empty or a single line.** There is nothing to review. That is a
  `/fill-ready` rewrite verdict: ask the filer for a scope line instead.

## Step 2 — Dispatch

Call the Agent tool with `subagent_type: "task-reviewer"` and exactly this:

```
Review issue #<N> in PioneerAIAcademy/cowork-genealogy for handoff to a junior
developer working with Claude Code. Follow your instructions exactly and return
your report in the specified format.
```

**Pass nothing else.** Not your opinion of the issue, not its board rank, not
what you suspect is wrong with it. An agent told what to expect finds it, and
the value here is a read that owes nothing to yours.

## Step 3 — Relay, and verify before acting

Print the verdict, the body edit and the `Checked` lines substantially intact.

**Then check the findings before acting on them.** Open the file, run the
command, confirm the claim — proposals as much as criticisms. A suggested
command or file name relayed without checking reads like an established thing to
whoever picks the issue up. Say what you rejected and why, alongside what you
accepted.

If the agent returns a **For the lead** block, write it into the issue body as a
`## Decision needed` block, passing each option through **verbatim** — the agent
read the spec, the ADRs and the code, and you did not. Do not ask it: whoever
runs this is not necessarily who answers. `/make-decisions` presents it.

## Step 4 — Apply what is approved

Every verdict has a write; a verdict you cannot act on does nothing.

| Verdict | Write |
|---|---|
| `ready` | `reviewed` label only |
| `ready-after-edit` | Prepend the agent's text, then `reviewed` |
| `needs-a-decision` | `needs-decision` label — **not** `senior`. One answer unblocks it and the work behind it is often junior |
| `senior` | `senior` label, no assignee. Keep the `developer`/`genealogist` label: it picks the lane, and CODEOWNERS routes the review by it |
| `stale-rewrite` | Replace the ask, keeping the original under an `## Original issue` heading |
| `close` | `gh issue close --reason "not planned"` with the reason |

Four rules on the writes:

- **Edit the body, not a comment.** The junior reads the body; a finding in a
  comment thread evaporates.
- **Prepend, never replace** — except `stale-rewrite`, where the premise moved
  and the ask is now wrong.
- **Open the body with the marker**, for whoever picks it up:

  ```
  > **Reviewed <YYYY-MM-DD> before junior handoff.** <one clause: decision
  > recorded below / no decision needed / premise was false>; the original body
  > follows under "Original issue".
  ```

- **`reviewed` goes on last**, after the body write lands. Labelling first and
  failing on the body leaves an issue that looks vetted and is not.

**Never apply both `senior` and `needs-decision`.** They are different states
with different remedies — one wants a person, the other wants an answer — and an
issue carrying both tells the board neither.

**Never answer a fork yourself.** Every open fork gets its `## Decision needed`
block and the `needs-decision` label. `/make-decisions` is the only place a
ruling is taken and applied.

## Step 5 — Do not move the board

Promotion and demotion belong to `/fill-ready`. A `senior` or
`needs-a-decision` verdict means the issue stays where it is, out of the junior
pool; report it so the next fill can swap it. Do not start the work either.
