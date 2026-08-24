"""Six corpus counts, each defined by a predicate printed next to it.

Issue #1484 (c): six counts drift in `docs/architecture.md` §9.1/§9.3 prose and
nothing prints them, so they go stale every week and are wrong in the next doc
PR. This is the command that reproduces them, so a doc edit can be checked
instead of hand-counted.

Each count is a PREDICATE, not a directory listing, and the predicate is printed
beside the number — a bare count with no rule is exactly what drifted. Pure
analysis over committed files; stdlib + `runlog_selection` only, no SDK.

CLI (from eval/harness/):  uv run python -m e2e.inventory
"""

from __future__ import annotations

import json

from e2e.runlog_selection import REPO_ROOT, all_result_jsons

UNIT_TESTS = REPO_ROOT / "eval" / "tests" / "unit"
E2E_FIXTURES = REPO_ROOT / "eval" / "tests" / "e2e"
SPECS = REPO_ROOT / "docs" / "specs"


def _is_unit_test(path) -> bool:
    """A unit test definition: a `.json` under a skill dir with a top-level
    `test` object (the shape the harness collects)."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    return isinstance(data, dict) and isinstance(data.get("test"), dict)


def _has_nonnull_cost(path) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return False
    usage = data.get("usage") if isinstance(data, dict) else None
    cost = usage.get("total_cost_usd") if isinstance(usage, dict) else None
    return isinstance(cost, (int, float)) and not isinstance(cost, bool)


def counts() -> list[tuple[int, str]]:
    """`(number, predicate)` for each of the six, in the architecture.md order."""
    unit_defs = sum(1 for p in UNIT_TESTS.glob("*/*.json") if _is_unit_test(p))
    unit_suites = sum(1 for d in UNIT_TESTS.iterdir() if d.is_dir())
    fixtures = sum(1 for d in E2E_FIXTURES.iterdir() if (d / "fixture.json").is_file())
    runlogs = all_result_jsons()
    costed = sum(1 for p in runlogs if _has_nonnull_cost(p))
    specs = sum(1 for p in SPECS.glob("*.md"))
    return [
        (unit_defs, "unit test definitions = *.json under eval/tests/unit/<skill>/ with a top-level `test` object"),
        (unit_suites, "unit suites = directories under eval/tests/unit/"),
        (fixtures, "e2e fixtures = directories under eval/tests/e2e/ containing fixture.json"),
        (len(runlogs), "e2e run logs = run-*.json under eval/runlogs/e2e/ (excludes .ann / .final-* siblings)"),
        (costed, "costed runs = e2e run logs with a non-null usage.total_cost_usd"),
        (specs, "specs = *.md directly under docs/specs/"),
    ]


def main() -> int:
    print("Eval corpus inventory (each count by its predicate):")
    for n, predicate in counts():
        print(f"  {n:>5}  {predicate}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
