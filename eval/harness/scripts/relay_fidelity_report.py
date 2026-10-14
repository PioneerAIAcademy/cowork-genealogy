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
is fed to the LLM judge as a harness observation (unit-test-spec.md §8, "Three tiers"), so the judge would charge the agent for the dispatcher's drop. The direct
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

The routed block carries almost no verbatim-relay signal, which is worth knowing
before reading it. Every CONFORMING routed return is `init-project` ->
`check-warnings`, and init-project FOLDS what it gets into its own summary
rather than relaying it (`skills/init-project/SKILL.md:214-220`) -- so its
`0 of 13` is a property of the corpus, not a defect in init-project.
`record-extraction/SKILL.md:245` carries the strictest relay instruction in the
repo and contributes no routed returns at all. The routed block is NOT empty,
though: `research-exhaustiveness` contributes 14 NON-conforming routed returns,
and its line share is the most informative routed number here.

The numbers move as run logs land. Re-run and update the baseline; do not
treat a change as a regression without reading which logs changed.

`HEADING` below is hand-ported from
`packages/engine/mcp-server/tests/packaging/agent-return-contract.test.ts`,
which cannot be imported across the language boundary;
`test_heading_matches_the_typescript_contract` reads that file and fails when
the two drift.
"""

from __future__ import annotations

import argparse
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
from harness.since_window import (  # noqa: E402
    add_since_arg,
    describe_window,
    filter_since,
)
from e2e.runlog_selection import is_result_json  # noqa: E402

# Module constants so the unit test can point all three at a fixture tree.
RUNLOGS_ROOT = REPO / "eval" / "runlogs" / "unit"
TESTS_ROOT = REPO / "eval" / "tests" / "unit"
AGENTS_ROOT = REPO / "packages" / "engine" / "plugin" / "agents"
E2E_RUNLOGS_ROOT = REPO / "eval" / "runlogs" / "e2e"

# A run log older than this records an `Agent` return cut at 500 chars, and a
# narration with no `thread` key. Both are un-attributable rather than clean:
# scoring them would read the LOG's truncation, and the subagent's own
# messages, as the main thread's relay. See e2e/result.py entry 8.
MIN_PRODUCTION_SCHEMA_VERSION = 8
PRODUCTION_LABEL = "production arm — real routes, e2e corpus"

# Ported from agent-return-contract.test.ts. Levels 2-4 because that test
# accepts any of them, though every shipped agent uses `###`.
HEADING = re.compile(r"^#{2,4}\s+`summary_for_user`\s*$", re.M)
_FENCE = re.compile(r"(?s)```.*?```")

# Emitted by `_summarize_response` when it cuts a string. Its presence means
# the LOG truncated the return, so a comparison would measure the log.
TRUNCATION_MARKER = "[truncated by harness for prompt size;"


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
    out = text.replace("*", "")
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
    lines = strip_agent_return_trailer(text or "").splitlines()
    last = None
    in_fence = False
    for i, line in enumerate(lines):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if not in_fence and line.strip() == "---":
            last = i
    if last is None:
        return ""
    # Sliced from the ORIGINAL lines, never the fence-stripped ones: the tail
    # is matched against an unstripped `text_response`, so returning a
    # fence-stripped tail made a summary containing a code block impossible to
    # match even when relayed verbatim.
    return "\n".join(lines[last + 1 :]).strip()


def conforming_agents(agents_root: Path) -> set[str]:
    """Agent names whose body carries the summary heading outside a fence.

    Raises on a missing root rather than returning an empty set. Silence here
    prints `conforming 0 ... non-conf 217`, which reads as "no agent carries
    the contract any more" instead of "the report could not find the agents" —
    and the runlogs root already raised on the same mistake, so two of three
    roots disagreed about what a bad path means.
    """
    if not agents_root.is_dir():
        raise FileNotFoundError(f"agents root not found: {agents_root}")
    return {
        p.stem
        for p in sorted(agents_root.glob("*.md"))
        if HEADING.search(strip_fences(p.read_text(encoding="utf-8")))
    }


def arm_index(tests_root: Path) -> dict[str, bool]:
    """`{test id: is_direct}` over every test JSON.

    Built by id because test files are named by SLUG, never by id -- there is
    no path to guess from a run log's `test_id`.
    """
    if not tests_root.is_dir():
        raise FileNotFoundError(f"tests root not found: {tests_root}")
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
    arms = arm_index(tests_root)
    suites: dict[str, Any] = {}

    for suite_dir in sorted(p for p in runlogs_root.iterdir() if p.is_dir()):
        got = latest_full_skill_runlog(suite_dir)
        if got is None:
            # Same shape as every other suite, with a null log. Two shapes
            # meant `suites[x]["direct"]` raised KeyError on a scratch-only
            # suite and `format_report` re-derived the guard three times.
            suites[suite_dir.name] = {
                "log": None,
                "direct": _blank_counts(),
                "routed": _blank_counts(),
                "excluded_is_error": 0,
                "no_test_json": 0,
                "orphan_tests": 0,
                "body_changed": 0,
                "unverifiable_body": 0,
            }
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
            # A return whose agent is absent from the run log's snapshot cannot
            # be staleness-checked at all. Without this, `body_changed: 0`
            # means either "nothing stale" or "nothing checkable" and the
            # reader cannot tell which. 217/217 are covered today.
            "unverifiable_body": 0,
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
                    if stored is None:
                        entry["unverifiable_body"] += 1
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
                        # Filtered AFTER normalizing, not before: a line of
                        # only `**` is non-blank raw but empty normalized, and
                        # counting it in the denominator while barring it from
                        # the numerator depressed the share permanently.
                        lines = [
                            n for n in (normalize(ln) for ln in body.splitlines()) if n
                        ]
                        norm_relay = normalize(relayed)
                        side["lines_total"] += len(lines)
                        side["lines_found"] += sum(1 for ln in lines if ln in norm_relay)
        suites[suite_dir.name] = entry
    return suites


def compute_production_counts(
    e2e_root: Path,
    *,
    cutoff: Any = None,
    agents_root: Path | None = None,
    test_slug: str | None = None,
) -> dict[str, Any]:
    """Relay fidelity on a REAL route: a subagent's return against what the
    main thread said afterwards.

    Reports its own denominators. Every way this can come back empty also
    produces a cheerful zero -- no logs, no `Agent` calls, every log below
    `MIN_PRODUCTION_SCHEMA_VERSION` -- and a silent zero here reads as "every
    relay was faithful", which is this report's own failure mode pointed
    backwards. `eligible` is the number the percentages are OF; when it is 0
    the caller must say so rather than print 0%.
    """
    if not e2e_root.exists():
        raise FileNotFoundError(f"e2e runlog root not found: {e2e_root}")

    conforming = conforming_agents(agents_root or AGENTS_ROOT)
    out: dict[str, Any] = {
        "logs_seen": 0,
        "logs_excluded_by_window": 0,
        "excluded_is_error": 0,
        "excluded_no_agent_type": 0,
        "excluded_non_conforming": 0,
        "no_usable_return": 0,
        "no_tail": 0,
        "no_main_narration_for_call": 0,
        "logs_too_old_schema": 0,
        "logs_no_narration": 0,
        "agent_calls": 0,
        "returns_truncated": 0,
        "eligible": 0,
        "exact": 0,
        "normalized": 0,
        "dropped": 0,
    }
    # `is_result_json` is the repo's own predicate for this (e2e/runlog_selection),
    # used by every other e2e reader. Re-deriving it is how the first cut of this
    # arm counted 611 logs against the real 203: `run-*.json` also matches
    # `run-<ts>.ann.json` and both `run-<ts>.final-*.json` siblings.
    dirs = [d for d in sorted(e2e_root.iterdir()) if d.is_dir()]
    if test_slug:
        dirs = [d for d in dirs if d.name == test_slug]
    paths = sorted(p for d in dirs for p in sorted(d.iterdir()) if is_result_json(p))
    total_before_window = len(paths)
    paths = filter_since(paths, cutoff)
    out["logs_excluded_by_window"] = total_before_window - len(paths)
    # Carries the branch-scope caveat too — the window and "the runs may be on
    # another branch" are two different reasons a corpus read is not what it
    # looks like, so the house helper states them together.
    out["window"] = describe_window(
        cutoff, n_runs=len(paths), n_total=total_before_window
    )

    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            # A log that cannot be read is skipped, not fatal: this is a
            # report over a corpus, and one bad file must not cost the rest.
            # `logs_seen` is incremented only below, so an unreadable log
            # never pads a denominator either.
            continue
        out["logs_seen"] += 1

        # Untrusted field: a non-numeric value must not cost the other 202 logs,
        # one line after the parse guard above states exactly that policy.
        version = data.get("harness_schema_version")
        if not isinstance(version, int) or version < MIN_PRODUCTION_SCHEMA_VERSION:
            out["logs_too_old_schema"] += 1
            continue

        # Main-thread prose only. Selected on `kind` AND `thread`, never on the
        # ABSENCE of `thread`: the nine harness/blocked append sites carry no
        # message and so no tag, and treating untagged as main would fold a
        # subagent's own words into the relay it is being compared against.
        relay = " ".join(
            n.get("text") or ""
            for n in (data.get("narration") or [])
            if n.get("kind") == "assistant" and n.get("thread") == "main"
        )
        if not relay.strip():
            out["logs_no_narration"] += 1

        for call in data.get("tool_calls") or []:
            if not _is_agent_call(call.get("tool")):
                continue
            out["agent_calls"] += 1

            # FIRST, as the unit arm does: an errored spawn's text is the
            # harness's own denial, not the agent's. Charging the relay for a
            # spawn that produced no return measures nothing.
            if call.get("is_error"):
                out["excluded_is_error"] += 1
                continue

            # The verbatim-relay contract belongs to agents that declare a
            # `summary_for_user` section. Read it off the AGENT BODY, never off
            # the return text — the same rule `tail_after_final_rule`'s own
            # docstring states. 807 of the corpus's Agent calls go to agents
            # with no such section (image-reader, gps-mentor,
            # research-exhaustiveness); scoring a transcription for verbatim
            # presence in narration measures contract coverage, not fidelity.
            agent = ((call.get("args") or {}).get("subagent_type") or "").split(":")[-1]
            if not agent:
                out["excluded_no_agent_type"] += 1
                continue
            if agent not in conforming:
                out["excluded_non_conforming"] += 1
                continue

            raw = _agent_return_text(call.get("response_summary"))
            if raw is None:
                # Stripped past 14 days, an error string, a `_summary_truncated`
                # dict from a >3-block result, or the head floor's passthrough.
                # Counted: 893 of today's 1,738 Agent calls land here, and an
                # unexplained residual is what this report exists to prevent.
                out["no_usable_return"] += 1
                continue
            if TRUNCATION_MARKER in raw:
                # The log cut it; comparing would measure the log, not the relay.
                out["returns_truncated"] += 1
                continue
            tail = tail_after_final_rule(raw)
            if not tail.strip():
                # No final rule: the unit arm counts this `conforming` but NOT
                # `with_tail` and never scores it. Scoring `raw` instead would
                # make a multi-KB return the string that must appear verbatim,
                # which no relay does — a guaranteed false `dropped`.
                out["no_tail"] += 1
                continue
            if not relay.strip():
                out["no_main_narration_for_call"] += 1
                continue
            out["eligible"] += 1
            if tail.strip() in relay:
                out["exact"] += 1
                out["normalized"] += 1
            elif normalize(tail) in normalize(relay):
                out["normalized"] += 1
            else:
                out["dropped"] += 1
    return out


def _is_agent_call(tool: Any) -> bool:
    """Suffix match, as the orchestrator does, so every server spelling resolves."""
    return isinstance(tool, str) and (tool.endswith("Agent") or tool.endswith("Task"))


def _agent_return_text(summary: Any) -> str | None:
    """The agent's own return out of a recorded `response_summary`.

    An `Agent` result is two text blocks -- the return, then an
    `agentId:/<usage>` announcement, last in all 845 corpus cases -- so take
    the FIRST text block, not the last, and strip the runtime trailer the unit
    side strips too.
    """
    if not isinstance(summary, str):
        return None
    try:
        parsed = json.loads(summary)
    except json.JSONDecodeError:
        return None
    blocks = parsed if isinstance(parsed, list) else None
    if not blocks:
        return None
    for block in blocks:
        if isinstance(block, dict) and block.get("type") == "text":
            return strip_agent_return_trailer(block.get("text") or "")
    return None


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
        ("unverifiable_body", "returns whose agent is absent from the snapshot"),
    ):
        n = sum(d.get(key, 0) for d in suites.values() if d.get("log"))
        out.append(f"  {n:>4}  {why}")
    missing = [n for n, d in sorted(suites.items()) if not d.get("log")]
    if missing:
        out.append(f"  {len(missing):>4}  suites with no run log: {', '.join(missing)}")
    return "\n".join(out)


def format_production_report(c: dict[str, Any]) -> str:
    """Denominators first. Every way this comes back empty also produces a
    clean-looking zero, so the counts that explain an empty run are printed
    whether or not anything was scored."""
    lines = [
        PRODUCTION_LABEL,
        "=" * len(PRODUCTION_LABEL),
    ]
    if c.get("window"):
        lines.append(f"  {c['window']}")
    lines += [
        f"  e2e run logs read             {c['logs_seen']}",
        f"    below schema v{MIN_PRODUCTION_SCHEMA_VERSION} (unscorable)    {c['logs_too_old_schema']}",
        f"    no main-thread narration    {c['logs_no_narration']}",
        f"  Agent calls                   {c['agent_calls']}",
        f"    errored spawn               {c['excluded_is_error']}",
        f"    agent declares no summary   {c['excluded_non_conforming']}",
        f"    no subagent_type recorded   {c['excluded_no_agent_type']}",
        f"    no usable return captured   {c['no_usable_return']}",
        f"    return truncated by the log {c['returns_truncated']}",
        f"    return carries no tail      {c['no_tail']}",
        f"    no main narration to match  {c['no_main_narration_for_call']}",
        f"  SCORED (eligible)             {c['eligible']}",
    ]
    accounted = (
        c["excluded_is_error"] + c["excluded_non_conforming"]
        + c["excluded_no_agent_type"] + c["no_usable_return"]
        + c["returns_truncated"] + c["no_tail"]
        + c["no_main_narration_for_call"] + c["eligible"]
    )
    if accounted != c["agent_calls"]:
        # Every Agent call lands in exactly one line above. If that stops being
        # true the residual is unexplained, which is the defect this report was
        # written to avoid — say so rather than let it hide in the arithmetic.
        lines.append(
            f"  UNACCOUNTED                   {c['agent_calls'] - accounted}"
            "  <- a bug in this report"
        )
    if not c["eligible"]:
        lines += [
            "",
            "  Nothing scored. That is NOT a clean result — read the lines above",
            f"  for which reason. A log below v{MIN_PRODUCTION_SCHEMA_VERSION} records an Agent return cut at",
            "  500 chars and a narration with no `thread` tag; scoring either would",
            "  measure this harness rather than the relay.",
        ]
        return "\n".join(lines)
    pct = lambda n: f"{100 * n / c['eligible']:.0f}%"  # noqa: E731
    lines += [
        "",
        "  Of the scored calls (`normalized` INCLUDES `exact`, so these are not",
        "  a partition and do not sum to 100%):",
        f"    relayed verbatim            {c['exact']} ({pct(c['exact'])})",
        f"    survives normalization      {c['normalized']} ({pct(c['normalized'])})",
        f"    dropped by the relay        {c['dropped']} ({pct(c['dropped'])})",
    ]
    return "\n".join(lines)


def main() -> int:
    # The labels carry an em dash, and the genealogist team runs Windows where
    # the console is cp1252 -- without this the report dies with
    # UnicodeEncodeError rather than printing. House pattern; a repo lint
    # (tests/unit/test_encoding_lint.py) enforces it on any runnable module
    # that prints non-ASCII, and caught this one.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--production",
        action="store_true",
        help="relay fidelity on real e2e routes instead of the unit dispatcher",
    )
    # `add_since_arg`, not a hand-rolled `--since`: its default is a STRING, so
    # argparse runs it through `parse_since` too. A `default=None` silently
    # skips the converter and reads the whole corpus while the Makefile and
    # eval/CLAUDE.md both promise a 14-day window.
    parser.add_argument(
        "--test", metavar="SLUG", help="one e2e fixture slug instead of the corpus"
    )
    add_since_arg(parser)
    args = parser.parse_args()

    if args.production:
        counts = compute_production_counts(
            E2E_RUNLOGS_ROOT, cutoff=args.since, test_slug=args.test
        )
        print(format_production_report(counts))
        # Exit 2 on an empty denominator. A prose warning beside a success exit
        # relocates the silent zero to the exit code — the house pattern is the
        # opposite (`conflict_verdict_report`'s unknown skill, `replay-collapse`
        # when every walk is unverifiable): fail loudly, never falsely.
        return 0 if counts["eligible"] else 2
    print(format_report(compute_counts()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
