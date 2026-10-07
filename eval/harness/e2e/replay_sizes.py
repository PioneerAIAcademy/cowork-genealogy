"""`make replay-sizes` — replay committed e2e tool calls against two engine
builds and diff the answer sizes. Zero model calls, zero network.

**The question it answers.** Waves 1 and 2 of `docs/plan/cost-latency-10x.md`
change what tools return. Measuring a change with a real run costs ~$10 and
~75 minutes and moves with run-to-run spread; the unit suite serves canned
fixture answers, so it cannot see a tool-body change at all. This re-asks the
questions a committed run already recorded — same tool, same arguments, same
project state — to a **base** build and a **candidate** build of the MCP
server, and reports how much bigger or smaller the answers got.

**What is replayed (v1).** Only tools that read project files on disk:
`REPLAYABLE` below — 2,040 of 5,615 recorded MCP calls, ~36% of recorded
answer characters, over the 26 committed runs that carry
`tool_calls[].result_chars`. Tools that call FamilySearch or the wiki are not
replayed (that needs recorded upstream answers — T1.4c); they are listed under
NOT REPLAYED with their call count, never shown as a 0% change.

**Project state.** A read tool must see the files as they stood when the call
was made. `harness.replay.replay(..., upto=i)` rebuilds `research.json` from the
run's recorded writes. Nothing rebuilds the *tree* mid-run, so tree readers get
the run's **final** tree (labelled approximate): of 232 `person_warnings` calls,
160 name a person absent from the starting tree and 5 one absent from the final.

**The headline is candidate vs base, never candidate vs recorded.** The
recorded size came from whatever build ran weeks ago against the real notes;
comparing to it would blame this change for every other change since, plus
any reconstruction error. It is shown as a fidelity column only.

**Measured as the orchestrator measured it.** A success is
`len(json.dumps(content))` of the `[{"type","text"}]` list; an error is the
plain text, because the SDK hands the orchestrator a string on the error path
(`e2e/orchestrator.py` `_serialize_result`). Characters only — no dollars, since
how many later turns re-read an answer is invisible here.

**It refuses to report a misleading zero.** Exit 3 when the rebase to a local
project dir broke (preflight, `no_project`, or any project-io path error),
when state-shaped errors appear on calls that recorded none beyond a margin,
when a read changed the files, when a tool tried the network, or when a server
died. Argument-validation errors (a recorded argument the current tool now
rejects) are contract drift, not a broken harness: they print as their own row
and never exit 3.

**No 14-day window.** This is a paired comparison of two builds on identical
inputs, so mixing eras cannot corrupt it; and its inputs (runs carrying
`result_chars`) all postdate the strip fix, so they replay intact when stripped.

Exit codes: 0 report produced · 2 selection/usage/build error · 3 replay
integrity error.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from e2e.runlog_selection import all_result_jsons
from harness.replay import RESEARCH_WRITERS, UNMODELLED_WRITERS, bare_tool_name, replay

REPO_ROOT = Path(__file__).resolve().parents[3]
ENGINE_DIR = REPO_ROOT / "packages" / "engine" / "mcp-server"
E2E_TESTS = REPO_ROOT / "eval" / "tests" / "e2e"
RUNLOGS = REPO_ROOT / "eval" / "runlogs"

#: Tools replayed in v1: they read project files and nothing else.
REPLAYABLE = frozenset(
    {"research_query", "validate_research_schema", "project_context", "person_warnings", "merge_warnings"}
)
TREE_READERS = frozenset({"project_context", "person_warnings", "merge_warnings"})
#: Reads `results/` sidecars too, which are not committed.
PARTIAL_STATE = frozenset({"validate_research_schema"})
WRITERS = RESEARCH_WRITERS | UNMODELLED_WRITERS | {"build_external_search_url"}

#: The harness's own cap denial — never a tool answer. The cap is 300 in most
#: fixtures and 200 in three, so match the number, not a literal.
_CAP_DENIAL = re.compile(r"tool_calls cap \(\d+\) exceeded")
CAP_DENIAL_CHARS = len("tool_calls cap (300) exceeded")

#: Path errors from project-io / person-warnings: the rebase to the local
#: project dir broke. Recorded rate 0 of 2,040, so one is a harness failure.
PATH_ERRORS = (
    "projectPath is required",
    "projectPath does not exist",
    "not found in projectPath",
    "tree.gedcomx.json not found at",
)
NO_PROJECT = '"reason":"no_project"'
#: Errors that mean the reconstructed state lacks something the call needed.
_STATE_ERROR = re.compile(r"not found in|missing or not an array|is not valid JSON|Person '[^']*' not found")
#: Errors that mean the recorded *arguments* are now rejected.
_ARG_ERROR = re.compile(r"is not one of|is not a supported filter|is required|must be|expected .* got|Invalid")
NET_BLOCKED = "replay-sizes: network blocked"
NET_GUARD = f"data:text/javascript,globalThis.fetch=()=>{{throw new Error('{NET_BLOCKED}')}}"
#: The first commit whose build writes `build-info.json` (#2126).
STAMP_COMMIT = "e8607990d"


class IntegrityError(Exception):
    """The replay is not measuring what it claims to (exit 3)."""


class UsageError(Exception):
    """Selection, usage or build problem (exit 2)."""


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------


def measure(content: list[dict[str, Any]], is_error: bool) -> int:
    """An answer's size exactly as the e2e orchestrator recorded `result_chars`."""
    if is_error:
        return len("".join(str(c.get("text", "")) for c in content))
    return len(json.dumps([{"type": c.get("type"), "text": c.get("text")} for c in content]))


