"""Report external identifiers a skill persisted that no input could have supplied.

Seven of 27 skill bodies carry a don't-fabricate rule in prose — `research-plan`
("never cite or invent a specific source … not already in the before-state"),
`citation` ("every value … must be traceable"), `search-external-sites` ("do not
guess it"), `check-warnings` ("do not invent fact ids, dates, or sources the tool
didn't return"), plus `locality-guide`, `init-project` and `person-evidence`.
**Nothing checked any of them.** This is the mechanical half.

Offline and free: it reads committed run logs, the test corpus, the scenario
fixtures and the mocked MCP fixtures. No model calls, no network.

    cd eval/harness && uv run python -m provenance_report [--skill NAME]

## Why this is a report and not a validator (yet)

Two findings from measuring it against the committed corpus first — the repo's
rule is that a check has to be proven to fail before it is trusted, and this one
had to be proven not to fire on everything:

1. **A validator cannot see tool responses.** `tool_calls` records `{tool, args}`
   only (`skill_runner.py`), so "did this id come back from a call?" is not
   answerable at validator time. The mocked responses *are* on disk, so this
   reads the test's declared `mcp_fixtures[]` instead — which is sound for the
   unit harness and would not be for a live run.
2. **Years swamp a naive check.** Requiring every 4+ digit number to trace gave
   442 hits across 89 test-pairs, almost all of them genealogical years the skill
   legitimately derived (1844, 1865, 1868…). Restricting to ARKs and 5+ digit
   numbers gives **46 hits across 26 test-pairs of 1,842 test-runs**.

Those 26 are a triage pile, not a verdict: some are real model-memory citations
(a collection id no fixture returned), some are punctuation captured by the ARK
pattern. Triage them, then decide what becomes blocking — see issue #1667.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
UNIT_RUNLOGS = REPO_ROOT / "eval" / "runlogs" / "unit"
UNIT_TESTS = REPO_ROOT / "eval" / "tests" / "unit"
MCP_FIXTURES = REPO_ROOT / "eval" / "fixtures" / "mcp"
SCENARIOS = REPO_ROOT / "eval" / "fixtures" / "scenarios"

# FamilySearch ARK. The trailing-punctuation trim below matters: a citation ends
# an ARK with a full stop and the raw match would carry it, making every ARK look
# untraceable.
ARK_RE = re.compile(r"ark:/\d+/[\w:.-]+")

# A bare identifier-shaped number. **5+ digits, deliberately.** Four digits is a
# year, and requiring years to trace flagged 442 legitimate derivations.
NUM_RE = re.compile(r"(?<![\w.:/-])\d{5,}(?![\w.-])")


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def candidate_identifiers(text: str) -> set[str]:
    """External identifiers worth tracing, normalised."""
    out = {a.rstrip(".,;:)") for a in ARK_RE.findall(text)}
    out |= set(NUM_RE.findall(text))
    return {c for c in out if c}


def sources_for(spec: dict) -> str:
    """Everything the run could legitimately have read an identifier from."""
    parts = [spec.get("input", {}).get("user_message", "") or ""]
    scenario = (spec.get("input") or {}).get("scenario")
    if scenario:
        d = SCENARIOS / scenario
        if d.is_dir():
            for f in sorted(d.glob("*.json")):
                parts.append(_read(f))
    for fx in spec.get("mcp_fixtures") or []:
        parts.append(_read(MCP_FIXTURES / f"{fx}.json"))
    return "\n".join(parts)


def load_specs() -> dict[str, dict]:
    specs = {}
    for p in sorted(UNIT_TESTS.glob("*/*.json")):
        if p.name == "rubric.md":
            continue
        try:
            d = json.loads(_read(p))
        except json.JSONDecodeError:
            continue
        tid = (d.get("test") or {}).get("id")
        if tid:
            specs[tid] = d
    return specs


def scan(skill_filter: str | None = None) -> dict[str, dict[tuple[str, str], int]]:
    """skill -> {(test_id, identifier): run_count} for identifiers with no source.

    Counted across run logs rather than listed per log: the same citation
    recurring in five runs is one defect seen five times, and printing it five
    times buries the single-run ones.
    """
    specs = load_specs()
    findings: dict[str, dict[tuple[str, str], int]] = defaultdict(lambda: defaultdict(int))
    if not UNIT_RUNLOGS.is_dir():
        return findings
    for skill_dir in sorted(UNIT_RUNLOGS.iterdir()):
        if not skill_dir.is_dir():
            continue
        if skill_filter and skill_dir.name != skill_filter:
            continue
        for p in sorted(skill_dir.glob("v*.json")):
            if p.name.endswith(".ann.json"):
                continue
            try:
                log = json.loads(_read(p))
            except json.JSONDecodeError:
                continue
            for t in log.get("tests") or []:
                spec = specs.get(t.get("test_id"))
                if not spec:
                    continue
                haystack = sources_for(spec)
                seen: set[str] = set()
                for r in t.get("runs") or []:
                    changes = (r.get("output") or {}).get("file_changes") or {}
                    for cand in candidate_identifiers(json.dumps(changes)):
                        if cand not in haystack and cand not in seen:
                            seen.add(cand)
                            findings[skill_dir.name][(t["test_id"], cand)] += 1
    return findings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="provenance_report",
        description="Identifiers persisted that no fixture, scenario or user "
        "message supplied. Offline; makes no API calls.",
    )
    ap.add_argument("--skill", help="Limit to one skill.")
    args = ap.parse_args(argv)

    findings = scan(args.skill)
    total = sum(len(v) for v in findings.values())
    if not total:
        print("No untraceable identifiers found.")
        return 0

    print(f"Untraceable persisted identifiers: {total} across "
          f"{len(findings)} skill(s)\n")
    for skill in sorted(findings):
        rows = findings[skill]
        print(f"{skill}  ({len(rows)})")
        for (tid, ident), runs in sorted(rows.items()):
            seen_in = f"  [{runs} runs]" if runs > 1 else ""
            print(f"    {tid:34s} {ident}{seen_in}")
        print()
    print("Not all of these are fabrications — triage before acting. A value the "
          "skill legitimately derived (a computed date, a normalised place) and "
          "an ARK carrying trailing punctuation both land here. See issue #1667.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
