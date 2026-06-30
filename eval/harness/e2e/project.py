"""Seed an editable Cowork project from a fixture's STARTING state.

`make e2e-project TEST=<slug>` (Windows: `SeedProject.bat`) copies a fixture's
`starting-research.json` + `starting-tree.gedcomx.json` into a fresh, editable
project folder — `eval/e2e-project/<slug>/` — as `research.json` +
`tree.gedcomx.json`. Open that folder in Claude Cowork to run `/research`
step-by-step (init-project is auto-skipped because research.json already
exists), and open the SAME folder in the Research Viewer to watch the run
unfold live.

This is for *understanding and debugging* the research process — NOT for
scoring. An interactive run does NOT block the tree-read tools
(`person_read` / `person_search` / `person_ancestors`) that the headless
`make e2e-run` blocks, so the agent can read the stripped answer off the live
FamilySearch tree. When watching live, check it found the answer by *searching
records*, not by reading the tree. The honest pass/fail is always
`make e2e-run`.

Refuses to overwrite an already-seeded project (so a re-seed can't silently
wipe a debugging session); pass --force / FORCE=1 to start fresh.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from .orchestrator import DEFAULT_FIXTURES_ROOT, REPO_ROOT

PROJECT_ROOT = REPO_ROOT / "eval" / "e2e-project"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.project",
        description="Seed an editable Cowork project from a fixture's starting state.",
    )
    parser.add_argument(
        "--test", required=True, help="Fixture slug, e.g. kenneth-quass-death"
    )
    parser.add_argument("--fixtures-root", type=Path, default=DEFAULT_FIXTURES_ROOT)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-seed even if the project folder already exists (wipes its research.json).",
    )
    args = parser.parse_args(argv)

    fixture_dir = args.fixtures_root / args.test
    starting_research = fixture_dir / "starting-research.json"
    starting_tree = fixture_dir / "starting-tree.gedcomx.json"
    if not starting_research.exists() or not starting_tree.exists():
        print(
            f"Fixture '{args.test}' is missing its starting state (expected "
            f"{starting_research.name} + {starting_tree.name} in {fixture_dir}).",
            file=sys.stderr,
        )
        return 1

    out_dir = PROJECT_ROOT / args.test
    dest_research = out_dir / "research.json"
    if dest_research.exists() and not args.force:
        print(
            f"A project is already seeded at {out_dir}.\n"
            f"Re-seeding would wipe any work there. Delete it, or re-run with "
            f"FORCE=1 (make e2e-project TEST={args.test} FORCE=1) to start fresh.",
            file=sys.stderr,
        )
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(starting_research, dest_research)
    shutil.copyfile(starting_tree, out_dir / "tree.gedcomx.json")

    print(f"Seeded an editable project at {out_dir}")
    print()
    print("Next:")
    print(
        f"  1. Open {out_dir} in Claude Cowork (genealogy plugin installed, "
        f"logged in to FamilySearch)."
    )
    print(
        "  2. Run  /research  — it reads the objective from research.json. "
        "init-project is auto-skipped;"
    )
    print(
        "     question-selection still runs unless the fixture seeds a question."
    )
    print(
        "  3. Open the SAME folder in the Research Viewer to watch it live, and "
        "ask Claude why it did/didn't do a step."
    )
    print()
    print(
        "For DEBUGGING, not scoring: a live run does NOT block the tree-read tools, "
        "so confirm it"
    )
    print(
        "found the answer by searching records (not by reading the tree). "
        "Score with `make e2e-run`."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