def classify_error(text: str) -> str:
    if _STATE_ERROR.search(text):
        return "state"
    if _ARG_ERROR.search(text):
        return "argument"
    return "other"


def _parsed(text: str) -> Any:
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


def non_empty_success(tool: str, text: str) -> bool:
    """A success that actually returned something — what a lost-state replay
    would quietly turn into small, equal, successful answers in both arms."""
    body = _parsed(text)
    if tool == "research_query":
        if not isinstance(body, dict):
            return False
        return body.get("ok") is True and isinstance(body.get("count"), int) and body["count"] > 0
    if tool == "person_warnings":
        return isinstance(body, dict) and isinstance(body.get("warningCount"), int)
    return True


# --------------------------------------------------------------------------
# Selecting runs and building replay items
# --------------------------------------------------------------------------


@dataclass
class Item:
    run: str
    index: int
    tool: str
    args: dict[str, Any]
    research: dict[str, Any]
    tree: dict[str, Any] | None
    recorded_chars: int
    recorded_is_error: bool


@dataclass
class RunItems:
    run_path: Path
    slug: str
    starting_research: dict[str, Any]
    tree: dict[str, Any] | None
    items: list[Item] = field(default_factory=list)


def _tracked(paths: list[Path]) -> set[Path]:
    out = subprocess.run(
        ["git", "ls-files", "eval/runlogs/e2e"], cwd=REPO_ROOT, capture_output=True,
        text=True, encoding="utf-8", check=True,
    ).stdout
    tracked = {(REPO_ROOT / line).resolve() for line in out.splitlines()}
    return {p for p in paths if p.resolve() in tracked}


def select_runs(test: str | None, tracked_only: bool) -> tuple[list[tuple[Path, dict]], int]:
    """Runs carrying `result_chars`; `(runs, untracked_count)`."""
    paths = [p for p in all_result_jsons() if test is None or p.parent.name == test]
    tracked = _tracked(paths)
    runs: list[tuple[Path, dict]] = []
    untracked = 0
    for p in sorted(paths):
        try:
            log = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            continue
        calls = log.get("tool_calls") if isinstance(log, dict) else None
        if not isinstance(calls, list) or not any(
            isinstance(c, dict) and "result_chars" in c for c in calls
        ):
            continue
        if p not in tracked:
            if tracked_only:
                continue
            untracked += 1
        runs.append((p, log))
    return runs, untracked


