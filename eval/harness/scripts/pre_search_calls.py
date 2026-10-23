"""Count the MCP calls a search-records run makes before its first record_search.

    python eval/harness/scripts/pre_search_calls.py <run-log.json> [<run-log.json> ...]

Per test, the first run's calls are counted; tests that never reach record_search
are skipped. Prints the median and mean (and min/max) of all MCP calls before the
first search, how many of them are research_query, and how many tests had none.
Baseline for issue #3581 (docs/skill-to-agent-pair-conversion.md, "What is still open").
"""
import json
import statistics
import sys
from pathlib import Path


def _bare(name):
    return str(name or "").split("__")[-1]


def measure(path):
    log = json.loads(Path(path).read_text(encoding="utf-8"))
    rows = []
    for test in log["tests"]:
        runs = test.get("runs") or []
        if not runs:
            continue
        names = [_bare(c.get("tool")) for c in runs[0]["output"].get("tool_calls") or []]
        if "record_search" not in names:
            continue
        before = names[: names.index("record_search")]
        rows.append((test["test_id"], len(before), before.count("research_query")))
    return rows


def main(paths):
    for path in paths:
        rows = measure(path)
        calls = [n for _, n, _ in rows]
        queries = [q for _, _, q in rows]
        print(
            f"{Path(path).name}: {len(rows)} tests reach record_search; "
            f"MCP calls before it median {statistics.median(calls)}, "
            f"mean {statistics.mean(calls):.2f} (min {min(calls)}, max {max(calls)}); "
            f"research_query in {sum(1 for q in queries if q)} of {len(rows)}"
        )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
