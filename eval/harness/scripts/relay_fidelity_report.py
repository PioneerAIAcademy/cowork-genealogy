"""How much of an agent's return survives the main thread's relay to the user.

NOT `check_replay_fidelity.py`, which is one letter away and does something
else entirely (it replays e2e runs through `harness/replay.py`). This reads
committed UNIT run logs and compares what an agent returned with what the main
thread then said.

**Report, never a gate.** Nothing here runs in CI, nothing fails a build, and
nothing reaches the judge. That is deliberate and it is the whole reason this
is a script rather than a validator (issue #3188): on a DIRECT test the main
thread is the harness's own dispatcher (`DIRECT_DISPATCH_PROMPT` in
`harness/skill_runner.py`), not the subject under test. A gating `test_*` would
fail most direct runs on every agent suite's next paid eval, and a `report_*`
is fed to the LLM judge as a harness observation (unit-test-spec.md §15, Tier
2), so the judge would charge the agent for the dispatcher's drop. The direct
block below is therefore labelled DISPATCHER fidelity, and is not a statement
about production.

What it measures, per `agent_returns` entry (not per run -- seven runs carry
two entries from two different agents):

  conforming returns   the agent's own .md carries the `summary_for_user`
                       heading, so the text after its final `---` is the part
                       a relay is supposed to reproduce. Read off the AGENT
                       BODY, never off the return text: a PENDING agent's
                       markdown horizontal rule would otherwise look like a
                       summary.
  survives             that text appears in `text_response` as a SUBSTRING.
                       Not equality -- a relay legitimately prefixes its own
                       "Hand-back: ..." preamble, and equality scores 0 of 132
                       on today's corpus while containment scores 7.
  non-conforming       no summary section, so there is no verbatim contract;
                       reported as the share of the return's non-empty lines
                       that appear in `text_response`.

BASELINE, 2026-10-06, main @ c9ad396e6 (29 suites, 230 entries):

  direct (dispatcher fidelity)
    conforming                 135
    with text after final ---  132
    survives exactly             7
    survives normalized         13
  routed (per calling skill)
    conforming                  13
    with text after final ---   13
    survives exactly             0
    survives normalized          0

The routed block is empty of real relays today and that is worth knowing before
reading it: every measurable routed return is `init-project` -> `check-warnings`,
and init-project FOLDS what it gets into its own summary rather than relaying it
(`skills/init-project/SKILL.md:214-220`). `record-extraction/SKILL.md:245`
carries the strictest relay instruction in the repo and contributes no routed
returns at all. So `0 of 13` is a property of the corpus, not a defect in
init-project.

The numbers move as run logs land. Re-run and update the baseline; do not
treat a change as a regression without reading which logs changed.

`HEADING` below is hand-ported from
`packages/engine/mcp-server/tests/packaging/agent-return-contract.test.ts` and
cannot be imported across the language boundary, so drift between the two is
unguarded -- a `nothing-checks` gap noted on issue #3188.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
# Two inserts, both needed. The harness dir is for `harness.*`; HERE is for
# `check_runlogs`, which lives beside this file in a directory with no
# __init__.py and is not importable from the harness dir alone.
sys.path.insert(0, str(REPO / "eval" / "harness"))
sys.path.insert(0, str(HERE))

from check_runlogs import latest_full_skill_runlog  # noqa: E402
from harness.loader import InvalidTestError, load_test  # noqa: E402
from harness.skill_runner import strip_agent_return_trailer  # noqa: E402
from harness.snapshot import hash_file  # noqa: E402

# Module constants so the unit test can point all three at a fixture tree.
RUNLOGS_ROOT = REPO / "eval" / "runlogs" / "unit"
TESTS_ROOT = REPO / "eval" / "tests" / "unit"
AGENTS_ROOT = REPO / "packages" / "engine" / "plugin" / "agents"

# Ported from agent-return-contract.test.ts. Levels 2-4 because that test
# accepts any of them, though every shipped agent uses `###`.
HEADING = re.compile(r"^#{2,4}\s+`summary_for_user`\s*$", re.M)
_FENCE = re.compile(r"(?s)```.*?```")

DIRECT_LABEL = "direct arm — DISPATCHER fidelity, not production"
ROUTED_LABEL = "routed arm — by calling skill"
EXCLUDED_LABEL = "excluded before bucketing"


def strip_fences(text: str) -> str:
    """Drop fenced code blocks, so markup inside one is not read as structure."""
    return _FENCE.sub("", text)


def normalize(text: str) -> str:
    """Canonical form for comparing a relay with a return.

    An ORDERED, exact list, because "normalize dashes" alone is ambiguous
    enough to move the headline: collapsing runs of `-` as well scores 16 where
    this scores 13, and both are faithful readings of a looser rule.

    Runs of `-` are deliberately NOT collapsed -- agents write an em dash as
    `--` and relays render it as a single character, so collapsing would make
    `--` and `-` interchangeable and over-count survival.
    """
    out = text.replace("**", "").replace("*", "")
    for src, dst in (("“", '"'), ("”", '"'), ("‘", "'"), ("’", "'")):
        out = out.replace(src, dst)
    for src in ("—", "–", "−"):
        out = out.replace(src, "-")
    return " ".join(out.split()).strip()


def tail_after_final_rule(text: str) -> str:
    """The text after the return's final `---` line, or "" if it has none.

    A line whose STRIPPED content is exactly `---`, after the runtime trailers
    are removed and fenced blocks dropped -- a `---` inside a code fence would
    otherwise move what counts as "final".
    """
    body = strip_fences(strip_agent_return_trailer(text or ""))
    lines = body.splitlines()
    last = None
    for i, line in enumerate(lines):
        if line.strip() == "---":
            last = i
    if last is None:
        return ""
    return "\n".join(lines[last + 1 :]).strip()


def conforming_agents(agents_root: Path) -> set[str]:
    """Agent names whose body carries the summary heading outside a fence."""
    if not agents_root.is_dir():
        return set()
    return {
        p.stem
        for p in sorted(agents_root.glob("*.md"))
        if HEADING.search(strip_fences(p.read_text(encoding="utf-8")))
    }


def test_arm_index(tests_root: Path) -> dict[str, bool]:
    """`{test id: is_direct}` over every test JSON.

    Built by id because test files are named by SLUG, never by id -- there is
    no path to guess from a run log's `test_id`.
    """
    index: dict[str, bool] = {}
    for path in sorted(tests_root.rglob("*.json")):
        try:
            spec = load_test(path)
        except (InvalidTestError, OSError):
            continue
        if spec.id:
            index[spec.id] = spec.is_direct
    return index


def _blank_counts() -> dict[str, int]:
    return {
        "conforming": 0,
        "with_tail": 0,
        "exact": 0,
        "normalized": 0,
        "non_conforming": 0,
        "lines_found": 0,
        "lines_total": 0,
    }


def compute_counts(
    runlogs_root: Path | None = None,
    tests_root: Path | None = None,
    agents_root: Path | None = None,
) -> dict[str, Any]:
    """Walk the corpus and return the counts, with no formatting.

    Asserted by the unit test as a structure. A golden string would red for
    every break at once -- so no row could be shown to red only its own test --
    and would accept nothing but itself, which gives up the other direction.
    """
    runlogs_root = runlogs_root or RUNLOGS_ROOT
    tests_root = tests_root or TESTS_ROOT
    agents_root = agents_root or AGENTS_ROOT

    conforming = conforming_agents(agents_root)
    arms = test_arm_index(tests_root)
    suites: dict[str, Any] = {}

    for suite_dir in sorted(p for p in runlogs_root.iterdir() if p.is_dir()):
        got = latest_full_skill_runlog(suite_dir)
        if got is None:
            suites[suite_dir.name] = {"log": None}
            continue
        log_name, log = got
        snapshot = log.get("snapshot") or {}
        entry: dict[str, Any] = {
            "log": log_name,
            "direct": _blank_counts(),
            "routed": _blank_counts(),
            "excluded_is_error": 0,
            "no_test_json": 0,
            "orphan_tests": 0,
            "body_changed": 0,
        }

        for test in log.get("tests") or []:
            test_id = test.get("test_id")
            is_direct = arms.get(test_id)
            if is_direct is None:
                # Counted per TEST as well as per return: both orphans on main
                # carry zero returns, so a per-return counter alone reports 0
                # and the guard looks like it found nothing.
                entry["orphan_tests"] += 1
            for run in test.get("runs") or []:
                returns = (run.get("output") or {}).get("agent_returns") or []
                relayed = (run.get("output") or {}).get("text_response") or ""
                for ret in returns:
                    # FIRST. The text is the harness's own stub denial
                    # ("'x' did not execute..."), not the agent's -- relaying
                    # it measures nothing. Before the snapshot check, because
                    # a stubbed agent never ran and so was never snapshotted.
                    if ret.get("is_error"):
                        entry["excluded_is_error"] += 1
                        continue
                    if is_direct is None:
                        entry["no_test_json"] += 1
                        continue

                    agent = ret.get("subagent_type") or ""
                    rel = f"packages/engine/plugin/agents/{agent}.md"
                    stored = snapshot.get(rel)
                    # Hashed from `agents_root`, not `REPO / rel`: the snapshot
                    # KEY is repo-relative (that is what the run log stores),
                    # but the file to hash must come from the configured root
                    # or the unit test cannot exercise this branch at all.
                    if stored is not None and stored != hash_file(
                        rel, agents_root / f"{agent}.md"
                    ):
                        # Additive: counted here AND left in its bucket.
                        entry["body_changed"] += 1

                    side = entry["direct" if is_direct else "routed"]
                    text = ret.get("text") or ""
                    if agent in conforming:
                        side["conforming"] += 1
                        tail = tail_after_final_rule(text)
                        if tail:
                            side["with_tail"] += 1
                            if tail in relayed:
                                side["exact"] += 1
                                side["normalized"] += 1
                            elif normalize(tail) in normalize(relayed):
                                # Inclusive of exact, as the issue counts it.
                                side["normalized"] += 1
                    else:
                        side["non_conforming"] += 1
                        body = strip_agent_return_trailer(text)
                        lines = [
                            normalize(ln) for ln in body.splitlines() if ln.strip()
                        ]
                        norm_relay = normalize(relayed)
                        side["lines_total"] += len(lines)
                        side["lines_found"] += sum(
                            1 for ln in lines if ln and ln in norm_relay
                        )
        suites[suite_dir.name] = entry
    return suites


def format_report(suites: dict[str, Any]) -> str:
    """Human-readable rendering. Timestamps live here, never in the counts."""
    out: list[str] = []
    for arm, label in (("direct", DIRECT_LABEL), ("routed", ROUTED_LABEL)):
        out.append(label)
        total = _blank_counts()
        for name, data in sorted(suites.items()):
            if not data.get("log"):
                continue
            c = data[arm]
            if not (c["conforming"] or c["non_conforming"]):
                continue
            share = (
                f"{100 * c['lines_found'] // c['lines_total']}%"
                if c["lines_total"]
                else "-"
            )
            out.append(
                f"  {name:<26} {data['log']:<34} "
                f"conforming {c['conforming']:>3}  tail {c['with_tail']:>3}  "
                f"exact {c['exact']:>3}  norm {c['normalized']:>3}  "
                f"non-conf {c['non_conforming']:>3} (lines kept {share})"
            )
            for k in total:
                total[k] += c[k]
        out.append(
            f"  {'TOTAL':<26} {'':<34} "
            f"conforming {total['conforming']:>3}  tail {total['with_tail']:>3}  "
            f"exact {total['exact']:>3}  norm {total['normalized']:>3}  "
            f"non-conf {total['non_conforming']:>3}"
        )
        out.append("")

    out.append(EXCLUDED_LABEL)
    for key, why in (
        ("excluded_is_error", "is_error (harness stub text, not the agent's)"),
        ("orphan_tests", "run-log tests with no test JSON (arm unknowable)"),
        ("no_test_json", "...and the returns they cost us"),
        ("body_changed", "agent body changed since the run (still counted above)"),
    ):
        n = sum(d.get(key, 0) for d in suites.values() if d.get("log"))
        out.append(f"  {n:>4}  {why}")
    missing = [n for n, d in sorted(suites.items()) if not d.get("log")]
    if missing:
        out.append(f"  {len(missing):>4}  suites with no run log: {', '.join(missing)}")
    return "\n".join(out)


def main() -> int:
    # The labels carry an em dash, and the genealogist team runs Windows where
    # the console is cp1252 -- without this the report dies with
    # UnicodeEncodeError rather than printing. House pattern; a repo lint
    # (tests/unit/test_encoding_lint.py) enforces it on any runnable module
    # that prints non-ASCII, and caught this one.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    print(format_report(compute_counts()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
