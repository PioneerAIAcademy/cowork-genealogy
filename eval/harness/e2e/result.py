"""E2e result schema and persistence.

A run produces four artifacts under eval/runlogs/e2e/<test-id>/, named by
outcome (see runlog_prefix):

- a gradeable run (verdict pass / partial / fail) uses the committable
  `run-<timestamp>.*` prefix and is committed. A committed `fail` is retained
  signal — "the system can't solve this yet; retry later" — exactly as a failing
  unit test is committed. Fixture *validity* is a separate axis: only a `pass`
  proves the fixture solvable (e2e-test-spec.md §14).
- a `skipped` run (the judge never ran — the agent crashed before producing any
  tree, so there is nothing to grade) uses `scratch_<timestamp>.*`, which
  `.gitignore` keeps out of version control.

The four files per run ({prefix} = `run-` or `scratch_`):

- {prefix}<timestamp>.json — structured result (this module)
- {prefix}<timestamp>.transcript.md — human-readable transcript
- {prefix}<timestamp>.final-tree.gedcomx.json — agent's final tree
- {prefix}<timestamp>.final-research.json — agent's final research.json

See e2e-test-spec.md §8.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# Bump when the persisted shape changes in a way a reader must branch on.
# Its whole job is to spare the next reader the commit archaeology that
# `axes_from_runlog` has to do for pre-v1 logs (see that function).
#   1 — the three-axis split: top-level `compliance` / `outcome` /
#       `guardrail_bypass_violations` (GitHub issue #972).
HARNESS_SCHEMA_VERSION = 1


@dataclass
class E2eResult:
    test_id: str
    captured_at: str  # ISO-8601 UTC

    # GENEALOGICAL verdict from the judge: "pass" | "partial" | "fail" — or
    # "skipped" when the judge did not run (e.g. SDK crashed before producing
    # any tree state).
    #
    # This field is the judge's conclusion and NOTHING else. It used to be
    # overwritten to "fail" by the guardrail check below, which fused two
    # orthogonal axes into one boolean and made a run that got the genealogy
    # completely right read identically to one that got it wrong (issue #972).
    # Compliance now lives on its own axis; `outcome` is the combined gate.
    verdict: str

    # Why the run stopped. See spec §6.5.
    # One of: completed | inactivity | timeout | tool_cap | cost_cap |
    # max_turns | natural_end | error
    stop_reason: str

    # Structured judge output (per_finding, recall_required, recall_total,
    # verdict, rationale). Empty dict when judge was skipped.
    judge_output: dict[str, Any] = field(default_factory=dict)

    # Token / cost / duration counters from the SDK ResultMessage.
    usage: dict[str, Any] = field(default_factory=dict)

    # Every tool call the agent attempted, in order — not just mcp__-prefixed
    # ones (Skill, Agent, Read, … are included too; the entry-construction
    # code has no such filter). Each entry is {tool, args, response_summary,
    # agent_id, agent_type}; the last two come from the PreToolUse hook's own
    # payload (docs/specs/guardrail-enforcement-spec.md §11) and are only
    # set once a ToolResultBlock arrives for that call — None on the main
    # thread, the subagent's identifiers otherwise. A call still in-flight
    # when the run aborts mid-stream never gets any of the last three keys.
    # Critical for diffing across runs when investigating drift.
    tool_calls: list[dict[str, Any]] = field(default_factory=list)

    # Free-text error message when stop_reason == "error".
    error: str | None = None

    # Tags copied from fixture.json — kept on the result so the roll-up
    # report can group without re-reading every fixture.
    tags: dict[str, str] = field(default_factory=dict)

    # Tool calls the PreToolUse hook denied. Each entry is
    # {tool, args, blocked_by}; the name predates the second and third
    # reasons, so read `blocked_by` rather than assuming a tree read:
    #
    #   "tree"    — reading the answer off the live tree (person_read /
    #               person_search / person_ancestors are disabled in e2e runs,
    #               e2e-test-spec.md §6.1). The agent tried to shortcut
    #               research; the verdict is still earned from records, but
    #               it's worth a reviewer's eye.
    #   "fixture" — blocked by the fixture's own `blocked_tools`.
    #
    # In every case the call was denied, so it never reaches `tool_calls` —
    # this list is the only record that it was attempted.
    blocked_tree_reads: list[dict[str, Any]] = field(default_factory=list)

    # Compact per-subagent transcript summaries (agent_type, per-turn
    # stop_reason / output_tokens / block shape, and a `runaway_thinking` flag).
    # Captured from the SDK's ephemeral subagent cache — which the runlog
    # otherwise does not store — so a subagent that burned its whole output
    # budget on thinking (stop_reason=max_tokens, no tool call), invisible from
    # `tool_calls` alone, is diagnosable directly from the committed runlog.
    # See subagent_capture.py.
    subagents: list[dict[str, Any]] = field(default_factory=list)

    # docs/specs/guardrail-enforcement-spec.md §8 — the HARD guardrail
    # detector's findings: a guardrail skill's effect present in the final
    # project state with no matching successful invocation anywhere in the run.
    # Lives at the top level, NOT inside `judge_output`, because it is a
    # harness fact rather than a judge grade — `interpret-e2e-result` is
    # forbidden to read `judge_output` at all, so burying it there made it
    # invisible to the one reader whose job is explaining a run (issue #972).
    guardrail_bypass_violations: list[str] = field(default_factory=list)

    # Schema marker for readers. See HARNESS_SCHEMA_VERSION.
    harness_schema_version: int = HARNESS_SCHEMA_VERSION

    # --- Derived; never passed in. See __post_init__. ----------------------
    #
    # COMPLIANCE axis: "pass" | "fail". Two-valued on a live run — every run
    # this harness performs IS checked, including a treeless one (the §4.4
    # block runs outside the skip-judge/no-tree branch, and two of its three
    # arms don't read the tree at all). The third value, "not_checked", exists
    # only in `axes_from_runlog` as a statement about pre-detector HISTORY.
    compliance: str = field(init=False, default="pass")

    # The explicit overall gate: the genealogical verdict, downgraded to
    # "fail" when compliance failed. This is what the exit code keys on.
    outcome: str = field(init=False, default="pass")

    # docs/specs/guardrail-enforcement-spec.md §7 — SHADOW MODE ONLY:
    # protected writes (a proof_summaries/person_evidence/conflicts/
    # exhaustive_declaration write, or a tree_edit/tree_correct/
    # materialize_facts write one of the four GPS guardrail skills owns) with
    # no matching successful `Skill` invocation in a trailing window. Logged,
    # never denied, at this stage — the point is to measure the false-positive
    # rate against real runs before any call is ever rejected. Each entry is
    # {index, tool, required_skill, question_id} — see
    # harness/skill_invocation.py::find_unguarded_protected_writes.
    #
    # DO NOT REMOVE OR RENAME THIS FIELD WITHOUT READING `axes_from_runlog`.
    # It landed in the same commit as the §4.4 hard detector (25e61c9f), and
    # because it is a `default_factory` field its key is emitted
    # unconditionally — which makes its mere PRESENCE the only reliable
    # fingerprint of "the code that wrote this runlog had the detector" for
    # the 122 pre-v1 logs. There is no other signal: `usage.cli_version` is
    # absent or null in every committed run, and nothing records a git sha.
    # `test_e2e_result.py` pins the 6 known-fingerprint runs so removing this
    # field fails loudly instead of silently reclassifying them.
    # (Logs written from HARNESS_SCHEMA_VERSION >= 1 carry `compliance`
    # directly and do not depend on this.)
    guardrail_shadow_violations: list[dict[str, Any]] = field(default_factory=list)

    # docs/specs/guardrail-enforcement-spec.md §11 — SHADOW MODE ONLY, a
    # distinct bypass shape from the one above: a protected write (owned by
    # one of the four GUARDRAIL_SKILLS per owning_skills, or an
    # extraction_append call) whose own agent_id/agent_type (see tool_calls
    # above) shows it was made by neither the main thread nor one of the
    # four dedicated Cowork agents. Each entry is a human-readable violation
    # string — see
    # harness/skill_invocation.py::find_protected_writes_by_unnamed_delegate.
    #
    # SHADOW: deliberately NOT read by __post_init__ below. It must not move
    # the compliance axis until its false-positive rate is calibrated (#911).
    protected_writes_by_unnamed_delegate: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Derive the compliance and gate axes.

        Derived rather than passed in because each has exactly one correct
        value given `verdict` + `guardrail_bypass_violations`. A defaulted
        constructor argument would let a caller write a self-contradictory
        permanent artifact — and the bug this class is being changed for was
        exactly one mis-assembled field.
        """
        self.compliance = "fail" if self.guardrail_bypass_violations else "pass"
        self.outcome = "fail" if self.compliance == "fail" else self.verdict


