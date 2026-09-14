"""Capture subagent transcript summaries into the committed e2e runlog.

An e2e run delegates work to plugin subagents via the Agent tool (e.g. the
`record-extractor`). Those subagents run in their own SDK sub-session whose
transcript is written to the *ephemeral* local cache:

    ~/.claude/projects/<cwd-slug>/<session-uuid>/subagents/agent-*.jsonl
    ~/.claude/projects/<cwd-slug>/<session-uuid>/subagents/agent-*.meta.json

That directory is the temp-workspace-encoded path and is deleted with the
workspace. The committed runlog records each tool call with a key-preserving
`response_summary` (see `orchestrator._summarize_tool_response`; before
`HARNESS_SCHEMA_VERSION` 2 it head-truncated anything over 500 chars, keeping 497
plus an ellipsis), and since #1027 attributes each call to its `agent_type` /
`agent_id` — but it stores **no** subagent *transcript*. So a failure that
happens inside a subagent's own turns — no tool call to attribute, just thinking
that burns the budget — is invisible from the committed runlog without the
per-turn summaries this module adds.

The failure that motivated this: a `record-extractor` subagent called
`project_context` once, then emitted a single thinking-only turn that burned its
entire output budget (`stop_reason == "max_tokens"`, no tool call, no text). The
parent saw nothing for ~6 minutes and died on the inactivity watchdog. From the
runlog alone it looked like "the subagent did nothing" — the smoking gun lived
only in the ephemeral cache.

We do **not** copy the raw jsonl into the committed runlog: it is multi-MB
(each thinking turn carries a ~130 KB encrypted signature) and the thinking
*content* is unrecoverable anyway (Claude Code stores it encrypted; the
plaintext is always empty). The full diagnostic signal is the per-turn *shape* —
`stop_reason`, `output_tokens`, and which block types / tool names each turn
produced. That is small, so we embed a compact summary directly in the runlog
JSON (`E2eResult.subagents`), where `runaway_thinking: true` makes this whole
class of failure a one-line grep.

All functions are best-effort and pure-ish: parsing never raises on a malformed
or partial transcript (a run killed mid-generation leaves the final turn
un-flushed), so capture can never fail an otherwise-loggable run.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def _bare_tool_name(name: str) -> str:
    """`mcp__genealogy__project_context` -> `project_context`; leave others as-is."""
    return name.split("__")[-1] if name.startswith("mcp__") else name


def _block_label(block: dict[str, Any]) -> str:
    """One short label per content block, e.g. `thinking`, `tool_use:record_read`."""
    btype = block.get("type", "?")
    if btype == "tool_use":
        return f"tool_use:{_bare_tool_name(block.get('name', '?'))}"
    if btype == "tool_result":
        return "tool_result"
    return btype  # thinking | text | ...


def summarize_turn(message: dict[str, Any]) -> dict[str, Any]:
    """Compact summary of one assistant turn's shape.

    Keeps only what survives Claude Code's encrypted-thinking storage and what
    diagnoses a runaway: the stop reason, the output-token count, and the block
    types / tool names. No thinking text (it is always empty) and no 130 KB
    signature.
    """
    content = message.get("content")
    blocks = content if isinstance(content, list) else []
    labels = [_block_label(b) for b in blocks if isinstance(b, dict)]
    usage = message.get("usage") or {}
    turn: dict[str, Any] = {
        "stop_reason": message.get("stop_reason"),
        "output_tokens": usage.get("output_tokens"),
        "blocks": labels,
    }
    if is_runaway_turn(turn):
        turn["runaway"] = True
    return turn


def is_runaway_turn(turn: dict[str, Any]) -> bool:
    """A turn that burned its whole output budget on thinking and did nothing.

    `stop_reason == "max_tokens"` AND every block is a `thinking` block (no tool
    call, no text) — the model hit the output ceiling mid-thought and produced
    nothing actionable. This is the exact shape of the record-extractor freeze.
    """
    if turn.get("stop_reason") != "max_tokens":
        return False
    blocks = turn.get("blocks") or []
    return len(blocks) > 0 and all(b == "thinking" for b in blocks)


def parse_jsonl(path: Path) -> list[dict[str, Any]]:
    """Parse a JSONL transcript. Skips blank / unparseable lines (a run killed
    mid-generation can leave a truncated final line)."""
    records: list[dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return records
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def summarize_transcript(
    records: list[dict[str, Any]],
    *,
    meta: dict[str, Any] | None = None,
    transcript_name: str | None = None,
) -> dict[str, Any]:
    """Roll a subagent's raw records up into the compact runlog summary."""
    turns: list[dict[str, Any]] = []
    for rec in records:
        message = rec.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        turns.append(summarize_turn(message))

    out_tokens = [t["output_tokens"] for t in turns if isinstance(t.get("output_tokens"), int)]
    summary: dict[str, Any] = {
        "agent_type": (meta or {}).get("agentType"),
        "description": (meta or {}).get("description"),
        "num_assistant_turns": len(turns),
        "max_output_tokens": max(out_tokens) if out_tokens else None,
        # Any turn hit the output ceiling (broader than runaway — a legit long
        # answer can also cap out; the `runaway_thinking` flag is the narrow one).
        "hit_output_cap": any(t.get("stop_reason") == "max_tokens" for t in turns),
        # The narrow, high-signal flag: at least one turn burned the budget on
        # thinking alone. This is what makes the freeze grep-able in the runlog.
        "runaway_thinking": any(is_runaway_turn(t) for t in turns),
        "turns": turns,
    }
    if transcript_name:
        # The raw jsonl is NOT committed (ephemeral + multi-MB); recorded only so
        # a local forensic dig can still find it in the cache before teardown.
        summary["transcript"] = transcript_name
    return summary


