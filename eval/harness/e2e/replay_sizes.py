"""`make replay-sizes` — replay committed e2e tool calls against two engine
builds and diff the answer sizes. Zero model calls, zero network.

**The question it answers.** Waves 1 and 2 of `docs/plan/cost-latency-10x.md`
change what tools return. Measuring a change with a real run costs ~$10 and
~75 minutes and moves with run-to-run spread; the unit suite serves canned
fixture answers, so it cannot see a tool-body change at all. This re-asks the
questions a committed run already recorded — same tool, same arguments, same
project state — to a **base** build and a **candidate** build of the MCP
server, and reports how much bigger or smaller the answers got.

**What is replayed.** Two kinds of tool:

* the tools that read project files on disk (`LOCAL_REPLAYABLE`, T1.4);
* the FamilySearch and wiki tools (`NETWORK_REPLAYABLE`, T1.4c), served from
  recorded upstream answers — "cassettes" under `eval/fixtures/replay/`
  (`make replay-record`, `e2e/replay_record.py`). Both arms load the fetch hook
  `e2e/replay_fetch.mjs` in replay mode, which answers every upstream request
  from the cassettes by a canonical key and never calls the network. A run the
  cassette manifest does not name, a call it excluded at record time, and a
  `record_read` in sidecar mode (`resultsRef`, deferred) are listed under NOT
  REPLAYED with their reason.

Every other tool (`image_transcribe`, the tree tools) is listed under NOT
REPLAYED with its call count, never shown as a 0% change.

**Project state.** A read tool must see the files as they stood when the call
was made. `harness.replay.replay(..., upto=i)` rebuilds `research.json` from the
run's recorded writes. Nothing rebuilds the *tree* mid-run, so tree readers get
the run's **final** tree (labelled approximate): of 232 `person_warnings` calls,
160 name a person absent from the starting tree and 5 one absent from the final.
Each arm gets its own project dir (same-length paths, since search answers echo
`projectPath`), and `results/` is emptied before every network call — so the
unlogged-search note never fires in replay (a named limitation).

**The headline is candidate vs base, never candidate vs recorded.** The
recorded size came from whatever build ran weeks ago against the real notes;
comparing to it would blame this change for every other change since, plus
any reconstruction error. It is shown as a fidelity column only. Both arms read
the same cassette bytes for the same request, so upstream drift since the
recording cannot read as a regression.

**Measured as the orchestrator measured it.** A success is
`len(json.dumps(content))` of the `[{"type","text"}]` list; an error is the
plain text, because the SDK hands the orchestrator a string on the error path
(`e2e/orchestrator.py` `_serialize_result`). Characters only — no dollars, since
how many later turns re-read an answer is invisible here.

**It refuses to report a misleading zero.** Exit 3 when the rebase to a local
project dir broke (preflight, `no_project`, or any project-io path error),
when state-shaped errors appear on calls that recorded none beyond a margin,
when a read changed the files, when a local tool tried the network, when a
server died, or when the base build misses the cassettes on recorded calls
beyond the same margin ("cassettes stale: re-record"). A call whose base
request misses is bucketed `stale`; one only the candidate misses is bucketed
`candidate-new-request` (a candidate that changes a request). Both leave the Δ
table and print with their counts — never netted to 0. Argument-validation
errors (a recorded argument the current tool now rejects) are contract drift,
not a broken harness: they print as their own row and never exit 3.

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

#: Tools that read project files and nothing else (T1.4).
LOCAL_REPLAYABLE = frozenset(
    {"research_query", "validate_research_schema", "project_context", "person_warnings", "merge_warnings"}
)
#: FamilySearch and wiki tools, served from recorded cassettes (T1.4c).
NETWORK_REPLAYABLE = frozenset(
    {"wiki_read", "wiki_place_page", "wiki_search", "record_search", "record_read", "volume_search",
     "fulltext_search"}
)
REPLAYABLE = LOCAL_REPLAYABLE | NETWORK_REPLAYABLE
REPLAY_FIXTURES = REPO_ROOT / "eval" / "fixtures" / "replay"
HOOK = Path(__file__).resolve().with_name("replay_fetch.mjs")
#: The replay arms' login: a token that never expires and has no refresh token,
#: so `getValidToken(LOCAL)` returns it without a refresh (auth/tokenManager.ts).
FAKE_TOKEN = "replay-not-a-real-token"
FAKE_TOKEN_EXPIRES_AT = 4102444800000
FAKE_WIKI = "http://wiki.replay.invalid"
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
    if tool in NETWORK_REPLAYABLE:
        if not isinstance(body, dict):
            return False
        for key in ("results", "persons", "volumes", "entries"):
            if isinstance(body.get(key), list):
                return len(body[key]) > 0
        return isinstance(body.get("content"), str) and bool(body["content"].strip())
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

    @property
    def network(self) -> bool:
        return self.tool in NETWORK_REPLAYABLE


@dataclass
class RunItems:
    run_path: Path
    slug: str
    starting_research: dict[str, Any]
    tree: dict[str, Any] | None
    items: list[Item] = field(default_factory=list)


def run_key(run_path: Path) -> str:
    """How a cassette manifest names a run: repo-relative POSIX path."""
    resolved = run_path.resolve()
    try:
        return resolved.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return resolved.as_posix()


@dataclass
class CassetteSet:
    """The cassette dirs to replay from, first match wins, and their manifests
    merged the same way: for one run's call, the first dir naming it decides."""

    dirs: list[Path]
    calls: dict[tuple[str, int], dict] = field(default_factory=dict)
    runs: list[str] = field(default_factory=list)
    provenance: list[tuple[Path, dict]] = field(default_factory=list)


