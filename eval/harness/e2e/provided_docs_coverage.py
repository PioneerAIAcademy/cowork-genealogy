"""Report e2e fixtures whose latest run skipped non-FamilySearch primary plan
items but ship no bundled external-evidence capture.

Issue #2083: 76 % of primary Ancestry items are skipped in autonomous runs
because no human can upload a capture.  The provided-documents/ mechanism
closes the gap where one exists; this script shows where it does not.

**What a "gap fixture" is.**  A fixture is a gap when ALL of these hold:

  1. Its latest committed ``.final-research.json`` sidecar has at least one
     non-FamilySearch primary plan item with ``status == "skipped"``.
     ("Primary" means the item has no ``fallback_for``; fallback items are
     legitimately skipped ~62 % of the time and are excluded.)
  2. Its ``provided-documents/`` directory is absent or contains no real
     files (``.gitkeep`` and other dot-files are ignored).

**What this script does NOT do.**  It does not assert that a committed
capture is an authentic paywalled page — nothing in CI can verify that (see
"The failure mode this task is exposed to" in issue #2083).  Its job is
narrower: flag fixtures where the harness cannot supply what the plan needs.

CLI (from eval/harness/):
    uv run python -m e2e.provided_docs_coverage
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

from e2e.runlog_selection import REPO_ROOT

E2E_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "e2e"
E2E_FIXTURES = REPO_ROOT / "eval" / "tests" / "e2e"
PROVIDED_DOCS_DIRNAME = "provided-documents"
FAMILYSEARCH = "FamilySearch"


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------


def _latest_final_research_per_fixture(
    runlogs_root: Path,
) -> dict[str, Path]:
    """Map fixture slug → its most recent ``.final-research.json`` path."""
    latest: dict[str, Path] = {}
    if not runlogs_root.is_dir():
        return latest
    for slug_dir in sorted(runlogs_root.iterdir()):
        if not slug_dir.is_dir():
            continue
        candidates = sorted(
            p for p in slug_dir.iterdir() if p.name.endswith(".final-research.json")
        )
        if candidates:
            latest[slug_dir.name] = candidates[-1]
    return latest


def _has_real_capture(fixture_dir: Path) -> bool:
    """True when ``provided-documents/`` contains at least one real file.

    Dot-files (``.gitkeep``, ``.gitignore``) are placeholders, not evidence.
    """
    docs_dir = fixture_dir / PROVIDED_DOCS_DIRNAME
    if not docs_dir.is_dir():
        return False
    return any(p for p in docs_dir.iterdir() if p.is_file() and not p.name.startswith("."))


def _capture_count(fixture_dir: Path) -> int:
    """Number of real (non-dot) files in ``provided-documents/``."""
    docs_dir = fixture_dir / PROVIDED_DOCS_DIRNAME
    if not docs_dir.is_dir():
        return 0
    return sum(1 for p in docs_dir.iterdir() if p.is_file() and not p.name.startswith("."))


def _external_primary_skips(final_research: dict) -> collections.Counter:
    """Counter of ``repository → skip count`` for non-FS primary skipped items.

    Excludes:
      - items with ``fallback_for`` set (legitimate deferred alternates)
      - items whose ``status`` is not ``"skipped"``
      - FamilySearch items (not a capture gap)
    """
    c: collections.Counter = collections.Counter()
    for plan in final_research.get("plans") or []:
        for item in plan.get("items") or []:
            if item.get("fallback_for"):
                continue
            if item.get("status") != "skipped":
                continue
            repo = item.get("repository") or "?"
            if repo == FAMILYSEARCH:
                continue
            c[repo] += 1
    return c


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def coverage_report(
    runlogs_root: Path = E2E_RUNLOGS,
    fixtures_root: Path = E2E_FIXTURES,
) -> tuple[dict, list[dict]]:
    """Return ``(skip_table, gap_rows)`` over the latest committed run per fixture.

    ``skip_table``:
        ``{repo_key: {"skip": N, "total": N}}`` where ``repo_key`` is
        ``"FamilySearch"``, ``"Ancestry"``, or ``"other"``.

    ``gap_rows``:
        One dict per gap fixture, sorted by total external skips descending:
        ``{"slug": str, "skips": Counter, "captures": int}``.
    """
    latest = _latest_final_research_per_fixture(runlogs_root)

    skip_table: dict[str, dict] = {
        "FamilySearch": {"skip": 0, "total": 0},
        "Ancestry": {"skip": 0, "total": 0},
        "other": {"skip": 0, "total": 0},
    }
    gap_rows: list[dict] = []

    for slug, sidecar in sorted(latest.items()):
        try:
            data = json.loads(sidecar.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue

        # Accumulate skip table (all repos, all primaries)
        for plan in data.get("plans") or []:
            for item in plan.get("items") or []:
                if item.get("fallback_for"):
                    continue
                repo = item.get("repository") or "?"
                key = repo if repo in ("FamilySearch", "Ancestry") else "other"
                skip_table[key]["total"] += 1
                if item.get("status") == "skipped":
                    skip_table[key]["skip"] += 1

        # Check gap
        ext_skips = _external_primary_skips(data)
        if not ext_skips:
            continue

        fixture_dir = fixtures_root / slug
        captures = _capture_count(fixture_dir)
        gap_rows.append({"slug": slug, "skips": ext_skips, "captures": captures})

    # Sort: most external skips first; within tie, zero-capture fixtures first
    gap_rows.sort(key=lambda r: (-sum(r["skips"].values()), r["captures"]))
    return skip_table, gap_rows


def _pct(n: int, d: int) -> str:
    return f"{100 * n / d:.1f}%" if d else "—"


def main() -> int:
    # Non-ASCII characters in output (arrows, etc.) die with UnicodeEncodeError
    # on Windows cp1252 consoles.  Reconfigure to UTF-8 before any print().
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    skip_table, gap_rows = coverage_report()

    print("External-repository breadth coverage (issue #2083)")
    print("=" * 60)
    print("Skip rate for primary (non-fallback) plan items by repository")
    print(f"  (latest committed .final-research.json sidecar per fixture)\n")

    for key in ("FamilySearch", "Ancestry", "other"):
        s = skip_table[key]
        print(
            f"  {key:14}  {s['skip']:4}/{s['total']:4}  = {_pct(s['skip'], s['total'])}"
        )

    gap = [r for r in gap_rows if r["captures"] == 0]
    partial = [r for r in gap_rows if r["captures"] > 0]

    print(f"\nFixtures with external skips and NO bundled capture  ({len(gap)} fixtures)")
    print("-" * 60)
    if gap:
        for r in gap:
            repos = ", ".join(f"{v} {k}" for k, v in sorted(r["skips"].items()))
            print(f"  {r['slug']:<36}  {repos}")
    else:
        print("  (none)")

    if partial:
        print(
            f"\nFixtures with external skips and SOME bundled capture  ({len(partial)} fixtures)"
        )
        print("-" * 60)
        for r in partial:
            repos = ", ".join(f"{v} {k}" for k, v in sorted(r["skips"].items()))
            print(f"  {r['slug']:<36}  {repos}  [{r['captures']} capture(s)]")

    total_gap = sum(sum(r["skips"].values()) for r in gap)
    total_partial = sum(sum(r["skips"].values()) for r in partial)
    print(
        f"\n  {len(gap)} gap fixture(s) → {total_gap} unobtainable skipped item(s)"
    )
    if partial:
        print(
            f"  {len(partial)} partial fixture(s) → {total_partial} still-skipped item(s)"
            " despite having captures"
        )
    print(
        "\nTo close a gap: add a real PDF/PNG saved from the paywalled site"
        f"\n  to  eval/tests/e2e/<slug>/{PROVIDED_DOCS_DIRNAME}/"
        "\nThen re-run: make e2e-run TEST=<slug>"
    )

    # Exit 1 when any fixture has external skips and zero captures, so a
    # pre-commit hook or a developer can catch the gap before it silently
    # corrupts the benchmark.
    return 1 if gap else 0


if __name__ == "__main__":
    raise SystemExit(main())