def _read_json(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _is_harness_denial(call: dict) -> bool:
    summary = call.get("response_summary")
    if isinstance(summary, str):
        return bool(_CAP_DENIAL.search(summary))
    # Stripped run: the text is gone. A denial is an error of exactly its length.
    return bool(call.get("is_error")) and call.get("result_chars") == CAP_DENIAL_CHARS


def build_items(
    run_path: Path, log: dict, tools: set[str], skipped: Counter, skipped_chars: Counter
) -> RunItems | None:
    slug = run_path.parent.name
    fixture = E2E_TESTS / slug
    starting = _read_json(fixture / "starting-research.json") or {}
    tree = _read_json(run_path.with_name(f"{run_path.stem}.final-tree.gedcomx.json")) or _read_json(
        fixture / "starting-tree.gedcomx.json"
    )
    out = RunItems(run_path=run_path, slug=slug, starting_research=starting, tree=tree)
    calls = log["tool_calls"]
    cache: dict[int, dict] = {}
    writers_before = 0
    for i, call in enumerate(calls):
        if not isinstance(call, dict):
            continue
        raw = str(call.get("tool") or "")
        name = bare_tool_name(raw)
        is_mcp = raw.startswith("mcp__")
        chars = call.get("result_chars") if isinstance(call.get("result_chars"), int) else 0
        if name in WRITERS:
            writers_before += 1
        if not is_mcp:
            continue
        reason = None
        if name not in REPLAYABLE:
            if name in WRITERS:
                reason = "writer"
            elif name == "sidecar_read":
                reason = "sidecar-not-committed"
            else:
                reason = "not-on-local-allow-list"
        elif name not in tools:
            reason = "filtered-out (--tools)"
        elif not isinstance(call.get("result_chars"), int):
            reason = "unclassifiable"
        elif _is_harness_denial(call):
            reason = "harness-denied"
        elif name in TREE_READERS and tree is None:
            reason = "no-tree"
        if reason is not None:
            skipped[(name, reason)] += 1
            skipped_chars[(name, reason)] += chars
            continue
        if writers_before not in cache:
            cache[writers_before] = replay(calls, starting, upto=i).research
        args = dict(call.get("args") or {})
        out.items.append(Item(
            run=f"{slug}/{run_path.stem}", index=i, tool=name, args=args,
            research=cache[writers_before], tree=tree,
            recorded_chars=chars, recorded_is_error=bool(call.get("is_error")),
        ))
    return out


# --------------------------------------------------------------------------
# Builds
# --------------------------------------------------------------------------


def build_version(build_dir: Path) -> str:
    info = _read_json(build_dir / "build-info.json")
    if not info or not isinstance(info.get("version"), str):
        raise UsageError(f"{build_dir} has no build-info.json — not a complete engine build")
    return info["version"]


def _git(*args: str, cwd: Path = REPO_ROOT, check: bool = True) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", check=check,
    ).stdout.strip()


def default_base() -> str:
    """`git merge-base HEAD origin/main`, after fetching — local `main` lags."""
    fetched = subprocess.run(
        ["git", "fetch", "-q", "origin", "main"], cwd=REPO_ROOT, capture_output=True,
        text=True, encoding="utf-8",
    )
    if fetched.returncode != 0:
        print("WARNING: `git fetch origin main` failed — the default base may be stale.", file=sys.stderr)
    return _git("merge-base", "HEAD", "origin/main")


def check_base_supported(sha: str, repo: Path = REPO_ROOT, stamp: str = STAMP_COMMIT) -> None:
    """Refuse a base whose build writes no build-info.json. A clone too shallow
    to hold the stamp commit cannot answer, and says so rather than "predates"."""
    if subprocess.run(
        ["git", "cat-file", "-e", f"{stamp}^{{commit}}"], cwd=repo, capture_output=True,
    ).returncode != 0:
        raise UsageError(
            f"cannot check base {sha[:9]}: {stamp} is not in this clone's history "
            "(a shallow clone?) — run `git fetch --unshallow` and retry"
        )
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", stamp, sha], cwd=repo, capture_output=True,
    ).returncode != 0:
        raise UsageError(
            f"base {sha[:9]} predates {stamp} (#2126): its build writes no "
            "build-info.json, so it is unsupported"
        )


