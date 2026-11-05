"""Stop-condition checks.

The orchestrator uses these to translate post-SDK state into the
`stop_reason` enum from the spec. For v1, every reason is decided
*after* the SDK returns rather than via active polling — the simplest
mechanism that gives correct labels.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def read_research_json(workspace: Path) -> dict[str, Any] | None:
    """Return parsed research.json, or None if missing or unusable.

    `UnicodeDecodeError` is caught because it is a `ValueError`, not an
    `OSError` — `read_text` decodes before `json` sees the bytes, so a file with
    invalid UTF-8 would otherwise propagate out of every caller. The
    `isinstance` check is load-bearing for the same reason: a research.json
    parsing to a JSON *array* is not None, so without it the value passes every
    `is None` test and then raises `AttributeError` on `.get(...)`. Both matter
    because `pretool_hook` calls this with no `try` around it, so a raise here
    aborts the whole run instead of degrading. Mirrors the guards the sibling
    `guardrail_shadow_report._load_json` already documents.
    """
    path = Path(workspace) / "research.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return parsed if isinstance(parsed, dict) else None


def read_tree_json(workspace: Path) -> dict[str, Any] | None:
    """Return parsed tree.gedcomx.json, or None if missing or unusable.

    The same two guards `read_research_json` above documents, but they earn their
    place differently, so read them separately.

    `UnicodeDecodeError` is a `ValueError` rather than an `OSError`, so a tree
    written in cp1252 (the Windows default, and this team runs on Windows) used
    to propagate out of every caller. That one does matter on the paid e2e path:
    `collect_post_hoc_shadow` reads this file, and a raise there aborts the run
    before any result file is written.

    The `isinstance` guard does NOT protect that path — every detector at that
    site already returns `[]` on a non-dict, so an array-shaped tree was harmless
    there. It protects the OTHER two callers: `final_tree` and `starting_tree`
    are passed around as `dict | None`, and a list slipped through every
    `is None` test to raise `AttributeError` on `.get(...)` later. It also
    changes what such a run RECORDS -- the judge is skipped and the verdict is
    `skipped` rather than the judge being handed a list and the run landing
    `ungraded`. Both are better than the alternative, and both are tested in
    `tests/unit/test_e2e_stop_checker.py`; neither is a side effect of the
    post-hoc work that prompted the hardening.
    """
    path = Path(workspace) / "tree.gedcomx.json"
    if not path.exists():
        return None
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return None
    return parsed if isinstance(parsed, dict) else None



def read_external_collection_keys(workspace: Path) -> dict[str, list[str]]:
    """The run's stored curated Ancestry collections: place -> sorted
    `ancestry:<id>` keys from `external-collections.json` (#2995).

    A place stored with no Ancestry row maps to `[]`, which is different from a
    place never fetched (absent). Missing or unusable file -> `{}`, never a raise:
    this runs at the end of a paid run, before its result file is written."""
    path = Path(workspace) / "external-collections.json"
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return {}
    places = parsed.get("places") if isinstance(parsed, dict) else None
    if not isinstance(places, dict):
        return {}
    out: dict[str, list[str]] = {}
    for place, entry in places.items():
        rows = entry.get("rows") if isinstance(entry, dict) else None
        keys = {
            row["key"]
            for row in (rows if isinstance(rows, list) else [])
            if isinstance(row, dict)
            and isinstance(row.get("key"), str)
            and row["key"].startswith("ancestry:")
        }
        out[str(place)] = sorted(keys)
    return out


def project_completed(research: dict[str, Any] | None) -> bool:
    """Whether research.json says the project is done."""
    if not research:
        return False
    return (research.get("project") or {}).get("status") == "completed"


# The retired hand-back literal (lead ruling 2026-09-07, retired by issue #2292 and
# PR #2870, 2026-09-27: "the Stop hook is the mechanism"). No shipped prompt emits it,
# so in an autonomous run a `step` is the agent asking the patron. Kept as telemetry
# only: `nudge_report` counts it over the committed runs, which still carry it.
# Matched literally; do not loosen.
_HAND_BACK_STEP_TAIL = ". Continue?"
_HAND_BACK_STEP_LEAD = "Next: "
_HAND_BACK_COMPLETE = "Research complete."

# Step mode's offer (decision 25). Unlike the literal above this one is LIVE: every
# step turn ends on it. Matched on FORM only, which is all this function is about -- `step_boundary.offered_step`
# resolves WHICH step the label names, and that needs the label table, which this
# module deliberately does not import (stdlib-only, pure, shared with
# `nudge_report.py`). Same strictness as the retired pair above: a lead and a tail,
# so an ordinary closing question ending in "?" is not mistaken for an offer.
_STEP_OFFER_TAIL = "?"
_STEP_OFFER_LEAD = "Continue with "


def classify_hand_back(text: str | None) -> str:
    """Classify an agent's closing words: "step_offer" | "step" | "silent" | "completion_claim".

    Pure, stdlib-only, text in / class out, and takes NO `research` argument: whether
    a completion claim is true is the caller's question, not this one's.

    Normalises its own input (`" ".join(text.split())`), since `nudge_report` passes
    narration text and a predicate anchored to the end would otherwise trip on
    trailing whitespace.

    `completion_claim` is tested first. The order of the two step arms is now
    DELIBERATE, where it used to be arbitrary: `_STEP_OFFER_TAIL` is bare `"?"`,
    which every `". Continue?"` also ends with, so the two arms overlap on any text
    carrying both leads. `step_offer` wins because step mode's line is the live one
    and the `"Next: "` literal is retired.

    NOTE the class is about FORM, not truth. A `completion_claim` is not by itself a
    false completion — the caller decides that by reading project.status. And a run
    that stops on a genuine logged blocker reads as `silent` here, because it names no
    next step; the taxonomy has no separate blocker class.
    """
    t = " ".join((text or "").split())
    if t.endswith(_HAND_BACK_COMPLETE):
        return "completion_claim"
    if t.endswith(_STEP_OFFER_TAIL) and _STEP_OFFER_LEAD in t:
        return "step_offer"
    if t.endswith(_HAND_BACK_STEP_TAIL) and _HAND_BACK_STEP_LEAD in t:
        return "step"
    return "silent"


def derive_stop_reason(
    *,
    sdk_aborted_reason: str | None,
    research: dict[str, Any] | None,
) -> str:
    """Map (SDK abort reason, research.json state) to spec stop_reason.

    Priority: explicit SDK aborts win over project status — if a cap
    fired, we want the cap reason in the result even if the agent had
    already set status=completed before the cap.
    """
    # #941 — first, because outranking `completed` is the whole point: two of
    # the three runs lost to an absent MCP surface self-declared
    # project.status == "completed" and were reported as research failures.
    if sdk_aborted_reason == "mcp_unavailable":
        return "mcp_unavailable"
    # #2974 — like mcp_unavailable, an infrastructure stop that outranks
    # `completed`: a host that slept past the inactivity cap consumed the run's
    # budget, so whatever status it left is not a graded outcome.
    if sdk_aborted_reason == "host_slept":
        return "host_slept"
    if sdk_aborted_reason == "max_wall_clock_seconds":
        return "timeout"
    if sdk_aborted_reason == "max_tool_calls":
        return "tool_cap"
    if sdk_aborted_reason == "cost_cap":
        return "cost_cap"
    if sdk_aborted_reason == "max_turns":
        return "max_turns"
    if sdk_aborted_reason in ("sdk_stream_silence", "no_progress_stall"):
        # Both are "the agent stopped advancing": no message at all (silence)
        # or messages without progress (a stall). The error text distinguishes.
        return "inactivity"
    if sdk_aborted_reason == "error":
        return "error"

    if project_completed(research):
        return "completed"
    return "natural_end"
