#!/usr/bin/env python3
"""Corpus replay behind research_append's resolution-kind precondition (#1852).

No committed op carries `resolution_kind`, so replaying the rule as written
refuses every resolve and measures nothing. ADR-0011 limit 2 is met instead by
three numbers over every LANDED `conflicts` resolve op in the committed e2e run
logs:

  (a) the op names a winner (`preferred_assertion_id` in the conflict's
      `competing_assertion_ids`) — it passes as `competitor` once it names the
      kind;
  (b) it names no winner — it needs `tree` or `synthesis`;
  (c) of (b), the rationale already cites at least two distinct `src_`/`a_`
      ids — the half of `synthesis` a rationale can already carry.

An update op carries only the fields it changes, so a field it does not name is
read from the run's committed final state for the same conflict id. Also printed:
the final-state scale (resolved conflicts, those with no winner, and those of
them citing two ids), and each conflict the issue #2203 genealogist adjudication
labelled, with its label, so (b) can be read against it.

Committed so the figures in guardrail-enforcement-spec.md stay reproducible
after PLAN.md is deleted. Usage (from eval/harness):
    uv run python scripts/measure_resolution_kind.py [--list]
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
REPO = HARNESS.parents[1]
sys.path.insert(0, str(HARNESS))

from harness.context_policy import bare_tool_name  # noqa: E402
from harness.skill_invocation import _iter_ops, did_not_land  # noqa: E402

_IDS = re.compile(r"\b(?:src|a)_\d+\b", re.I)

# Issue #2203's labels, keyed (fixture slug, conflict id). Two bottemiller runs
# share the key; both are labelled synthesis.
ADJUDICATED = {
    ("antonio-lucas-spouse", "c_001"): "tree",
    ("bottemiller-parents", "c_001"): "synthesis",
    ("broyles-siblings", "c_002"): "synthesis",
    ("jens-nielsen", "c_001"): "tree",
    ("katalin-horak-son", "c_001"): "not actually resolved",
    ("mary-mcandrew-son", "c_001"): "synthesis",
    ("pierre-desobry-spouse", "c_001"): "competitor",
    ("teitje-harkema-parents-1833", "c_001"): "competitor",
    ("victor-spenard-parents", "c_001"): "competitor",
    ("zuniga-rojas-parents", "c_001"): "synthesis",
}


def cited(text: object) -> int:
    return len({m.lower() for m in _IDS.findall(text)}) if isinstance(text, str) else 0


def main() -> int:
    show = "--list" in sys.argv
    files = subprocess.run(
        ["git", "ls-files", "eval/runlogs/e2e"], cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout.split()
    logs = [f for f in files if Path(f).name.startswith("run-") and Path(f).name.count(".") == 1]
    head = subprocess.run(
        ["git", "rev-parse", "--short=9", "HEAD"], cwd=REPO, capture_output=True, text=True, encoding="utf-8", check=True
    ).stdout.strip()

    ops = a = b = c = 0
    b_rows: list[str] = []
    for f in logs:
        run = json.loads((REPO / f).read_text(encoding="utf-8"))
        final_path = REPO / f.replace(".json", ".final-research.json")
        final = json.loads(final_path.read_text(encoding="utf-8")) if final_path.exists() else {}
        final_by_id = {x.get("id"): x for x in final.get("conflicts") or [] if isinstance(x, dict)}
        for call in run.get("tool_calls") or []:
            if did_not_land(call) or bare_tool_name(call.get("tool", "")) != "research_append":
                continue
            for op in _iter_ops(call.get("args") or {}):
                if op.get("section") != "conflicts":
                    continue
                d = op.get("fields") if isinstance(op.get("fields"), dict) else op.get("entry")
                if not isinstance(d, dict) or d.get("status") != "resolved":
                    continue
                prior = final_by_id.get(op.get("entryId") or d.get("id"), {})
                competing = d.get("competing_assertion_ids", prior.get("competing_assertion_ids")) or []
                winner = d.get("preferred_assertion_id", prior.get("preferred_assertion_id"))
                rationale = d.get("resolution_rationale", prior.get("resolution_rationale"))
                ops += 1
                if isinstance(winner, str) and winner in competing:
                    a += 1
                    continue
                b += 1
                n = cited(rationale)
                c += n >= 2
                b_rows.append(f"  {Path(f).parent.name}/{Path(f).name} {op.get('entryId') or '(append)'}: rationale cites {n}")

    res = none = none_two = 0
    for f in files:
        if not f.endswith(".final-research.json"):
            continue
        for x in json.loads((REPO / f).read_text(encoding="utf-8")).get("conflicts") or []:
            if isinstance(x, dict) and x.get("status") == "resolved":
                res += 1
                if not x.get("preferred_assertion_id"):
                    none += 1
                    none_two += cited(x.get("resolution_rationale")) >= 2

    print(f"HEAD {head}; {len(logs)} committed e2e run logs")
    print(f"landed resolve ops: {ops}")
    print(f"  (a) name a winner among competing_assertion_ids (pass as competitor): {a}")
    print(f"  (b) name no winner (need tree or synthesis): {b}")
    print(f"  (c) of (b), rationale already cites >= 2 distinct src_/a_ ids: {c}")
    print(f"final states: {res} resolved conflicts, {none} with no preferred_assertion_id, {none_two} of those citing >= 2 ids")
    print("issue #2203 adjudication, read against the final states:")
    for f in files:
        if not f.endswith(".final-research.json"):
            continue
        slug = Path(f).parent.name
        for x in json.loads((REPO / f).read_text(encoding="utf-8")).get("conflicts") or []:
            key = (slug, x.get("id")) if isinstance(x, dict) else None
            if key in ADJUDICATED and x.get("status") == "resolved" and not x.get("preferred_assertion_id"):
                print(f"  {slug} {x['id']} ({Path(f).name[4:23]}): {ADJUDICATED[key]}; rationale cites {cited(x.get('resolution_rationale'))}")
    if show:
        print("\n(b) ops:")
        print("\n".join(b_rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
