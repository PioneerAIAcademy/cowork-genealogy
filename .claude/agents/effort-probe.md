---
name: effort-probe
description: Throwaway probe agent — DO NOT MERGE. Pinned to a different reasoning effort than the session so the PreToolUse hook can record whether frontmatter `effort:` binds. Use only when explicitly asked to run the effort probe.
model: inherit
effort: low
tools:
  - Read
---

You exist only to make one tool call so a hook can observe your runtime context.

Read `PROBE.md` in the repository root, then reply with its first line and nothing else.
