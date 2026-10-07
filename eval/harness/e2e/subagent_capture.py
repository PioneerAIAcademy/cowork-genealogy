"""Capture subagent transcript summaries into the committed e2e runlog.

An e2e run delegates work to plugin subagents via the Agent tool (e.g. the
`record-extractor`). Those subagents run in their own SDK sub-session whose
transcript is written to the *ephemeral* local cache:

    <config-root>/projects/<cwd-slug>/<session-uuid>/subagents/agent-*.jsonl
    <config-root>/projects/<cwd-slug>/<session-uuid>/subagents/agent-*.meta.json

where <config-root> is CLAUDE_CONFIG_DIR when the operator set it, else
~/.claude — see `sdk_cache_dir`.

That directory is the temp-workspace-encoded path and outlives the
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
import re
from pathlib import Path
from typing import Any


#: The four token fields rolled up per subagent. Deliberately the same set
#: `pricing._PER_MTOK` prices and `orchestrator._USAGE_FIELDS` accumulates, so a
#: subagent total and a main-thread total are summable without a field map.
USAGE_FIELDS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)

#: The fields that make up the window one message was sent against — everything
#: the model had to read to produce it. The same three as
#: `orchestrator._WINDOW_FIELDS`, for the same reason: `output_tokens` is what it
#: wrote, not what it read.
WINDOW_FIELDS = (
    "input_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)


def _bare_tool_name(name: str) -> str:
    """`mcp__genealogy__project_context` -> `project_context`; leave others as-is."""
    return name.split("__")[-1] if name.startswith("mcp__") else name


def transcript_agent_id(jsonl_path: Path) -> str | None:
    """`.../agent-<id>.jsonl` -> `<id>`; None when the name is not that shape.

    `<id>` is the SDK's subagent id, which is exactly the `agent_id` the parent's
    PreToolUse hook records for a streamed subagent call (`input_data["agent_id"]`
    in `orchestrator.pretool_hook`). Verified across the committed corpus: every
    `subagents[].transcript` id matches a `tool_calls[].agent_id` and none
    coincide by accident. That equality is the only key shared by a transcript
    and the run log's `tool_calls`, and it is what lets the backfill tell a
    synchronous agent — already in `tool_calls` under this id — from a background
    one that is not.
    """
    stem = jsonl_path.stem  # agent-<id>, with the `.jsonl` suffix already removed
    if not stem.startswith("agent-"):
        return None
    return stem[len("agent-") :] or None


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
    # `isinstance`, not `or {}`: that idiom catches a `None` or an empty dict but
    # passes a TRUTHY non-dict straight through, and `"n/a"` then raises on
    # `.get`. `parse_jsonl` admits arbitrary JSON objects, and `collect_subagents`
    # calls this from a loop whose exception would cost a completed, paid run its
    # entire log — the one thing this module's docstring promises cannot happen.
    raw_usage = message.get("usage")
    usage = raw_usage if isinstance(raw_usage, dict) else {}
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


def parse_jsonl(path: Path, errors: str = "strict") -> list[dict[str, Any]]:
    """Parse a JSONL transcript. Skips blank / unparseable lines (a run killed
    mid-generation can leave a truncated final line).

    Two things here are load-bearing rather than defensive, because this runs
    before the run log is written and outside any try — anything raised costs a
    completed, paid run its whole log:

    - ``errors``. A kill mid-write can end the file inside a multi-byte UTF-8
      sequence, and a strict decode raises ``UnicodeDecodeError``, which the
      ``except OSError`` below never sees — the exact shape this docstring
      claims to tolerate. Capture passes ``"replace"`` so it cannot raise and
      salvages the good prefix.

      The default stays ``"strict"``, and the ``UnicodeDecodeError`` is
      deliberately NOT caught here, because ``feedback_transcript_adapter``
      depends on it being raised: ``UnicodeDecodeError`` is a ``ValueError``,
      and its ``except (ValueError, OSError)`` is what marks a bundle unreadable
      and names the owner it excludes. Swallowing it here silently emptied that
      exclusion. Two callers, opposite needs — so the caller chooses.
    - The ``isinstance(rec, dict)`` filter. A line can be valid JSON and not an
      object (``"a string"``), and the return type says ``dict`` — every caller
      indexes it.
    """
    records: list[dict[str, Any]] = []
    try:
        text = path.read_text(encoding="utf-8", errors=errors)
    except OSError:
        return records
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(rec, dict):
            records.append(rec)
    return records


def pair_tool_calls(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pair each `tool_use` block with its `tool_result` within ONE subagent transcript.

    A background subagent's tool calls never reach the e2e run log's `tool_calls`:
    that list is built from the PARENT query's message stream
    (`orchestrator._consume`), and a background agent's messages flow through its
    own sub-session, not the parent's. This recovers them from the transcript the
    agent did leave behind — the same `agent-<id>.jsonl` `collect_subagents`
    already reads for `subagents[].turns`. Source is the transcript, not the
    stream.

    Returns one dict per `tool_use`, in transcript order:
    `{tool, args, tool_use_id, content, is_error}` — RAW and un-summarized, so the
    caller (`orchestrator.backfill_background_tool_calls`) can apply the SAME
    `_summarize_tool_response` / `_raw_result_chars` helpers the main stream uses
    and build a byte-identical entry. `tool` is the FULL name
    (`mcp__genealogy__record_read`), never bare-ified, and `args` comes from the
    block's `input` key — both to match the synchronous entry exactly.

    A `tool_use` whose result never arrived (a run killed mid-call) keeps
    `content=None` and `is_error=False`, mirroring a main-stream entry whose
    `ToolResultBlock` never came. Never raises — a malformed record is skipped.
    """
    by_id: dict[str, dict[str, Any]] = {}
    ordered: list[dict[str, Any]] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        message = rec.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "tool_use":
                name = block.get("name")
                if not isinstance(name, str):
                    continue
                args = block.get("input")
                entry = {
                    "tool": name,
                    "args": args if isinstance(args, dict) else {},
                    "tool_use_id": block.get("id"),
                    "content": None,
                    "is_error": False,
                }
                ordered.append(entry)
                tuid = block.get("id")
                if isinstance(tuid, str):
                    by_id[tuid] = entry
            elif btype == "tool_result":
                tuid = block.get("tool_use_id")
                entry = by_id.get(tuid) if isinstance(tuid, str) else None
                if entry is not None:
                    entry["content"] = block.get("content")
                    entry["is_error"] = block.get("is_error") is True
    return ordered


