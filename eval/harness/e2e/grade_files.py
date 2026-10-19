"""Grade a final tree/research that came from ANYWHERE against an e2e fixture.

    uv run python -m e2e.grade_files --fixture <slug> --tree <path>
                                     [--research <path>] [--json <out>] [--model <id>]

`e2e.orchestrator` grades in-process at the end of its own run, so until now the only
gradeable tree was one the harness had just produced. The prototype worker
(`apps/server/proto/`) can now run a fixture to completion and export its documents to
files (`make proto-export`), and D18 asks for the two sides side by side -- which needs
one instrument that grades either side's files. This is it.

Same judge, same order as the orchestrator: ``run_judge`` (which already applies the
component derivation), then ``apply_avoid_guard`` with the fixture's own subject person
ids. A grading that skips the guard is not the same grading -- an ``avoid`` finding whose
target is still in the tree would be left at whatever the model said.

The fixture is loaded by ``orchestrator.load_fixture``, the one loader, so the research
question, the expected findings, the judge model and the subject ids are exactly what a
real run is graded against.

Exit 0 whatever the verdict -- a ``fail`` is a result, not an error. Exit 2 when an input
is missing (fixture, tree, research, or ANTHROPIC_API_KEY); exit 1 when the judge call
itself fails.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from e2e.env import ENV_FILE, load_env_file
from e2e.judge import apply_avoid_guard, run_judge
from e2e.orchestrator import DEFAULT_FIXTURES_ROOT, Fixture, load_fixture

EXIT_OK = 0
EXIT_JUDGE_FAILED = 1
EXIT_BAD_INPUT = 2

#: How much of a finding's `description` the per-finding line carries.
TITLE_WIDTH = 78


class InputError(ValueError):
    """An input the grading needs is missing or unreadable -- exit 2, not a traceback."""


def load_json(path: Path, *, what: str) -> dict[str, Any]:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        raise InputError(f"cannot read the {what} at {path}: {exc}") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise InputError(f"the {what} at {path} is not valid JSON: {exc}") from exc


def fixture_for(slug: str, *, fixtures_root: Path = DEFAULT_FIXTURES_ROOT) -> Fixture:
    """The fixture the orchestrator would load for ``slug``."""
    fixture_dir = Path(fixtures_root) / slug
    if not (fixture_dir / "fixture.json").is_file():
        raise InputError(f"no fixture {slug!r}: {fixture_dir / 'fixture.json'} does not exist")
    try:
        return load_fixture(fixture_dir)
    except (OSError, ValueError, KeyError) as exc:
        raise InputError(f"fixture {slug!r} did not load: {type(exc).__name__}: {exc}") from exc


def grade(
    fixture: Fixture,
    *,
    final_tree: dict[str, Any] | None,
    final_research: dict[str, Any] | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    """The orchestrator's grading, on files: ``run_judge`` then ``apply_avoid_guard``."""
    judge_output = run_judge(
        research_question=fixture.researcher_question,
        expected_findings=fixture.expected_findings,
        final_tree=final_tree,
        final_research=final_research,
        model=model or fixture.judge_model,
    )
    return apply_avoid_guard(
        judge_output,
        expected_findings=fixture.expected_findings,
        final_tree=final_tree,
        subject_person_ids=fixture.subject_person_ids,
    )


def labels_of(judge_output: dict[str, Any]) -> dict[str, str]:
    """``finding_id -> matched``, for every entry the judge graded."""
    entries = judge_output.get("per_finding")
    if not isinstance(entries, list):
        return {}
    return {
        str(e.get("finding_id")): str(e.get("matched"))
        for e in entries
        if isinstance(e, dict)
    }


def title_of(finding: dict[str, Any], *, width: int = TITLE_WIDTH) -> str:
    """The finding's ``description``, trimmed to one line."""
    text = " ".join(str(finding.get("description") or "").split())
    if not text:
        text = f"({finding.get('type') or 'finding'})"
    return text if len(text) <= width else text[: width - 3].rstrip() + "..."


