#!/usr/bin/env python3
"""Stamp a ``findings_hash`` into an e2e ``.ann.json`` (issue #1719).

The ``grade-e2e-run`` skill writes the labels; this stamps a fingerprint of the
findings they were graded against, so ``calibrate_judge``'s loader can later
detect an ``expected-findings.json`` amended after grading (an amended finding
body that kept its id — which the id/key drift check cannot see).

This is **not** ``calibrate_judge``: it makes no judge API calls and is exempt
from the skill's "do not run ``calibrate_judge``" rule. Run it after writing the
annotation, before committing:

    cd eval/harness && uv run python -m e2e.stamp_findings_hash <path-to-run-*.ann.json>

Slug is the annotation's parent directory name; the hash is computed over
``eval/tests/e2e/<slug>/expected-findings.json`` via ``provenance.findings_hash``
— the single implementation the loader also calls, so the two cannot diverge.
Every other key in the annotation is left untouched.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from e2e.provenance import findings_hash

# Mirrors calibrate_judge.DEFAULT_FIXTURES_ROOT deliberately rather than importing
# it: importing calibrate_judge would pull in e2e.judge → anthropic, and this
# writer must stay off that chain.
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"


def _resolve_ann_path(ann_path: Path) -> Path:
    """Accept an absolute path, one relative to cwd, or one relative to the repo
    root. ``uv run`` puts cwd at ``eval/harness``, but the grade-e2e-run skill
    hands the repo-root-relative path it wrote (``eval/runlogs/e2e/...``); without
    this that path would resolve under ``eval/harness/`` and silently fail to
    stamp. Falls back to the input unchanged so the caller's read raises a clear
    error on a genuinely missing file."""
    if ann_path.is_absolute() or ann_path.exists():
        return ann_path
    candidate = REPO_ROOT / ann_path
    return candidate if candidate.exists() else ann_path


def stamp(ann_path: Path, fixtures_root: Path) -> str:
    """Write ``findings_hash`` into ``ann_path`` in place; return the hash.

    Raises ``FileNotFoundError`` if the sibling fixture is missing and
    ``ValueError`` if the annotation is not a JSON object — the CLI turns either
    into a nonzero exit rather than a traceback.
    """
    slug = ann_path.parent.name
    expected = fixtures_root / slug / "expected-findings.json"
    if not expected.exists():
        raise FileNotFoundError(
            f"no expected-findings.json for slug '{slug}' at {expected}"
        )
    ann = json.loads(ann_path.read_text(encoding="utf-8"))
    if not isinstance(ann, dict):
        raise ValueError(f"{ann_path} is not a JSON object")
    digest = findings_hash(expected)
    ann["findings_hash"] = digest
    ann_path.write_text(
        json.dumps(ann, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return digest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.stamp_findings_hash",
        description=(
            "Stamp findings_hash into an e2e annotation. Not calibrate_judge; "
            "makes no judge API calls."
        ),
    )
    parser.add_argument("ann_path", type=Path, help="Path to a run-<ts>.ann.json")
    parser.add_argument(
        "--fixtures-root",
        type=Path,
        default=DEFAULT_FIXTURES_ROOT,
        help=f"Root of e2e fixtures. Default: {DEFAULT_FIXTURES_ROOT}",
    )
    args = parser.parse_args(argv)
    ann_path = _resolve_ann_path(args.ann_path)
    try:
        digest = stamp(ann_path, args.fixtures_root)
    except (OSError, ValueError) as e:
        print(f"stamp_findings_hash: {e}", file=sys.stderr)
        return 1
    print(f"stamped findings_hash={digest} into {ann_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
