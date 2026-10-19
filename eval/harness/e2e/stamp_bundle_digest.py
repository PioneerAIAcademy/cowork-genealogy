#!/usr/bin/env python3
"""Stamp a ``blind_bundle_digest`` into an e2e ``.ann.json``.

The ``grade-e2e-run`` skill writes the labels and ``stamp_findings_hash`` stamps
the findings fingerprint; this stamps a fingerprint of the **four files the blind
grader reads** (expected-findings, fixture, final-tree, final-research), so
``calibrate_judge``'s loader can detect a post-grading edit to *any* of them.

Run after ``stamp_findings_hash``, before committing:

    cd eval/harness && uv run python -m e2e.stamp_bundle_digest <path-to-run-*.ann.json>

Slug is the annotation's parent directory name; stem is inferred from the
filename. The digest is computed via ``blind_bundle.bundle_digest`` over the
paths ``blind_bundle.bundle_paths`` returns — the single implementation the
loader also calls, so the two cannot diverge.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from e2e.blind_bundle import bundle_digest, bundle_paths

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"
DEFAULT_RUNLOGS_ROOT = REPO_ROOT / "eval" / "runlogs" / "e2e"


def _resolve_ann_path(ann_path: Path) -> Path:
    """Accept an absolute path, one relative to cwd, or one relative to the repo
    root — same logic as ``stamp_findings_hash._resolve_ann_path``."""
    if ann_path.is_absolute() or ann_path.exists():
        return ann_path
    candidate = REPO_ROOT / ann_path
    return candidate if candidate.exists() else ann_path


def stamp(
    ann_path: Path,
    fixtures_root: Path,
    runlogs_root: Path,
) -> str:
    """Write ``blind_bundle_digest`` into ``ann_path`` in place; return the digest.

    Raises ``FileNotFoundError`` if any of the 4 bundle files is missing and
    ``ValueError`` if the annotation is not a JSON object.
    """
    slug = ann_path.parent.name
    stem = ann_path.name[: -len(".ann.json")]  # run-<ts>
    paths = bundle_paths(
        slug, stem,
        fixtures_root=fixtures_root, runlogs_root=runlogs_root,
    )
    for p in paths:
        if not p.exists():
            raise FileNotFoundError(f"bundle file missing: {p}")
    ann = json.loads(ann_path.read_text(encoding="utf-8"))
    if not isinstance(ann, dict):
        raise ValueError(f"{ann_path} is not a JSON object")
    digest = bundle_digest(paths)
    ann["blind_bundle_digest"] = digest
    ann_path.write_text(
        json.dumps(ann, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return digest


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        prog="e2e.stamp_bundle_digest",
        description=(
            "Stamp blind_bundle_digest into an e2e annotation. Not "
            "calibrate_judge; makes no judge API calls."
        ),
    )
    parser.add_argument("ann_path", type=Path, help="Path to a run-<ts>.ann.json")
    parser.add_argument(
        "--fixtures-root",
        type=Path,
        default=DEFAULT_FIXTURES_ROOT,
        help=f"Root of e2e fixtures. Default: {DEFAULT_FIXTURES_ROOT}",
    )
    parser.add_argument(
        "--runlogs-root",
        type=Path,
        default=DEFAULT_RUNLOGS_ROOT,
        help=f"Root of e2e runlogs. Default: {DEFAULT_RUNLOGS_ROOT}",
    )
    args = parser.parse_args(argv)
    ann_path = _resolve_ann_path(args.ann_path)
    try:
        digest = stamp(ann_path, args.fixtures_root, args.runlogs_root)
    except (OSError, ValueError) as e:
        print(f"stamp_bundle_digest: {e}", file=sys.stderr)
        return 1
    print(f"stamped blind_bundle_digest={digest} into {ann_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