def load_cassettes(dirs: list[Path]) -> CassetteSet:
    out = CassetteSet(dirs=list(dirs))
    for d in dirs:
        manifest = _read_json(d / "manifest.json")
        if manifest is None:
            continue
        out.provenance.append((d, manifest))
        for run, entry in (manifest.get("runs") or {}).items():
            if run not in out.runs:
                out.runs.append(run)
            for idx, call in ((entry or {}).get("calls") or {}).items():
                out.calls.setdefault((run, int(idx)), call if isinstance(call, dict) else {})
    return out


def cassette_provenance(cassettes: CassetteSet, today: str | None = None) -> list[str]:
    """Header lines: when, and from which engine, each cassette dir was recorded."""
    from datetime import date

    if not cassettes.provenance:
        return [f"cassettes: none under {', '.join(str(d) for d in cassettes.dirs)} — network tools not replayed"]
    out = []
    now = date.fromisoformat(today) if today else date.today()
    for d, m in cassettes.provenance:
        recorded = str(m.get("recorded_at") or "")
        try:
            age = f"{(now - date.fromisoformat(recorded[:10])).days} days old"
        except ValueError:
            age = "age unknown"
        out.append(
            f"cassettes: {d}  recorded {recorded or '?'} · engine {str(m.get('engine_sha') or '?')[:9]} "
            f"({m.get('version', '?')}) · {age} · tree sub-requests {m.get('tree_subrequests', '?')}"
        )
    return out


