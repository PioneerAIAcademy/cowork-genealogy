#!/usr/bin/env python3
"""Replay the three guide-written-once validators over locality-guide run logs.

`test_persisted_guide_is_the_guide` (a), `test_in_project_return_follows_the_contract`
(b) and `test_no_project_return_carries_guide` (c) in
`validators/test_locality_guide.py` (issue #3442). Nothing in CI runs a validator
over the committed run logs, so this replay is what states their real pass/fail set
before a paid run, and it is committed so the counts stay reproducible after
`PLAN.md` is deleted on merge.

Each run is rebuilt from its run log: the before state is the scenario's
`research.json` as it is in this checkout (None when the test has no scenario),
the after state is that plus the run's `output.file_changes["research.json"]`
diff. `tool_calls` and `agent_returns` are read as recorded, and the test's tags
come from its current test JSON (so a tag added since the run counts).

Results are per named log. A run whose output carries no `agent_returns` key (run
logs recorded before the harness kept it) is reported as `skip(no agent_returns)`
for (b) and (c) rather than scored; the validators themselves are unchanged.

Usage (from eval/harness):
    uv run python scripts/replay_locality_guide_validators.py [--list] [RUN_LOG ...]

With no RUN_LOG it walks the tracked `eval/runlogs/unit/locality-guide/v*.json`
(minus `.ann.json`); given paths (e.g. a gitignored `scratch_<ts>.json` under
`<runlogs-root>/unit/locality-guide/`) it reads exactly those. `--list` prints
each failure's message.
"""

from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import pytest

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]
SCENARIOS = REPO / "eval" / "fixtures" / "scenarios"
TESTS = REPO / "eval" / "tests" / "unit" / "locality-guide"
sys.path[:0] = [str(HARNESS / "validators"), str(HARNESS)]

import test_locality_guide as lg  # noqa: E402

NO_RETURNS = "skip(no agent_returns)"


def _check_a(before, after, out, test):
    lg.test_persisted_guide_is_the_guide(before, after)


def _check_b(before, after, out, test):
    lg.test_in_project_return_follows_the_contract(
        before, after, out.get("tool_calls") or [], out.get("agent_returns")
    )


def _check_c(before, after, out, test):
    lg.test_no_project_return_carries_guide(test, out.get("agent_returns"))


CHECKS = [
    ("(a)", "test_persisted_guide_is_the_guide", _check_a, False),
    ("(b)", "test_in_project_return_follows_the_contract", _check_b, True),
    ("(c)", "test_no_project_return_carries_guide", _check_c, True),
]


