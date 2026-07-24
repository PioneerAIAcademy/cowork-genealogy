"""Capture subagent transcript summaries into the committed e2e runlog.

An e2e run delegates work to plugin subagents via the Agent tool (e.g. the
`record-extractor`). Those subagents run in their own SDK sub-session whose
transcript is written to the *ephemeral* local cache:

    ~/.claude/projects/<cwd-slug>/<session-uuid>/subagents/agent-*.jsonl
    ~/.claude/projects/<cwd-slug>/<session-uuid>/subagents/agent-*.meta.json

That directory is the temp-workspace-encoded path and is deleted with the
workspace. The committed runlog only records the *parent's* tool calls plus a
500-char-truncated `response_summary` per call — it stores **no** subagent
transcript. So a failure that happens entirely inside a subagent is invisible
from the committed runlog.

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


def find_subagent_transcripts(workspace: Path) -> list[tuple[Path, Path | None]]:
    """Locate this run's subagent transcripts (+ their meta) in the SDK cache.

    Subagent transcripts live under
    ``~/.claude/projects/<slug>/**/subagents/agent-*.jsonl`` where the project
    dir's slug ends with the unique tempdir leaf (``e2e-<id>-<rand>``) — the same
    match used by ``_find_session_transcript``. The ``agent-`` prefix
    distinguishes them from the parent's ``<session-uuid>.jsonl``. Returns
    (jsonl, meta-or-None) pairs sorted by mtime (oldest first = dispatch order).
    """
    projects = Path.home() / ".claude" / "projects"
    if not projects.is_dir():
        return []
    leaf = workspace.name
    jsonls: list[Path] = []
    for d in projects.iterdir():
        if d.is_dir() and d.name.endswith(leaf):
            jsonls.extend(d.rglob("agent-*.jsonl"))
    jsonls.sort(key=lambda p: p.stat().st_mtime)
    pairs: list[tuple[Path, Path | None]] = []
    for jsonl in jsonls:
        meta = jsonl.parent / (jsonl.stem + ".meta.json")
        pairs.append((jsonl, meta if meta.exists() else None))
    return pairs


def collect_subagents(workspace: Path) -> list[dict[str, Any]]:
    """Top-level entry: summarize every subagent transcript for this run.

    Best-effort — returns ``[]`` on any failure so it can never break an
    otherwise-loggable run.
    """
    try:
        pairs = find_subagent_transcripts(workspace)
    except OSError:
        return []
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
    return summaries
