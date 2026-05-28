#!/usr/bin/env python3
"""Generate an agree-with-all .ann.json for a run log.

Usage: uv run python eval/harness/scripts/gen_ann.py <path/to/runlog.json>
Writes <path/to/runlog>.ann.json with corrected_score == llm_score for every dimension.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: gen_ann.py <runlog.json>", file=sys.stderr)
        return 1

    runlog_path = Path(sys.argv[1])
    if not runlog_path.exists():
        print(f"File not found: {runlog_path}", file=sys.stderr)
        return 1

    log = json.loads(runlog_path.read_text())
    corrections = []

    for test in log.get("tests", []):
        test_id = test.get("test_id", "")
        # Use aggregated_dimensions (the per-test summary already merged across runs)
        dims = test.get("outcome_summary", {}).get("aggregated_dimensions", [])
        for dim in dims:
            corrections.append(
                {
                    "test_id": test_id,
                    "dimension_source": dim.get("source", "base"),
                    "dimension_name": dim.get("name", ""),
                    "llm_score": dim.get("score"),
                    "corrected_score": dim.get("score"),
                }
            )

    ann = {
        "run_log": runlog_path.name,
        "annotator": "francis",
        "corrections": corrections,
    }

    ann_path = runlog_path.with_suffix("").with_suffix("") if runlog_path.name.endswith(".json") else runlog_path
    ann_path = runlog_path.parent / (runlog_path.stem + ".ann.json")
    ann_path.write_text(json.dumps(ann, indent=2) + "\n")
    print(f"Wrote {ann_path} ({len(corrections)} corrections)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
