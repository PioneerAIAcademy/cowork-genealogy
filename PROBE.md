# Runtime-context probe — DO NOT MERGE

A throwaway build that answers two questions no offline check can, by observing a
real `PreToolUse` payload instead of reading a declaration.

## What it answers

1. **Does an agent's frontmatter `effort:` bind?** `AgentDefinition.effort` is in
   the pinned SDK, but the plugin ships agents as markdown and the hosted path
   stages them as files — the route with open upstream reports of `effort` being
   dropped while `model:` from the same block is honored. `record-extractor` is
   pinned `effort: low` here against a session default of `high`, so the two are
   unmistakable.
2. **What does a session actually expose?** The server prefix on each tool name,
   and whether `agent_id` is present at all. Every lint we have stops at the
   declared name.

## Run it

Install this build, open a genealogy project, and run any extraction — one record
through `record-extraction` is enough, since it delegates to `record-extractor`.

Then send back `_probe/runtime-context.jsonl` from the project folder.

## Reading the result

One JSON line per matched tool call. The two that matter:

- A row **with** `agent_id` is a call from inside the subagent; one **without** is
  the main thread. The subagent row also carries `agent_type`, which names which agent.
- **`effort` is an object, not a string** — it reads `"effort": {"level": "low"}`. A grep
  for `"effort": "low"` finds nothing.
- If the subagent's rows show `{"level": "low"}` while the main thread's show the session
  level, frontmatter effort **binds**. If both read the same, it does **not**, and the
  accepted bet in `ADR-0010` needs re-scoping to the programmatic route.

**Confirmed in Claude Code, 2026-08-25:** main thread `{"level": "xhigh"}`, `effort-probe`
subagent `{"level": "low"}`, same session, same `prompt_id`. Cowork is the remaining leg.

`tool_name` on every row gives the prefix census as a side effect, which is the
same ground truth issue #1732 collects by hand.

## Why it must not merge

`effort: low` on `record-extractor` degrades extraction on purpose, and the probe
hook writes a file into the user's project on every matched call. Neither belongs
in a shipped build. The hook itself is additive and safe —
`guard_project_files.py` and its matcher are untouched, and the probe returns an
empty decision on every path including every failure path — but its *purpose* is
diagnostic.

## What was verified before handing this over

- Five payload shapes exercised, including garbage stdin, empty stdin and an
  unwritable `cwd`: every one returns `{}` (allow) and exits 0.
- `tool_input` is never recorded — it carries record content.
- `packages/engine/mcp-server` packaging suite: 576 passed, including
  `plugin-hooks.test.ts`, whose guard-matcher assertion reads `PreToolUse[0]` and
  so is unaffected by the appended second entry.
- `check_skill_frontmatter.py`: 27 skills + 6 agents clean with `effort:` added.
