# Vendored: the description / trigger optimizer (from Anthropic's skill-creator)

`scripts/` here is vendored **verbatim** from Anthropic's `skill-creator` skill
(`anthropics/skills`, `skills/skill-creator/scripts/`) — the
description/trigger-optimization half of it:

- `run_loop.py` — train/test split + iterate a blinded description improver,
  best-by-held-out-score
- `run_eval.py` — fakes the skill as a throwaway `.claude/commands/<name>.md`
  and runs real `claude -p`, detecting whether Claude consults the skill
- `improve_description.py` — the blinded improver (≤1024-char descriptions)
- `generate_report.py` — the per-iteration HTML report
- `utils.py`, `__init__.py`

**Do not edit these files.** They are kept byte-identical so upstream drift is
easy to track; if upstream changes, re-copy. The package name `scripts` is
preserved because the modules import each other as `from scripts.X import ...`;
run them as `python -m scripts.run_loop` from this directory (`eval/triggering/`).

What it does: tunes a skill's SKILL.md `description` (the trigger surface the
Cowork orchestrator reads) against a `[{query, should_trigger}]` set. It does
**not** execute the skill or any MCP tool — only measures whether Claude decides
to consult the skill. This is the *description* loop; the *body* loop is the
`skill-improver` agent.

Driven in this repo by:
- `build_eval_set.py` — derives the query set from the unit-test corpus
- `make optimize-skill SKILL=<name>` — build the set, then run the loop

**On-demand only.** It needs the `claude` CLI, network access, and incurs model
cost (real `claude -p` calls). It is **not** part of CI and has not been run
end-to-end in this repo yet — the first team use validates it; treat its output
as advisory and apply the proposed description as a human-reviewed SKILL.md edit.
`make optimize-skill` writes `results.json` + the HTML report to
`eval/runlogs/optimizer/<ts>/` (excluded from the release gate + comparisons).

Spec / rationale: `docs/plan/skill-mcp-optimization-plan.md`; lifecycle: `docs/skill-lifecycle.md` §7.

Provenance: copied from the local skill-creator cache on 2026-06-10. Record the
upstream commit here when re-vendoring.

## Local divergences from upstream

- **`encoding="utf-8"`** added to all `read_text()` and `write_text()` calls
  (utils.py, run_loop.py, run_eval.py, improve_description.py,
  generate_report.py). Without this, Python defaults to cp1252 on Windows
  and crashes on SKILL.md files containing em dashes or smart quotes, or
  HTML reports containing Unicode check/cross marks (✓/✗). Re-apply after
  re-vendoring.

- **`encoding="utf-8"`** added to `subprocess.run()` in
  improve_description.py. The `text=True` flag uses the system default
  encoding for stdin/stdout; on Windows that's cp1252, which crashes when
  the prompt contains Unicode characters from SKILL.md content. Re-apply
  after re-vendoring.

- **`shutil.which("claude")`** replaces bare `"claude"` in subprocess
  commands (run_eval.py, improve_description.py). On Windows, npm-installed
  CLIs are batch wrappers (`claude.cmd`); `subprocess.Popen` without
  `shell=True` cannot find them by bare name. `shutil.which` resolves the
  full path on all platforms. Re-apply after re-vendoring.

- **Thread-based pipe reader on Windows** in run_eval.py. The original
  `select.select()` + `os.read()` streaming loop raises `OSError` on
  Windows because `select` only works on sockets there, not on pipe file
  descriptors. Replaced with a platform-conditional block: Windows uses a
  daemon reader thread feeding a `queue.Queue`; Unix keeps the original
  `select`-based path. Re-apply after re-vendoring.
