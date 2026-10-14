"""`make replay-record` — record the upstream answers `make replay-sizes`
replays the FamilySearch and wiki tools from (eval/fixtures/replay/README.md).

It re-asks each committed network-tool call of the chosen runs ONCE, live, to
one engine build, with the fetch hook (`replay_fetch.mjs`) in record mode. No
model calls, no new e2e runs: it walks the runs exactly as `replay_sizes`
does — `research.json` rebuilt as of each call, the run's final tree — so the
tree-built `matchTwoExamples` bodies are byte-identical at replay.

Every upstream body passes the privacy filter (`replay_privacy.py`) inside the
hook BEFORE the engine sees it, and only the filtered body is written. A filter
failure aborts the whole recording; so do six consecutive 401s. The finished
cassettes pass `replay_privacy.check` before they are swapped into OUT, and a
failed check writes nothing to OUT.

Run with the REAL HOME: a token refresh must write back to the real token file
(a refresh in a copied HOME would revoke it — utils/fs-fetch.ts, #2859). OUT is
never under eval/runlogs/. Only `OUT/cassettes/` and `OUT/manifest.json` are
replaced, so a committed README beside them survives a re-record.

Exit codes: 0 recorded · 2 usage/preflight error · 3 aborted (privacy filter
failed, auth lost, the check refused the output, or an exchange ran outside a
call).
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
import tempfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from e2e import replay_privacy as privacy
from e2e import replay_sizes
from e2e.replay_sizes import (
    ENGINE_DIR,
    LOCAL_REPLAYABLE,
    NETWORK_REPLAYABLE,
    REPO_ROOT,
    RUNLOGS,
    Arm,
    HookLog,
    IntegrityError,
    UsageError,
    _git,
    build_items,
    build_version,
    call_args,
    empty_results,
    run_key,
    same_length_projects,
    select_runs,
    write_hook_bootstrap,
)
from harness.replay import bare_tool_name

PRIVACY_SCRIPT = Path(privacy.__file__).resolve()
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
AUTH_ABORT_AFTER = 6
NEWEST = "newest-per-fixture"


class RecordAbort(Exception):
    """The recording cannot continue safely (exit 3); OUT is untouched."""


# --------------------------------------------------------------------------
# Choosing the runs
# --------------------------------------------------------------------------


def choose_runs(spec: str) -> list[tuple[Path, dict]]:
    """`newest-per-fixture` (the Q3 set), `all`, or comma-separated run paths."""
    runs, _ = select_runs(None, tracked_only=True)
    if spec == "all":
        return runs
    if spec == NEWEST:
        newest: dict[str, tuple[Path, dict]] = {}
        for p, log in runs:
            if p.parent.name not in newest or p.name > newest[p.parent.name][0].name:
                newest[p.parent.name] = (p, log)
        return [newest[k] for k in sorted(newest)]
    wanted = {(REPO_ROOT / s.strip()).resolve() for s in spec.split(",") if s.strip()}
    chosen = [(p, log) for p, log in runs if p.resolve() in wanted]
    missing = wanted - {p.resolve() for p, _ in chosen}
    if missing:
        raise UsageError(f"RUNS names {len(missing)} path(s) that are not tracked runs carrying "
                         f"result_chars: {sorted(str(m) for m in missing)}")
    return chosen


# --------------------------------------------------------------------------
# One call's exchanges -> recorded or excluded
# --------------------------------------------------------------------------


@dataclass
class CallOutcome:
    status: str  # "recorded" | "excluded"
    reason: str | None = None
    keys: list[str] = field(default_factory=list)
    #: Exchanges to store: every final exchange of a recorded call; only the
    #: fs-places ones of an excluded call (S7 — the place caches mean another
    #: replay order may need them).
    store: list[dict[str, Any]] = field(default_factory=list)
    auth_401: bool = False


def classify_call(lines: list[dict[str, Any]], *, exclude_tree: bool = False) -> CallOutcome:
    """The status policy (PLAN §1.1) over one call's hook lines."""
    final: dict[str, dict[str, Any]] = {}
    withheld: list[dict[str, Any]] = []
    for line in lines:
        ev = line.get("event")
        if ev == "abort":
            raise RecordAbort(f"privacy filter failed: {line.get('detail', '')}")
        if ev == "withhold":
            withheld.append(line)
        elif ev in ("exchange", "error"):
            final[str(line.get("key"))] = line
    places = [x for x in final.values() if x.get("event") == "exchange" and x.get("group") == "fs-places"
              and (200 <= int(x.get("status", 0)) < 300 or x.get("status") == 404)]
    statuses = [int(x["status"]) for x in final.values() if x.get("event") == "exchange"]
    statuses += [int(x["status"]) for x in withheld if isinstance(x.get("status"), int)]
    reason = None
    for w in withheld:
        if w.get("reason") == "endpoint-not-allowlisted":
            reason = "endpoint-not-allowlisted"
            break
    if reason is None and any(s in (401, 403) for s in statuses):
        reason = "auth-failed-at-record"
    if reason is None and (
        any(x.get("event") == "error" for x in final.values()) or any(s in RETRYABLE_STATUS for s in statuses)
    ):
        reason = "upstream-unavailable-at-record"
    if reason is None and withheld:
        reason = str(withheld[0].get("reason") or "withheld")
    if reason is None and exclude_tree and any(
        x.get("group") in privacy.TREE_GROUPS for x in final.values()
    ):
        reason = "tree-subrequest (Q1 option a)"
    if reason is not None:
        return CallOutcome("excluded", reason, store=places, auth_401=401 in statuses)
    stored = [x for x in final.values() if x.get("event") == "exchange"]
    return CallOutcome("recorded", keys=sorted(x["key"] for x in stored), store=stored)