def tracked_logs() -> list[Path]:
    files = subprocess.run(
        ["git", "ls-files", "eval/runlogs/unit/locality-guide"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.split()
    return [
        REPO / f
        for f in sorted(files)
        if Path(f).name.startswith("v") and f.endswith(".json") and not f.endswith(".ann.json")
    ]


def tests_by_id() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for path in sorted(TESTS.glob("*.json")):
        test = json.loads(path.read_text(encoding="utf-8")).get("test") or {}
        if test.get("id"):
            out[test["id"]] = test
    return out


def scenario_research(scenario: str | None) -> dict | None:
    if not scenario:
        return None
    path = SCENARIOS / scenario / "research.json"
    if not path.exists():
        raise ValueError(f"scenario {scenario!r} has no research.json in this checkout")
    return json.loads(path.read_text(encoding="utf-8"))


def apply_diff(research: dict | None, change: dict | None) -> dict | None:
    """`research` with a `harness.diff.diff_research_json` diff applied: added
    entries appended, modified entries' changed fields set (a field whose `after`
    is null is dropped), deleted entries removed. The singleton `project` section
    is left as it was; no validator replayed here reads it.

    Raises ValueError when a modified entry's id is not in `research`: the
    scenario has changed since the run, so the after state cannot be rebuilt."""
    diff = (change or {}).get("diff") or {}
    if research is None and not diff:
        return None
    after = deepcopy(research) if research is not None else {}
    for section, delta in diff.items():
        if section == "project" or not isinstance(delta, dict):
            continue
        entries = [e for e in (after.get(section) or []) if isinstance(e, dict)]
        by_id = {e.get("id"): e for e in entries}
        for mod in delta.get("modified") or []:
            entry = by_id.get(mod.get("id"))
            if entry is None:
                raise ValueError(
                    f"{section} entry {mod.get('id')} was modified in the run but is not "
                    "in the scenario's research.json in this checkout"
                )
            for field, values in (mod.get("changed_fields") or {}).items():
                value = (values or {}).get("after")
                if value is None:
                    entry.pop(field, None)
                else:
                    entry[field] = value
        deleted = {e.get("id") for e in delta.get("deleted") or [] if isinstance(e, dict)}
        entries = [e for e in entries if e.get("id") not in deleted]
        entries.extend(deepcopy(e) for e in delta.get("added") or [] if isinstance(e, dict))
        after[section] = entries
    return after


def _state(research: dict | None) -> dict:
    return {
        "research_json": research,
        "tree_gedcomx_json": None,
        "tree_gedcomx": None,
        "files": {},
        "skill_frontmatter": {},
    }


def replay_log(path: Path, tests: dict[str, dict], show: bool) -> dict[str, dict[str, int]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    counts = {
        name: {"pass": 0, "fail": 0, "skip": 0, NO_RETURNS: 0, "error": 0}
        for _, name, _, _ in CHECKS
    }
    failures: dict[str, list[str]] = {name: [] for _, name, _, _ in CHECKS}
    messages: list[str] = []
    runs = 0
    for t in doc.get("tests") or []:
        test_id = t.get("test_id") or ""
        test = tests.get(test_id) or {"id": test_id, "tags": []}
        try:
            before_research = scenario_research(t.get("scenario"))
        except ValueError as e:
            for run in t.get("runs") or []:
                runs += 1
                label = f"{test_id.rsplit('_', 1)[-1]}#{run.get('run_index')}"
                for _, name, _, _ in CHECKS:
                    counts[name]["error"] += 1
                    failures[name].append(f"{label}!")
                print(f"STALE {path.name} {test_id} run {run.get('run_index')}: {e}")
            continue
        for run in t.get("runs") or []:
            runs += 1
            out = run.get("output") or {}
            change = (out.get("file_changes") or {}).get("research.json")
            before = _state(before_research)
            label = f"{test_id.rsplit('_', 1)[-1]}#{run.get('run_index')}"
            try:
                after = _state(apply_diff(before_research, change))
            except ValueError as e:
                for _, name, _, _ in CHECKS:
                    counts[name]["error"] += 1
                    failures[name].append(f"{label}!")
                print(f"STALE {path.name} {test_id} run {run.get('run_index')}: {e}")
                continue
            for tag, name, check, needs_returns in CHECKS:
                if needs_returns and "agent_returns" not in out:
                    counts[name][NO_RETURNS] += 1
                    continue
                try:
                    check(before, after, out, test)
                    counts[name]["pass"] += 1
                except pytest.skip.Exception:
                    counts[name]["skip"] += 1
                except AssertionError as e:
                    counts[name]["fail"] += 1
                    failures[name].append(label)
                    message = " ".join(line.strip() for line in str(e).splitlines())
                    messages.append(f"    {tag} {test_id} run {run.get('run_index')}: {message}")
                except Exception as e:  # noqa: BLE001 - a crash is a validator bug; surface it
                    counts[name]["error"] += 1
                    failures[name].append(f"{label}!")
                    messages.append(f"    {tag} {test_id} run {run.get('run_index')}: CRASH {type(e).__name__}: {e}")
    print(f"\n{path.name}: {runs} runs")
    for tag, name, _, _ in CHECKS:
        c = counts[name]
        parts = [f"{c['pass']} pass", f"{c['fail']} fail", f"{c['skip']} skip"]
        if c[NO_RETURNS]:
            parts.append(f"{c[NO_RETURNS]} {NO_RETURNS}")
        parts.append(f"{c['error']} error")
        print(f"  {tag} {name}: {', '.join(parts)}")
        if failures[name]:
            print(f"      fail: {' '.join(failures[name])}")
    if show and messages:
        print("\n".join(messages))
    return counts


def main(argv: list[str]) -> int:
    show = "--list" in argv
    args = [a for a in argv if a != "--list"]
    unknown = [a for a in args if a.startswith("-")]
    if unknown:
        print(f"unknown option(s): {unknown}", file=sys.stderr)
        return 2
    logs = [Path(a).resolve() for a in args] if args else tracked_logs()
    missing = [str(p) for p in logs if not p.is_file()]
    if missing:
        print(f"no such run log: {missing}", file=sys.stderr)
        return 2
    if not logs:
        print("no run logs to replay", file=sys.stderr)
        return 2
    head = subprocess.run(
        ["git", "rev-parse", "--short=9", "HEAD"],
        cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.strip()
    print(f"HEAD {head}")
    tests = tests_by_id()
    errors = 0
    for path in logs:
        counts = replay_log(path, tests, show)
        errors += sum(c["error"] for c in counts.values())
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