def ordered_ids(
    expected_findings: dict[str, Any], *judge_outputs: dict[str, Any]
) -> list[str]:
    """Expected findings in fixture order, then any id a judge graded that the fixture
    does not list (the avoid guard can append one) -- so a stray grade is visible rather
    than dropped."""
    findings = expected_findings.get("findings") or []
    out = [str(f.get("id")) for f in findings if isinstance(f, dict)]
    seen = set(out)
    for judge_output in judge_outputs:
        for fid in sorted(labels_of(judge_output)):
            if fid not in seen:
                seen.add(fid)
                out.append(fid)
    return out


def titles_of(expected_findings: dict[str, Any]) -> dict[str, str]:
    findings = expected_findings.get("findings") or []
    return {str(f.get("id")): title_of(f) for f in findings if isinstance(f, dict)}


def _pct(value: Any) -> str:
    try:
        return f"{float(value):.2f}"
    except (TypeError, ValueError):
        return "?"


def render(fixture: Fixture, judge_output: dict[str, Any]) -> str:
    """The verdict, then one line per expected finding: id, ``matched``, short title."""
    labels = labels_of(judge_output)
    titles = titles_of(fixture.expected_findings)
    lines = [
        f"fixture   {fixture.id}",
        f"verdict   {str(judge_output.get('verdict') or '?')}"
        f"   (recall required {_pct(judge_output.get('recall_required'))},"
        f" total {_pct(judge_output.get('recall_total'))})",
        "",
    ]
    ids = ordered_ids(fixture.expected_findings, judge_output)
    if not ids:
        lines.append("(the fixture lists no expected findings)")
    width = max((len(i) for i in ids), default=2)
    for fid in ids:
        label = labels.get(fid, "(not graded)")
        title = titles.get(fid, "(not an expected finding -- graded anyway)")
        lines.append(f"{fid:<{width}}  {label:<12}  {title}")
    forced = (judge_output.get("avoid_guard") or {}).get("forced_false") or []
    if forced:
        lines.append("")
        for entry in forced:
            lines.append(
                f"avoid-guard forced {entry.get('finding_id')} to false: "
                f"{', '.join(entry.get('person_ids') or [])} still in the tree"
            )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        prog="e2e.grade_files",
        description="Grade a final tree/research against an e2e fixture with the harness's judge.",
    )
    parser.add_argument("--fixture", required=True, help="fixture slug under eval/tests/e2e/")
    parser.add_argument("--tree", required=True, type=Path, help="the final tree.gedcomx.json to grade")
    parser.add_argument(
        "--research", type=Path, default=None,
        help="the final research.json; without it proof quality is graded on no proof summaries",
    )
    parser.add_argument("--json", dest="json_out", type=Path, default=None,
                        help="write the raw judge output here")
    parser.add_argument("--model", default=None, help="judge model; default the fixture's")
    parser.add_argument("--fixtures-root", type=Path, default=DEFAULT_FIXTURES_ROOT)
    args = parser.parse_args(argv)

    try:
        fixture = fixture_for(args.fixture, fixtures_root=args.fixtures_root)
        final_tree = load_json(args.tree, what="final tree")
        final_research = load_json(args.research, what="final research") if args.research else None
    except InputError as exc:
        print(f"grade_files: {exc}", file=sys.stderr)
        return EXIT_BAD_INPUT

    load_env_file()  # the judge reads ANTHROPIC_API_KEY from the process env
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            f"grade_files: no ANTHROPIC_API_KEY. Set it in the environment or in {ENV_FILE}.",
            file=sys.stderr,
        )
        return EXIT_BAD_INPUT

    try:
        judge_output = grade(
            fixture, final_tree=final_tree, final_research=final_research, model=args.model
        )
    except Exception as exc:  # noqa: BLE001 -- the judge is a network call; report, don't traceback
        print(f"grade_files: the judge failed ({type(exc).__name__}: {exc})", file=sys.stderr)
        return EXIT_JUDGE_FAILED

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(judge_output, indent=2), encoding="utf-8")

    print(render(fixture, judge_output))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
