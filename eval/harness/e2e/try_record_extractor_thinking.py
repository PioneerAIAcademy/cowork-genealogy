"""Isolate the record-extractor runaway-thinking freeze in one command.

WHY THIS EXISTS
    In the frederick-curtiss-munson-parents e2e run the `record-extractor`
    subagent (claude-sonnet-5) called `project_context` once, then emitted a
    single thinking-only turn that burned its entire 32000-token output budget
    (`stop_reason=max_tokens`), made no tool call, produced nothing, and the
    parent run died on the 600s inactivity watchdog. Reproducing that through a
    full e2e run costs ~15 minutes and hides the cause inside a subagent.

    The runaway fires on the turn *right after* `project_context` — before the
    subagent ever reads the record — so it needs only the agent's system prompt
    (read live from the plugin) + the exact delegation message that triggered it.
    This script replays that with a stubbed tool loop against the real API and
    reports, per thinking configuration, whether the subagent RAN AWAY (hit
    max_tokens on thinking alone) or ACTED (called a write tool = extraction).

WHAT IT ANSWERS
    sonnet-5 uses ADAPTIVE thinking (it chooses its own depth), governed by
    output_config.effort. The e2e harness freezes but Cowork does not, so the
    two most likely drive the subagent at different effort. This sweeps effort
    on the same prompt and reports which RAN AWAY vs ACTED:
      - effort-high   : adaptive thinking, high effort, 32k cap (harness-like)
      - effort-medium : adaptive thinking, medium effort
      - effort-low    : adaptive thinking, low effort
      - thinking-off  : thinking disabled (known to extract cleanly)
    A few API calls, not a 15-minute e2e run, so the effort question is settled
    in minutes.

USAGE
    Needs ANTHROPIC_API_KEY (the harness reads eval/.env, which the worktree
    hook links in). From eval/harness/:
        uv run python -m e2e.try_record_extractor_thinking
        uv run python -m e2e.try_record_extractor_thinking --model claude-sonnet-5
        uv run python -m e2e.try_record_extractor_thinking --prompt-file some.txt

    Read-only against the API; makes no MCP calls (tools are stubbed) and writes
    nothing. Dev probe — not shipped, not part of the test suite.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anthropic

REPO_ROOT = Path(__file__).resolve().parents[3]
AGENT_MD = REPO_ROOT / "packages" / "engine" / "plugin" / "agents" / "record-extractor.md"

# The exact delegation message the record-extraction skill sent the subagent in
# the frozen run (run-2026-07-16_10-29-29). This is the trigger; the runaway
# happens on the model's response to project_context returning, so this message
# + the system prompt below are the whole reproduction input.
DEFAULT_DELEGATION_PROMPT = """\
Extract all assertions from this FamilySearch birth record into the research project.

**Project path:** /tmp/e2e-frederick-curtiss-munson-parents-3dj4a5rf
**Log entry:** log_001
**Results sidecar:** results/log_001.json
**Open research question:** q_001 — "What does Frederick Curtiss Munson's 31 July 1887 Brooklyn, New York birth record say about his parents?"

**Record details (already read via record_read):**