def ensure_build_at(ref: str) -> Path:
    """A built engine at `ref`, in a cached sparse worktree. Raises UsageError."""
    try:
        sha = _git("rev-parse", "--verify", f"{ref}^{{commit}}")
    except subprocess.CalledProcessError as exc:
        raise UsageError(f"base ref {ref!r} does not resolve: {exc.stderr.strip()}") from exc
    check_base_supported(sha)
    root = Path(tempfile.gettempdir()) / "genealogy-replay-builds" / sha
    engine = root / "packages" / "engine" / "mcp-server"
    build = engine / "build"
    if (build / "build-info.json").exists():
        return build
    hooks = Path(tempfile.mkdtemp(prefix="replay-nohooks-"))
    if not engine.exists():
        if root.exists():
            shutil.rmtree(root, ignore_errors=True)
        root.parent.mkdir(parents=True, exist_ok=True)
        _git("-c", f"core.hooksPath={hooks}", "worktree", "add", "--force", "--no-checkout",
             "--detach", str(root), sha)
        _git("sparse-checkout", "set", "packages/engine/mcp-server", "scripts", cwd=root)
        _git("-c", f"core.hooksPath={hooks}", "checkout", cwd=root)
    same_lock = _git("rev-parse", f"{sha}:packages/engine/mcp-server/package-lock.json") == _git(
        "hash-object", str(ENGINE_DIR / "package-lock.json")
    )
    modules = engine / "node_modules"
    if same_lock and not modules.exists():
        modules.symlink_to(ENGINE_DIR / "node_modules", target_is_directory=True)
    steps = ([] if same_lock else [["npm", "ci"]]) + [["npm", "run", "build"]]
    for step in steps:
        done = subprocess.run(step, cwd=engine, capture_output=True, text=True, encoding="utf-8")
        if done.returncode != 0:
            raise UsageError(f"base build failed ({' '.join(step)}):\n{done.stderr[-4000:]}")
    if not (build / "build-info.json").exists():
        raise UsageError(f"base build at {sha[:9]} produced no build-info.json")
    return build


# --------------------------------------------------------------------------
# Running both arms
# --------------------------------------------------------------------------


@dataclass
class Answer:
    chars: int
    is_error: bool
    text: str


@dataclass
class Row:
    item: Item
    base: Answer
    candidate: Answer


def _hash_dir(project: Path) -> str:
    h = hashlib.sha256()
    for name in ("research.json", "tree.gedcomx.json"):
        p = project / name
        h.update(p.read_bytes() if p.exists() else b"<absent>")
    return h.hexdigest()


def _check_answer(text: str, where: str) -> None:
    if NO_PROJECT in text.replace(" ", ""):
        raise IntegrityError(f"{where}: answered no_project — the projectPath rebase broke")
    for marker in PATH_ERRORS:
        if marker in text:
            raise IntegrityError(f"{where}: project-io path error ({marker!r}) — the rebase broke")
    if NET_BLOCKED in text:
        raise IntegrityError(f"{where}: the tool tried the network")


class Arm:
    """One long-lived MCP server for one build."""

    def __init__(self, label: str, build: Path, home: Path):
        self.label = label
        self.build = build
        self.home = home
        self._stack = None
        self.session = None

    async def __aenter__(self):
        from contextlib import AsyncExitStack

        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home))
        params = StdioServerParameters(
            command="node", args=["--import", NET_GUARD, str(self.build / "index.js")],
            env=env, encoding="utf-8",
        )
        self._stack = AsyncExitStack()
        try:
            read, write = await self._stack.enter_async_context(stdio_client(params))
            self.session = await self._stack.enter_async_context(ClientSession(read, write))
            await self.session.initialize()
        except Exception as exc:
            await self._stack.aclose()
            raise IntegrityError(f"{self.label} server failed to start: {exc}") from exc
        return self

    async def __aexit__(self, *exc):
        await self._stack.aclose()

    async def call(self, tool: str, args: dict[str, Any], where: str) -> tuple[list[dict], bool]:
        try:
            result = await self.session.call_tool(tool, args)
        except Exception as exc:
            raise IntegrityError(f"{where}: {self.label} server failed: {exc}") from exc
        content = []
        for c in result.content:
            if getattr(c, "type", None) != "text":
                raise IntegrityError(f"{where}: {self.label} returned non-text content")
            content.append({"type": "text", "text": c.text})
        return content, bool(result.isError)


