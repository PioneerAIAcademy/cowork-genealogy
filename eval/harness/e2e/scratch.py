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
import json
import shutil
import sys
from pathlib import Path

from e2e.orchestrator import (
    DEFAULT_FIXTURES_ROOT,
    DEFAULT_MCP_SERVER_ENTRY,
    DEFAULT_PLUGIN_SKILLS,
    build_workspace,
    load_fixture,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
# Default scratch location: a sibling of the repo, so nothing lands inside
# the checkout. e.g. /home/me/cowork-genealogy  ->  /home/me/e2e-scratch
DEFAULT_SCRATCH_DIR = REPO_ROOT.parent / "e2e-scratch"


def write_mcp_config(target: Path, mcp_server_entry: Path) -> None:
    """Write a .mcp.json so Claude Code loads the genealogy MCP server.

    Without this, the scratch session has the skills but NONE of the MCP
    tools (validate_research_schema, record_search, person_read, …), so
    /research can't actually research. Claude Code auto-loads `.mcp.json`
    from the working dir (it prompts once to approve the project server).
    The path must be absolute — the scratch dir is outside the repo, so a
    relative path wouldn't resolve.
    """
    config = {
        "mcpServers": {
            "genealogy": {
                "type": "stdio",
                "command": "node",
                "args": [str(mcp_server_entry.resolve())],
                "env": {},
            }
        }
    }
    (target / ".mcp.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def setup_scratch(
    *,
    slug: str,
    scratch_dir: Path,
    fixtures_root: Path = DEFAULT_FIXTURES_ROOT,
    skills_dir: Path = DEFAULT_PLUGIN_SKILLS,
    mcp_server_entry: Path = DEFAULT_MCP_SERVER_ENTRY,
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
    write_mcp_config(target, mcp_server_entry)  # so /research has its MCP tools
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
    parser.add_argument(
        "--mcp-server-entry", type=Path, default=DEFAULT_MCP_SERVER_ENTRY,
        help=f"Built MCP server. Default: {DEFAULT_MCP_SERVER_ENTRY}",
    )
    args = parser.parse_args(argv)

    if not args.mcp_server_entry.exists():
        print(
            f"ERROR: MCP server not built at {args.mcp_server_entry}.\n"
            "Without it /research has no MCP tools (validate_research_schema, "
            "record_search, …) and can't research. Run `npm run build` in "
            "packages/engine/mcp-server/ (or `make engine-build`) first.",
            file=sys.stderr,
        )
        return 2

    try:
        target, question = setup_scratch(
            slug=args.test,
            scratch_dir=args.dir,
            fixtures_root=args.fixtures_root,
            skills_dir=args.skills_dir,
            mcp_server_entry=args.mcp_server_entry,
            overwrite=args.overwrite,
        )
    except (FileNotFoundError, FileExistsError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    print(f"Scratch workspace ready: {target}")
    print("  (seeded research.json + tree.gedcomx.json, plugin skills in")
    print("   .claude/skills/, and a .mcp.json for the genealogy MCP server)")
    print()
    print("Next:")
    print(f"  cd {target}")
    print("  claude")
    print()
    print("Claude Code will prompt ONCE to approve the project MCP server")
    print("(.mcp.json) — approve it, or /research has no tools. You also need")
    print("to be logged in to FamilySearch (the `login` MCP tool).")
    print()
    print("Then try the research flow. Start WITHOUT --autonomous so you can")
    print("watch it chain through the GPS sub-skills and nudge it:")
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
