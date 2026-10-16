"""Source screen, step 2: run the source-evaluation agent over every snapshot copy.

Issue #3408, plan comment of 2026-10-14. Reads a snapshot written by
``packages/engine/mcp-server/dev/source-screen.ts`` (``snapshot`` and/or
``plant``), serves each copy's stored reads to the agent through the harness's
own mock MCP server, and writes one judge file per copy plus ``judge.jsonl``,
which ``source-screen.ts score`` reads.

No network: every read the agent makes is answered from the snapshot. The run
bills the operator's Claude subscription and refuses API-key auth, because the
snapshot holds restricted truth-set data. Every path must lie outside the repo.

Usage (from eval/harness):
    uv run python source_screen_judge.py --snapshot <dir> [--only <copy> ...]
        [--model <id>] [--max-tool-calls N] [--max-wall-clock-seconds N]
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

HARNESS_DIR = Path(__file__).resolve().parent
REPO_ROOT = HARNESS_DIR.parents[1]
AGENT = "source-evaluation"
AGENT_BODY = REPO_ROOT / "packages/engine/plugin/agents/source-evaluation.md"
SCENARIOS_DIR = REPO_ROOT / "eval/fixtures/scenarios"
SKILLS_DIR = REPO_ROOT / "packages/engine/plugin/skills"

KINDS = {"indexing", "misattributed", "source_conflict", "unchecked"}
DEFAULT_MAX_TOOL_CALLS = 150
DEFAULT_MAX_WALL_CLOCK_SECONDS = 1200
DEFAULT_MAX_TURNS = 60

FINDINGS_INSTRUCTION = (
    "After your report, end with one fenced ```json block holding a list with one "
    'entry per finding: {"source_url": <the source URL>, "kind": <"indexing" | '
    '"misattributed" | "source_conflict" | "unchecked">, "fact": <the fact it bears on>}. '
    "List each audit-list source you could not check as kind \"unchecked\". "
    "An empty list is []."
)

_ARK_CORE = re.compile(r"ark:/61903/\d:\d:[A-Za-z0-9.-]+")
_BARE_PREFIXED = re.compile(r"^\d:\d:[A-Za-z0-9.-]+$")


class JudgeError(Exception):
    pass


class QuotaStop(Exception):
    pass


def to_ark(value: Any) -> Any:
    """The ``toArk()`` of src/utils/ark.ts: any ARK spelling to ``ark:/61903/...``."""
    if not isinstance(value, str) or not value:
        return value
    v = value.strip()
    m = _ARK_CORE.search(v)
    if m:
        return m.group(0)
    if _BARE_PREFIXED.match(v):
        return f"ark:/61903/{v}"
    return v


def bare_id(ark: str) -> str:
    return to_ark(ark).rsplit(":", 1)[-1]


def is_inside_repo(path: Path, repo_root: Path = REPO_ROOT) -> bool:
    p = Path(path).resolve()
    root = Path(repo_root).resolve()
    return p == root or root in p.parents


def guard_path(path: str | Path, flag: str = "--snapshot") -> Path:
    p = Path(path)
    if is_inside_repo(p):
        raise JudgeError(f"{flag} {p} is inside the repo; truth-set data must stay outside it")
    return p.resolve()


def require_subscription(auth: Any) -> None:
    mode = getattr(auth, "skill_runner_mode", None)
    if mode != "subscription":
        raise JudgeError(
            f"the judge runs only on a Claude subscription (got {mode!r}); "
            "it never bills the API key for restricted data"
        )


def _read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def list_copies(snapshot: Path) -> list[str]:
    run = _read_json(snapshot / "run.json")
    keys: list[str] = []
    for key in list((run.get("map") or {}).values()) + list((run.get("plants") or {}).keys()):
        if key not in keys:
            keys.append(key)
    return keys


def _copy_dir(snapshot: Path, copy: str) -> Path:
    return snapshot / "persons" / copy


def read_record(snapshot: Path, copy: str, record_id: str) -> Any:
    """The copy's own records/ (an indexing plant) before the shared cache."""
    for p in (_copy_dir(snapshot, copy) / "records" / f"{record_id}.json", snapshot / "records" / f"{record_id}.json"):
        if p.exists():
            return _read_json(p)
    return None