# --------------------------------------------------------------------------
# Writing the cassettes
# --------------------------------------------------------------------------

LINE_FIELDS = ("key", "method", "url", "accept", "body_sha256", "status", "content_type", "body", "rewrites")


def cassette_line(exchange: dict[str, Any]) -> dict[str, Any]:
    """Exactly the stored fields — there is no request-header field."""
    return {k: exchange.get(k) for k in LINE_FIELDS}


def write_cassettes(lines: dict[str, tuple[str, dict]], cassettes: Path,
                    file_cap: int = privacy.FILE_BYTES_CAP) -> dict[str, int]:
    """One JSONL per group, sorted by key; a group over the file cap is split
    by the first hex character of sha256(key) (SF6). Returns bytes per group."""
    cassettes.mkdir(parents=True, exist_ok=True)
    by_group: dict[str, list[str]] = defaultdict(list)
    for key in sorted(lines):
        group, line = lines[key]
        by_group[group].append(json.dumps(cassette_line(line), ensure_ascii=False, sort_keys=True))
    sizes: dict[str, int] = {}
    for group, rows in by_group.items():
        total = sum(len(r.encode("utf-8")) + 1 for r in rows)
        sizes[group] = total
        if total <= file_cap:
            (cassettes / f"{group}.jsonl").write_text("\n".join(rows) + "\n", encoding="utf-8")
            continue
        shards: dict[str, list[str]] = defaultdict(list)
        for row in rows:
            key = json.loads(row)["key"]
            shards[hashlib.sha256(key.encode("utf-8")).hexdigest()[0]].append(row)
        for h, shard in shards.items():
            (cassettes / f"{group}.{h}.jsonl").write_text("\n".join(shard) + "\n", encoding="utf-8")
    return sizes


def key_census(lines: dict[str, tuple[str, dict]]) -> dict[str, dict[str, int]]:
    """Every JSON key path per group, with counts — read at the checkpoint to
    catch tree data the rules miss. Never committed."""
    census: dict[str, Counter] = defaultdict(Counter)

    def walk(node: Any, path: str, c: Counter) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                p = f"{path}.{k}" if path else k
                c[p] += 1
                walk(v, p, c)
        elif isinstance(node, list):
            for v in node:
                walk(v, path + "[]", c)

    for group, line in lines.values():
        try:
            body = json.loads(line.get("body") or "null")
        except ValueError:
            census[group]["<non-JSON body>"] += 1
            continue
        walk(body, "", census[group])
    return {g: dict(sorted(c.items())) for g, c in sorted(census.items())}