recordId: ark:/61903/1:1:2WQG-RYD
Record ARK (image/source): ark:/61903/1:2:997M-6DKQ
Collection: "New York, New York City Births, 1846-1909" (FamilySearch collection 2240282)
Citation: "New York, New York City Births, 1846-1909", FamilySearch (https://www.familysearch.org/ark:/61903/1:1:2WQG-RYD : Wed Mar 12 00:47:05 UTC 2025), Entry for Munson and Jared Howes Munson, 31 Jul 1887.

**Persons on record:**

1. Child (principal): p_14729657322 — Munson [no given name indexed], Male, born 31 July 1887, Brooklyn, Kings, New York, United States; Race: White
2. Father: p_14729657320 (ark:/61903/1:1:2WQG-RYZ) — Jared Howes Munson, Male, born in New York
3. Mother: p_14729657321 (ark:/61903/1:1:2WQG-RY8) — Kathrine Seguine, Female, born in New York

**Relationships on record:**
- Jared Howes Munson is parent of child Munson
- Kathrine Seguine is parent of child Munson
- Jared Howes Munson and Kathrine Seguine are a Couple

**Tree subject:** Frederick Curtiss Munson (person id in tree.gedcomx.json: 9WMW-SVC) — already attached to this record per FamilySearch match data (attachedToSubject: true). The record's child persona maps to 9WMW-SVC.

**Also in tree:** Pearl Esther Scholl (LJBS-KBF) — likely Frederick's wife, not directly relevant to this birth record.

**Classification guidance:**
- This is a civil birth registration (an original record created at the time of the event).
- The child's birth fact: primary information (contemporaneous registration), direct evidence of the birth itself.
- The parents' names as informants: the informant on a civil birth registration is typically the father or a hospital/attendant reporting at the time — treat as primary information for facts reported by a contemporary witness. The father's name is primary information for his identity; the mother's name and maiden name are primary information recorded at the time of the child's birth.
- Evidence that the child named is Frederick Curtiss Munson: the given name is not indexed — record only the surname Munson and note that the given name was not indexed (the record image may show it). This is still direct evidence of the birth in Brooklyn on that date.
- Extract parentage assertions for both father and mother relative to the child.

Do NOT frame this as correcting any existing tree entries. Extract what the record says; the person-evidence and tree-edit skills handle identity linking afterward.\
"""

# The record-extractor's declared tools. Permissive schemas — enough that the
# model can call them; args aren't validated (this is a behavior probe).
_TOOL_NAMES = [
    "mcp__genealogy__project_context",
    "mcp__genealogy__record_read",
    "mcp__genealogy__place_search",
    "mcp__genealogy__place_search_all",
    "mcp__genealogy__research_append",
    "mcp__genealogy__research_log_append",
    "mcp__genealogy__tree_edit",
    "mcp__genealogy__record_person_matches",
    "mcp__genealogy__record_record_matches",
]
TOOLS = [
    {"name": n, "description": f"{n} (stubbed for this probe)", "input_schema": {"type": "object"}}
    for n in _TOOL_NAMES
]
# Calling any of these means the subagent produced extraction output — success,
# the opposite of the runaway.
_WRITE_TOOLS = {"research_append", "research_log_append", "tree_edit"}


def _bare(name: str) -> str:
    return name.split("__")[-1] if name.startswith("mcp__") else name


def _stub_tool_result(bare_name: str) -> str:
    """Canned tool results so the model can advance past project_context/record_read."""
    if bare_name == "project_context":
        return json.dumps({
            "ok": True,
            "projectStatus": "active",
            "openQuestions": [{"id": "q_001", "question": "What does Frederick Curtiss Munson's 31 July 1887 Brooklyn, New York birth record say about his parents?"}],
            "persons": [
                {"id": "9WMW-SVC", "name": "Frederick Curtiss Munson", "gender": "Male", "sourceRefs": []},
                {"id": "LJBS-KBF", "name": "Pearl Esther Scholl", "gender": "Female", "sourceRefs": []},
            ],
        })
    if bare_name == "record_read":
        return json.dumps({
            "persons": [
                {"id": "p_14729657322", "ark": "ark:/61903/1:1:2WQG-RYD", "gender": "Male",
                 "names": [{"type": "BirthName", "surname": "Munson"}],
                 "facts": [{"type": "Birth", "primary": True, "date": "31 Jul 1887", "place": "Brooklyn, Kings, New York, United States"}]},
                {"id": "p_14729657320", "ark": "ark:/61903/1:1:2WQG-RYZ", "gender": "Male",
                 "names": [{"type": "BirthName", "given": "Jared Howes", "surname": "Munson"}]},
                {"id": "p_14729657321", "ark": "ark:/61903/1:1:2WQG-RY8", "gender": "Female",
                 "names": [{"type": "BirthName", "given": "Kathrine", "surname": "Seguine"}]},
            ],
            "relationships": [
                {"type": "ParentChild", "person1": "p_14729657320", "person2": "p_14729657322"},
                {"type": "ParentChild", "person1": "p_14729657321", "person2": "p_14729657322"},
                {"type": "Couple", "person1": "p_14729657320", "person2": "p_14729657321"},
            ],
        })
    if bare_name in _WRITE_TOOLS:
        return json.dumps({"ok": True, "validation": {"valid": True, "warnings": []}})
    return json.dumps({"results": []})


@dataclass
class Config:
    label: str
    effort: str | None  # None = thinking disabled; else adaptive thinking at this effort
    max_tokens: int


# sonnet-5 uses ADAPTIVE thinking (it picks its own depth), governed by
# output_config.effort — NOT the old fixed budget_tokens. Effort is the knob the
# harness and Cowork most plausibly differ on, so we sweep it. `off` disables
# thinking entirely (confirmed to extract cleanly). max_tokens=32000 mirrors the
# harness's observed output ceiling so a high-effort run can hit it the same way.
DEFAULT_CONFIGS = [
    Config("effort-xhigh", effort="xhigh", max_tokens=32000),
    Config("effort-high", effort="high", max_tokens=32000),
    Config("effort-medium", effort="medium", max_tokens=32000),
    Config("effort-low", effort="low", max_tokens=16000),
    Config("thinking-off", effort=None, max_tokens=16000),
]


def _load_system_prompt() -> str:
    """Read the record-extractor system prompt (the .md body, frontmatter stripped)."""
    text = AGENT_MD.read_text(encoding="utf-8")
    if text.startswith("---"):
        # Drop the leading YAML frontmatter block (--- ... ---).
        parts = text.split("---", 2)
        if len(parts) == 3:
            return parts[2].lstrip("\n")
    return text


def _label(block: Any) -> str:
    btype = getattr(block, "type", "?")
    if btype == "tool_use":
        return f"tool_use:{_bare(getattr(block, 'name', '?'))}"
    return btype


def _make_client() -> anthropic.Anthropic:
    # max_retries lets the SDK ride out transient overloaded_error / 429s with
    # backoff (a high-effort turn is a big request and gets throttled first).
    # Reuse the harness auth path (eval/.env → ANTHROPIC_API_KEY) when available.
    try:
        from harness.auth import resolve_auth

        auth = resolve_auth()
        if auth.api_key:
            return anthropic.Anthropic(api_key=auth.api_key, max_retries=6)
    except Exception:  # noqa: BLE001 — fall back to the SDK's own env lookup
        pass
    return anthropic.Anthropic(max_retries=6)


def run_config(client: anthropic.Anthropic, *, model: str, system: str, prompt: str, cfg: Config, max_iters: int) -> dict[str, Any]:
    """Replay the stubbed tool loop under one thinking config; return a verdict."""
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    turns: list[dict[str, Any]] = []
    verdict = "loop-cap"

    for _ in range(max_iters):
        kwargs: dict[str, Any] = dict(model=model, max_tokens=cfg.max_tokens, system=system, tools=TOOLS, messages=messages)
        # sonnet-5's adaptive-thinking API: thinking.type=adaptive + output_config.effort.
        # Passed via extra_body so it works regardless of the SDK's typed params.
        # Streaming is required (a high-effort turn can exceed the 10-min non-stream cap).
        if cfg.effort is None:
            kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
        else:
            kwargs["extra_body"] = {"thinking": {"type": "adaptive"}, "output_config": {"effort": cfg.effort}}
        with client.messages.stream(**kwargs) as stream:
            resp = stream.get_final_message()

        labels = [_label(b) for b in resp.content]
        out_tok = resp.usage.output_tokens
        turns.append({"stop_reason": resp.stop_reason, "output_tokens": out_tok, "blocks": labels})
        print(f"    turn {len(turns)}: stop={resp.stop_reason:<10} out_tokens={out_tok:>6}  blocks={labels}")

        if resp.stop_reason == "max_tokens":
            thinking_only = bool(labels) and all(b == "thinking" for b in labels)
            verdict = "RUNAWAY (max_tokens, thinking-only)" if thinking_only else "hit output cap (with content)"
            break

        tool_uses = [b for b in resp.content if getattr(b, "type", None) == "tool_use"]
        if not tool_uses:
            verdict = "ended (no tool call)"
            break

        messages.append({"role": "assistant", "content": resp.content})
        results = []
        acted_write = False
        for tu in tool_uses:
            bare = _bare(tu.name)
            results.append({"type": "tool_result", "tool_use_id": tu.id, "content": _stub_tool_result(bare)})
            if bare in _WRITE_TOOLS:
                acted_write = True
        messages.append({"role": "user", "content": results})
        if acted_write:
            verdict = "ACTED (wrote extraction output)"
            break

    return {"label": cfg.label, "verdict": verdict, "turns": turns,
            "max_output_tokens": max((t["output_tokens"] for t in turns), default=0)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="claude-sonnet-5", help="model id (default: claude-sonnet-5, the record-extractor pin)")
    ap.add_argument("--prompt-file", type=Path, help="override the delegation message (default: the frozen run's exact message)")
    ap.add_argument("--max-iters", type=int, default=6, help="max model calls per config (default 6)")
    ap.add_argument("--config", action="append", help="only run named config(s): effort-high | effort-medium | effort-low | thinking-off")
    args = ap.parse_args(argv)

    system = _load_system_prompt()
    prompt = args.prompt_file.read_text(encoding="utf-8") if args.prompt_file else DEFAULT_DELEGATION_PROMPT
    configs = DEFAULT_CONFIGS
    if args.config:
        wanted = set(args.config)
        configs = [c for c in DEFAULT_CONFIGS if c.label in wanted]
        if not configs:
            print(f"No config matched {sorted(wanted)}; known: {[c.label for c in DEFAULT_CONFIGS]}", file=sys.stderr)
            return 2

    try:
        client = _make_client()
    except Exception as e:  # noqa: BLE001
        print(f"Could not build Anthropic client: {e}\nSet ANTHROPIC_API_KEY (or eval/.env).", file=sys.stderr)
        return 2

    print(f"record-extractor thinking probe — model={args.model}, system-prompt={len(system)} chars, delegation={len(prompt)} chars\n")
    results = []
    for cfg in configs:
        thinking = f"adaptive, effort={cfg.effort}" if cfg.effort else "disabled"
        print(f"[{cfg.label}] thinking {thinking}, max_tokens={cfg.max_tokens}")
        try:
            results.append(run_config(client, model=args.model, system=system, prompt=prompt, cfg=cfg, max_iters=args.max_iters))
        except Exception as e:  # noqa: BLE001 — report and keep going to the next config
            print(f"    ERROR: {type(e).__name__}: {e}")
            results.append({"label": cfg.label, "verdict": f"error: {type(e).__name__}", "turns": [], "max_output_tokens": 0})
        print()

    print("=" * 68)
    print(f"{'config':<14} {'max_out_tok':>11}  verdict")
    print("-" * 68)
    for r in results:
        print(f"{r['label']:<14} {r['max_output_tokens']:>11}  {r['verdict']}")
    print("=" * 68)
    print("\nThinking depth on this prompt scales steeply with output_config.effort:")
    print("~11k tokens at high, ~28k at xhigh — approaching the 32k output ceiling. So")
    print("effort is the dial that decides whether the record-extractor stays under the")
    print("ceiling or tips into a thinking-only max_tokens freeze. NOTE: these are")
    print("raw-API effort names; the Claude Code CLI resolves its OWN effort from the")
    print("`effortLevel` SETTING, not the CLAUDE_EFFORT env var (which is output-only,")
    print("verified). For sonnet-5 the harness's setting_sources=['project'] run resolves")
    print("to 'high'. Open question: what effort / output ceiling Cowork runs it at.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
