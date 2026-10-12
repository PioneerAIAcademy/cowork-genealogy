"""Seed a scenario's `external-collections.json` from external-links fixtures.

A scenario whose test starts with the curated list already stored (#2995) needs
the file the real `external_links_search` would have written. Writing it by hand
drifts from the engine's shape and byte order, so this replays fixtures through
the same compiled store the eval mock uses (`mock_mcp._store_external_collections`).

    uv run python scripts/seed_external_collections.py <scenario-dir> \\
        "<standardPlace>=<fixture-name>" ["<standardPlace>=<fixture-name>" ...]

Each pair is one fetch, in order, as if the agent had called
`external_links_search({standardPlace, projectPath})`. Needs a current engine
build (`make` in packages/engine/mcp-server). The scenario must already hold a
research.json, as a project does.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

_HARNESS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_HARNESS))

from harness.mock_mcp import _store_external_collections  # noqa: E402

FIXTURES = _HARNESS.parent / "fixtures" / "mcp"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    scenario = Path(argv[0])
    if not (scenario / "research.json").is_file():
        print(f"error: {scenario} holds no research.json", file=sys.stderr)
        return 2
    for pair in argv[1:]:
        place, sep, name = pair.partition("=")
        if not sep or not place or not name:
            print(f"error: expected <standardPlace>=<fixture-name>, got {pair!r}", file=sys.stderr)
            return 2
        path = FIXTURES / f"{name}.json"
        if not path.is_file():
            print(f"error: no fixture {path}", file=sys.stderr)
            return 2
        fixture = json.loads(path.read_text(encoding="utf-8"))
        if fixture.get("tool") != "external_links_search":
            print(f"error: {name} is not an external_links_search fixture", file=sys.stderr)
            return 2
        out = _store_external_collections(
            scenario,
            {"standardPlace": place, "projectPath": str(scenario)},
            fixture["response"],
            fixture.get("stored_rows"),
        )
        if "stored" not in out:
            print(f"error: nothing stored for {place!r}: {out.get('collectionsError', 'engine build missing?')}",
                  file=sys.stderr)
            return 1
        print(f"{place}: stored {', '.join(out['stored']['places'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