def merge_existing(
    out: Path, manifest: dict, calls: dict[str, dict[str, dict]], stored: dict[str, tuple[str, dict]],
    conflicts: int,
) -> tuple[dict[str, dict[str, dict]], int]:
    """Fold an existing OUT into this recording. The year floor and allowed-id
    set must match, or the two recordings followed different privacy rules."""
    old = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    for k in ("privacy_year_floor", "allowed_ids_sha256", "tree_subrequests"):
        if old.get(k) != manifest[k]:
            raise RecordAbort(f"MERGE: OUT was recorded with {k}={old.get(k)!r}, this recording has "
                              f"{manifest[k]!r} — record into a fresh OUT")
    shas = [s for s in [old.get("engine_sha"), *(old.get("also_recorded_with") or [])] if s]
    manifest["also_recorded_with"] = sorted(set(shas) - {manifest["engine_sha"]})
    for f in sorted((out / "cassettes").glob("*.jsonl")):
        group = privacy.cassette_group(f)
        for raw in f.read_text(encoding="utf-8").splitlines():
            line = json.loads(raw)
            prior = stored.get(line["key"])
            if prior is None:
                stored[line["key"]] = (group, line)
            elif prior[1].get("body") != line.get("body"):
                conflicts += 1
    merged: dict[str, dict[str, dict]] = {}
    for rk, entry in (old.get("runs") or {}).items():
        merged[rk] = dict((entry or {}).get("calls") or {})
    for rk, new_calls in calls.items():
        into = merged.setdefault(rk, {})
        for idx, new in new_calls.items():
            prev = into.get(idx)
            if prev and prev.get("status") == "recorded" and new.get("status") == "recorded":
                into[idx] = {**new, "keys": sorted(set(prev["keys"]) | set(new["keys"]))}
            elif prev and prev.get("status") == "recorded":
                continue
            else:
                into[idx] = new
    return merged, conflicts


def swap_into(out: Path, staged: Path) -> None:
    """Replace OUT/cassettes and OUT/manifest.json with the staged ones; leave
    anything else in OUT (the committed README) alone."""
    out.mkdir(parents=True, exist_ok=True)
    old = out / "cassettes"
    if old.exists():
        shutil.rmtree(old)
    shutil.move(str(staged / "cassettes"), str(old))
    shutil.move(str(staged / "manifest.json"), str(out / "manifest.json"))


# --------------------------------------------------------------------------
# Recording
# --------------------------------------------------------------------------


@dataclass
class RecordResult:
    manifest: dict[str, Any]
    by_tool: Counter
    group_bytes: dict[str, int]
    rewrites: Counter
    conflicts: int
    census: dict[str, dict[str, int]]
    a3_replayed: int
    a3_total: int
    year_floor_dropped: int


