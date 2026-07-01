#!/usr/bin/env python3
"""GH Action: report the e2e fixture-validity gate (e2e-test-spec.md §14).

A fixture the agent can never solve is worthless — every failure is a
false negative on agent capability. Stripping completeness proves the
answer isn't already in the starting tree, but only a real run proves
the answer is *recoverable from live FamilySearch*.

Recommendation: every committed fixture under eval/tests/e2e/<slug>/
should have at least one committed run log under
eval/runlogs/e2e/<slug>/run-*.json whose `verdict` is `pass`.

This check is **advisory** in CI: it reports any fixture lacking a
passing run log as a non-blocking warning, but does NOT fail the PR.
Only the unit-test runlog discipline check (check_runlogs.py) blocks
merge. The advisory framing lets draft fixtures — e.g. PID-less
fixtures authored without FamilySearch access, with their validity run
still owed — land while still surfacing the owed run. Pass `--strict`
to turn violations back into a hard non-zero exit (for local gating).

It is cheap and CI-safe: it only reads committed files. It does NOT
trigger a live e2e run (those stay out of CI — too expensive).

Self-contained — stdlib only. Run by .github/workflows/check-e2e-fixtures.yml.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
FIXTURES_DIR = REPO_ROOT / "eval" / "tests" / "e2e"
RUNLOGS_DIR = REPO_ROOT / "eval" / "runlogs" / "e2e"


def _fixture_slugs(fixtures_dir: Path) -> list[str]:
    """Committed fixtures — dirs with a fixture.json (skips .gitkeep etc.)."""
    if not fixtures_dir.exists():
        return []
    return sorted(
        p.name
        for p in fixtures_dir.iterdir()
        if p.is_dir() and (p / "fixture.json").exists()
    )


def _has_passing_runlog(runlogs_dir: Path, slug: str) -> bool:
    """True if any run-*.json under runlogs_dir/<slug>/ has verdict == pass."""
    slug_dir = runlogs_dir / slug
    if not slug_dir.is_dir():
        return False
    for runlog in slug_dir.glob("run-*.json"):
        try:
            data = json.loads(runlog.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if data.get("verdict") == "pass":
            return True
    return False


def check(
    fixtures_dir: Path = FIXTURES_DIR, runlogs_dir: Path = RUNLOGS_DIR
) -> list[str]:
    """Return a list of violation messages (empty == all fixtures valid)."""
    violations: list[str] = []
    for slug in _fixture_slugs(fixtures_dir):
        if not _has_passing_runlog(runlogs_dir, slug):
            violations.append(
                f"fixture '{slug}' has no committed passing run log under "
                f"eval/runlogs/e2e/{slug}/ (need a run-*.json with verdict=pass). "
                "Run it for real and commit the passing log before landing it "
                "(e2e-test-spec.md §14)."
            )
    return violations


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Report the e2e fixture-validity gate.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit non-zero on violations (hard gate). Default is advisory: "
        "violations are reported as warnings and the check still passes.",
    )
    args = parser.parse_args(argv)

    violations = check()
    slugs = _fixture_slugs(FIXTURES_DIR)

    if not violations:
        print(f"E2E fixture-validity check OK ({len(slugs)} fixture(s) checked).")
        return 0

    # Advisory by default: surface which fixtures still lack a committed
    # passing run log, but do NOT fail the PR. The e2e validity gate is a
    # landing recommendation (e2e-test-spec.md §14), not a merge blocker —
    # only the unit-test runlog discipline check (check_runlogs.py) blocks.
    print(
        "E2E fixture-validity check — fixtures without a committed passing run log:",
        file=sys.stderr,
    )
    for v in violations:
        # GitHub Actions warning annotation (surfaced on the PR, non-blocking).
        print(f"::warning::{v}")
        print(f"  - {v}", file=sys.stderr)

    if args.strict:
        print(
            f"{len(violations)} fixture(s) failed the validity gate (--strict).",
            file=sys.stderr,
        )
        return 1
    print(
        f"{len(violations)} fixture(s) advisory-flagged (run still owed); "
        "not blocking the PR.",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
