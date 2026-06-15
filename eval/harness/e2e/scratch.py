"""Set up a throwaway directory for running /research by hand.

The e2e harness runs `/research --autonomous` headlessly — you can't
watch the agent think or nudge it. To *debug* the research flow (e.g.
"why did the agent stop after question-selection?") you want an
interactive Claude Code session against the same starting state.

This builds exactly that, reusing the harness's own `build_workspace`
so the scratch dir is byte-identical to what a real run sees: the
fixture's `starting-research.json` / `starting-tree.gedcomx.json` copied
in as `research.json` / `tree.gedcomx.json`, and the plugin skills copied
into `.claude/skills/` (copied, not symlinked — Claude Code's skill
loader resolves copies reliably; symlinks are flaky, issue #17741).

The directory is created **outside the repo by default** (a sibling of
the repo) so a stray `research.json` or skill copy never pollutes the
checkout.

Usage (from eval/harness/):

  uv run python -m e2e.scratch --test kenneth-quass-death
  uv run python -m e2e.scratch --test <slug> --dir ~/my-scratch

Then `cd` into the printed directory and run `claude`. NOTE: the harness
blocks person_read/person_search/person_ancestors during a benchmark
run (spec §6.1); an interactive session does NOT — so if you call those
by hand you're reading the live tree, which is fine for debugging but is
not what a real run can do.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from e2e.orchestrator import (
    DEFAULT_FIXTURES_ROOT,
    DEFAULT_PLUGIN_SKILLS,
    build_workspace,
    load_fixture,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
# Default scratch location: a sibling of the repo, so nothing lands inside
# the checkout. e.g. /home/me/cowork-genealogy  ->  /home/me/e2e-scratch
DEFAULT_SCRATCH_DIR = REPO_ROOT.parent / "e2e-scratch"


def setup_scratch(
    *,
    slug: str,
    scratch_dir: Path,
    fixtures_root: Path = DEFAULT_FIXTURES_ROOT,
    skills_dir: Path = DEFAULT_PLUGIN_SKILLS,
    overwrite: bool = False,
) -> tuple[Path, str]:
    """Build a scratch workspace for `slug`. Returns (dir, research_question)."""
    fixture_dir = fixtures_root / slug
    if not (fixture_dir / "fixture.json").exists():
        raise FileNotFoundError(f"No fixture at {fixture_dir} (need fixture.json).")
    fixture = load_fixture(fixture_dir)

    target = scratch_dir / slug
    if target.exists():
        if not overwrite:
            raise FileExistsError(
                f"{target} already exists. Pass --overwrite to replace it."
            )
        shutil.rmtree(target)
    target.mkdir(parents=True)

    build_workspace(fixture, target, skills_dir)
    return target, fixture.researcher_question


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.scratch",
        description="Set up a throwaway dir to run /research by hand.",
    )
    parser.add_argument("--test", required=True, help="Fixture slug to seed from.")
    parser.add_argument(
        "--dir",
        type=Path,
        default=DEFAULT_SCRATCH_DIR,
        help=f"Parent dir for the scratch workspace. Default: {DEFAULT_SCRATCH_DIR}",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace the scratch dir if it already exists.",
    )
    parser.add_argument(
        "--fixtures-root", type=Path, default=DEFAULT_FIXTURES_ROOT,
        help=f"Default: {DEFAULT_FIXTURES_ROOT}",
    )
    parser.add_argument(
        "--skills-dir", type=Path, default=DEFAULT_PLUGIN_SKILLS,
        help=f"Default: {DEFAULT_PLUGIN_SKILLS}",
    )
    args = parser.parse_args(argv)

    try:
        target, question = setup_scratch(
            slug=args.test,
            scratch_dir=args.dir,
            fixtures_root=args.fixtures_root,
            skills_dir=args.skills_dir,
            overwrite=args.overwrite,
        )
    except (FileNotFoundError, FileExistsError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    print(f"Scratch workspace ready: {target}")
    print()
    print("Next:")
    print(f"  cd {target}")
    print("  claude")
    print()
    print("Then, in the Claude Code session, try the research flow. Start")
    print("WITHOUT --autonomous so you can watch it chain and nudge it:")
    print()
    print(f"  /research {question}")
    print()
    print("Once it chains through the GPS sub-skills reliably, try the real")
    print("autonomous form the harness uses:")
    print()
    print(f"  /research --autonomous {question}")
    print()
    print("Note: this interactive session does NOT block person_read /")
    print("person_search / person_ancestors the way a benchmark run does")
    print("(spec §6.1) — calling them reads the live tree. Fine for")
    print("debugging; just remember a real run can't.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