async def wiki_base(build: Path, home: Path) -> str:
    """What the build answers for `getWikiApiUrl(LOCAL)` — the base the hook
    canonicalises to {WIKI}."""
    config = (build / "auth" / "config.js").as_uri()
    principal = (build / "auth" / "principal.js").as_uri()
    script = (f"const c = await import({json.dumps(config)}); const p = await import({json.dumps(principal)});"
              "process.stdout.write(await c.getWikiApiUrl(p.LOCAL));")
    proc = await asyncio.create_subprocess_exec(
        "node", "--input-type=module", "-e", script,
        env=dict(os.environ, HOME=str(home), USERPROFILE=str(home)),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0 or not out.strip():
        raise UsageError(f"preflight: the build did not answer getWikiApiUrl(LOCAL): {err.decode('utf-8')[-400:]}")
    return out.decode("utf-8").strip()


async def record(
    runs: list[tuple[Path, dict]],
    build: Path,
    out: Path,
    *,
    home: Path,
    python: str = sys.executable,
    privacy_script: Path = PRIVACY_SCRIPT,
    upstream: Path | None = None,
    exclude_tree: bool = False,
    now: dt.datetime | None = None,
    tools: frozenset[str] = NETWORK_REPLAYABLE,
    preflight_auth: bool = True,
    merge: bool = False,
) -> RecordResult:
    """Record `runs` into `out`. `merge=True` adds to an existing OUT instead of
    replacing it — how a base and a candidate build are recorded into one
    scratch dir in one session (PLAN §8, SF1)."""
    out = out.resolve()
    if RUNLOGS.resolve() == out or RUNLOGS.resolve() in out.parents:
        raise UsageError(f"OUT {out} is under {RUNLOGS} — cassettes never go in the run-log corpus")
    if not runs:
        raise UsageError("no runs to record")
    now = now or dt.datetime.now(dt.timezone.utc)
    floor = now.year - 100
    version = build_version(build)
    base = await wiki_base(build, home)

    work = Path(tempfile.mkdtemp(prefix="replay-record-"))
    tests_root = replay_sizes.E2E_TESTS
    ids = privacy.allowed_ids([p for r, _ in runs for p in privacy.run_tree_paths(r, REPO_ROOT, tests_root)])
    allowed_file = work / "allowed-ids.json"
    allowed_file.write_text(json.dumps(ids), encoding="utf-8")
    log_path = work / "hook.jsonl"
    hook = write_hook_bootstrap(work / "hook", {
        "mode": "record", "log": str(log_path), "wikiBase": base, "python": python,
        "privacyScript": str(privacy_script), "floor": floor, "allowedIds": str(allowed_file),
        **({"upstream": str(upstream)} if upstream else {}),
    })
    log = HookLog(log_path)
    project = same_length_projects(1)[0]

    calls: dict[str, dict[str, dict]] = {}
    stored: dict[str, tuple[str, dict]] = {}
    conflicts = 0
    by_tool: Counter = Counter()
    rewrites: Counter = Counter()
    consecutive_401 = 0
    a3_replayed = 0
    a3_total = 0
    try:
        async with Arm("record", build, home, hook) as arm:

            async def send(tool: str, args: dict, where: str) -> list[dict]:
                stray = log.new_lines()
                if stray:
                    raise RecordAbort(f"{where}: {len(stray)} upstream exchange(s) ran while no call was outstanding")
                await arm.call(tool, args, where)
                lines = log.new_lines()
                for line in lines:
                    if line.get("event") == "abort":
                        raise RecordAbort(f"{where}: privacy filter failed: {line.get('detail', '')}")
                if lines and lines[-1].get("inflight", 0) != 0:
                    raise RecordAbort(f"{where}: a request was still in flight when the answer returned")
                return lines

            built = []
            for run_path, run_log in runs:
                skipped: Counter = Counter()
                items = build_items(run_path, run_log, set(tools), skipped, Counter(), recording=True)
                built.append((run_path, run_log, items))
            if preflight_auth:
                first = next((it for _, _, ri in built if ri for it in ri.items
                              if it.tool == "record_read" and it.args.get("recordId")), None)
                if first is None:
                    print("replay-record: WARNING — the set has no live record_read; auth preflight skipped",
                          file=sys.stderr)
                else:
                    lines = await send("record_read", {"recordId": first.args["recordId"]}, "auth preflight")
                    got = [x.get("status") for x in lines if x.get("event") in ("exchange", "withhold")]
                    if 200 not in got:
                        raise UsageError(
                            f"preflight: an authenticated FamilySearch request answered {got or 'nothing'}, "
                            "not 200 — log in (the `login` tool) and retry"
                        )

            for run_path, run_log, items in built:
                rk = run_key(run_path)
                entry = calls.setdefault(rk, {})
                for c in run_log["tool_calls"]:
                    if isinstance(c, dict) and str(c.get("tool", "")).startswith("mcp__") and isinstance(
                        c.get("result_chars"), int
                    ):
                        a3_total += c["result_chars"]
                        if bare_tool_name(str(c["tool"])) in LOCAL_REPLAYABLE:
                            a3_replayed += c["result_chars"]
                if items is None:
                    continue
                written: dict[str, str] = {}
                for item in items.items:
                    for name, doc in (("research.json", item.research), ("tree.gedcomx.json", item.tree)):
                        text = json.dumps(doc if doc is not None else {})
                        if written.get(name) != text:
                            (project / name).write_text(text, encoding="utf-8")
                            written[name] = text
                    empty_results(project)
                    where = f"{item.run}#{item.index} {item.tool}"
                    lines = await send(item.tool, call_args(item, project), where)
                    outcome = classify_call(lines, exclude_tree=exclude_tree)
                    if outcome.status == "excluded" and outcome.reason == "auth-failed-at-record" and outcome.auth_401:
                        consecutive_401 += 1
                        if consecutive_401 >= AUTH_ABORT_AFTER:
                            raise RecordAbort(f"{AUTH_ABORT_AFTER} consecutive calls answered 401 — the "
                                              "FamilySearch session is gone; log in and re-record")
                    elif outcome.status == "recorded":
                        consecutive_401 = 0
                    if outcome.status == "recorded":
                        entry[str(item.index)] = {"tool": item.tool, "status": "recorded", "keys": outcome.keys}
                        by_tool[(item.tool, "recorded")] += 1
                        a3_replayed += item.recorded_chars
                    else:
                        entry[str(item.index)] = {"tool": item.tool, "status": "excluded", "reason": outcome.reason}
                        by_tool[(item.tool, f"excluded:{outcome.reason}")] += 1
                    for x in outcome.store:
                        for rule, n in (x.get("rewrites") or {}).items():
                            rewrites[rule] += n
                        prior = stored.get(x["key"])
                        if prior is None:
                            stored[x["key"]] = (x["group"], x)
                        elif prior[1].get("body") != x.get("body"):
                            conflicts += 1
            if log.new_lines():
                raise RecordAbort("upstream exchange(s) ran after the last call answered")
        staged = work / "out"
        manifest = {
            "format": 1,
            "recorded_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "engine_sha": _git("rev-parse", "HEAD"),
            "version": version,
            "privacy_year_floor": floor,
            "allowed_ids_sha256": privacy.allowed_ids_sha256(ids),
            "tree_subrequests": "excluded" if exclude_tree else "committed",
        }
        if merge and (out / "manifest.json").exists():
            calls, conflicts = merge_existing(out, manifest, calls, stored, conflicts)
        group_bytes = write_cassettes(stored, staged / "cassettes")
        manifest["runs"] = {
            rk: {"calls": dict(sorted(c.items(), key=lambda kv: int(kv[0])))} for rk, c in calls.items()
        }
        (staged / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n",
                                              encoding="utf-8")
        violations = privacy.check(staged, REPO_ROOT, tests_root=tests_root)
        if violations:
            shown = "\n".join(f"  {f} [{rule}] {d}" for f, rule, d in violations[:20])
            raise RecordAbort(f"the cassette check refused the recording ({len(violations)}):\n{shown}")
        census = key_census(stored)
        swap_into(out, staged)
    finally:
        shutil.rmtree(work, ignore_errors=True)
        shutil.rmtree(project, ignore_errors=True)
    return RecordResult(manifest, by_tool, group_bytes, rewrites, conflicts, census, a3_replayed, a3_total,
                        rewrites.get("year_floor_dropped", 0))


def report(result: RecordResult, census_path: Path) -> str:
    out = [f"replay-record — {len(result.manifest['runs'])} runs, engine {result.manifest['engine_sha'][:9]} "
           f"({result.manifest['version']}), year floor {result.manifest['privacy_year_floor']}, "
           f"tree sub-requests {result.manifest['tree_subrequests']}", "", "CALLS (per tool)"]
    for (tool, status), n in sorted(result.by_tool.items()):
        out.append(f"  {tool:<20} {n:>5}  {status}")
    out += ["", "BYTES (per group)"]
    for group, n in sorted(result.group_bytes.items()):
        out.append(f"  {group:<16} {n:>12,}")
    total = sum(result.group_bytes.values())
    out.append(f"  {'TOTAL':<16} {total:>12,}   cap {privacy.CASSETTE_BYTES_CAP:,}")
    out += ["", "REWRITES (per rule)"]
    for rule, n in sorted(result.rewrites.items()):
        out.append(f"  {rule:<20} {n:>8,}")
    if not result.rewrites:
        out.append("  none")
    out.append(f"  year-floor entries dropped: {result.year_floor_dropped:,}")
    out.append(f"  same key, different body across calls (first kept): {result.conflicts}")
    fulltext = sum(n for (t, s), n in result.by_tool.items() if t == "fulltext_search" and s == "recorded")
    out.append(f"  fulltext_search calls recorded: {fulltext}")
    share = 100 * result.a3_replayed / result.a3_total if result.a3_total else 0.0
    out += ["", f"A3 replayed share on these runs: {result.a3_replayed:,} of {result.a3_total:,} recorded MCP "
            f"answer chars = {share:.2f}% (local five + recorded network calls)",
            f"key census (not committed): {census_path}"]
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, required=True, help="cassette dir to (re)write; never under eval/runlogs/")
    parser.add_argument("--runs", default=NEWEST, help=f"{NEWEST} (default) | all | comma-separated run paths")
    parser.add_argument("--build", type=Path, default=ENGINE_DIR / "build")
    parser.add_argument("--exclude-tree-subrequests", action="store_true",
                        help="Q1 option (a): exclude every call that POSTs matchTwoExamples or the tree attachments")
    parser.add_argument("--census", type=Path, help="where to write the key census (default: a temp file)")
    parser.add_argument("--merge", action="store_true",
                        help="add to an existing OUT instead of replacing it (record base and candidate into one "
                             "scratch dir)")
    args = parser.parse_args(argv)
    try:
        runs = choose_runs(args.runs)
        result = asyncio.run(record(runs, args.build, args.out, home=Path.home(),
                                    exclude_tree=args.exclude_tree_subrequests, merge=args.merge))
    except UsageError as exc:
        print(f"replay-record: {exc}", file=sys.stderr)
        return 2
    except (RecordAbort, IntegrityError) as exc:
        print(f"replay-record: ABORTED — {exc}\nNothing was written to {args.out}.", file=sys.stderr)
        return 3
    census_path = args.census or Path(tempfile.gettempdir()) / f"replay-key-census-{dt.datetime.now():%Y%m%d-%H%M%S}.json"
    census_path.write_text(json.dumps(result.census, indent=1), encoding="utf-8")
    print(report(result, census_path), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