def select_recorded_runs(cassettes: CassetteSet) -> tuple[list[tuple[Path, dict]], int]:
    """Exactly the runs the cassette manifests name; `(runs, untracked_count)`.
    A new function so `select_runs` keeps the signature replay_collapse imports."""
    if not cassettes.runs:
        raise UsageError(
            "--recorded-runs: no cassette manifest names a run under "
            + ", ".join(str(d) for d in cassettes.dirs)
            + " — record one with `make replay-record`"
        )
    paths = [Path(r) if Path(r).is_absolute() else REPO_ROOT / r for r in cassettes.runs]
    tracked = _tracked(paths)
    runs: list[tuple[Path, dict]] = []
    untracked = 0
    for p in paths:
        log = _read_json(p)
        if log is None:
            raise UsageError(f"--recorded-runs: the manifest names {p}, which is not a readable run log")
        if p not in tracked:
            untracked += 1
        runs.append((p, log))
    return runs, untracked


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
    run_path: Path, log: dict, tools: set[str], skipped: Counter, skipped_chars: Counter,
    cassettes: CassetteSet | None = None, *, recording: bool = False,
) -> RunItems | None:
    """The replayable calls of one run. A network call is replayed only when the
    cassette manifest recorded it; `recording=True` (the recorder) skips that
    test, since it is building the manifest."""
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
        call_args = call.get("args") if isinstance(call.get("args"), dict) else {}
        if name not in REPLAYABLE:
            if name in WRITERS:
                reason = "writer"
            elif name == "sidecar_read":
                reason = "sidecar-not-committed"
            else:
                reason = "not-on-replay-allow-list"
        elif name not in tools:
            reason = "filtered-out (--tools)"
        elif not isinstance(call.get("result_chars"), int):
            reason = "unclassifiable"
        elif _is_harness_denial(call):
            reason = "harness-denied"
        elif name in TREE_READERS and tree is None:
            reason = "no-tree"
        elif name == "record_read" and call_args.get("resultsRef"):
            reason = "sidecar-mode (deferred)"
        elif name in NETWORK_REPLAYABLE and not recording:
            key = run_key(run_path)
            entry = None if cassettes is None else cassettes.calls.get((key, i))
            if cassettes is None or key not in cassettes.runs:
                reason = "no-cassette (run not in recorded set)"
            elif entry is None:
                reason = "no-cassette (call not in manifest)"
            elif entry.get("status") != "recorded":
                reason = f"cassette-excluded:{entry.get('reason', 'unknown')}"
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
    #: None for a measured row; "stale" when the base build missed the
    #: cassettes, "candidate-new-request" when only the candidate did.
    bucket: str | None = None
    #: Unique cassette-miss keys behind the bucket (an engine retry re-issues
    #: the same key, so it is counted once).
    misses: int = 0


STALE = "stale"
CANDIDATE_NEW = "candidate-new-request"


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


def write_hook_bootstrap(directory: Path, config: dict[str, Any]) -> str:
    """A per-invocation `--import` module that installs `replay_fetch.mjs` with
    `config`. A temp file, not an env var (PLAN-T1.4c §1.1). Returns its URL."""
    directory.mkdir(parents=True, exist_ok=True)
    boot = directory / "replay-hook-bootstrap.mjs"
    boot.write_text(
        f"import {{ install }} from {json.dumps(HOOK.as_uri())};\n"
        f"await install({json.dumps(config)});\n",
        encoding="utf-8",
    )
    return boot.as_uri()


def write_fake_login(home: Path, wiki: str = FAKE_WIKI) -> None:
    """The replay arms' login, in a temp HOME. The real ~/.familysearch-mcp is
    never read, and no env-var fallback exists."""
    cfg = home / ".familysearch-mcp"
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / "tokens.json").write_text(
        json.dumps({"accessToken": FAKE_TOKEN, "expiresAt": FAKE_TOKEN_EXPIRES_AT}), encoding="utf-8"
    )
    (cfg / "config.json").write_text(json.dumps({"wikiApiUrl": wiki}), encoding="utf-8")


