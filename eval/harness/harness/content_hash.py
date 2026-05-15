"""SHA-256 hash of a test's resolved content for cross-PR comparison.

Per docs/plan/per-pr-review-workflow.md §2.4: the comparison view auto-excludes
tests whose hash differs between a PR's run log and main's. The hash covers:

- the test JSON minus cosmetic fields (`name`, `description`, `tags`)
- the contents of the referenced scenario directory (`research.json` +
  `tree.gedcomx.json`)
- the contents of each referenced MCP fixture file

Inputs are normalized for whitespace and key order before hashing. The
exclusion-based phrasing (exclude cosmetic fields, include everything else)
means future schema additions are caught by default — a new grading-relevant
field on the test schema automatically participates in the hash.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any


# Cosmetic fields in test.<x> that don't affect grading and should not
# invalidate cross-PR comparison when edited (typo fixes, tag additions,
# description tightening).
_COSMETIC_TEST_FIELDS = ("name", "description", "tags")

# Scenario files included in the hash. README.md is documentation and is
# intentionally excluded; only the state files participate.
_SCENARIO_FILES = ("research.json", "tree.gedcomx.json")


def compute_test_content_hash(
    test_raw: dict[str, Any],
    scenario_name: str | None,
    fixture_names: list[str],
    scenarios_dir: Path,
    fixtures_dir: Path,
) -> str:
    """Return SHA-256 hex digest of the resolved test content.

    Inputs are concatenated in a fixed order and canonically serialized so
    the hash is stable across processes and OS-level JSON read/write
    round-trips:

      1. The test JSON with cosmetic fields removed.
      2. For each scenario file (research.json then tree.gedcomx.json),
         the file's parsed-and-canonicalized JSON, or `<missing:fname>`
         if absent. Empty scenario_name skips the section entirely.
      3. For each fixture in fixture_names (preserving order — order matters
         for the harness's queue-mode dispatch), the fixture's parsed-and-
         canonicalized JSON, or `<missing:name>` if absent.

    A missing scenario directory contributes `<missing-scenario:name>`
    once; the file-level markers above only apply when the directory
    exists but the file inside it doesn't.
    """
    parts: list[str] = [_canonical(_strip_cosmetic(test_raw))]

    if scenario_name:
        scenario_dir = Path(scenarios_dir) / scenario_name
        if not scenario_dir.is_dir():
            parts.append(f"<missing-scenario:{scenario_name}>")
        else:
            for fname in _SCENARIO_FILES:
                f = scenario_dir / fname
                if f.exists():
                    parts.append(_canonical(json.loads(f.read_text())))
                else:
                    parts.append(f"<missing:{fname}>")

    for name in fixture_names:
        path = Path(fixtures_dir) / f"{name}.json"
        if path.exists():
            parts.append(_canonical(json.loads(path.read_text())))
        else:
            parts.append(f"<missing-fixture:{name}>")

    combined = "\n".join(parts)
    return hashlib.sha256(combined.encode("utf-8")).hexdigest()


def _strip_cosmetic(test_raw: dict[str, Any]) -> dict[str, Any]:
    """Return a deep copy of test_raw with cosmetic test.<x> fields removed.

    `test_raw` is the full test JSON (with `test`, `input`, `mcp_fixtures`,
    etc. at the top level). We only strip from the inner `test` block — the
    other top-level keys are all grading-relevant.
    """
    out = copy.deepcopy(test_raw)
    if isinstance(out.get("test"), dict):
        for field in _COSMETIC_TEST_FIELDS:
            out["test"].pop(field, None)
    return out


def _canonical(obj: Any) -> str:
    """Canonical JSON serialization — sorted keys, no whitespace, ASCII-only.

    This is the standard "canonical JSON" recipe: order-independent for dicts,
    whitespace-stripped, ASCII-escaped. Two structurally equivalent objects
    always produce the same string regardless of how they were originally
    written to disk.
    """
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