def timestamp_slug(now: datetime | None = None) -> str:
    """A filesystem-safe ISO-ish timestamp for filenames."""
    t = now or datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%d_%H-%M-%S")


_GRADED_VERDICTS = frozenset({"pass", "partial", "fail"})


def is_committable_run(verdict: str) -> bool:
    """Whether a run produced a gradeable tree worth committing.

    A judge verdict of pass / partial / fail means the run produced a final
    tree, so it is committed as `run-<ts>.*` and must be graded (§7.4) —
    including a `fail`, which is retained signal: a capability gap to retry
    later, exactly as a failing unit test is committed. Only a `skipped` (or
    otherwise non-graded) run — the judge never ran, so there is no tree to
    grade — stays a gitignored `scratch_` run.

    Fixture *validity* is a separate axis (e2e-test-spec.md §14): only a `pass`
    proves the fixture solvable. A committed `fail` does NOT validate the
    fixture (validity is a recommended authoring practice, not a CI check).
    """
    return verdict in _GRADED_VERDICTS


def runlog_prefix(verdict: str) -> str:
    """`run-` for a gradeable run (pass/partial/fail), else `scratch_` (skipped).

    Keyed on the GENEALOGICAL verdict, deliberately — not on `outcome`. A run
    whose judge never ran has nothing to grade no matter what the guardrail
    check found, and `e2e-test-spec.md` §7.2 already says such a run gets the
    gitignored prefix. (Before the issue-#972 split, a guardrail violation
    forced `verdict="fail"`, which force-committed exactly those ungradeable
    runs.)
    """
    return "run-" if is_committable_run(verdict) else "scratch_"


