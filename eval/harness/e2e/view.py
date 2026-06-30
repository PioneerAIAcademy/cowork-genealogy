"""Load the latest e2e run's final state into the Research Viewer folder.

`make e2e-view TEST=<slug>` (Windows: `ViewE2E.bat`) copies the newest run's
`*.final-research.json` + `*.final-tree.gedcomx.json` for a fixture into one
stable folder — `eval/e2e-view/` — renamed to `research.json` +
`tree.gedcomx.json`, the shape the Electron Research Viewer opens and
live-watches.

Open that folder once in the viewer (its "Open Project" button, or start the
viewer with `make electron`); every later `make e2e-view` overwrites the two
files in place, so an already-open viewer refreshes live across the
run -> interpret -> grade -> improve -> re-run loop.

Picks the newest run by mtime, so it works on a failing `scratch_*` run (the
usual thing to inspect) as well as a committed passing `run-*` one.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from .orchestrator import DEFAULT_RUNLOG_ROOT, REPO_ROOT

VIEW_DIR = REPO_ROOT / "eval" / "e2e-view"


def latest_final_pair(slug_dir: Path) -> tuple[Path, Path] | None:
    """Return the newest (tree, research) `final-*` pair in slug_dir, or None."""
    trees = sorted(
        slug_dir.glob("*.final-tree.gedcomx.json"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for tree in trees:
        research = tree.with_name(
            tree.name.replace(".final-tree.gedcomx.json", ".final-research.json")
        )
        if research.exists():
            return tree, research
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.view",
        description="Load the latest e2e run for a fixture into the Research Viewer folder.",
    )
    parser.add_argument(
        "--test", required=True, help="Fixture slug, e.g. kenneth-quass-death"
    )
    parser.add_argument("--runlog-root", type=Path, default=DEFAULT_RUNLOG_ROOT)
    args = parser.parse_args(argv)

    slug_dir = args.runlog_root / args.test
    if not slug_dir.is_dir():
        print(
            f"No runs for '{args.test}' — {slug_dir} does not exist. "
            f"Run `make e2e-run TEST={args.test}` first.",
            file=sys.stderr,
        )
        return 1

    pair = latest_final_pair(slug_dir)
    if pair is None:
        print(
            f"No completed run in {slug_dir} (need a matching "
            f"*.final-tree.gedcomx.json + *.final-research.json). "
            f"Run `make e2e-run TEST={args.test}` first.",
            file=sys.stderr,
        )
        return 1

    tree, research = pair
    VIEW_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(tree, VIEW_DIR / "tree.gedcomx.json")
    shutil.copyfile(research, VIEW_DIR / "research.json")

    run_stem = tree.name.replace(".final-tree.gedcomx.json", "")
    print(f"Loaded {run_stem} into {VIEW_DIR}")
    print()
    print("Open it in the Research Viewer:")
    print(f"  - In the viewer, click Open Project and choose:  {VIEW_DIR}")
    print("  - No viewer open yet? Start it with `make electron`.")
    print()
    print(
        "Keep the viewer open — run `make e2e-view` again after each run "
        "and it refreshes live."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