def _as_int(value: Any) -> int:
    """A token count, or 0. Never raises, never returns a bool or a float.

    `True` is an `int` in Python and would add 1 to a token total, so bools are
    excluded explicitly rather than by `isinstance(value, int)` alone.
    """
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return 0


def subagent_usage(records: list[dict[str, Any]]) -> dict[str, int]:
    """This subagent's four token totals, counted once per *message*.

    **Why this is not a sum over records.** Claude Code writes one record per
    content *block*, and every one of those records repeats the whole
    *message's* usage. A message that emitted thinking, then text, then a tool
    call appears three times, each time claiming the full cost. Summing records
    naively overstates `cache_read_input_tokens` by ~2x and
    `cache_creation_input_tokens` by ~2.4x (measured 2026-10-02 over 52 local
    subagent transcripts, 1,660 distinct message ids: input 2.081x, output
    1.018x, cache_read 2.000x, cache_creation 2.390x). Cache reads are the
    largest input line in the bill, so a naive sum is not a rough number — it is
    a wrong one that looks authoritative.

    Output tokens barely move (1.018x) for a reason worth keeping: a message's
    first record carries a *start-of-message snapshot* of `output_tokens`
    (median 3 across those transcripts), not the final count, so summing adds
    almost nothing. Do not simplify this to "the first record is always 1" —
    only 0.8% of them are, and the max observed is 6,121.

    So: key on `message["id"]`, last write wins. "Last" is safe because the
    final record of a message carries the final totals; measured over those same
    1,660 ids, the last record's value equals the maximum on all four fields for
    every id, with no exceptions. Last-write-wins applies only **among records
    carrying a dict `usage`**, so a trailing record without one cannot zero a
    real figure.

    Shape rules, all of which occur in real transcripts:

    - **Non-assistant records are skipped.** They carry no usage today (2,008
      user records across those 52 transcripts, none with a usage dict), but
      without the filter each would consume an `__anon_` slot and the key would
      stop meaning what this docstring says.
    - **A `usage` that is not a dict** — a string, a list, a number — is
      skipped, not read. This is the only shape that can raise, and `parse_jsonl`
      admits arbitrary JSON objects by design. `collect_subagents` does not guard
      this call, so an exception here would cost a completed, paid run its entire
      log.
    - **A record with no `message["id"]`** is counted once under a synthetic
      `__anon_<n>` key rather than dropped: its tokens were really spent.
    - **A missing or non-numeric field** counts 0.

    Always returns all four fields. An empty dict of zeros means "captured, and
    it used nothing visible"; the run-level `subagent_capture_status` is what
    distinguishes that from "capture failed". A subagent summary written before
    this field existed has **no** `usage` key at all, which the merge treats as
    unknown — never back-derive it from `turns[]`, which is the ~2x error above.
    """
    totals = dict.fromkeys(USAGE_FIELDS, 0)
    for counted in _per_message_usage(records).values():
        for field in USAGE_FIELDS:
            totals[field] += counted[field]
    return totals


