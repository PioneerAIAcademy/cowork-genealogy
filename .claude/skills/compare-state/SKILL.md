---
name: compare-state
description: Compare the current state of a feedback case directory
  (research.json, tree.gedcomx.json, results/) against the prose
  description of what went wrong or what should have happened, from
  _feedback/feedback.json. Use after the agent has run against a
  feedback-case directory to either (a) confirm the reported bug
  reproduces, or (b) verify a fix produces the desired outcome.
  Invoke as `/compare-state --against=what-went-wrong` or
  `/compare-state --against=desired`. Reports a structured verdict
  with a bullet list of specific discrepancies.
allowed-tools:
  - Read
  - Bash
  - Glob
---

# compare-state

Compares the current state of a feedback-case directory against the
user's prose description of what went wrong (or what should have
happened), and reports whether the state matches.

This skill is part of the feedback-case workflow documented in
[`docs/specs/feedback-case-spec.md`](../../../docs/specs/feedback-case-spec.md).
You are running inside an unzipped case directory wired by
`scripts/setup-feedback-case.sh`.

## Invocation

```
/compare-state --against=what-went-wrong   # confirms the bug reproduces (§3.2 step 6)
/compare-state --against=desired            # verifies the fix (§3.3 step 11)
```

The `--against` flag picks which field of `_feedback/feedback.json`
serves as the comparison target:

- `what-went-wrong` → `agent_did`
- `desired` → `agent_should_have`

## Steps

### 1. Validate the case fixture

Read `_feedback/feedback.json` from the current working directory.
Verify:

- The file exists and parses as JSON.
- `schema_version` is `1`.
- `user_prompt` is a non-empty string.
- The target field (`agent_did` for `what-went-wrong`,
  `agent_should_have` for `desired`) is present and non-empty.

If any check fails, abort with a message that names the specific
field and points the user at
`cowork-genealogy-ui/docs/feedback-json-spec.md` §3. Do not proceed to the LLM
comparison — surfacing a bad case fixture here is much better than
a downstream judgment producing nonsense.

### 2. Read the current state

Read the case directory's state files:

- `research.json` (always — the most likely place mutations land)
- `tree.gedcomx.json` (always)
- Any file with a `git diff` against the baseline commit. Use:
  ```bash
  git -C <case-dir> diff --name-only HEAD
  git -C <case-dir> ls-files --others --exclude-standard
  ```
  to find both modified-tracked and untracked files. Read those too.

You should also read the most recent transcript turns from this
Claude Code session as additional context — what tool calls did the
agent just make, and what did they return? This is implicit context
you already have; no special tool call needed.

### 3. Reason about the comparison

Compare the state and the recent agent behavior against the target
prose. Be specific. For `--against=what-went-wrong`, ask:

> "Does the current state, plus what just happened in this session,
> match the user's description of what went wrong?"

For `--against=desired`, ask:

> "Does the current state, plus what just happened in this session,
> match the user's description of what should have happened?"

Identify concrete points: which timeline entries are present, which
sources, which proof summaries, which plan items, which sidecars in
`results/`. What's missing or wrong relative to the prose.

### 4. Output the verdict

Print to the Claude Code session, in this order and shape:

```
**User prompt:** <verbatim contents of user_prompt from feedback.json>

**Verdict:** matches | partial | does-not-match

**Findings:**
- <one bullet per concrete observation, mapped to the prose>
- ...

**Next:** <one sentence on what the user should likely do next>
```

The verdict labels mean:

- **matches** — the state matches the target prose. For
  `what-went-wrong`, the bug reproduces; iterate next. For
  `desired`, the fix is working; promote next.
- **partial** — most of the prose is captured but at least one
  bullet is missing or off. The user decides whether to keep
  iterating.
- **does-not-match** — the prose and the state diverge
  meaningfully. For `what-went-wrong`, the bug did **not**
  reproduce (re-run, or escalate as "doesn't reproduce locally");
  for `desired`, the fix is not working — keep iterating.

The first line (`**User prompt:** …`) gives the user a stable
buffer to copy from when starting the next iteration, without
re-opening `_feedback/feedback.json`.

### 5. Stop

This skill produces no file artifacts. The verdict is the entire
output. The user reads it and decides what to do.

## Cost

One LLM reasoning pass per invocation. There are no MCP tool calls
beyond Read / Bash / Glob for file inspection. Use Claude Sonnet 4.6
(the default model).

## Decision rules

| Situation | Action |
|---|---|
| `_feedback/feedback.json` is missing | Abort with "Not a feedback-case directory. Run `scripts/setup-feedback-case.sh <zip>` first; see docs/specs/feedback-case-spec.md §3.1." |
| `_feedback/feedback.json` exists but the target field is empty | Abort with "feedback.json has empty `<field>`. Per `cowork-genealogy-ui/docs/feedback-json-spec.md` §3, this field is required and must be non-empty. Have the submitter resubmit." |
| `--against` flag missing or invalid | Print usage (`--against=what-went-wrong` or `--against=desired`) and abort. |
| The case directory has no git baseline (no `.git/`) | Warn but continue — the user may be running this outside the standard setup. State-diff falls back to reading the canonical files only. |
| The user invokes this from a directory that is NOT a feedback case (no `_feedback/`) | Abort with the message in row 1 above. |
| The state and prose agree but the agent's session transcript shows the agent never actually attempted the work | Verdict is `does-not-match` for `desired` (agent didn't try) or `does-not-match` for `what-went-wrong` (didn't reproduce). Note in **Findings** that the agent took no relevant action. |
