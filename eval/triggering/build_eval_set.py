#!/usr/bin/env python3
"""Derive a description/trigger eval set for one skill from the unit-test corpus.

The description optimizer (eval/triggering/scripts/run_loop.py, vendored from
Anthropic's skill-creator) tunes a skill's SKILL.md `description` against a list
of [{query, should_trigger}] items. This script builds that list for free from
the genealogist-authored unit tests, so the optimizer trains on real,
domain-expert phrasings instead of hand-written queries.

Mapping (see docs/plan/skill-mcp-optimization-plan.md):
  - every POSITIVE test for skill X            -> {query, should_trigger: true}
  - every NEGATIVE test for skill X            -> {query, should_trigger: false}
  - every NEGATIVE test in ANOTHER skill whose
    `negative.correct_skill` names X           -> {query, should_trigger: true}
        (the author already asserted X is the right route, so it is a free,
         domain-expert-labeled positive trigger for X)

Output: eval/triggering/eval_sets/<skill>.json — a JSON array of
{query, should_trigger, _provenance}. Regenerable; gitignored. The optimizer
reads only `query` + `should_trigger`; `_provenance` is for human review.

Stdlib only.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent  # eval/triggering
REPO_ROOT = HERE.parents[1]
TESTS_DIR = REPO_ROOT / "eval" / "tests" / "unit"
SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
OUT_DIR = HERE / "eval_sets"


def load_tests() -> list[tuple[Path, dict]]:
    out = []
    for tj in sorted(TESTS_DIR.glob("*/*.json")):
        try:
            out.append((tj, json.loads(tj.read_text(encoding="utf-8"))))
        except json.JSONDecodeError:
            print(f"  warning: skipping unparseable {tj.relative_to(REPO_ROOT)}", file=sys.stderr)
    return out


def build_for_skill(skill: str, tests: list[tuple[Path, dict]]) -> list[dict]:
    items: list[dict] = []
    for _tj, t in tests:
        meta = t.get("test", {})
        ttype = meta.get("type")
        tid = meta.get("id")
        owner = meta.get("skill")
        msg = (t.get("input") or {}).get("user_message")
        if not msg:
            continue
        if owner == skill and ttype == "positive":
            items.append({"query": msg, "should_trigger": True,
                          "_provenance": {"test_id": tid, "reason": "positive test for this skill"}})
        elif owner == skill and ttype == "negative":
            items.append({"query": msg, "should_trigger": False,
                          "_provenance": {"test_id": tid, "reason": "negative test for this skill"}})
        elif ttype == "negative":
            correct = (t.get("negative") or {}).get("correct_skill") or []
            if skill in correct:
                items.append({"query": msg, "should_trigger": True,
                              "_provenance": {"test_id": tid,
                                              "reason": f"negative test in '{owner}' routes here (correct_skill)"}})
    return items


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--skill", required=True,
                    help="skill directory name under packages/engine/plugin/skills/")
    ap.add_argument("--out", default=None,
                    help="output path (default eval/triggering/eval_sets/<skill>.json)")
    args = ap.parse_args()

    if not (SKILLS_DIR / args.skill).is_dir():
        print(f"ERROR: no skill '{args.skill}' under {SKILLS_DIR}", file=sys.stderr)
        return 1

    items = build_for_skill(args.skill, load_tests())
    pos = sum(1 for i in items if i["should_trigger"])
    neg = len(items) - pos

    out = Path(args.out) if args.out else (OUT_DIR / f"{args.skill}.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8")
    print(f"{args.skill}: {len(items)} queries ({pos} should-trigger, {neg} should-not) "
          f"-> {out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out}")

    if pos < 3 or neg < 3:
        print(f"  NOTE: thin set ({pos} positive / {neg} negative). run_loop holds out ~40% "
              f"stratified by polarity and needs a few of each class; add tests (or hand-add "
              f"near-miss negatives) before trusting the optimizer's scores.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
