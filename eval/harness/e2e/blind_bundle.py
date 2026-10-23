#!/usr/bin/env python3
"""Print the four files a blind grader may read, and their digest.

The ``grade-e2e-run`` skill invokes this instead of listing files, so the
grader does not see ``run-<ts>.json`` (which holds the judge's
verdict) because this command only prints the four grading-input paths. The digest (``blind_bundle_digest``) is a sha256 over the
normalized content of all four files (``fixture.json`` minus its top-level
``hint``; see ``_DIGEST_IGNORED_FIXTURE_KEYS``); PR C stamps it into the e2e
``.ann.json`` so ``calibrate_judge`` can later verify what the grader saw.

Usage::

    cd eval/harness && uv run python -m e2e.blind_bundle <slug> [<stem>]

``<stem>`` is the run-log stem (e.g. ``run-2026-09-09_14-30-43``).
When omitted, the newest ``run-`` prefixed run log is used.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from harness.snapshot import hash_content, hash_file, normalize

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_RUNLOGS_ROOT = REPO_ROOT / "eval" / "runlogs" / "e2e"
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"

_RUN_STEM_RE = re.compile(r"^run-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})$")

# Top-level keys of the fixture's `fixture.json` left out of the digest. `hint`
# (issue #3553) is adjudication metadata — the genealogist's call on whether the
# hinted record persona is the tree person, scored by `make matcher-accuracy` —
# not grading input, and a grade made before the field existed cannot have been
# influenced by it, so backfilling it must not orphan that grade's stamp.
# Hand-kept in sync with `_DIGEST_IGNORED_FIXTURE_KEYS` in
# scripts/check_e2e_fixtures.py (`test_blind_bundle.py` asserts they agree).
_FIXTURE_NAME = "fixture.json"
_DIGEST_IGNORED_FIXTURE_KEYS = ("hint",)


def _newest_stem(slug_dir: Path) -> str:
    """Return the stem of the newest ``run-<ts>`` run log in *slug_dir*."""
    stems: list[str] = []
    for p in slug_dir.iterdir():
        if p.suffix == ".json" and not p.name.endswith((".ann.json", ".final-tree.gedcomx.json", ".final-research.json")):
            stem = p.stem
            if _RUN_STEM_RE.match(stem):
                stems.append(stem)
    if not stems:
        raise FileNotFoundError(f"no run-<ts>.json in {slug_dir}")
    stems.sort()
    return stems[-1]


def bundle_paths(
    slug: str,
    stem: str,
    *,
    fixtures_root: Path = DEFAULT_FIXTURES_ROOT,
    runlogs_root: Path = DEFAULT_RUNLOGS_ROOT,
) -> list[Path]:
    """Return the 4 file paths the blind grader may read, in order."""
    fixture_dir = fixtures_root / slug
    runlog_dir = runlogs_root / slug
    return [
        fixture_dir / "expected-findings.json",
        fixture_dir / "fixture.json",
        runlog_dir / f"{stem}.final-tree.gedcomx.json",
        runlog_dir / f"{stem}.final-research.json",
    ]


def bundle_digest(paths: list[Path]) -> str:
    """Compute sha256 over the normalized content of *paths*.

    Hash each file individually via ``hash_file``, then combine the sorted
    ``{path: hash}`` map — the same pattern as ``provenance.skills_hash``.
    ``fixture.json`` is hashed without its ``_DIGEST_IGNORED_FIXTURE_KEYS``.
    """
    file_map: dict[str, str] = {}
    for p in paths:
        key = p.name
        if key == _FIXTURE_NAME:
            file_map[key] = _fixture_hash(p)
        else:
            file_map[key] = hash_file(key, p)
    return hash_content(json.dumps(file_map, sort_keys=True, ensure_ascii=False))


def _fixture_hash(p: Path) -> str:
    """``hash_file`` of *p* with ``_DIGEST_IGNORED_FIXTURE_KEYS`` dropped.

    A file carrying none of those keys is hashed from its own bytes, exactly as
    ``hash_file`` would, so no existing digest moves.
    """
    if not p.exists():
        return ""
    raw = p.read_bytes()
    try:
        obj = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        obj = None
    if isinstance(obj, dict) and any(k in obj for k in _DIGEST_IGNORED_FIXTURE_KEYS):
        kept = {k: v for k, v in obj.items() if k not in _DIGEST_IGNORED_FIXTURE_KEYS}
        raw = json.dumps(kept, ensure_ascii=False).encode("utf-8")
    return hash_content(normalize(_FIXTURE_NAME, raw))


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        prog="e2e.blind_bundle",
        description=(
            "Print the four files a blind grader may read, plus their "
            "digest. Does not print run-<ts>.json."
        ),
    )
    parser.add_argument("slug", help="Fixture slug (e.g. anders-monsen-ancestry)")
    parser.add_argument(
        "stem",
        nargs="?",
        default=None,
        help="Run-log stem (e.g. run-2026-09-09_14-30-43). Default: newest.",
    )
    parser.add_argument("--fixtures-root", type=Path, default=DEFAULT_FIXTURES_ROOT)
    parser.add_argument("--runlogs-root", type=Path, default=DEFAULT_RUNLOGS_ROOT)
    args = parser.parse_args(argv)

    # Refuse an explicit run-<ts>.json path — the grader must not see it.
    if args.stem and args.stem.endswith(".json"):
        print(
            f"blind_bundle: refusing '{args.stem}' — pass the stem "
            f"(e.g. run-2026-09-09_14-30-43), not a .json filename. "
            f"run-<ts>.json holds the judge's verdict and must not be "
            f"opened before grading.",
            file=sys.stderr,
        )
        return 1

    slug_dir = args.runlogs_root / args.slug
    if not slug_dir.is_dir():
        print(f"blind_bundle: no run logs for slug '{args.slug}' at {slug_dir}", file=sys.stderr)
        return 1

    try:
        stem = args.stem if args.stem else _newest_stem(slug_dir)
    except FileNotFoundError as e:
        print(f"blind_bundle: {e}", file=sys.stderr)
        return 1

    paths = bundle_paths(
        args.slug, stem,
        fixtures_root=args.fixtures_root,
        runlogs_root=args.runlogs_root,
    )

    missing = [p for p in paths if not p.exists()]
    if missing:
        print("blind_bundle: missing file(s):", file=sys.stderr)
        for p in missing:
            print(f"  {p}", file=sys.stderr)
        return 1

    digest = bundle_digest(paths)

    print("Blind bundle files:")
    for p in paths:
        print(f"  {p}")
    print(f"\nblind_bundle_digest={digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