async def run_arms(
    runs: list[RunItems], base: Path, candidate: Path, versions: tuple[str, str]
) -> tuple[list[Row], int]:
    """Replay every item to both builds. Returns `(rows, build_id_substitutions)`."""
    base_version, cand_version = versions
    home = Path(tempfile.mkdtemp(prefix="replay-home-"))
    project = Path(tempfile.mkdtemp(prefix="replay-project-"))
    rows: list[Row] = []
    substitutions = 0
    try:
        async with Arm("base", base, home) as b, Arm("candidate", candidate, home) as c:
            for run in runs:
                written: dict[str, str] = {}

                def place(research: dict, tree: dict | None) -> None:
                    for name, doc in (("research.json", research), ("tree.gedcomx.json", tree)):
                        text = json.dumps(doc if doc is not None else {})
                        if written.get(name) != text:
                            (project / name).write_text(text, encoding="utf-8")
                            written[name] = text

                place(run.starting_research, run.tree)
                for arm in (b, c):
                    content, is_error = await arm.call(
                        "project_context", {"projectPath": str(project)}, f"{run.slug} preflight"
                    )
                    text = "".join(x["text"] for x in content)
                    body = _parsed(text)
                    if is_error or not isinstance(body, dict) or body.get("ok") is not True:
                        raise IntegrityError(
                            f"{run.slug} preflight: {arm.label} project_context was not ok:true — "
                            f"the rebased project dir is not a readable project ({text[:200]})"
                        )
                for item in run.items:
                    place(item.research, item.tree)
                    args = dict(item.args)
                    args["projectPath"] = str(project)
                    where = f"{item.run}#{item.index} {item.tool}"
                    before = _hash_dir(project)
                    answers = []
                    for arm in (b, c):
                        content, is_error = await arm.call(item.tool, args, where)
                        if arm is c and cand_version != base_version:
                            for x in content:
                                n = x["text"].count(cand_version)
                                if n:
                                    substitutions += n
                                    x["text"] = x["text"].replace(cand_version, base_version)
                        text = "".join(x["text"] for x in content)
                        _check_answer(text, f"{where} [{arm.label}]")
                        if _hash_dir(project) != before:
                            raise IntegrityError(f"{where}: {arm.label} changed the project files")
                        answers.append(Answer(measure(content, is_error), is_error, text))
                    rows.append(Row(item, answers[0], answers[1]))
    finally:
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(project, ignore_errors=True)
    return rows, substitutions


# --------------------------------------------------------------------------
# Report
# --------------------------------------------------------------------------


@dataclass
class ToolStats:
    calls: int = 0
    recorded: int = 0
    base: int = 0
    candidate: int = 0
    recorded_errors: int = 0
    base_errors: int = 0
    candidate_errors: int = 0
    base_successes: int = 0
    base_non_empty: int = 0
    candidate_non_empty: int = 0
    new_errors: Counter = field(default_factory=Counter)


def summarize(rows: list[Row]) -> dict[str, ToolStats]:
    stats: dict[str, ToolStats] = defaultdict(ToolStats)
    for row in rows:
        s = stats[row.item.tool]
        s.calls += 1
        s.recorded += row.item.recorded_chars
        s.base += row.base.chars
        s.candidate += row.candidate.chars
        s.recorded_errors += row.item.recorded_is_error
        s.base_errors += row.base.is_error
        s.candidate_errors += row.candidate.is_error
        if not row.base.is_error:
            s.base_successes += 1
            s.base_non_empty += non_empty_success(row.item.tool, row.base.text)
        if not row.candidate.is_error:
            s.candidate_non_empty += non_empty_success(row.item.tool, row.candidate.text)
        if row.base.is_error and not row.item.recorded_is_error:
            s.new_errors[classify_error(row.base.text)] += 1
    return stats


