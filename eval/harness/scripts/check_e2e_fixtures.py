#!/usr/bin/env python3
"""GH Action: the e2e grading gate (a discipline check on committed files).

## Grading gate (BLOCKING)

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

## Not gated: fixture validity

Whether a fixture has a committed *passing* run log (proof it is solvable from
live FamilySearch — e2e-test-spec.md §14) is a recommended practice surfaced in
the authoring docs, **not** a CI check. A fixture can land without one — draft
and PID-less fixtures routinely do — so this script no longer emits a
fixture-validity warning.

Self-contained — stdlib only. Run by .github/workflows/check-e2e-fixtures.yml.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
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
# CLI
# --------------------------------------------------------------------------- #

def main() -> int:
    # --- Grading gate (blocking) — PR-added run logs with a tree need an ann ---
    added = git_added_e2e_runlogs()
    if added is None:
        print("E2E grading gate skipped (no PR context: BASE_SHA/HEAD_SHA unset).")
        return 0

    grade_violations = check_added_runlogs_graded(added)
    if grade_violations:
        print(
            "E2E grading gate — PR-added run logs missing their annotation:",
            file=sys.stderr,
        )
        for v in grade_violations:
            print(f"::error::{v}")
            print(f"  - {v}", file=sys.stderr)
        return 1

    print(f"E2E grading gate OK ({len(added)} added run log(s) checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