def sdk_cache_dir(workspace: Path) -> Path | None:
    """The SDK's cache directory for this workspace, or None if absent.

    Resolved with the SDK's own ``project_key_for_directory`` rather than a
    match on the workspace leaf. The leaf does NOT survive into the slug: the
    key is the sanitized full realpath, and ``_sanitize_path`` rewrites every
    non-alphanumeric character to ``-``. Since tempfile's suffix alphabet
    contains ``_``, a leaf-suffix match missed roughly one run in five and
    recorded ``subagents: []`` with no way to tell that from "none ran" (#2468).

    Calling the SDK is what keeps this correct: the CLI computes the same key
    with the same function, so the two cannot drift.

    Lets ``ImportError`` propagate, deliberately. ``collect_subagents`` already
    wraps this call in ``except Exception`` and records ``error``, so the run log
    survives either way — but swallowing it here would report ``no_cache_dir``
    instead, i.e. "no subagent ran, or the cache was cleaned", for a lookup that
    is broken. That is the ambiguity this status field exists to remove, and
    ``harness/workspace.py`` raises on this same import for the same reason.
    """
    from claude_agent_sdk import project_key_for_directory

    # Honour CLAUDE_CONFIG_DIR exactly as orchestrator.py does when it builds the
    # agent's environment: the operator's shell sets it, the SDK subprocess
    # inherits it, and the cache then lives somewhere other than ~/.claude.
    config_root = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    cache = config_root / "projects" / project_key_for_directory(workspace)
    return cache if cache.is_dir() else None


def find_subagent_transcripts(workspace: Path) -> list[tuple[Path, Path | None]]:
    """Locate this run's subagent transcripts (+ their meta) in the SDK cache.

    Subagent transcripts live under
    ``~/.claude/projects/<key>/**/subagents/agent-*.jsonl``, where the key comes
    from ``sdk_cache_dir`` — the same resolution ``_find_session_transcript``
    uses. The slug does **not** end with the tempdir leaf; see ``sdk_cache_dir``. The ``agent-`` prefix
    distinguishes them from the parent's ``<session-uuid>.jsonl``. Returns
    (jsonl, meta-or-None) pairs sorted by mtime (oldest first = dispatch order).
    """
    cache = sdk_cache_dir(workspace)
    if cache is None:
        return []
    jsonls: list[Path] = list(cache.rglob("agent-*.jsonl"))
    jsonls.sort(key=lambda p: p.stat().st_mtime)
    pairs: list[tuple[Path, Path | None]] = []
    for jsonl in jsonls:
        meta = jsonl.parent / (jsonl.stem + ".meta.json")
        pairs.append((jsonl, meta if meta.exists() else None))
    return pairs


def collect_subagents(workspace: Path) -> tuple[list[dict[str, Any]], str]:
    """Top-level entry: summarize every subagent transcript for this run.

    Returns ``(summaries, status)``. Best-effort — never raises, so it can never
    break an otherwise-loggable run.

    ``status`` exists because an empty list used to mean three different things
    and nothing in the envelope told them apart (#2468):

    ``captured``
        At least one transcript was summarized.
    ``no_cache_dir``
        The SDK cache directory for this workspace does not exist. Either no
        agent ran, or the cache was already cleaned up.
    ``matched_no_transcripts``
        The directory resolved but produced zero summaries — no
        ``agent-*.jsonl``, or every one of them unparseable, which is the
        run-killed-mid-generation shape this module skips silently below.
    ``error``
        Something failed while looking. Recorded, never raised.
    """
    try:
        if sdk_cache_dir(workspace) is None:
            return [], "no_cache_dir"
        pairs = find_subagent_transcripts(workspace)
    except Exception:  # noqa: BLE001 — a capture miss must never fail the run
        return [], "error"
    summaries: list[dict[str, Any]] = []
    for jsonl, meta_path in pairs:
        records = parse_jsonl(jsonl)
        if not records:
            continue
        meta: dict[str, Any] | None = None
        if meta_path is not None:
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                meta = None
        summaries.append(
            summarize_transcript(records, meta=meta, transcript_name=jsonl.name)
        )
    return summaries, ("captured" if summaries else "matched_no_transcripts")
