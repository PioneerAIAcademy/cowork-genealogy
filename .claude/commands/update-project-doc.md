---
description: Update README.md and CLAUDE.md (and optionally other docs) to reflect the latest state of the project. Asks clarifying questions before editing and waits for review before declaring done.
---

You are updating project documentation to match the current state of this
repository. Follow the steps in order. Do not skip ahead — clarifying
questions come **before** edits, and the dev's review comes **before**
"done".

## Step 1 — Detect what changed

Run these in parallel and read the docs that may need editing:

- `git log main..HEAD --oneline` — commits on this branch
- `git status --short` — uncommitted modifications
- `git diff main...HEAD --stat` — files touched on this branch
- Read `README.md`, `CLAUDE.md`, `PROJECT-GOAL.md` so you know their
  current shape and voice before proposing edits

If the branch has no diff against `main` and a clean working tree, ask
the dev what they want documented before continuing — there may be
intent (a planned change, an external decision) that isn't reflected
in code yet.

## Step 2 — Summarize and confirm scope

Summarize what changed in 2–4 plain-prose bullets, in the dev's terms
("shipped the search tool", "added the spec-review agent", "renamed X
to Y"). Don't list every file — group by intent.

Then use `AskUserQuestion` to confirm:

1. **Is this the change to document?** (yes / no, let me describe it /
   only some of it)
2. **Which files should be updated?** README.md and CLAUDE.md are the
   default. Also offer:
   - `PROJECT-GOAL.md` — only relevant if the change affects a tool
     tracked there (`wikipedia_search`, `places`, `login`/`logout`/
     `auth_status`, `collections`, `search`, `tree`, `cets`). Skip
     for changes that don't touch those tools.
   - `docs/specs/` — if a spec was added or changed and CLAUDE.md
     should link to it
   - Other (free-text) — let the dev name additional files (e.g., a
     testing guide under `docs/`)
3. **Anything to emphasize or omit?** Free-text. Use this to steer
   tone (e.g., "don't mention the WAF workaround, that's an
   implementation detail", "lead with the corpus-size win for
   search").

Do not edit anything until the dev has answered.

## Step 3 — Edit, file by file

For each file in scope, identify the specific sections to change.
Don't rewrite whole files. State in one sentence what you're about
to change before each `Edit` call.

Patterns that match the existing style (read surrounding text first):

- **README.md** — tools table under "What it does today"; usage
  example under "Try it out" if the new tool benefits from one;
  "Project status" paragraph. Keep the table column order:
  Tool / Purpose / Auth.
- **CLAUDE.md** — "Implemented tools" for shipped tools (mirror the
  existing `collections` entry: signature, returns, spec link);
  "Specced tools (not yet implemented)" for shipped specs whose code
  isn't merged yet. Move a tool between these sections when its
  status changes — don't leave it in both. If the change is to the
  auth module, "Auth architecture" is the section to edit.
- **PROJECT-GOAL.md** — flip the row in the Task Progress table
  (Phase 0–4); update "Current Focus" if the phase advanced. Only
  edit if the dev confirmed it in Step 2.
- **docs/specs/** — if linking a new spec from CLAUDE.md, double-
  check the file exists and the path is right.

Match the existing voice across all files: terse plain prose, no
marketing, no emojis, no forward-looking promises about unshipped
work, no "we're excited to" framing. The repo's docs describe what
*is*.

## Step 4 — Hand off for review

After all edits are applied, summarize each edit as one bullet:
file + section + what changed (e.g.,
"README.md §What it does today — added `search` row").

Then say:

> "Run `git diff` to inspect the full patch. Reply 'done' when
> you're satisfied, or tell me what to adjust."

Do **not** mark anything complete and do **not** commit. Wait for the
dev to reply "done" (or equivalent) before considering the task
finished. If they ask for adjustments, edit, re-summarize, and ask
again.

## Conventions to honor

- No Claude attribution in commit messages or PR descriptions.
- No emojis in any doc.
- Don't introduce new top-level sections unless the dev asks —
  extend existing ones.
- When citing a spec, link to `docs/specs/<tool>-spec.md` exactly
  as the existing entries do.
- If a tool has shipped, move it from "Specced tools (not yet
  implemented)" to "Implemented tools" in CLAUDE.md.
- Don't add backwards-compatibility hedges ("formerly known as X")
  unless renames are user-visible and the dev asks for it.