def _fixture(tool: str, args: dict[str, Any], body: Any) -> dict[str, Any]:
    if isinstance(body, dict) and body.get("is_error"):
        return {"tool": tool, "args": args, "is_error": True, "response": {"error": str(body.get("error", ""))}}
    return {"tool": tool, "args": args, "response": body}


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)


def generate_fixtures(snapshot: Path, copy: str, fixtures_dir: Path) -> tuple[list[str], dict[str, Any]]:
    """Write mock fixtures for one copy; return (fixture names, facts about the copy)."""
    d = _copy_dir(snapshot, copy)
    read = _read_json(d / "person-read.json")
    audit = _read_json(d / "audit.json")
    sid = audit["subject_id"]
    out: list[tuple[str, dict[str, Any]]] = []

    out.append(("person-read-subject", _fixture("person_read", {"personId": f"~{sid}"}, read)))
    others = d / "others"
    if others.is_dir():
        for p in sorted(others.glob("*.json")):
            out.append((f"person-read-{p.stem}", _fixture("person_read", {"personId": f"~{p.stem}"}, _read_json(p))))

    personas = [e for e in audit["entries"] if e.get("class") == "persona"]
    for e in personas:
        rid = bare_id(e["ark"])
        rec = read_record(snapshot, copy, rid)
        if rec is None:
            rec = {"is_error": True, "error": f"Record {rid} was not read in the snapshot."}
        out.append((f"record-read-{rid}", _fixture("record_read", {"recordId": f"~{rid}"}, rec)))

    att_path = d / "attachments.json"
    subject_arks = [to_ark(e["ark"]) for e in personas if e.get("level") == "subject"]
    if subject_arks:
        att = _read_json(att_path) if att_path.exists() else {"is_error": True, "error": "attachments not read"}
        if att.get("is_error"):
            body: Any = att
        else:
            by_ark = {to_ark(k): v for k, v in (att.get("attachments") or {}).items()}
            body = {
                "attachments": {a: by_ark[a] for a in subject_arks if a in by_ark},
                "unattached": [a for a in subject_arks if a not in by_ark],
            }
        out.append(("source-attachments", _fixture("source_attachments", {"uris": "~1:1:"}, body)))

    quality_path = d / "quality.json"
    if quality_path.exists():
        q = _read_json(quality_path)
        # The mock's person_quality handler ignores is_error: a stored error
        # reaches the agent as an ordinary {"error": ...} result.
        body = {"error": q["error"]} if isinstance(q, dict) and q.get("is_error") else q
        out.append(("person-quality", {"tool": "person_quality", "args": {"personId": sid, "detail": True}, "response": body}))

    fixtures_dir.mkdir(parents=True, exist_ok=True)
    names: list[str] = []
    for stem, fx in out:
        name = _safe(f"ss-{copy}-{stem}")
        _write_json(fixtures_dir / f"{name}.json", fx)
        names.append(name)
    facts = {
        "subject_id": sid,
        "not_audited": sum(1 for e in audit["entries"] if e.get("level") == "relationship"),
    }
    return names, facts


_FENCE = re.compile(r"```json\s*(.*?)```", re.DOTALL | re.IGNORECASE)


def parse_findings(text: str) -> tuple[list[dict[str, Any]], str | None]:
    """The closing ```json block, as findings. Returns (findings, parse_error)."""
    blocks = _FENCE.findall(text or "")
    if not blocks:
        return [], "no closing ```json block"
    try:
        data = json.loads(blocks[-1])
    except json.JSONDecodeError as e:
        return [], f"closing json block does not parse: {e}"
    if not isinstance(data, list):
        return [], "closing json block is not a list"
    findings: list[dict[str, Any]] = []
    for i, item in enumerate(data):
        if not isinstance(item, dict) or item.get("kind") not in KINDS or not isinstance(item.get("source_url"), str):
            return [], f"finding {i} is not {{source_url, kind, fact}} with a known kind: {item!r}"
        findings.append({"source_url": item["source_url"], "kind": item["kind"], "fact": item.get("fact")})
    return findings, None


