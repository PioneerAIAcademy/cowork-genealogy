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

from harness.snapshot import diff_snapshot_vs_disk, hash_file  # noqa: E402
from harness.versioning import classify  # noqa: E402


REPO_ROOT = HARNESS_DIR.parents[1]
RUNLOGS_DIR = REPO_ROOT / "eval" / "runlogs" / "unit"
JUDGE_PROMPT_PATH = REPO_ROOT / "eval" / "harness" / "judge" / "prompt.md"


# Match `eval/runlogs/unit/<skill>/<file>.json`
RUNLOG_PATH_RE = re.compile(r"^eval/runlogs/unit/([^/]+)/([^/]+\.json)$")


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
    files (the candidate → released flow) both count.
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
    """Rule 2 (blocking): latest run log's snapshot matches disk."""
    snapshot = log.get("snapshot") or {}
    diffs = diff_snapshot_vs_disk(snapshot, REPO_ROOT)
    if not diffs:
        return 0
    gh_error(
        f"skill `{skill}`: latest full-skill run log `{filename}` is NOT active — "
        f"{len(diffs)} snapshot file(s) differ from the working tree. Re-run the "
        f"harness (`uv run python eval/harness/run_tests.py --skill {skill}`) so "
        f"the run log reflects the PR-branch state.\n"
        + "\n".join(f"  - {p}: {kind}" for p, kind in sorted(diffs.items())),
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
    touched_skills: set[str] = set()
    for _, path in changes:
        if path is None:
            continue
        m = RUNLOG_PATH_RE.match(path)
        if not m:
            continue
        skill, filename = m.group(1), m.group(2)
        if classify(filename).kind == "released":
            touched_releases.setdefault(skill, []).append(path)
        # Any change under eval/runlogs/unit/<skill>/ touches that skill.
        touched_skills.add(skill)

    # Also: changes to skill files / tests / fixtures / scenarios should
    # surface their owning skill as "touched" for rules 2 + 3.
    for _, path in changes:
        if path is None:
            continue
        m = re.match(r"^(?:packages/engine/plugin/skills|eval/tests/unit)/([^/]+)/", path)
        if m:
            touched_skills.add(m.group(1))

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
