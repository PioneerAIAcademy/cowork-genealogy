# Review instructions

Read by the managed cloud reviewer when a senior comments `@claude review` on a
PR. It runs by request only, so every run should earn its cost: report what a
careful reviewer would stop the PR for, and stay quiet otherwise.

This repo is mostly prose — skills, agent prompts, specs, docs. Calibrate for
that, not for a production service. A 400-line `SKILL.md` diff is normal and is
not, by itself, anything.

## Severity

`CLAUDE.md` is the rulebook and you have already been given it. Apply the rules
from there; this file only says how hard to press.

Default: a newly introduced `CLAUDE.md` violation is 🟡 Nit.

**Escalate to 🔴 Important** for the eight below. Each has shipped from this
repo at least once and no CI job catches any of them. The trigger column is
only what to look for — apply the rule as `CLAUDE.md` states it, not as
paraphrased here.

| Trigger | `CLAUDE.md` § |
|---|---|
| An MCP tool in a plugin agent's `tools:` or `disallowedTools:` listed under only one of the two server spellings | Cowork plugin agents → **Dual-spelled tool names** |
| A `research.json` or simplified-GedcomX change that edits some of its sites and not all | **Researcher profile in `research.json`** |
| Python `read_text` / `write_text` / `open` on a text file without `encoding="utf-8"` as a keyword | **Python file I/O: always pass `encoding="utf-8"`** |
| A `gh project` command or an `addProjectV2ItemById` call | **Repository layout** → deferring work creates an issue |
| A `select:mcp__…` query in a plugin skill or agent body | Cowork plugin agents → **Never hardcode a qualified name in a ToolSearch query** |
| A skill or agent body told to `Read` a sibling reference file at runtime | Cowork plugin agents → **No playbook/reference files for agents** |
| Network access or a non-stdlib import under a skill's `scripts/` or under `packages/engine/plugin/hooks/` | **Plugin hooks**; **What NOT to do** |
| A path in `packages/engine/plugin/hooks/` that can raise instead of falling through to allowing the call | **Plugin hooks** |

Everything else — naming, structure, wording, refactoring, missing tests — is
🟡 Nit at most.

`CLAUDE.md` is the only file you can assume you have. Specs, ADRs, and
everything else this repo references are not injected; a finding that depends on
one must quote what you actually read.

## Cap the nits

At most five Nits per review; if you found more, say "plus N similar" in the
summary. Post no Nits at all on prose style, heading structure, or word choice
in `.md` files.

## Do not report

- Anything CI enforces: `make test-all`, vitest, pytest, lockfile drift,
  co-author, run-log, and e2e-fixture checks.
- `releases/`, `build/`, `node_modules/`, `*.lock`, `pnpm-lock.yaml`.
- Run logs and `.ann.json` under `eval/runlogs/` — recorded output, not
  authored code.
- Fixture and scenario JSON under `eval/tests/` and `eval/fixtures/`, unless the
  change breaks schema validation.

## Verification bar

A behavior claim needs a `file:line` citation in the source. Do not infer
behavior from a name, a comment, or a doc.

Do not post a finding that rests on what a prompt will cause a model to do.
Prompt behavior in this repo is established by eval runs, not by reading — a
confident claim about it costs the author a round trip and settles nothing.

## Re-review

After the first review of a PR, post Important findings only. Do not raise new
Nits on a later push.

## Summary shape

Open the review body with a one-line tally: `2 important, 4 nits`. When there
are no Important findings, lead with "No blocking issues."
