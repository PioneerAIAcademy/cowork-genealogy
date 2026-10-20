"""No Python file in this repo may reference a name nothing defines (ruff F821).

This is the SECOND time a bare `NameError` reached a running tier, so it is one shared
guard rather than a second one-off (CLAUDE.md, "A new lint must be proven to fail").

1. `writer_record` was called in `proto/worker/options.py` with no import, inside an
   `except Exception`, so it silently dropped a ledger row and nothing failed.
2. `psycopg` and `PG_DSN` were referenced by all three of the prototype web tier's blob
   routes -- sidecar, image and upload -- with neither ever defined at module scope. Every
   call that got past validation answered 500. Three of phase 2's acceptance clauses were
   recorded as built while none of them worked on a running stack. Found by curling the
   routes, not by any suite: the route tests stub the client and never reach the line.

`make harness-lint` has run this rule since long before either bug, over `eval/harness`
and `.claude/skills` only -- and NO CI job and no entry in `scripts/test.sh` invoked it,
so in practice it ran when somebody remembered. This test fixes both halves: repo-wide
scope, and the `pytest` job already runs it.

Lives here rather than in `apps/server/tests/` because ruff is a dependency of this
project and not of that one, and because `test_encoding_lint.py` already establishes
this directory as the home for repo-wide Python lints.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
HARNESS = REPO_ROOT / "eval" / "harness"


def test_no_python_file_references_an_undefined_name() -> None:
    # Same self-check as the encoding lint: a scan rooted at the wrong directory finds
    # nothing and reads exactly like a clean repo.
    assert REPO_ROOT.joinpath("CLAUDE.md").is_file(), (
        f"repo-root detection is wrong: {REPO_ROOT} has no CLAUDE.md, so this lint would "
        "scan the wrong tree and pass without checking anything"
    )

    proc = subprocess.run(
        ["uv", "run", "--frozen", "ruff", "check", "--select", "F821",
         "--output-format", "concise", str(REPO_ROOT)],
        cwd=HARNESS, capture_output=True, text=True, encoding="utf-8",
    )
    # ruff exits 1 on findings and 2 on a usage/internal error. A usage error must not
    # read as "no findings", which is how a lint quietly stops checking.
    assert proc.returncode in (0, 1), (
        f"ruff could not run (exit {proc.returncode}); this lint is not checking anything.\n"
        f"{proc.stdout}\n{proc.stderr}"
    )
    findings = [ln for ln in proc.stdout.splitlines() if "F821" in ln]
    assert not findings, (
        "undefined name(s) — these raise NameError at runtime, and a route or branch that "
        "is not exercised by a test will answer 500 in production instead:\n  "
        + "\n  ".join(findings)
    )


def test_the_lint_actually_reaches_the_server_tree() -> None:
    """Reach, proven on a planted defect rather than assumed.

    A lint whose path argument silently excludes the tree it is meant to cover passes
    for the wrong reason, and `apps/server` is exactly the tree the second bug was in.
    """
    planted = REPO_ROOT / "apps" / "server" / "_f821_reach_probe.py"
    planted.write_text("def f():\n    return a_name_nothing_defines\n", encoding="utf-8")
    try:
        proc = subprocess.run(
            ["uv", "run", "--frozen", "ruff", "check", "--select", "F821",
             "--output-format", "concise", str(REPO_ROOT)],
            cwd=HARNESS, capture_output=True, text=True, encoding="utf-8",
        )
        assert "a_name_nothing_defines" in proc.stdout, (
            "the planted undefined name in apps/server was NOT reported, so this lint "
            f"does not reach that tree:\n{proc.stdout}\n{proc.stderr}"
        )
    finally:
        planted.unlink(missing_ok=True)