class HookLog:
    """Reads the lines a fetch hook appended since the last read."""

    def __init__(self, path: Path):
        self.path = path
        self.offset = 0

    def new_lines(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        with self.path.open("rb") as fh:
            fh.seek(self.offset)
            data = fh.read()
        complete = data[: data.rfind(b"\n") + 1]
        self.offset += len(complete)
        return [json.loads(line) for line in complete.decode("utf-8").splitlines() if line.strip()]


class Arm:
    """One long-lived MCP server for one build. `hook` is an `--import`
    specifier; the default blocks the network outright (T1.4)."""

    def __init__(self, label: str, build: Path, home: Path, hook: str | None = None):
        self.label = label
        self.build = build
        self.home = home
        self.hook = hook or NET_GUARD
        self._stack = None
        self.session = None

    async def __aenter__(self):
        from contextlib import AsyncExitStack

        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        env = dict(os.environ, HOME=str(self.home), USERPROFILE=str(self.home))
        params = StdioServerParameters(
            command="node", args=["--import", self.hook, str(self.build / "index.js")],
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


def call_args(item: Item, project: Path) -> dict[str, Any]:
    """The recorded arguments, rebased to this arm's project dir. A network call
    gets a `projectPath` only when the recorded call carried one — adding it
    would turn on staging the recorded call never did."""
    args = dict(item.args)
    if not item.network or "projectPath" in args:
        args["projectPath"] = str(project)
    return args


def empty_results(project: Path) -> None:
    """A network call reads `results/` (the unlogged-search note) before it
    stages, so every network call starts from an empty one."""
    shutil.rmtree(project / "results", ignore_errors=True)


def same_length_projects(n: int = 2) -> list[Path]:
    """One project dir per arm, same prefix, asserted same length: search
    answers echo `projectPath`, so unequal paths would read as a size change."""
    dirs = [Path(tempfile.mkdtemp(prefix="replay-project-")) for _ in range(n)]
    if len({len(str(d)) for d in dirs}) != 1:
        raise IntegrityError(f"arm project dirs differ in length: {[str(d) for d in dirs]}")
    return dirs


def miss_keys(lines: list[dict[str, Any]]) -> set[str]:
    return {str(x.get("key")) for x in lines if x.get("event") == "miss"}


async def run_arms(
    runs: list[RunItems], base: Path, candidate: Path, versions: tuple[str, str],
    cassettes: CassetteSet | None = None, *, wiki: str = FAKE_WIKI,
) -> tuple[list[Row], int]:
    """Replay every item to both builds. Returns `(rows, build_id_substitutions)`.

    When any item is a network call, both arms load the replay hook over
    `cassettes`; otherwise they keep T1.4's plain network block."""
    base_version, cand_version = versions
    home = Path(tempfile.mkdtemp(prefix="replay-home-"))
    hooks_dir = Path(tempfile.mkdtemp(prefix="replay-hooks-"))
    projects = same_length_projects()
    rows: list[Row] = []
    substitutions = 0
    network = any(item.network for run in runs for item in run.items)
    logs: list[HookLog | None] = [None, None]
    hooks: list[str | None] = [None, None]
    if network:
        write_fake_login(home, wiki)
        for n, label in enumerate(("base", "candidate")):
            log = hooks_dir / f"{label}.jsonl"
            logs[n] = HookLog(log)
            hooks[n] = write_hook_bootstrap(hooks_dir / label, {
                "mode": "replay", "log": str(log), "wikiBase": wiki,
                "cassettes": [str(d) for d in (cassettes.dirs if cassettes else [])],
            })
    try:
        async with Arm("base", base, home, hooks[0]) as b, Arm("candidate", candidate, home, hooks[1]) as c:
            arms = ((b, projects[0], logs[0]), (c, projects[1], logs[1]))
            for run in runs:
                written: dict[tuple[int, str], str] = {}

                def place(research: dict, tree: dict | None) -> None:
                    for n, (_, project, _) in enumerate(arms):
                        for name, doc in (("research.json", research), ("tree.gedcomx.json", tree)):
                            text = json.dumps(doc if doc is not None else {})
                            if written.get((n, name)) != text:
                                (project / name).write_text(text, encoding="utf-8")
                                written[(n, name)] = text

                place(run.starting_research, run.tree)
                for arm, project, _ in arms:
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
                for arm, _, log in arms:
                    if log is not None and log.new_lines():
                        raise IntegrityError(
                            f"{run.slug}: {arm.label} touched the network hook outside any replayed call "
                            "(at start-up or in the preflight)"
                        )
                for item in run.items:
                    place(item.research, item.tree)
                    where = f"{item.run}#{item.index} {item.tool}"
                    answers = []
                    missed: list[set[str]] = []
                    for arm, project, log in arms:
                        if item.network:
                            empty_results(project)
                        before = _hash_dir(project)
                        content, is_error = await arm.call(item.tool, call_args(item, project), where)
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
                        lines = log.new_lines() if log is not None else []
                        if lines and not item.network:
                            raise IntegrityError(
                                f"{where} [{arm.label}]: a local tool touched the network hook "
                                f"({len(lines)} request(s))"
                            )
                        missed.append(miss_keys(lines))
                        answers.append(Answer(measure(content, is_error), is_error, text))
                    bucket = STALE if missed[0] else CANDIDATE_NEW if missed[1] else None
                    rows.append(Row(item, answers[0], answers[1], bucket,
                                    len(missed[0] or missed[1])))
    finally:
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(hooks_dir, ignore_errors=True)
        for project in projects:
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
    #: Calls the hook bucketed out of the Δ table, and their unique miss keys.
    stale: int = 0
    stale_keys: int = 0
    candidate_new: int = 0
    candidate_new_keys: int = 0


def summarize(rows: list[Row]) -> dict[str, ToolStats]:
    stats: dict[str, ToolStats] = defaultdict(ToolStats)
    for row in rows:
        s = stats[row.item.tool]
        if row.bucket == STALE:
            s.stale += 1
            s.stale_keys += row.misses
            continue
        if row.bucket == CANDIDATE_NEW:
            s.candidate_new += 1
            s.candidate_new_keys += row.misses
            continue
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
        total = s.calls + s.stale + s.candidate_new
        if s.stale > state_error_margin(total):
            raise IntegrityError(
                f"{tool}: the base build missed the cassettes on {s.stale} recorded calls (margin "
                f"{state_error_margin(total)}) — cassettes stale: re-record (`make replay-record`)"
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
        if not s.calls:
            continue
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
    if any(s.stale or s.candidate_new for s in stats.values()) or any(
        t in NETWORK_REPLAYABLE for t in stats
    ):
        out.append("")
        out.append("CASSETTE MISSES (left out of the Δ table — never netted to 0)")
        out.append(f"  {'tool':<24} {'stale':>6} {'keys':>6} {'candidate-new-request':>22} {'keys':>6}")
        for tool in sorted(t for t in stats if t in NETWORK_REPLAYABLE or stats[t].stale or stats[t].candidate_new):
            s = stats[tool]
            out.append(
                f"  {tool:<24} {s.stale:>6,} {s.stale_keys:>6,} {s.candidate_new:>22,} {s.candidate_new_keys:>6,}"
            )
        out.append(
            "  stale = the base build asked for something the cassettes do not hold (main changed a "
            "request: re-record); candidate-new-request = only the candidate did (measure it by "
            "recording base and candidate into one scratch dir, listed first in CASSETTES)"
        )
    movers = sorted((r for r in rows if r.bucket is None),
                    key=lambda r: -abs(r.candidate.chars - r.base.chars))[:10]
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
         "base_error": r.base.is_error, "candidate_error": r.candidate.is_error, "bucket": r.bucket}
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
    parser.add_argument(
        "--cassettes", default=str(REPLAY_FIXTURES),
        help="comma-separated cassette dirs (each: manifest.json + cassettes/); the first match wins, "
             "so a scratch recording listed first overlays the committed set",
    )
    parser.add_argument("--recorded-runs", action="store_true",
                        help="replay exactly the runs the cassette manifests name")
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
    cassette_dirs = [Path(d.strip()).resolve() for d in str(args.cassettes).split(",") if d.strip()]
    cassettes = load_cassettes(cassette_dirs)
    if args.recorded_runs:
        runs_logs, untracked = select_recorded_runs(cassettes)
        runs_logs = [(p, log) for p, log in runs_logs if args.test is None or p.parent.name == args.test]
    else:
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
        run = build_items(path, log, tools, skipped, skipped_chars, cassettes)
        if run and run.items:
            runs.append(run)
    if not any(r.items for r in runs):
        raise UsageError("zero calls left to replay after skips")

    rows, substitutions = await run_arms(
        runs, base, candidate, (base_version, cand_version), cassettes
    )
    stats = summarize(rows)
    check_margins(stats)

    header = [
        "replay-sizes — committed e2e tool calls, base vs candidate engine build",
        f"base:      {base_desc}  ({base_version})",
        f"candidate: {candidate}  ({cand_version})",
    ]
    header += cassette_provenance(cassettes)
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