def delegation_for(subject_id: str, workspace: Path) -> str:
    return (
        f"Audit the sources attached to {subject_id}. Tell me which of them belong on the profile "
        f"and what is wrong with any that do not.\n\nprojectPath: {workspace}\n\n{FINDINGS_INSTRUCTION}"
    )


def agent_sha256() -> str:
    return hashlib.sha256(AGENT_BODY.read_bytes()).hexdigest()


def summarize_calls(tool_calls: list[dict[str, Any]]) -> tuple[dict[str, dict[str, int]], bool]:
    """Calls per tool by `matched.kind`, and whether any call matched no fixture."""
    out: dict[str, dict[str, int]] = {}
    miss = False
    for c in tool_calls or []:
        tool = str(c.get("tool", "")).split("__")[-1]
        kind = str((c.get("matched") or {}).get("kind", "none"))
        out.setdefault(tool, {})
        out[tool][kind] = out[tool].get(kind, 0) + 1
        if kind == "none":
            miss = True
    return out, miss


Runner = Callable[..., Awaitable[Any]]


async def judge_copy(
    snapshot: Path,
    copy: str,
    *,
    auth: Any,
    run_skill: Runner,
    model: str,
    max_tool_calls: int,
    max_wall_clock_seconds: int,
    build_workspace: Callable[..., Any],
    cleanup_session_store: Callable[[Path], None],
    direct_dispatch_prompt: Callable[[str, str], str],
    agent_return_text: Callable[[Any, str], str],
    quota_reason: str,
) -> dict[str, Any]:
    """Run the agent on one copy and write judge/<copy>.json (or .aborted.json)."""
    judge_dir = snapshot / "judge"
    tmp = Path(tempfile.mkdtemp(prefix="source-screen-judge-"))
    try:
        workspace = tmp / "ws"
        workspace.mkdir()
        fixtures_dir = tmp / "fixtures"
        build_workspace(None, SCENARIOS_DIR, SKILLS_DIR, workspace, stage_skills=False)
        shutil.copyfile(_copy_dir(snapshot, copy) / "tree.gedcomx.json", workspace / "tree.gedcomx.json")
        names, facts = generate_fixtures(snapshot, copy, fixtures_dir)
        started = time.time()
        try:
            result = await run_skill(
                user_message=direct_dispatch_prompt(AGENT, delegation_for(facts["subject_id"], workspace)),
                workspace=workspace,
                fixture_names=names,
                fixtures_dir=fixtures_dir,
                auth=auth,
                model=model,
                max_turns=DEFAULT_MAX_TURNS,
                max_tool_calls=max_tool_calls,
                max_wall_clock_seconds=max_wall_clock_seconds,
            )
        finally:
            cleanup_session_store(workspace)
        text = agent_return_text(getattr(result, "agent_returns", None), AGENT) or getattr(result, "text_response", "") or ""
        calls, harness_miss = summarize_calls(getattr(result, "tool_calls", []))
        findings, parse_error = parse_findings(text)
        record = {
            "copy_key": copy,
            "subject_id": facts["subject_id"],
            "model": model,
            "agent_sha256": agent_sha256(),
            "text": text,
            "findings": findings,
            "parse_error": parse_error,
            "harness_miss": harness_miss,
            "not_audited": facts["not_audited"],
            "calls": calls,
            "tool_args": [
                {"tool": str(c.get("tool", "")).split("__")[-1], "args": c.get("args"), "matched": (c.get("matched") or {}).get("kind")}
                for c in getattr(result, "tool_calls", []) or []
            ],
            "usage": getattr(result, "usage", {}) or {},
            "wall_seconds": round(time.time() - started, 1),
            "turns": (getattr(result, "usage", {}) or {}).get("num_turns"),
            "aborted_reason": getattr(result, "aborted_reason", None),
        }
        aborted = record["aborted_reason"]
        if aborted:
            _write_json(judge_dir / f"{copy}.aborted.json", record)
            if aborted == quota_reason:
                raise QuotaStop(copy)
            return record
        (judge_dir / f"{copy}.aborted.json").unlink(missing_ok=True)
        _write_json(judge_dir / f"{copy}.json", record)
        return record
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def pending_copies(snapshot: Path, only: list[str] | None = None) -> list[str]:
    """Copies with a finished snapshot and no finished judge file; aborted ones are retried."""
    out = []
    for copy in list_copies(snapshot):
        if only and copy not in only:
            continue
        meta = _copy_dir(snapshot, copy) / "meta.json"
        if not meta.exists() or _read_json(meta).get("living"):
            continue
        if (_copy_dir(snapshot, copy) / "person-read.json").exists() and not (snapshot / "judge" / f"{copy}.json").exists():
            out.append(copy)
    return out


