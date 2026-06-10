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
