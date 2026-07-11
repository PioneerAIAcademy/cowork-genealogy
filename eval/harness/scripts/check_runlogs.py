#!/usr/bin/env python3
"""GH Action: enforce the per-PR runlog contract.

Three blocking rules + one warn-only rule per
docs/plan/eval-runlog-versioning.md §C6:

    Rule 1   ≤1 added-or-renamed-into-place v{N}.json per skill.
    Rule 2   latest full-skill run log per touched skill is "active on
             skill-side files" (snapshot matches working tree).
    Rule 2b  (warn-only) the same run log's judge_prompt_hash matches
             eval/harness/judge/prompt.md.
    Rule 3   the same run log's .ann.json has corrections for every
             (test_id, dimension_source, dimension_name) triple.

Run by .github/workflows/check-runlogs.yml. Self-contained — only uses
stdlib + the harness's own `snapshot.py` and `versioning.py` modules.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
sys.path.insert(0, str(HARNESS_DIR))

from harness.snapshot import agent_refs_in_text, diff_snapshot_vs_disk, hash_file  # noqa: E402
from harness.versioning import classify  # noqa: E402


REPO_ROOT = HARNESS_DIR.parents[1]
RUNLOGS_DIR = REPO_ROOT / "eval" / "runlogs" / "unit"
JUDGE_PROMPT_PATH = REPO_ROOT / "eval" / "harness" / "judge" / "prompt.md"
PLUGIN_SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
TESTS_UNIT_DIR = REPO_ROOT / "eval" / "tests" / "unit"


# Match `eval/runlogs/unit/<skill>/<file>.json`
RUNLOG_PATH_RE = re.compile(r"^eval/runlogs/unit/([^/]+)/([^/]+\.json)$")

# Match `packages/engine/plugin/agents/<name>.md` — a plugin agent prompt.
# An agent edit gates every skill whose SKILL.md references `@plugin:<name>`
# (the agent body is embedded in those skills' run-log snapshots), exactly
# like an edit inside the skill dir itself.
AGENT_PATH_RE = re.compile(r"^packages/engine/plugin/agents/([^/]+)\.md$")


# Orchestrator skills exempt from the per-skill runlog rules (2 + 3). These
# skills are validated by e2e GPS fixtures, not unit tests, so by design they
# have no `eval/tests/unit/<skill>/` scaffolding and no
# `eval/runlogs/unit/<skill>/` dir. Without this exemption, any edit to the
# skill body hard-fails with "no run logs" and the `eval-cosmetic-skip` label
# can't clear it — that escape hatch only relaxes rule 2 once a runlog dir
# already exists.
RUNLOG_GATE_EXEMPT_SKILLS = frozenset({"research"})


def gh_error(message: str, *, file: str | None = None) -> None:
    """Emit a GitHub error annotation (also fails the step)."""
    prefix = f"::error file={file}::" if file else "::error::"
    print(f"{prefix}{message}")


def gh_warning(message: str, *, file: str | None = None) -> None:
    prefix = f"::warning file={file}::" if file else "::warning::"
    print(f"{prefix}{message}")


def git_diff_changes() -> list[tuple[str, str | None]]:
    """Return [(status_letter, path)] for AR-filtered changes in the PR.

    Uses --diff-filter=AR so newly-added files AND renamed-into-place
    files (the candidate → released flow) both count. Rule 1's
    released-runlog counting keys off this view.
    """
    base = os.environ["BASE_SHA"]
    head = os.environ["HEAD_SHA"]
    out = subprocess.check_output(
        ["git", "diff", "--name-status", "--diff-filter=AR", base, head],
        text=True,
    )
    rows: list[tuple[str, str | None]] = []
    for line in out.splitlines():
        parts = line.split("\t")
        if not parts:
            continue
        status = parts[0]
        # "A\t<path>" or "R<score>\t<from>\t<to>"
        if status.startswith("A"):
            rows.append(("A", parts[1]))
        elif status.startswith("R"):
            rows.append(("R", parts[-1]))  # dest path
    return rows


def git_diff_touched_paths() -> list[str]:
    """Every path changed in the PR, regardless of status (added, modified,
    deleted, renamed — both sides of a rename).

    The touched-skill detection for rules 2 + 3 keys off this view: a
    *modification* to a SKILL.md, test JSON, or referenced plugin agent
    invalidates the run-log snapshot just as surely as an addition, so the
    AR-only view rule 1 uses would miss it.
    """
    base = os.environ["BASE_SHA"]
    head = os.environ["HEAD_SHA"]
    out = subprocess.check_output(
        ["git", "diff", "--name-status", base, head],
        text=True,
    )
    paths: list[str] = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        paths.extend(p for p in parts[1:] if p)
    return paths


def skills_referencing_agents(skills_root: Path) -> dict[str, set[str]]:
    """Map each plugin-agent name to the skills whose SKILL.md references
    it via `@plugin:<name>`. One scan over the skill corpus."""
    mapping: dict[str, set[str]] = {}
    if not skills_root.is_dir():
        return mapping
    for skill_md in sorted(skills_root.glob("*/SKILL.md")):
        try:
            text = skill_md.read_text(encoding="utf-8")
        except OSError:
            continue
        for agent in agent_refs_in_text(text):
            mapping.setdefault(agent, set()).add(skill_md.parent.name)
    return mapping


def rule1_max_one_released(touched_releases: dict[str, list[str]]) -> int:
    """Rule 1: ≤1 added/renamed-into-place v{N}.json per skill."""
    fails = 0
    for skill, files in touched_releases.items():
        if len(files) > 1:
            paths = ", ".join(files)
            gh_error(
                f"skill `{skill}`: {len(files)} released run logs added/renamed in this PR. "
                f"Max is 1. Offending files: {paths}",
            )
            fails += 1
    return fails


def latest_full_skill_runlog(skill_dir: Path) -> tuple[str, dict] | None:
    """Return (filename, parsed_log) for the latest full-skill run log
    in `skill_dir` — preferring released v{N}.json, then candidate
    v{N}_<ts>.json. Scratch runs ignored.
    """
    released: list[tuple[int, str]] = []
    candidates: list[tuple[int, str, str]] = []
    for path in skill_dir.iterdir():
        if not path.is_file():
            continue
        c = classify(path.name)
        if c.kind == "released" and c.version is not None:
            released.append((c.version, path.name))
        elif c.kind == "candidate" and c.version is not None and c.timestamp is not None:
            candidates.append((c.version, c.timestamp, path.name))

    if released:
        released.sort(reverse=True)
        filename = released[0][1]
    elif candidates:
        candidates.sort(reverse=True)
        filename = candidates[0][2]
    else:
        return None
    return filename, json.loads((skill_dir / filename).read_text(encoding="utf-8"))


def rule2_active(skill: str, log: dict, filename: str) -> int:
    """Rule 2 (blocking): latest run log's snapshot matches disk.

    Cosmetic-skip escape hatch: when `COSMETIC_SKIP=1` (set by the workflow
    because a senior applied the `eval-cosmetic-skip` label on this PR), a
    snapshot mismatch is downgraded to a warning instead of a block — the
    prior run log + its already-complete annotations stand without a re-run.
    The label is auto-removed on every new push (see check-runlogs.yml), so
    the bypass can never outlive the commit it was approved for. Only rule 2
    is relaxed: rules 1 and 3 still run, so an unannotated baseline can't be
    waved through.
    """
    snapshot = log.get("snapshot") or {}
    diffs = diff_snapshot_vs_disk(snapshot, REPO_ROOT)
    if not diffs:
        return 0
    diff_lines = "\n".join(f"  - {p}: {kind}" for p, kind in sorted(diffs.items()))
    if os.environ.get("COSMETIC_SKIP") == "1":
        gh_warning(
            f"skill `{skill}`: latest run log `{filename}` differs from the working "
            f"tree in {len(diffs)} file(s), but the `eval-cosmetic-skip` label "
            f"bypasses rule 2 for this PR — no re-run required. Confirm the change "
            f"is behavior-neutral before approving.\n" + diff_lines,
        )
        return 0
    gh_error(
        f"skill `{skill}`: latest full-skill run log `{filename}` is NOT active — "
        f"{len(diffs)} snapshot file(s) differ from the working tree. Re-run the "
        f"harness (`uv run python eval/harness/run_tests.py --skill {skill}`) so "
        f"the run log reflects the PR-branch state. If the change is purely "
        f"cosmetic (no behavior change), a senior can instead apply the "
        f"`eval-cosmetic-skip` label to this PR.\n" + diff_lines,
    )
    return 1


def rule2b_judge_prompt(skill: str, log: dict, filename: str) -> None:
    """Rule 2b (warn-only): judge_prompt_hash matches current judge prompt."""
    expected = log.get("judge_prompt_hash") or ""
    actual = hash_file("eval/harness/judge/prompt.md", JUDGE_PROMPT_PATH)
    if expected and actual and expected != actual:
        gh_warning(
            f"skill `{skill}`: latest run log `{filename}` was scored against an "
            f"older judge prompt (hash {expected[:12]}…). Current judge prompt "
            f"hash is {actual[:12]}…. Re-running would likely produce different "
            f"scores — interpret the corrected mean cautiously.",
        )


def rule3_completeness(skill: str, log: dict, filename: str, skill_dir: Path) -> int:
    """Rule 3 (blocking): every dimension has a correction entry in .ann.json."""
    ann_filename = filename.removesuffix(".json") + ".ann.json"
    ann_path = skill_dir / ann_filename
    if not ann_path.exists():
        gh_error(
            f"skill `{skill}`: latest run log `{filename}` has no annotation file "
            f"(`{ann_filename}` missing). Review every dimension before opening "
            f"the PR.",
        )
        return 1
    ann = json.loads(ann_path.read_text(encoding="utf-8"))
    corrections = ann.get("corrections") or []
    # Guard against malformed / hand-written corrections before building the
    # reviewed-set. Annotations must come from the CRUD UI; a hand-edited or
    # stale-tool file can omit the required keys (notably the deprecated
    # `run_index`/`dimension`/`source` shape Claude tends to emit when asked
    # to write a .ann.json directly). Without this guard the set-comprehension
    # below dies with an opaque `KeyError: 'dimension_source'` instead of a
    # reviewable error. See the eval/CLAUDE.md note: never hand-write .ann.json.
    REQUIRED_KEYS = ("test_id", "dimension_source", "dimension_name")
    malformed = [
        c
        for c in corrections
        if not (isinstance(c, dict) and all(k in c for k in REQUIRED_KEYS))
    ]
    if malformed:
        gh_error(
            f"skill `{skill}`: annotation `{ann_filename}` has {len(malformed)} "
            f"of {len(corrections)} correction(s) missing required keys "
            f"{REQUIRED_KEYS} — likely hand-written or in the deprecated "
            f"run_index/dimension/source shape. Annotations must be produced by "
            f"the CRUD UI, not written by hand. Delete the file and re-review "
            f"every dimension in the UI.",
        )
        return 1
    have = {
        (c["test_id"], c["dimension_source"], c["dimension_name"])
        for c in corrections
    }
    missing: list[tuple[str, str, str]] = []
    for t in log.get("tests") or []:
        for d in t.get("outcome_summary", {}).get("aggregated_dimensions") or []:
            key = (t["test_id"], d["source"], d["name"])
            if key not in have:
                missing.append(key)
    if not missing:
        return 0
    sample = ", ".join(f"{tid}/{src}/{name}" for tid, src, name in missing[:5])
    gh_error(
        f"skill `{skill}`: annotation `{ann_filename}` is incomplete — "
        f"{len(missing)} dimension(s) are unreviewed (e.g., {sample}). "
        f"Review every dimension in the CRUD UI before opening the PR.",
    )
    return 1


def main() -> int:
    changes = git_diff_changes()

    # Collect (skill -> [filename]) for added/renamed-into-place released
    # files. Rule 1 enforces ≤1 per skill.
    touched_releases: dict[str, list[str]] = {}
    for _, path in changes:
        if path is None:
            continue
        m = RUNLOG_PATH_RE.match(path)
        if not m:
            continue
        skill, filename = m.group(1), m.group(2)
        if classify(filename).kind == "released":
            touched_releases.setdefault(skill, []).append(path)

    # Touched-skill detection for rules 2 + 3 uses the any-status view: a
    # modification invalidates a snapshot just like an addition.
    touched_paths = git_diff_touched_paths()
    touched_skills: set[str] = set()
    touched_agents: set[str] = set()
    for path in touched_paths:
        m = RUNLOG_PATH_RE.match(path)
        if m:
            # Any change under eval/runlogs/unit/<skill>/ touches that skill.
            touched_skills.add(m.group(1))
            continue
        # Changes to skill files / tests surface their owning skill.
        m = re.match(r"^(?:packages/engine/plugin/skills|eval/tests/unit)/([^/]+)/", path)
        if m:
            touched_skills.add(m.group(1))
            continue
        m = AGENT_PATH_RE.match(path)
        if m:
            touched_agents.add(m.group(1))

    # A touched plugin agent gates every skill whose SKILL.md references
    # `@plugin:<name>` — the agent body is part of those skills' run-log
    # snapshots, so editing it outside eval discipline must fail rule 2.
    if touched_agents:
        referencing = skills_referencing_agents(PLUGIN_SKILLS_DIR)
        for agent in sorted(touched_agents):
            touched_skills |= referencing.get(agent, set())

    # Drop orchestrator skills with no unit suite by design (see
    # RUNLOG_GATE_EXEMPT_SKILLS) so a skill-body edit doesn't hard-fail the
    # per-skill rules with no way to clear them.
    touched_skills -= RUNLOG_GATE_EXEMPT_SKILLS

    # Drop DELETED skills: when a PR removes a skill entirely — its skill dir
    # AND its unit-test dir are both absent from the working tree — there is
    # nothing left to re-run, so rules 2 + 3 have no gate target. Historical
    # runlogs under eval/runlogs/unit/<skill>/ may stay behind as history.
    # A skill with EITHER dir still present is still gated (a half-deleted
    # skill is an inconsistent state the gate should surface, not skip).
    touched_skills = {
        s
        for s in touched_skills
        if (PLUGIN_SKILLS_DIR / s).is_dir() or (TESTS_UNIT_DIR / s).is_dir()
    }

    fails = rule1_max_one_released(touched_releases)

    if not RUNLOGS_DIR.is_dir():
        print(f"No runlogs directory at {RUNLOGS_DIR}; skipping rules 2 + 3.")
        return 1 if fails else 0

    for skill in sorted(touched_skills):
        skill_dir = RUNLOGS_DIR / skill
        if not skill_dir.is_dir():
            gh_error(
                f"skill `{skill}` was touched but has no run logs at "
                f"`eval/runlogs/unit/{skill}/`. Re-run the harness with "
                f"`--skill {skill}` and commit the result before opening this PR.",
            )
            fails += 1
            continue
        latest = latest_full_skill_runlog(skill_dir)
        if latest is None:
            gh_error(
                f"skill `{skill}` was touched but has no full-skill run log. "
                f"Re-run the harness with `--skill {skill}` to produce one.",
            )
            fails += 1
            continue
        filename, log = latest
        fails += rule2_active(skill, log, filename)
        rule2b_judge_prompt(skill, log, filename)
        fails += rule3_completeness(skill, log, filename, skill_dir)

    if fails:
        print(f"\n{fails} rule violation(s). See annotations above.")
        return 1
    print("All runlog rules satisfied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