def _per_message_usage(records: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    """Each assistant message's four token fields, keyed once per message id.

    The keying rules are `subagent_usage`'s — see its docstring for why each one
    exists. Shared so the sum (`subagent_usage`) and the max
    (`subagent_peak_window`) can never disagree about what a message is.
    """
    per_message: dict[str, dict[str, int]] = {}
    anon = 0
    for rec in records:
        if not isinstance(rec, dict):
            continue
        message = rec.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        usage = message.get("usage")
        if not isinstance(usage, dict):
            continue
        key = message.get("id")
        if not isinstance(key, str) or not key:
            key = f"__anon_{anon}"
            anon += 1
        per_message[key] = {field: _as_int(usage.get(field)) for field in USAGE_FIELDS}
    return per_message


def subagent_peak_window(records: list[dict[str, Any]]) -> int:
    """The tallest single window this subagent read: a MAX, never a sum.

    `subagent_usage` answers "what did it spend"; this answers "how close did it
    come to the compaction line", which is what decides whether the helper is
    safe on a cheaper model (`docs/plan/cost-latency-10x.md` §7). Two helpers
    that each spend 300k — ten 30k reads against two 150k reads — are identical
    to the sum and opposite here.

    A peak saturates once the helper compacts: it stops at the trigger however
    much more it needed. Read it beside `subagent_compactions`, whose count is
    the signal past that point (`compaction_report.py`'s verdict for the main
    thread, #2491). 0 when no message carries usage.
    """
    return max(
        (sum(counted[f] for f in WINDOW_FIELDS) for counted in _per_message_usage(records).values()),
        default=0,
    )


def _token_or_none(value: Any) -> int | None:
    """A token count, or None when absent or not a number — never a fake 0."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def subagent_compactions(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One entry per time Claude Code compacted this subagent's own context.

    The CLI the harness runs writes a subagent's compaction into that
    subagent's own transcript as
    `{"type": "system", "subtype": "compact_boundary", "compactMetadata":
    {"trigger", "preTokens", "postTokens", ...}}`. The *count* is the signal:
    `pre_tokens` is kept for completeness and saturates at the trigger exactly as
    the peak does. `postTokens` is optional in the CLI.

    A missing or non-numeric figure is None, never 0 — a 0 `post_tokens` would
    read as "compacted to nothing". A malformed or missing `compactMetadata`
    still yields an entry: the compaction happened. Never raises.
    """
    out: list[dict[str, Any]] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if rec.get("type") != "system" or rec.get("subtype") != "compact_boundary":
            continue
        meta = rec.get("compactMetadata")
        meta = meta if isinstance(meta, dict) else {}
        trigger = meta.get("trigger")
        out.append({
            "trigger": trigger if isinstance(trigger, str) else None,
            "pre_tokens": _token_or_none(meta.get("preTokens")),
            "post_tokens": _token_or_none(meta.get("postTokens")),
        })
    return out


def subagent_models(records: list[dict[str, Any]]) -> list[str]:
    """The distinct model ids this subagent's messages ran on, first-seen order.

    A list, not one value, so a helper that changed model mid-run is not
    reported as having used one. Ids starting with `<` are skipped: Claude Code
    writes `<synthetic>` on placeholder messages no model produced.
    """
    seen: list[str] = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        message = rec.get("message")
        if not isinstance(message, dict) or message.get("role") != "assistant":
            continue
        model = message.get("model")
        if isinstance(model, str) and model and not model.startswith("<") and model not in seen:
            seen.append(model)
    return seen


def subagent_duration_seconds(records: list[dict[str, Any]]) -> float | None:
    """Seconds from the earliest to the latest record timestamp, or None.

    Earliest/latest, not first/last: `queued_command` attachment records carry
    their enqueue time, so timestamps can step backwards within a transcript.
    Measured against the CLI's own `duration_ms` on the 16 helpers of the
    2026-10-05 catharina run: within 0.1 s. None with fewer than two parseable
    timestamps — never a fake 0.
    """
    from datetime import datetime

    moments = []
    for rec in records:
        stamp = rec.get("timestamp") if isinstance(rec, dict) else None
        if not isinstance(stamp, str):
            continue
        try:
            moments.append(datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp())
        except ValueError:
            continue
    if len(moments) < 2:
        return None
    return round(max(moments) - min(moments), 3)


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
        # Counted once per message id, NOT summed over `turns[]` — see
        # `subagent_usage`. `turns[]` stays one entry per record because the
        # runaway readers and `max_output_tokens` need per-record shape.
        "usage": subagent_usage(records),
        # The tallest single read (a max), how many times the context was
        # compacted, and which models ran — see each function's docstring.
        "peak_window_tokens": subagent_peak_window(records),
        "compactions": subagent_compactions(records),
        "models": subagent_models(records),
        "duration_seconds": subagent_duration_seconds(records),
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

    Tries more than one spelling, because **the CLI slugs the cwd IT resolved,
    not the one it was handed** — the same fact ``mcp_stderr.py`` records and
    acts on. ``project_key_for_directory`` realpaths, so on its own it misses
    wherever the CLI did not:

    - **Windows 8.3 short names.** Committed run logs show the CLI keying on
      ``C--Users-KWESIA-1-AppData-Local-Temp-…`` while the home in the same
      string is ``C:\\Users\\KWESI ASANTE``. Python's ``realpath`` expands that,
      so an exact key built from it never matches. Three operators and nine
      logs carry that shape, and they capture successfully under a leaf match —
      so a resolved-only key would REGRESS the platform this team runs on.
    - **Symlinked parents** on Linux, and ``/var`` vs ``/private/var`` on macOS.

    So: the resolved key first (authoritative when the CLI did resolve, and the
    only candidate that carries NFC normalisation), then the literal spelling,
    then a normalised-leaf scan. The leaf is immune to every path-spelling
    difference above — which is what the issue asked for and why it stays as the
    backstop.

    Lets ``ImportError`` propagate, deliberately. ``collect_subagents`` already
    wraps this call in ``except Exception`` and records ``error``, so the run log
    survives either way — but swallowing it here would report ``no_cache_dir``
    instead, i.e. "no subagent ran, or the cache was cleaned", for a lookup that
    is broken. ``harness/workspace.py`` raises on this same import for the same
    reason.
    """
    from claude_agent_sdk import project_key_for_directory

    # Honour CLAUDE_CONFIG_DIR exactly as orchestrator.py:1428 does when it
    # builds the agent's environment: the operator's shell sets it, the SDK
    # subprocess inherits it, and the cache then lives outside ~/.claude.
    config_root = Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")
    projects = config_root / "projects"

    keys: list[str] = [project_key_for_directory(workspace)]
    literal = re.sub(r"[^A-Za-z0-9]", "-", str(workspace))
    if literal not in keys:
        keys.append(literal)
    for key in keys:
        cache = projects / key
        if cache.is_dir():
            return cache

    # Backstop: match on the normalised leaf. Unlike a whole-path key this
    # cannot care how the parent directories were spelled.
    if not projects.is_dir():
        return None
    leaf = re.sub(r"[^A-Za-z0-9]", "-", workspace.name)
    for d in sorted(projects.iterdir()):
        if d.is_dir() and d.name.endswith(leaf):
            return d
    return None


def find_subagent_transcripts(workspace: Path, cache_dir: Path | None = None) -> list[tuple[Path, Path | None]]:
    """Locate this run's subagent transcripts (+ their meta) in the SDK cache.

    Subagent transcripts live under
    ``~/.claude/projects/<key>/**/subagents/agent-*.jsonl``, where the key comes
    from ``sdk_cache_dir`` — the same resolution ``_find_session_transcript``
    uses. The slug does **not** end with the tempdir leaf; see ``sdk_cache_dir``. The ``agent-`` prefix
    distinguishes them from the parent's ``<session-uuid>.jsonl``. Returns
    (jsonl, meta-or-None) pairs sorted by mtime (oldest first = dispatch order).
    """
    cache = cache_dir if cache_dir is not None else sdk_cache_dir(workspace)
    if cache is None:
        return []
    # `stat` before parsing means one dangling symlink would take down an
    # otherwise healthy capture, so missing entries sort last rather than raise.
    def _mtime(p: Path) -> float:
        try:
            return p.stat().st_mtime
        except OSError:
            return float("inf")

    jsonls: list[Path] = sorted(cache.rglob("agent-*.jsonl"), key=_mtime)
    pairs: list[tuple[Path, Path | None]] = []
    for jsonl in jsonls:
        meta = jsonl.parent / (jsonl.stem + ".meta.json")
        pairs.append((jsonl, meta if meta.exists() else None))
    return pairs


def find_session_transcript(workspace: Path, cache_dir: Path | None = None) -> Path | None:
    """The main thread's own `<session-uuid>.jsonl`, or None. Never raises.

    It sits at the top of the cache directory; subagent transcripts live a level
    down under `<uuid>/subagents/`, so a top-level glob never picks one up. The
    newest file wins, which is the run's own session when the cache directory
    is per-workspace (it is: the key is the workspace path).
    """
    try:
        cache = cache_dir if cache_dir is not None else sdk_cache_dir(workspace)
        if cache is None:
            return None
        candidates = list(cache.glob("*.jsonl"))
        if not candidates:
            return None
        return max(candidates, key=lambda p: p.stat().st_mtime)
    except Exception:  # noqa: BLE001 — a capture miss must never fail the run
        return None


def collect_main_thread(workspace: Path) -> dict[str, Any] | None:
    """The main thread's busiest moment, compactions and models, or None.

    The unit harness runs a routed test's skill on the main thread, not in a
    subagent, so `collect_subagents` alone would report nothing for it. Records
    marked `isSidechain` are skipped so a subagent's messages, should any land
    in the parent file, never inflate the main thread's peak. None when the
    transcript cannot be found or read — never a zeroed block, which would read
    as "the main thread read nothing". Never raises.
    """
    try:
        path = find_session_transcript(workspace)
        if path is None:
            return None
        records = [
            r for r in parse_jsonl(path, errors="replace")
            if r.get("isSidechain") is not True
        ]
        if not records:
            return None
        return {
            "peak_window_tokens": subagent_peak_window(records),
            "compactions": subagent_compactions(records),
            "models": subagent_models(records),
        }
    except Exception:  # noqa: BLE001 — a capture miss must never fail the run
        return None


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
        cache = sdk_cache_dir(workspace)
        if cache is None:
            return [], "no_cache_dir"
        # Resolved once and passed down: a second lookup could disagree with the
        # first if the directory vanishes between them, and the status would
        # then describe a different world than the summaries do.
        pairs = find_subagent_transcripts(workspace, cache_dir=cache)
    except Exception:  # noqa: BLE001 — a capture miss must never fail the run
        return [], "error"
    # The summarize loop is inside the guard too: it used to sit outside, where a
    # single malformed record (a `message.usage` that is a string rather than an
    # object) raised an AttributeError straight out of this function and cost a
    # completed, paid run its entire log — the one thing this module's docstring
    # promises can never happen. `subagent_usage` now type-checks that field, so
    # this is belt and braces; keep both, because the next field added here will
    # not have been thought about as carefully.
    summaries: list[dict[str, Any]] = []
    try:
        for jsonl, meta_path in pairs:
            records = parse_jsonl(jsonl, errors="replace")
            if not records:
                continue
            meta: dict[str, Any] | None = None
            if meta_path is not None:
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError, UnicodeDecodeError):
                    meta = None
                if not isinstance(meta, dict):
                    # A non-empty non-dict (`[1, 2]`) survives the falsy check the
                    # summarizer does and then raises on `.get`.
                    meta = None
            summaries.append(
                summarize_transcript(records, meta=meta, transcript_name=jsonl.name)
            )
    except Exception:  # noqa: BLE001 — a capture miss must never fail the run
        return summaries, "error"
    return summaries, ("captured" if summaries else "matched_no_transcripts")
