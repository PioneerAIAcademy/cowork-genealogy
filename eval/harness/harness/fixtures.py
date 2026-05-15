"""MCP fixture loading + predicate matching per unit-test-spec.md §3.2, §15."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class InvalidFixtureError(Exception):
    """Raised when a fixture file is missing or malformed."""


def load_fixtures(names: list[str], fixtures_dir: Path) -> list[dict[str, Any]]:
    """Load fixture JSON files by stem name from fixtures_dir.

    Stamps each loaded fixture with `_source_name` (the stem name from the
    test's `mcp_fixtures` array) so the call log can report
    `response_fixture` per spec §10. The stem name takes precedence over
    any `_source_name` the JSON already contains.
    """
    out: list[dict[str, Any]] = []
    for name in names:
        path = Path(fixtures_dir) / f"{name}.json"
        if not path.exists():
            raise InvalidFixtureError(f"fixture not found: {path}")
        try:
            fixture = json.loads(path.read_text())
        except json.JSONDecodeError as e:
            raise InvalidFixtureError(
                f"fixture is not valid JSON: {path}: {e}"
            ) from e
        fixture["_source_name"] = name
        out.append(fixture)
    return out


def build_manifest(fixtures: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Group fixtures by tool and split into predicated / queue lists.

    Returns: {
        tool_name: {
            "predicated": [(when, response, source_name), ...],
            "queue": [(response, source_name), ...],
            "input_schema": dict or None,
        }
    }

    `source_name` is the stem name from the test's `mcp_fixtures` array,
    threaded through so the mock handler can record `response_fixture`
    on the call log per spec §10. Returns None when the fixture didn't
    come through `load_fixtures` (e.g., direct test construction).

    When multiple fixtures for the same tool declare different
    `input_schema`s, the last one wins. v1 leaves merging strategies to v2.
    """
    manifest: dict[str, dict[str, Any]] = {}
    for fixture in fixtures:
        if "tool" not in fixture:
            raise InvalidFixtureError(f"fixture missing 'tool' field: {fixture}")
        if "response" not in fixture:
            raise InvalidFixtureError(
                f"fixture missing 'response' field: {fixture.get('tool', '?')}"
            )
        bucket = manifest.setdefault(
            fixture["tool"],
            {"predicated": [], "queue": [], "input_schema": None},
        )
        source = fixture.get("_source_name")
        if "when" in fixture:
            bucket["predicated"].append(
                (fixture["when"], fixture["response"], source)
            )
        else:
            bucket["queue"].append((fixture["response"], source))
        if "input_schema" in fixture:
            bucket["input_schema"] = fixture["input_schema"]
    return manifest


def matches(predicate: dict[str, Any], args: dict[str, Any]) -> bool:
    """Return True iff every key in predicate matches args.

    Keys are dotted paths. The optional "args." prefix is stripped.
    String values prefixed with "~" are case-insensitive substring matches;
    everything else is exact equality.
    """
    for path, expected in predicate.items():
        path = path.removeprefix("args.")
        actual: Any = args
        for part in path.split("."):
            if not isinstance(actual, dict) or part not in actual:
                return False
            actual = actual[part]
        if isinstance(expected, str) and expected.startswith("~"):
            needle = expected[1:].lower()
            if needle not in str(actual).lower():
                return False
        elif actual != expected:
            return False
    return True