def overall_outcome(verdict: str, compliance: str) -> str:
    """The combined gate. `not_checked` is NOT a failure — it is an unknown,
    and it must never be folded into a pass count either (see corpus_report)."""
    return "fail" if compliance == "fail" else verdict


def axes_from_runlog(data: dict[str, Any]) -> tuple[str, str, str]:
    """`(verdict, compliance, outcome)` for a runlog dict of ANY vintage.

    Committed runlogs are permanent artifacts and are never rewritten, so
    every reader of historical data goes through here. Four shapes exist:

    1. `harness_schema_version` present — the post-#972 shape. Read directly.
    2. Pre-v1 with `judge_output.guardrail_bypass_violations` — the guardrail
       check fired, so the top-level `verdict` was overwritten to "fail" and
       the real genealogical verdict survives only inside `judge_output`.
       Recover it. (4 of the 5 such committed runs are genealogically `pass`.)
    3. Pre-v1 with no `guardrail_shadow_violations` key — written by code that
       predates the detector entirely (106 of 122 committed runs). It was
       never checked, and saying `pass` here would launder 106 unknowns into
       confident passes, which is the same conflation #972 is about pointed
       the other way. `not_checked`.
    4. Pre-v1, detector-era, nothing recorded. Still `not_checked`, NOT
       `pass`: the fingerprint proves the detector's PRESENCE, not its
       COMPLETENESS. This branch matches exactly one committed run,
       `bagley-father-1884`, whose own runlog predates the `same_person` arm
       that was added *because of that run* — replaying today's checks against
       it finds a violation. A `pass` there would be a known-false pass.

    Note the shape here is for DISPLAY. Corpus membership is decided by the
    `run-` filename prefix, which does not always agree: a run whose judge
    raised is committed but reports `verdict="skipped"`. The filename wins for
    "is this in the corpus", this function wins for "what does it say".
    """
    if "harness_schema_version" in data:
        verdict = str(data.get("verdict") or "skipped")
        compliance = str(data.get("compliance") or "pass")
        # `.get` with a derivation fallback, not `data["outcome"]` — a
        # partially-written or future-shaped log must not raise here.
        outcome = str(data.get("outcome") or overall_outcome(verdict, compliance))
        return verdict, compliance, outcome

    judge_output = data.get("judge_output") or {}
    if "guardrail_bypass_violations" in judge_output:
        verdict = str(judge_output.get("verdict") or "skipped")
        return verdict, "fail", "fail"

    # Branches 3 and 4 both land on `not_checked` — pre-detector code never
    # ran the check, and detector-era code ran a version of it we can't pin.
    # They stay distinguishable for forensics via `detector_era_runlog`.
    verdict = str(data.get("verdict") or "skipped")
    return verdict, "not_checked", verdict


def detector_era_runlog(data: dict[str, Any]) -> bool:
    """Whether the code that wrote this pre-v1 runlog carried the §4.4 detector.

    The fingerprint: `guardrail_shadow_violations` landed in the same commit
    as the detector (25e61c9f) as a `default_factory` field, so its key is
    present iff the writing code had both. Exactly 6 of the 122 pre-v1
    committed runs qualify.

    This says the detector was PRESENT, not that it was the current version —
    two of those 6 predate later arms (`same_person`, and #947's widened
    conflict-resolution check), which is why `axes_from_runlog` reports them
    `not_checked` rather than `pass`. Meaningless for v1+ logs, which carry
    `compliance` directly.
    """
    return "harness_schema_version" not in data and "guardrail_shadow_violations" in data


def write_result_files(
    *,
    result: E2eResult,
    runlog_dir: Path,
    transcript: str,
    final_tree: dict[str, Any] | None,
    final_research: dict[str, Any] | None,
    timestamp: str | None = None,
) -> dict[str, Path]:
    """Write the four committed artifacts. Returns the paths written."""
    runlog_dir.mkdir(parents=True, exist_ok=True)
    ts = timestamp or timestamp_slug()
    stem = f"{runlog_prefix(result.verdict)}{ts}"

    paths = {
        "result": runlog_dir / f"{stem}.json",
        "transcript": runlog_dir / f"{stem}.transcript.md",
        "tree": runlog_dir / f"{stem}.final-tree.gedcomx.json",
        "research": runlog_dir / f"{stem}.final-research.json",
    }

    paths["result"].write_text(json.dumps(asdict(result), indent=2), encoding="utf-8")
    paths["transcript"].write_text(transcript, encoding="utf-8")
    if final_tree is not None:
        paths["tree"].write_text(json.dumps(final_tree, indent=2), encoding="utf-8")
    if final_research is not None:
        paths["research"].write_text(
            json.dumps(final_research, indent=2), encoding="utf-8"
        )

    return paths
