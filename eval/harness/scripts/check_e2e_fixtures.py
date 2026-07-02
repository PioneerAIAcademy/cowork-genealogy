#!/usr/bin/env python3
"""GH Action: two e2e discipline checks on committed files.

## 1. Grading gate (BLOCKING)

Every run log ADDED in this PR that produced a final tree must ship its
``run-<ts>.ann.json`` in the same PR — grading is same-PR (the developer +
genealogist teams grade every run they commit; docs/e2e-testing-guide.md
"Grading a run"). A treeless run (crashed or skipped before a final tree) is
exempt: there is nothing to grade. Scoped to PR-added run logs via
``git diff --diff-filter=A`` (BASE_SHA / HEAD_SHA), mirroring check_runlogs.py
rule 1; skipped when run outside a PR (env unset), so local runs still work.

This gate checks annotation *presence*, not content. Content validity (drift /
incomplete / malformed) is the maintainer's ``calibrate_judge --dry-run`` step
and the loader's own classification — kept out of CI so this check stays
stdlib-only and never needs the harness venv.

## 2. Fixture-validity gate (advisory — e2e-test-spec.md §14)

A fixture the agent can never solve is worthless — every failure is a
false negative on agent capability. Stripping completeness proves the
answer isn't already in the starting tree, but only a real run proves
the answer is *recoverable from live FamilySearch*.

Recommendation: every committed fixture under eval/tests/e2e/<slug>/
should have at least one committed run log under
eval/runlogs/e2e/<slug>/run-*.json whose `verdict` is `pass`.

The fixture-validity check is **advisory** in CI: it reports any fixture
lacking a passing run log as a non-blocking warning, but does NOT fail the PR
(the grading gate above is the blocking part). The advisory framing lets draft
fixtures — e.g. PID-less fixtures authored without FamilySearch access, with
their validity run still owed — land while still surfacing the owed run. Pass
`--strict` to turn fixture-validity violations into a hard exit too (local).

It is cheap and CI-safe: it only reads committed files. It does NOT
trigger a live e2e run (those stay out of CI — too expensive).

Self-contained — stdlib only. Run by .github/workflows/check-e2e-fixtures.yml.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
FIXTURES_DIR = REPO_ROOT / "eval" / "tests" / "e2e"
RUNLOGS_DIR = REPO_ROOT / "eval" / "runlogs" / "e2e"


# --------------------------------------------------------------------------- #
# Grading gate (blocking): PR-added run logs with a tree must ship their ann
# --------------------------------------------------------------------------- #

def _is_primary_runlog(name: str) -> bool:
    """True for a ``run-<ts>.json`` result file, excluding its siblings
    (``.ann.json``, ``.final-tree.gedcomx.json``, ``.final-research.json``,
    ``.transcript.md``)."""
    return (
        name.startswith("run-")
        and name.endswith(".json")
        and not name.endswith(".ann.json")
        and ".final-" not in name
    )


def git_added_e2e_runlogs() -> list[Path] | None:
    """PR-added primary run logs under eval/runlogs/e2e/, as repo-relative Paths.

    Returns ``None`` when not running in a PR context (BASE_SHA / HEAD_SHA
    unset) — the grading gate only applies to files added in the PR, mirroring
    check_runlogs.py rule 1 (``git diff --diff-filter=A``). Local runs skip it.
    """
    base = os.environ.get("BASE_SHA")
    head = os.environ.get("HEAD_SHA")
    if not base or not head:
        return None
    out = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=A", base, head],
        text=True,
        cwd=REPO_ROOT,
    )
    added: list[Path] = []
    for line in out.splitlines():
        path = line.strip()
        if not path:
            continue
        p = Path(path)
        if (
            len(p.parts) >= 4
            and p.parts[:3] == ("eval", "runlogs", "e2e")
            and _is_primary_runlog(p.name)
        ):
            added.append(p)
    return added


def check_added_runlogs_graded(added: list[Path]) -> list[str]:
    """Blocking gate: every PR-added run log that produced a tree must ship its
    committed ``run-<ts>.ann.json`` in the same PR.

    A treeless run (crashed / skipped before a final tree) is exempt — the
    loader can't grade it and neither can a human, so no annotation is owed.
    Detected by the absence of the ``run-<ts>.final-tree.gedcomx.json`` sibling,
    which is exactly the file the grade loader requires.
    """
    violations: list[str] = []
    for rel in added:
        runlog = REPO_ROOT / rel
        stem = rel.name[: -len(".json")]  # run-<ts>
        slug_dir = runlog.parent
        tree = slug_dir / f"{stem}.final-tree.gedcomx.json"
        ann = slug_dir / f"{stem}.ann.json"
        if not tree.exists():
            continue  # treeless run — nothing to grade
        if not ann.exists():
            violations.append(
                f"run log '{rel}' produced a final tree but no committed "
                f"'{stem}.ann.json'. Grade it in this PR with /grade-e2e-run and "
                "commit the annotation (grading is same-PR; "
                "docs/e2e-testing-guide.md 'Grading a run')."
            )
    return violations


# --------------------------------------------------------------------------- #
# Fixture-validity gate (advisory)
# --------------------------------------------------------------------------- #

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
        if not _is_primary_runlog(runlog.name):
            continue
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


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="E2E discipline checks: grading gate (blocking) + "
        "fixture-validity gate (advisory)."
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Also exit non-zero on fixture-validity violations (hard gate). "
        "Default is advisory for validity: those are warnings and still pass. "
        "The grading gate is always blocking.",
    )
    args = parser.parse_args(argv)

    exit_code = 0

    # --- Grading gate (blocking) — PR-added run logs with a tree need an ann ---
    added = git_added_e2e_runlogs()
    if added is None:
        print("E2E grading gate skipped (no PR context: BASE_SHA/HEAD_SHA unset).")
    else:
        grade_violations = check_added_runlogs_graded(added)
        if grade_violations:
            print(
                "E2E grading gate — PR-added run logs missing their annotation:",
                file=sys.stderr,
            )
            for v in grade_violations:
                print(f"::error::{v}")
                print(f"  - {v}", file=sys.stderr)
            exit_code = 1
        else:
            print(f"E2E grading gate OK ({len(added)} added run log(s) checked).")

    # --- Fixture-validity gate (advisory unless --strict) ---
    violations = check()
    slugs = _fixture_slugs(FIXTURES_DIR)
    if not violations:
        print(f"E2E fixture-validity check OK ({len(slugs)} fixture(s) checked).")
    else:
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
            exit_code = 1
        else:
            print(
                f"{len(violations)} fixture(s) advisory-flagged (run still owed); "
                "not blocking the PR.",
                file=sys.stderr,
            )

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
