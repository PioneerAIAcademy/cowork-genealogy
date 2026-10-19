"""Run the single-ask e2e panel (spec §16, issue #3527).

    uv run python -m e2e.run_single_ask [--test <slug>]

Each fixture under ``eval/tests/e2e-single-ask/<slug>/`` is one message a patron
typed, sent verbatim as one ordinary turn into a project built from the
fixture's starting state, and graded deterministically by ``single_ask_grade``:
no judge, no ``expected-findings.json``. Live and billed (FamilySearch + model).

Exit 0 when every fixture passes, 1 when any fails, 2 when a run never happened
(bad fixture, no server build, the genealogy MCP server unavailable).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from e2e.env import load_env_file, stage_openrouter_key
from e2e.orchestrator import (
    DEFAULT_MCP_SERVER_ENTRY,
    DEFAULT_PLUGIN_SKILLS,
    REPO_ROOT,
    Fixture,
    build_workspace,
    load_caps,
    read_research_json,
    run_single_ask_turn,
)
from e2e.result import timestamp_slug
from e2e.single_ask_grade import (
    SAVE_SECTIONS,
    SingleAskGrade,
    SingleAskSpec,
    format_line,
    grade,
)

DEFAULT_SINGLE_ASK_FIXTURES = REPO_ROOT / "eval" / "tests" / "e2e-single-ask"
# A sibling of eval/runlogs/e2e/, never inside it: about 20 readers walk that
# tree with no exclusion, and its CI gate demands a .ann.json for every run.
DEFAULT_SINGLE_ASK_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "e2e-single-ask"
REQUIRED_KEYS = ("id", "message", "expected_owner", "expected_save")
# Aborts after which the turn is not a data point, so nothing is graded.
NEVER_HAPPENED = ("mcp_unavailable",)
UNGRADED = ("host_slept",)


class FixtureError(ValueError):
    pass


def load_single_ask_fixture(fixture_dir: Path) -> tuple[Fixture, SingleAskSpec]:
    fixture_dir = Path(fixture_dir)
    raw = json.loads((fixture_dir / "fixture.json").read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise FixtureError(f"{fixture_dir.name}: fixture.json must be a JSON object")
    missing = [k for k in REQUIRED_KEYS if not raw.get(k)]
    if missing:
        raise FixtureError(f"{fixture_dir.name}: fixture.json is missing {missing}")
    save = raw["expected_save"]
    if not isinstance(save, dict) or save.get("section") not in SAVE_SECTIONS:
        raise FixtureError(
            f"{fixture_dir.name}: expected_save.section must be one of {list(SAVE_SECTIONS)}"
        )
    if save["section"] == "log" and not save.get("tool"):
        raise FixtureError(f"{fixture_dir.name}: a log expected_save needs a `tool`")
    if not isinstance(raw.get("is_plan_ask", False), bool):
        raise FixtureError(f"{fixture_dir.name}: is_plan_ask must be true or false")
    setup = raw.get("setup_units") or []
    if not isinstance(setup, list) or not all(isinstance(u, str) for u in setup):
        raise FixtureError(f"{fixture_dir.name}: setup_units must be a list of unit names")
    for name in ("starting-research.json", "starting-tree.gedcomx.json"):
        if not (fixture_dir / name).is_file():
            raise FixtureError(f"{fixture_dir.name}: {name} is missing")
    model = raw.get("model") or {}
    fixture = Fixture(
        id=raw["id"],
        dir=fixture_dir,
        researcher_question=raw["message"],
        tags=raw.get("tags") or {},
        agent_model=model.get("agent", "claude-sonnet-4-6"),
        judge_model="",
        caps=load_caps(raw.get("caps") or {}),
        expected_findings={},
        starting_research_path=fixture_dir / "starting-research.json",
        starting_tree_path=fixture_dir / "starting-tree.gedcomx.json",
        blocked_tools=frozenset(raw.get("blocked_tools") or ()),
    )
    spec = SingleAskSpec(
        id=raw["id"],
        message=raw["message"],
        expected_owner=raw["expected_owner"],
        expected_save={k: str(v) for k, v in save.items()},
        is_plan_ask=raw.get("is_plan_ask", False),
        setup_units=tuple(setup),
        must_not=str(raw.get("must_not") or ""),
    )
    return fixture, spec


def fixture_dirs(root: Path, test: str | None) -> list[Path]:
    if test:
        return [root / test]
    return sorted(d for d in root.iterdir() if (d / "fixture.json").is_file())


async def run_one(
    fixture_dir: Path,
    *,
    runlog_root: Path,
    mcp_server_entry: Path,
    effort_level: str | None,
    agent_model: str | None,
) -> tuple[SingleAskSpec, dict[str, Any], SingleAskGrade | None]:
    fixture, spec = load_single_ask_fixture(fixture_dir)
    starting_research = json.loads(
        fixture.starting_research_path.read_text(encoding="utf-8")
    )
    with tempfile.TemporaryDirectory(
        prefix=f"e2e-single-ask-{fixture.id}-", ignore_cleanup_errors=True
    ) as tmp:
        workspace = build_workspace(
            fixture, Path(tmp), DEFAULT_PLUGIN_SKILLS,
            effort_level=effort_level, agent_model=agent_model,
        )
        record = await run_single_ask_turn(
            fixture=fixture,
            message=spec.message,
            workspace=workspace,
            mcp_server_entry=mcp_server_entry,
            agent_model=agent_model,
        )
        final_research = read_research_json(workspace)

    aborted = record["aborted_reason"]
    if aborted in NEVER_HAPPENED:
        raise RuntimeError(record.get("error") or aborted)
    g = None
    if aborted not in UNGRADED:
        g = grade(
            tool_calls=record["tool_calls"],
            spec=spec,
            starting_research=starting_research,
            final_research=final_research,
            aborted_reason=aborted,
        )
    out_dir = runlog_root / fixture.id
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"run-{timestamp_slug()}.json"
    out.write_text(
        json.dumps(
            {
                "test_id": fixture.id,
                "effort_level": effort_level,
                "agent_model": agent_model or fixture.agent_model,
                "grade": None if g is None else {
                    "passed": g.passed,
                    "failed": g.failed,
                    "checks": {k: {"ok": ok, "detail": d} for k, (ok, d) in g.checks.items()},
                    "first_unit": g.first_unit,
                    "units": g.units,
                    "delivered": g.delivered,
                    "extraction_appends": g.extraction_appends,
                    "stop": g.stop,
                },
                **record,
                "final_research": final_research,
            },
            indent=2,
            ensure_ascii=False,
            default=str,
        )
        + "\n",
        encoding="utf-8",
    )
    record["runlog"] = str(out)
    return spec, record, g


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    load_env_file()
    stage_openrouter_key()
    parser = argparse.ArgumentParser(
        prog="e2e.run_single_ask",
        description="Run the single-ask e2e panel (one ordinary turn per fixture).",
    )
    parser.add_argument("--test", help="One fixture slug; omit to run the whole panel.")
    parser.add_argument("--fixtures-root", type=Path, default=DEFAULT_SINGLE_ASK_FIXTURES)
    parser.add_argument("--runlog-root", type=Path, default=DEFAULT_SINGLE_ASK_RUNLOGS)
    parser.add_argument("--mcp-server-entry", type=Path, default=DEFAULT_MCP_SERVER_ENTRY)
    parser.add_argument(
        "--effort-level", default="high",
        choices=["low", "medium", "high", "xhigh", "max"],
    )
    parser.add_argument("--agent-model", default=None)
    args = parser.parse_args(argv)

    if not args.mcp_server_entry.exists():
        print(
            f"MCP server build not found at {args.mcp_server_entry}. Run `make build` first.",
            file=sys.stderr,
        )
        return 2
    try:
        dirs = fixture_dirs(args.fixtures_root, args.test)
        loaded = [load_single_ask_fixture(d) for d in dirs]
    except (OSError, json.JSONDecodeError, FixtureError) as e:
        print(f"Bad single-ask fixture: {e}", file=sys.stderr)
        return 2
    if not loaded:
        print(f"No single-ask fixtures under {args.fixtures_root}", file=sys.stderr)
        return 2

    failures = 0
    for d in dirs:
        try:
            spec, record, g = asyncio.run(
                run_one(
                    d,
                    runlog_root=args.runlog_root,
                    mcp_server_entry=args.mcp_server_entry,
                    effort_level=args.effort_level,
                    agent_model=args.agent_model,
                )
            )
        except KeyboardInterrupt:
            print("\nInterrupted.", file=sys.stderr)
            return 130
        except RuntimeError as e:
            print(f"\nThis run never happened ({d.name}): {e}", file=sys.stderr)
            return 2
        cost = (record.get("usage") or {}).get("whole_run_cost_usd_estimated")
        if g is None:
            failures += 1
            print(f"UNGRADED {spec.id}  stop={record['aborted_reason']}")
        else:
            failures += 0 if g.passed else 1
            print(format_line(spec, g))
        shown = f"{cost:.2f}" if isinstance(cost, (int, float)) else "?"
        print(f"    cost~${shown}  runlog: {record['runlog']}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
