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
  and crashes on files containing em dashes, smart quotes, or Unicode
  symbols like checkmarks (U+2713) and ballot-X (U+2717) in the HTML
  report. Re-apply after re-vendoring.

- **`encoding="utf-8"`** added to `subprocess.run()` in
  improve_description.py. The `text=True` flag uses the system default
  encoding (cp1252 on Windows) for stdin/stdout. The prompt contains
  SKILL.md content with Unicode characters (e.g. arrows U+2192) that
  cp1252 cannot encode. Re-apply after re-vendoring.

- **`shutil.which("claude")` for CLI resolution** (run_eval.py,
  improve_description.py). On Windows, `claude` is installed as
  `claude.cmd` by npm. Bare `"claude"` in `subprocess.Popen/run` raises
  `[WinError 2] The system cannot find the file specified`.
  `shutil.which()` resolves the full path including `.cmd` extension.
  Re-apply after re-vendoring.

- **Thread-based pipe reader on Windows** (run_eval.py).
  `select.select()` only works on sockets on Windows, not on pipe file
  descriptors from `subprocess.PIPE`. Replaced with a daemon reader
  thread that feeds chunks into a `queue.Queue`, preserving the
  early-exit streaming detection. The Unix code path (`select` +
  `os.read`) is unchanged. Re-apply after re-vendoring.