def write_judge_jsonl(snapshot: Path) -> int:
    """judge.jsonl from every finished judge file; refuses mixed agent bodies or models."""
    rows: list[dict[str, Any]] = []
    shas: set[str] = set()
    models: set[str] = set()
    for copy in list_copies(snapshot):
        p = snapshot / "judge" / f"{copy}.json"
        if not p.exists():
            continue
        j = _read_json(p)
        shas.add(j.get("agent_sha256"))
        models.add(j.get("model"))
        for f in j.get("findings") or []:
            rows.append(
                {
                    "copy_key": copy,
                    "ark": to_ark(f["source_url"]),
                    "source_url": f["source_url"],
                    "kind": f["kind"],
                    "fact": f.get("fact"),
                    "signal": "judge",
                }
            )
    if len(shas) > 1:
        raise JudgeError(f"judge files mix {len(shas)} source-evaluation.md versions; re-judge so they share one")
    if len(models) > 1:
        raise JudgeError(f"judge files mix models {sorted(m for m in models if m)}; re-judge with one")
    (snapshot / "judge.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    return len(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--snapshot", required=True)
    ap.add_argument("--only", action="append")
    ap.add_argument("--model")
    ap.add_argument("--max-tool-calls", type=int, default=DEFAULT_MAX_TOOL_CALLS)
    ap.add_argument("--max-wall-clock-seconds", type=int, default=DEFAULT_MAX_WALL_CLOCK_SECONDS)
    args = ap.parse_args(argv)
    snapshot = guard_path(args.snapshot)
    if not (snapshot / "run.json").exists():
        raise JudgeError(f"{snapshot} holds no run.json; run source-screen snapshot or plant first")

    from harness.auth import resolve_auth
    from harness.skill_runner import (
        DEFAULT_MODEL,
        QUOTA_ABORT_REASON,
        agent_return_text,
        direct_dispatch_prompt,
        run_skill,
    )
    from harness.workspace import build_workspace, cleanup_session_store

    auth = resolve_auth()
    require_subscription(auth)
    copies = pending_copies(snapshot, args.only)
    if args.only:
        unknown = sorted(set(args.only) - set(list_copies(snapshot)))
        if unknown:
            raise JudgeError(f"--only names copies the snapshot does not hold: {unknown}")
    print(f"judging {len(copies)} copies", flush=True)
    try:
        for i, copy in enumerate(copies, 1):
            rec = asyncio.run(
                judge_copy(
                    snapshot,
                    copy,
                    auth=auth,
                    run_skill=run_skill,
                    model=args.model or DEFAULT_MODEL,
                    max_tool_calls=args.max_tool_calls,
                    max_wall_clock_seconds=args.max_wall_clock_seconds,
                    build_workspace=build_workspace,
                    cleanup_session_store=cleanup_session_store,
                    direct_dispatch_prompt=direct_dispatch_prompt,
                    agent_return_text=agent_return_text,
                    quota_reason=QUOTA_ABORT_REASON,
                )
            )
            state = rec["aborted_reason"] or ("harness_miss" if rec["harness_miss"] else "ok")
            print(f"[{i}/{len(copies)}] {state}: {len(rec['findings'])} findings, {rec['wall_seconds']}s", flush=True)
    except QuotaStop:
        print(
            "stopped: subscription quota exhausted. Resume later with the same command:\n"
            f"  uv run python source_screen_judge.py --snapshot {snapshot}",
            flush=True,
        )
        write_judge_jsonl(snapshot)
        return 3
    n = write_judge_jsonl(snapshot)
    print(f"wrote {snapshot / 'judge.jsonl'}: {n} findings", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except JudgeError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