def state_error_margin(calls: int) -> int:
    """Base-only state errors tolerated per tool before exit 3. Provisional:
    re-set from the explained errors of the unchanged-build run (PLAN §3.1)."""
    return max(10, calls * 5 // 100)


def check_margins(stats: dict[str, ToolStats]) -> None:
    for tool, s in stats.items():
        n = s.new_errors["state"]
        if n > state_error_margin(s.calls):
            raise IntegrityError(
                f"{tool}: {n} state errors on calls that recorded none (margin "
                f"{state_error_margin(s.calls)}) — the reconstructed state is missing what they read"
            )


def _pct(delta: int, base: int) -> str:
    return f"{100 * delta / base:+.2f}%" if base else "--"


def render(
    *, header: list[str], stats: dict[str, ToolStats], rows: list[Row], skipped: Counter,
    skipped_chars: Counter, all_mcp_chars: int, substitutions: int,
) -> str:
    out = list(header)
    replayed_chars = sum(s.recorded for s in stats.values())
    out.append(
        f"replayed {sum(s.calls for s in stats.values()):,} calls · their recorded answers are "
        f"{replayed_chars:,} of {all_mcp_chars:,} recorded MCP answer chars "
        f"({100 * replayed_chars / all_mcp_chars:.1f}%)" if all_mcp_chars else "replayed 0 calls"
    )
    out.append(f"buildId substitutions in candidate answers: {substitutions}")
    out.append("")
    out.append(
        f"{'tool':<26} {'calls':>6} {'base chars':>12} {'candidate':>12} {'Δ chars':>10} {'Δ %':>8}"
        f" {'Δ of all':>9}  {'base/recorded':>13}"
    )
    total_delta = 0
    for tool in sorted(stats):
        s = stats[tool]
        delta = s.candidate - s.base
        total_delta += delta
        label = tool + (" (partial state)" if tool in PARTIAL_STATE else "") + (
            " (final tree)" if tool in TREE_READERS else ""
        )
        out.append(
            f"{label:<26} {s.calls:>6,} {s.base:>12,} {s.candidate:>12,} {delta:>+10,} "
            f"{_pct(delta, s.base):>8} {_pct(delta, all_mcp_chars):>9}  "
            f"{(s.base / s.recorded if s.recorded else 0):>12.2f}x"
        )
    out.append(f"{'TOTAL':<26} {'':>6} {'':>12} {'':>12} {total_delta:>+10,} {'':>8} {_pct(total_delta, all_mcp_chars):>9}")
    out.append("  base/recorded is reconstruction fidelity against the recorded run — not the result.")
    out.append("")
    out.append("SUCCESS AND ERRORS (per tool)")
    out.append(
        f"  {'tool':<24} {'successes':>9} {'non-empty':>10} {'cand non-empty':>14} "
        f"{'err rec/base/cand':>18}  new base errors by class"
    )
    for tool in sorted(stats):
        s = stats[tool]
        share = f"{100 * s.base_non_empty / s.base_successes:.0f}%" if s.base_successes else "--"
        classes = ", ".join(f"{k} {v}" for k, v in sorted(s.new_errors.items())) or "none"
        out.append(
            f"  {tool:<24} {s.base_successes:>9,} {s.base_non_empty:>6,} {share:>3} {s.candidate_non_empty:>14,} "
            f"{s.recorded_errors:>6}/{s.base_errors}/{s.candidate_errors:<6}  {classes}"
        )
    out.append(
        f"  state-error margin: max(10, 5% of calls) per tool — argument-validation errors never exit 3"
    )
    movers = sorted(rows, key=lambda r: -abs(r.candidate.chars - r.base.chars))[:10]
    movers = [r for r in movers if r.candidate.chars != r.base.chars]
    out.append("")
    out.append("LARGEST PER-CALL CHANGES")
    if not movers:
        out.append("  none — every replayed call is the same size in both builds")
    for r in movers:
        args = json.dumps({k: v for k, v in r.item.args.items() if k != "projectPath"})[:70]
        out.append(
            f"  {r.candidate.chars - r.base.chars:>+8,}  {r.item.run}#{r.item.index} {r.item.tool} {args}"
        )
    out.append("")
    out.append("NOT REPLAYED (a change to these tools is not measured here)")
    by_tool: dict[str, list[tuple[str, int, int]]] = defaultdict(list)
    for (tool, reason), n in skipped.items():
        by_tool[tool].append((reason, n, skipped_chars[(tool, reason)]))
    for tool in sorted(by_tool, key=lambda t: -sum(c for _, _, c in by_tool[t])):
        for reason, n, chars in sorted(by_tool[tool]):
            out.append(f"  {tool:<28} {n:>6,} calls {chars:>12,} chars   {reason}")
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _write_json(path: Path, rows: list[Row]) -> None:
    resolved = path.resolve()
    if RUNLOGS.resolve() in resolved.parents:
        raise UsageError(f"--json refuses a path under {RUNLOGS} (corpus pollution)")
    resolved.write_text(json.dumps([
        {"run": r.item.run, "index": r.item.index, "tool": r.item.tool,
         "recorded": r.item.recorded_chars, "base": r.base.chars, "candidate": r.candidate.chars,
         "base_error": r.base.is_error, "candidate_error": r.candidate.is_error}
        for r in rows
    ], indent=1), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    # The report prints "Δ", which a cp1252 Windows console cannot encode.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", help="git ref for the base build (default: merge-base with origin/main)")
    parser.add_argument("--base-build", type=Path, help="an already-built base build/ dir")
    parser.add_argument("--candidate-build", type=Path, default=ENGINE_DIR / "build")
    parser.add_argument("--test", help="one fixture slug")
    parser.add_argument("--tools", help="comma-separated subset of the replayable tools")
    parser.add_argument("--tracked-only", action="store_true", help="only runs committed to git")
    parser.add_argument("--json", type=Path, help="write per-call rows here (not under eval/runlogs/)")
    args = parser.parse_args(argv)
    try:
        return asyncio.run(_main(args))
    except UsageError as exc:
        print(f"replay-sizes: {exc}", file=sys.stderr)
        return 2
    except IntegrityError as exc:
        print(f"replay-sizes: REPLAY INTEGRITY ERROR — {exc}", file=sys.stderr)
        return 3


async def _main(args: argparse.Namespace) -> int:
    if args.json and RUNLOGS.resolve() in args.json.resolve().parents:
        raise UsageError(f"--json refuses a path under {RUNLOGS} (corpus pollution)")
    tools = set(REPLAYABLE)
    if args.tools:
        asked = {t.strip() for t in args.tools.split(",") if t.strip()}
        tools = asked & REPLAYABLE
        if not tools:
            raise UsageError(f"--tools {args.tools!r} matches no replayable tool ({', '.join(sorted(REPLAYABLE))})")
    runs_logs, untracked = select_runs(args.test, args.tracked_only)
    if not runs_logs:
        raise UsageError("no committed run carries tool_calls[].result_chars for this selection")

    candidate = args.candidate_build
    cand_version = build_version(candidate)
    if args.base_build:
        base, base_desc = args.base_build, f"build dir {args.base_build}"
    else:
        ref = args.base or default_base()
        base = ensure_build_at(ref)
        base_desc = f"{ref} = {_git('log', '-1', '--format=%h %s', ref)}"
    base_version = build_version(base)

    skipped: Counter = Counter()
    skipped_chars: Counter = Counter()
    all_mcp_chars = 0
    runs: list[RunItems] = []
    for path, log in runs_logs:
        all_mcp_chars += sum(
            c["result_chars"] for c in log["tool_calls"]
            if isinstance(c, dict) and str(c.get("tool", "")).startswith("mcp__")
            and isinstance(c.get("result_chars"), int)
        )
        run = build_items(path, log, tools, skipped, skipped_chars)
        if run and run.items:
            runs.append(run)
    if not any(r.items for r in runs):
        raise UsageError("zero calls left to replay after skips")

    rows, substitutions = await run_arms(runs, base, candidate, (base_version, cand_version))
    stats = summarize(rows)
    check_margins(stats)

    header = [
        "replay-sizes — committed e2e tool calls, base vs candidate engine build",
        f"base:      {base_desc}  ({base_version})",
        f"candidate: {candidate}  ({cand_version})",
    ]
    if base.resolve() == candidate.resolve():
        header.append("*** BASE AND CANDIDATE ARE THE SAME BUILD DIRECTORY ***")
    header.append(
        f"runs: {len(runs_logs)} carrying result_chars"
        + (f" ({untracked} untracked)" if untracked else " (all tracked)")
        + (" · --tracked-only" if args.tracked_only else "")
    )
    print(render(
        header=header, stats=stats, rows=rows, skipped=skipped, skipped_chars=skipped_chars,
        all_mcp_chars=all_mcp_chars, substitutions=substitutions,
    ), end="")
    if args.json:
        _write_json(args.json, rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
