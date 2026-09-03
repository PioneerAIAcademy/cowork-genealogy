"""In-process mock MCP server for unit-test harness per spec §15.

Builds a claude_agent_sdk SDK MCP server from a fixture manifest. The server's
tools dispatch via `args` predicate matching (every fixture declares its
expected args); calls that match no fixture return a structured
`fixture_not_found` error so the run log can flag missing coverage.

Tool responses are JSON-encoded into a single text content block — the SDK's
contract for tool results.

## Live tools

Some MCP tools are deterministic functions of local workspace state — they
require no network and their return value depends on what the skill just
wrote. Canning their response as a fixture would be dishonest: a fixture
can't reflect the actual file content the skill produced.

LIVE_TOOLS lists these by bare tool name. Each entry in LIVE_TOOLS is
registered unconditionally (not gated on fixture presence) and its handler
invokes the real implementation rather than fixture-matching. Its call-log
entry uses `matched.kind = "live"` so the covered-call gate and warning
logic treat it the same as a fixture-matched call.

Current live tools:
- validate_research_schema: calls the compiled TS validator against the
  workspace path, so the result reflects the actual files the skill wrote.
- research_log_append: calls the compiled TS tool to append a log entry to
  research.json. Handles id assignment, timestamping, camelCase→snake_case
  field renaming, and validation — exactly as production does. Without this,
  skills that write log entries directly use the tool's camelCase parameter
  names instead of the schema's snake_case field names.
- research_append: calls the compiled TS tool to append/update an entry in a
  research.json section (the post-migration write path for skills like
  record-extraction, person-evidence, hypothesis-tracking). It
  validates-before-persist and enforces supersede-not-delete, so its result
  reflects the actual file the skill produced — a fixture cannot. Without it
  registered live, the migrated skills' write calls return `fixture_not_found`
  and the model silently fails to persist (it analyzes in text but never
  writes), which the validators and judge then grade as a write failure.
- tree_edit: calls the compiled TS tool to ADD facts, names, persons,
  relationships, and sources on tree.gedcomx.json (single op or a batched
  `ops` array; additive ops only — the correction/removal ops live in
  tree_correct). Like research_append it validates-before-persist against the
  actual workspace files, so its result reflects what the skill wrote — a
  fixture cannot. Without it registered live, record-extraction (and any skill
  that writes tree stubs/sources) gets `fixture_not_found` on every tree_edit
  call and either fails to persist or thrashes retrying an unavailable tool
  until it hits the wall-clock cap.
- tree_correct: the correction/removal half of the tree_edit split — calls the
  compiled TS tool to update facts/names/persons/sources in place or remove a
  fact/relationship (update_fact, update_name, update_person, update_source,
  remove). Same batched-op / validate-before-persist semantics as tree_edit;
  same live-registration rationale. Kept as a separate tool so a skill's
  allowed-tools can grant additions without granting identity rewrites (the
  record-extractor authority split).
- project_context: calls the compiled TS tool to project the workspace's
  research.json + tree.gedcomx.json into the compact read-only shape the
  record-extractor agent consumes instead of reading project files. A
  deterministic function of workspace state — a canned fixture cannot
  honestly reflect what the skill just wrote.
- research_query: same rationale as project_context — a read-only projection
  over the workspace's own research.json, so a fixture could only drift from
  what the skill just wrote. Registered live when search-records and the
  research orchestrator were pointed at it in place of whole-file Reads;
  without it, a skill that follows that instruction hits an uncovered tool
  call and grades badly for doing the right thing.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from harness.fixtures import build_manifest, load_fixtures, matches

# Bare tool names that are always registered as live handlers rather than
# fixture-backed mocks. See module docstring for the rationale.
LIVE_TOOLS: set[str] = {
    "validate_research_schema",
    "research_log_append",
    "research_append",
    "extraction_append",
    "tree_edit",
    "tree_correct",
    "materialize_facts",
    "merge_warnings",
    "project_context",
    # Read-only projection over the workspace's own research.json — same shape
    # as project_context, and deterministic, so mocking it would only invite
    # drift. Added when search-records / research were pointed at it in place of
    # whole-file Reads; without it a skill following that instruction hits an
    # uncovered tool call and grades badly for doing the right thing.
    "research_query",
    # The only route by which a project comes into existence. init-project's
    # tests start from an EMPTY workspace, so a fixture cannot serve this: what
    # is graded is whether both files end up on disk and valid, and only the
    # real tool decides that. A canned success would grade the arguments while
    # the workspace stayed empty and every file-existence check failed — and an
    # uncovered call here aborts the test outright (Type 1), wasting the whole
    # paid run.
    "project_create",
    # Pure arithmetic, and the one case where a fixture would be dishonest in the
    # opposite direction from the rest of this list: it depends on no workspace
    # state at all, but a canned response would supply the computed answer the
    # test exists to measure. convert-dates declares it as its ONLY tool and its
    # body forbids hand arithmetic ("Do not fall back to hand arithmetic"), yet
    # across four committed run logs / 56 runs it was never called once - it was
    # registered nowhere, so it never appeared in the model's tool list and every
    # conversion was done by hand and graded a pass. Tool Arguments is N/A
    # whenever tool_calls is empty, so the defect switched off the dimension that
    # covers it. conflict-resolution declares it too. Issue #1654 (deep dive).
    "convert_calendar",
}

# Path to the compiled MCP server build output, used by live tool handlers.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_MCP_BUILD = _REPO_ROOT / "packages" / "engine" / "mcp-server" / "build"

# Tools whose returned `{"ok": false}` means the call could not do what was asked.
#
# The production dispatch (`src/index.ts`) marks these `isError` via
# `writerToolResult`; this harness shells out to the compiled tools directly and
# never goes through that dispatch, so without this mirror a failed write would
# read as an error in production and a SUCCESS in every unit eval run.
#
# This is `OK_FALSE_IS_FAILURE` from `src/tool-result.ts` intersected with
# LIVE_TOOLS — the two that are not live here (`merge_tree_persons`,
# `tree_forget`) have no handler to mirror. The drift lint in
# tests/unit/test_mock_mcp.py pins that intersection, so a twelfth tool added on
# the TypeScript side fails here rather than silently going unmirrored.
#
# `merge_warnings` is deliberately absent: its `ok: false` is a dry-run verdict
# about a merge, not the tool failing. Marking it would tell the agent a working
# preview had crashed.
OK_FALSE_IS_FAILURE_LIVE: set[str] = {
    "research_append",
    "extraction_append",
    "research_log_append",
    "tree_edit",
    "tree_correct",
    "materialize_facts",
    "project_context",
    "research_query",
    "project_create",
    # Its `ok: false` means the requested correction could not be applied (an
    # impossible date, a doubleYear inconsistent with the year, a quakerMonth
    # ordinal out of range, or julianToGregorianDay before 1582-10-15) - a real
    # failure the agent must see as one, not a verdict like merge_warnings' dry run.
    "convert_calendar",
}


def _tool_envelope(tool_name: str, response: dict[str, Any]) -> dict[str, Any]:
    """The MCP content envelope, with `is_error` set on a returned failure.

    The SDK maps an `"is_error"` key to the `isError` the model sees. Gated on
    BOTH the tool name and `ok is False`: gating on the name alone would flag
    successes (every one of these returns `ok: true` when it works), and gating
    on `ok` alone would flip `merge_warnings`, which shares the compiled-tool
    builder and whose `ok: false` is a legitimate answer.

    `reason == "no_project"` is exempt, mirroring `writerToolResult` in
    `src/tool-result.ts`: the user is not in a research project, so nothing was
    asked of a project that exists. Without this mirror the unit tier would show
    an error where production shows an answer.
    """
    envelope: dict[str, Any] = {
        "content": [{"type": "text", "text": json.dumps(response)}]
    }
    if (
        tool_name in OK_FALSE_IS_FAILURE_LIVE
        and response.get("ok") is False
        and response.get("reason") != "no_project"
    ):
        envelope["is_error"] = True
    return envelope


# Last-resort input schema for a tool that is neither in the compiled build
# nor given an explicit fixture-provided input_schema (e.g. an aspirational
# tool that has fixtures but no .ts source yet). Lets the LLM pass any args.
# Read-only — the SDK treats an advertised inputSchema as a validation
# descriptor and never mutates it.
_PERMISSIVE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {},
    "additionalProperties": True,
}


def _run_node_eval(
    script: str, input_str: str | None = None, timeout: int = 30
) -> subprocess.CompletedProcess[str]:
    """Run a Node ESM ``--eval`` script and return the completed process.

    The single choke point for every ``node --input-type=module --eval``
    invocation in this file (six call sites as of 2026-08-18, three separate
    code-review passes flagged the hand-duplicated ``subprocess.run(...,
    capture_output=True, text=True, encoding="utf-8", timeout=...)`` shape).
    ``encoding="utf-8"`` is load-bearing, not cosmetic: without it, ``text=True``
    decodes with the platform default -- cp1252 on Windows -- and crashes on
    any non-ASCII byte Node writes to stdout (issue #1399 follow-on). Callers
    keep their own try/except and response-shaping, which differ per tool;
    only the subprocess invocation itself is shared.
    """
    return subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        input=input_str,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout,
    )


_build_tool_catalog_cache: dict[str, dict[str, Any]] | None = None


def _load_build_tool_catalog() -> dict[str, dict[str, Any]]:
    """Load ``{tool_name: {"description", "inputSchema"}}`` from the compiled
    MCP server build (``allToolSchemas`` in ``build/tool-schemas.js``) — the
    single source of truth for the tool list production advertises.

    This is what both the fixture-backed and live mock tools use to advertise
    production-identical descriptions and input schemas, replacing two
    hand-maintained mirrors that had drifted: the per-live-tool input schemas
    (``research_append`` once lacked ``ops``) and the fixture fallback that
    left tools with no schema at all (the match-tool fixtures, so the model
    probed with ``{}`` and was graded down for the harness-induced retries —
    rx_007/008).

    Importing the aggregate resolves the engine's ``node_modules``, which is a
    guaranteed prerequisite of every eval run (the Makefile's ``$(ENGINE_BUILD)``
    depends on ``$(ENGINE_DEPS)``, and ``run_tests.py``'s build-fresh gate aborts
    a stale/missing build). Returns ``{}`` on any failure so the mock degrades
    to permissive schemas / stub descriptions rather than aborting the run.

    Cached at module level so ``node`` is spawned once per process, not once
    per test — but only a successful catalog is cached. A transient failure
    (a slow disk tripping the timeout, a stray decode error) must not poison
    every remaining test in the process with permissive schemas; it retries
    node on the next call instead. The returned structures are treated as
    read-only.
    """
    global _build_tool_catalog_cache
    if _build_tool_catalog_cache is not None:
        return _build_tool_catalog_cache
    catalog = _load_build_tool_catalog_uncached()
    if catalog:
        _build_tool_catalog_cache = catalog
    return catalog


def _load_build_tool_catalog_uncached() -> dict[str, dict[str, Any]]:
    schemas_js = _MCP_BUILD / "tool-schemas.js"
    if not schemas_js.exists():
        return {}
    sjs_posix = str(schemas_js).replace("\\", "/").replace("'", "\\'")
    schemas_url = ("file:///" + sjs_posix) if sys.platform == "win32" else sjs_posix
    script = (
        f"import {{ allToolSchemas }} from '{schemas_url}';"
        " const out = allToolSchemas.map("
        "(s) => ({ name: s.name, description: s.description, inputSchema: s.inputSchema })"
        ");"
        " process.stdout.write(JSON.stringify(out));"
    )
    try:
        proc = _run_node_eval(script)
        out = proc.stdout.strip()
        if not out:
            return {}
        return {
            entry["name"]: {
                "description": entry.get("description"),
                "inputSchema": entry.get("inputSchema"),
            }
            for entry in json.loads(out)
        }
    except Exception:
        return {}

# Fixture-backed search tools whose canned response must be *staged* so the
# live `research_log_append` can finalize the results/<log_id>.json sidecar.
# The real record_search/fulltext_search stage their verbatim payload to
# results/.staging/<uuid>.json and return `staged.resultsRef`; the mock returns
# a canned payload, so we materialize the staged file here (via the compiled
# stager) and inject the handle. Without this, the live log tool has no staged
# source to finalize and errors ("orphan sidecar" / staging error).
STAGING_SEARCH_TOOLS: set[str] = {"record_search", "fulltext_search", "external_links_search"}

# Verbatim copy of RANKING_SKIPPED_NOTE in
# packages/engine/mcp-server/src/tools/record-search.ts. The two cannot share a
# definition — one is TypeScript on the host, the other Python in the harness —
# so grep RANKING_SKIPPED_NOTE to find both copies when editing either.
RANKING_SKIPPED_NOTE = (
    "No `subjectId`, so match-score ranking and marriage jurisdiction hints did "
    "not run. Pass the tree person this search is about as `subjectId` to enable "
    "both. Omit it only when the search is not about a specific tree person — a "
    "broad survey, or a person not yet in the tree."
)

# Verbatim copies of UNLOGGED_SEARCHES_NOTE and NIL_SEARCH_NEEDS_LOG_NOTE in
# packages/engine/mcp-server/src/utils/results-staging.ts, same rule as above:
# grep the constant name to find both copies when editing either. The COUNT is
# never computed here — `unloggedStagedSearches` is called out of the
# compiled build (see `_stage_and_compact_search_results`), because a Python
# restatement of the pairing rule is a second implementation the drift test
# cannot see.
UNLOGGED_SEARCHES_NOTE = (
    "{n} earlier staged search response(s) in this project have no research.json log "
    "entry: {refs}. Call `research_log_append` for each, passing that ref as "
    "`stagedResultsRef` — the staged file holds the search's own query, so the entry "
    "is filled in host-side and needs no reconstruction from memory. Log each as you "
    "go rather than batching them at the end. A search with no log entry is a search "
    "that did not happen, and the staged response is deleted 24h after it was made."
)

#: Mirrors UNLOGGED_REFS_SHOWN / formatUnloggedRefs in results-staging.ts. A join is
#: safe to restate here; the PAIRING rule is not, and is called out of the build.
UNLOGGED_REFS_SHOWN = 5


def _fixture_is_nil(response: dict[str, Any]) -> bool:
    """Whether a fixture response represents a genuinely nil search.

    Mirrors the production gate: an empty `results` AND a zero upstream total.
    `record_search` reports that total as `totalMatches`, `fulltext_search` as
    `totalResults`, and `external_links_search` as `totalForPlace`; a fixture that
    omits its total is treated as 0, since a canned response with no total claims
    no matches. Keyed on the total because `results` is the post-`mapEntry` set in
    production, and a page that fails mapping empties it while the total does not.
    """
    if response.get("results"):
        return False
    for key in ("totalMatches", "totalResults", "totalForPlace"):
        total = response.get(key)
        if isinstance(total, (int, float)) and total > 0:
            return False
    return True


def _format_unlogged_refs(refs: list[str]) -> str:
    shown = ", ".join(refs[:UNLOGGED_REFS_SHOWN])
    rest = len(refs) - UNLOGGED_REFS_SHOWN
    return f"{shown}, and {rest} more" if rest > 0 else shown

NIL_SEARCH_NEEDS_LOG_NOTE = (
    "Nothing returned, and nothing staged. A nil search is a finding and must be "
    "recorded: log it with `research_log_append`, `outcome: \"negative\"` — which "
    "records what the search returned, not that the record is absent — the exact "
    "parameters used, and no `stagedResultsRef`."
)


# Compaction the real search tool applies to its INLINE results once they are
# staged, per tool. Both are exported from the compiled build so this harness
# runs the production function rather than a Python restatement of it: a mock
# that hands the agent a field production strips grades tool-usage and triage
# against a shape production never sends (#1826, #2009). `external_links_search`
# stages but compacts nothing, so it is absent here by design.
_STAGED_COMPACTORS: dict[str, str] = {
    "record_search": "compactStagedRecordSearch",
    "fulltext_search": "compactStagedFulltextSearch",
}


def _stage_and_compact_search_results(
    workspace: Path, tool_name: str, response: dict[str, Any]
) -> tuple[dict[str, Any] | None, dict[str, Any], list[dict[str, Any]]]:
    """Stage a mocked search response and apply the tool's own post-staging
    compaction, both by calling the compiled build.

    Mirrors the real search tool's order: stage the full-fidelity payload to the
    sidecar first, then slim the inline copy. Doing both in ONE node process is
    deliberate — a second subprocess per search call would widen the mock's
    existing 30s-cap flakiness under concurrency (#2025).

    Returns `(staged_handle, response, unlogged_count)`. `staged_handle` is None on
    a nil search or a staging failure, and in that case `response` comes back
    untouched — compaction is only ever correct once the sidecar holds the full
    payload. The compaction functions are idempotent, so a fixture already written
    in the compacted shape passes through unchanged. The third element is the staged
    backlog read before this call staged anything — handles, not a count, because
    the note names the refs (empty when unavailable).
    """
    stager_js = _MCP_BUILD / "utils" / "results-staging.js"
    compactor_js = _MCP_BUILD / "utils" / "staged-compaction.js"
    if not stager_js.exists():
        return None, response, []

    def _url(p: Path) -> str:
        posix = str(p).replace("\\", "/").replace("'", "\\'")
        return ("file:///" + posix) if sys.platform == "win32" else posix

    compactor = _STAGED_COMPACTORS.get(tool_name)
    if compactor and compactor_js.exists():
        compact_import = f"import {{ {compactor} }} from '{_url(compactor_js)}';"
        compact_call = f" if (r) {compactor}(input.response);"
    else:
        compact_import = ""
        compact_call = ""

    input_obj = {
        "projectPath": str(workspace).replace("\\", "/"),
        "tool": tool_name,
        "response": response,
    }
    script = (
        f"import {{ stageSearchResults, unloggedStagedSearches }} from '{_url(stager_js)}';"
        f"{compact_import}"
        " import { readFileSync } from 'node:fs';"
        " const input = JSON.parse(readFileSync(0, 'utf-8'));"
        # Counted BEFORE staging, exactly as the real tools order it: a count taken
        # after would include the call being answered and fire on every first search.
        " const unlogged = await unloggedStagedSearches(input.projectPath);"
        " const r = await stageSearchResults(input);"
        f"{compact_call}"
        " process.stdout.write(JSON.stringify({ staged: r, unlogged, response: input.response }));"
    )
    try:
        proc = _run_node_eval(script, json.dumps(input_obj))
        out = proc.stdout.strip()
        if not out:
            return None, response, []
        parsed = json.loads(out)
        unlogged = parsed.get("unlogged") or []
        staged = parsed.get("staged")  # StagedHandle, or null -> None
        if staged is None:
            return None, response, unlogged
        return staged, parsed.get("response", response), unlogged
    except Exception:
        return None, response, []


def _unlogged_staged_handles(workspace: Path) -> list[dict[str, Any]]:
    """The staged backlog for a call that stages nothing (a nil search).

    Runs the compiled `unloggedStagedSearches` on its own. That is one node
    process where a nil search currently spawns none, so the per-call subprocess
    count does not rise — the concern behind #2025 was a SECOND process per call,
    not a first. Returns [] on any failure; this is advisory.
    """
    stager_js = _MCP_BUILD / "utils" / "results-staging.js"
    if not stager_js.exists():
        return []

    posix = str(stager_js).replace("\\", "/").replace("'", "\\'")
    url = ("file:///" + posix) if sys.platform == "win32" else posix
    script = (
        f"import {{ unloggedStagedSearches }} from '{url}';"
        " import { readFileSync } from 'node:fs';"
        " const input = JSON.parse(readFileSync(0, 'utf-8'));"
        " process.stdout.write(JSON.stringify("
        " { unlogged: await unloggedStagedSearches(input.projectPath) }));"
    )
    try:
        proc = _run_node_eval(
            script, json.dumps({"projectPath": str(workspace).replace("\\", "/")})
        )
        out = proc.stdout.strip()
        return list(json.loads(out).get("unlogged") or []) if out else []
    except Exception:
        return []


def create_mock_server(
    fixture_names: list[str],
    fixtures_dir: Path,
    *,
    workspace: Path | None = None,
    tool_descriptions: dict[str, str] | None = None,
):
    """Build the in-process MCP server and return (server_config, call_log, tools_by_name).

    Call log accumulates {"tool", "args", "expected_args", "matched",
    "response_fixture", "response"} dicts as the SDK invokes the mock
    tools. `expected_args` is the matched fixture's declared `args`
    block (null when no fixture matched). The caller is responsible
    for assembling tool_calls into the run log.

    tools_by_name maps the bare tool name (e.g. "wikipedia_search") to the
    SdkMcpTool object. Tests can invoke `tools_by_name[name].handler(args)`
    directly without going through the SDK transport.

    `workspace` is the per-test tempdir. Required for live tools that need
    to read workspace files (e.g. validate_research_schema). When None,
    live tools are still registered but return an error response.
    """
    fixtures = load_fixtures(fixture_names, fixtures_dir)
    manifest = build_manifest(fixtures)
    # Production tool metadata (descriptions + input schemas) pulled from the
    # compiled build — the single source of truth (eval/production parity).
    build_catalog = _load_build_tool_catalog()
    # Real production descriptions when available; fall back to a generic stub
    # per-tool below. Callers may pass an explicit map (e.g., tests) to
    # override the catalog lookup.
    if tool_descriptions is None:
        tool_descriptions = {
            name: meta["description"]
            for name, meta in build_catalog.items()
            if meta.get("description")
        }
    call_log: list[dict[str, Any]] = []

    # `record_search` now ranks host-side when given a `subjectId`, returning the
    # result inline as `ranked` — the model makes no separate rank call in the
    # normal flow. The corpus already carries per-test `rank-search-matches-*`
    # fixtures, tuned to each test's intent, so the mock composes the two rather
    # than requiring every record-search fixture to be rewritten with a `ranked`
    # block. Composition (not duplication) is also the only shape that works:
    # one record-search fixture is shared by tests that want DIFFERENT rankings
    # (record-search-1850-census-flynn pairs with both -flynn-census and
    # -flynn-collection-mismatch), which an inline block could not express.
    # Fixtures are loaded per test, so the right ranking is the one this test
    # declared. Same class of simulation as the staging block below: mirror what
    # the real tool does internally.
    rank_predicated = list((manifest.get("rank_search_matches") or {}).get("predicated") or [])

    tools = []
    for tool_name, bucket in manifest.items():
        predicated = list(bucket["predicated"])
        # Input schema precedence: the compiled production schema wins (the
        # single source of truth), so fixture-backed tools advertise exactly
        # what production does. A fixture-provided input_schema is honored only
        # for tools absent from the build (aspirational tools with fixtures but
        # no .ts source yet); a permissive shape is the last resort.
        input_schema = (
            (build_catalog.get(tool_name) or {}).get("inputSchema")
            or bucket.get("input_schema")
            or _PERMISSIVE_SCHEMA
        )

        # Capture loop variables via default args so closures bind by value.
        async def handler(
            args,
            _predicated=predicated,
            _name=tool_name,
            _workspace=workspace,
            _rank_predicated=rank_predicated,
        ):
            entry: dict[str, Any] = {
                "tool": f"mcp__genealogy__{_name}",
                "args": dict(args),
                "expected_args": None,
                "matched": {"kind": "none", "index": None},
                "response_fixture": None,
            }

            response: dict[str, Any] | None = None
            source_name: str | None = None
            for i, (predicate, resp, src) in enumerate(_predicated):
                if matches(predicate, args):
                    entry["matched"] = {"kind": "predicate", "index": i}
                    entry["expected_args"] = dict(predicate)
                    response = resp
                    source_name = src
                    break

            if response is None:
                response = {
                    "error": "fixture_not_found",
                    "tool": _name,
                    "message": (
                        f"No fixture matched call to {_name}. "
                        "Add a fixture for this argument shape."
                    ),
                }

            # Stage the canned payload for search tools so the live
            # research_log_append can finalize the sidecar (mirrors the real
            # tool returning staged.resultsRef), then apply the compaction the
            # real tool applies to its inline results once staged — both by
            # calling the compiled build, so the agent is graded on the shape
            # production actually sends. Only when projectPath was passed and
            # results came back; nil searches retain nothing and compact nothing.
            if (
                _name in STAGING_SEARCH_TOOLS
                and _workspace is not None
                and "error" not in response
                and args.get("projectPath")
                and isinstance(response.get("results"), list)
                and response.get("results")
            ):
                staged, response, _unlogged_staged = _stage_and_compact_search_results(
                    _workspace, _name, response
                )
                if staged is not None:
                    response = {**response, "staged": staged}
            elif (
                _name in STAGING_SEARCH_TOOLS
                and _workspace is not None
                and "error" not in response
                and args.get("projectPath")
            ):
                # Nil search: nothing staged, so the combined helper above never
                # ran and the backlog still has to be read for the note below.
                _unlogged_staged = _unlogged_staged_handles(_workspace)
            else:
                _unlogged_staged = []

            # Fold in the ranking the real record_search performs when the
            # caller names a subject. Matched against the test's own
            # rank_search_matches fixtures so each test keeps the ranking it was
            # written for. A test that declares no rank fixture gets no `ranked`
            # key — the same shape the real tool returns when ranking is not
            # requested — rather than a fabricated one.
            if (
                _name == "record_search"
                and args.get("subjectId")
                and "error" not in response
                and response.get("staged")
            ):
                for predicate, rank_resp, _src in _rank_predicated:
                    if matches(predicate, args):
                        response = {**response, "ranked": rank_resp}
                        break

            # The complement of the block above: when the caller gave a
            # projectPath but named no subject, the real record_search says so
            # instead of silently doing nothing. Mirrored here for the same
            # reason `ranked` is — a skill graded against the mock has to see
            # the response production would send it, or the nudge is untestable.
            #
            # `"projectPath" in args` (not truthiness) and `not subjectId`
            # (truthiness) reproduce the real gate exactly; the two differ on
            # purpose. Inserted BEFORE `results`, which is load-bearing: results
            # is the largest field, so a trailing one is what a size bound drops
            # first. Both the text and the ordering are pinned by
            # tests/tools/record-search.test.ts.
            if (
                _name == "record_search"
                and "projectPath" in args
                and not args.get("subjectId")
                and "error" not in response
            ):
                reordered = {}
                for _key, _value in response.items():
                    if _key == "results":
                        reordered["rankingSkipped"] = RANKING_SKIPPED_NOTE
                    reordered[_key] = _value
                reordered.setdefault("rankingSkipped", RANKING_SKIPPED_NOTE)
                response = reordered

            # The unlogged-search notes (#2056), mirrored for the same reason and
            # inserted in the same pre-`results` slot. All three staging tools carry
            # them, so this list is STAGING_SEARCH_TOOLS.
            #
            # The nil condition mirrors production's on BOTH halves, and each half
            # is a defect this PR was reviewed for:
            #
            # - Production requires the UPSTREAM total to be 0, not just an empty
            #   `results`, because `results` is the post-`mapEntry` set and a page
            #   that fails mapping empties it while `totalMatches`/`totalResults`
            #   stays non-zero. A mock that fires where production does not makes
            #   "the condition never held" and "the agent ignored it"
            #   indistinguishable — in the plane whose whole job is telling those
            #   apart. `_fixture_is_nil` reads whichever total the fixture carries.
            # - external_links_search stays approximate in BOTH directions, and
            #   structurally so: production keys on `allLinks`, the year-filtered set
            #   before host filtering, which a fixture never carries. `totalForPlace`
            #   sits before the year filter and `results` after the host filter, so
            #   `allLinks` lies between the only two numbers available here. A fixture
            #   omitting its total over-emits; one whose year filter emptied a non-zero
            #   total under-emits. Stated structurally on purpose — the enumerated-case
            #   version of this note went stale twice.
            if (
                _name in STAGING_SEARCH_TOOLS
                and "error" not in response
                and args.get("projectPath")
            ):
                _notes: dict[str, str] = {}
                if _unlogged_staged:
                    _notes["unloggedSearches"] = UNLOGGED_SEARCHES_NOTE.replace(
                        "{n}", str(len(_unlogged_staged))
                    ).replace(
                        "{refs}",
                        _format_unlogged_refs([h.get("ref", "") for h in _unlogged_staged]),
                    )
                if _fixture_is_nil(response):
                    _notes["nilSearchNeedsLog"] = NIL_SEARCH_NEEDS_LOG_NOTE
                if _notes:
                    reordered = {}
                    for _key, _value in response.items():
                        if _key == "results":
                            reordered.update(_notes)
                        reordered[_key] = _value
                    for _key, _value in _notes.items():
                        reordered.setdefault(_key, _value)
                    response = reordered

            entry["response"] = response
            entry["response_fixture"] = source_name
            call_log.append(entry)
            return {
                "content": [
                    {"type": "text", "text": json.dumps(response)},
                ],
            }

        # Prefer the production description; fall back to a generic stub
        # if the tool is not in the catalog (e.g., aspirational tools
        # like `fulltext_search` that have fixtures but no .ts source yet).
        description = tool_descriptions.get(
            tool_name, f"Mock {tool_name} — fixture-backed."
        )
        decorated = tool(tool_name, description, input_schema)(handler)
        tools.append(decorated)

    # --- Live tools ---------------------------------------------------------
    # Registered unconditionally regardless of fixture_names. Each live tool
    # calls the real implementation rather than matching a fixture predicate.
    for live_tool_name in sorted(LIVE_TOOLS):
        live_handler = _make_live_handler(live_tool_name, workspace, call_log)
        description = tool_descriptions.get(
            live_tool_name, f"Live {live_tool_name} — calls real implementation."
        )
        # Same source as fixture tools: the compiled production schema. Every
        # live tool has a .ts source, so it is always in the build; the
        # permissive fallback only guards a missing/failed build.
        input_schema = (
            (build_catalog.get(live_tool_name) or {}).get("inputSchema")
            or _PERMISSIVE_SCHEMA
        )
        decorated = tool(live_tool_name, description, input_schema)(live_handler)
        tools.append(decorated)

    server = create_sdk_mcp_server(name="genealogy", version="1.0.0", tools=tools)
    tools_by_name = {t.name: t for t in tools}
    return server, call_log, tools_by_name


def _make_live_handler(
    tool_name: str,
    workspace: Path | None,
    call_log: list[dict[str, Any]],
):
    """Return an async handler for a live tool."""
    if tool_name == "validate_research_schema":
        return _make_validate_handler(workspace, call_log)
    if tool_name == "research_log_append":
        return _make_log_append_handler(workspace, call_log)
    if tool_name == "research_append":
        return _make_research_append_handler(workspace, call_log)
    if tool_name == "extraction_append":
        # The record-extraction lane's writer (issue #695). Uses the generic
        # compiled-tool handler: the lane restriction lives inside the exported
        # extractionAppend function, so calling it directly here — as this
        # harness does, bypassing index.ts — still enforces the lane.
        return _make_compiled_tool_handler(
            "extraction_append", "extraction-append.js", "extractionAppend", workspace, call_log
        )
    if tool_name == "tree_edit":
        return _make_compiled_tool_handler("tree_edit", "tree-edit.js", "treeEdit", workspace, call_log)
    if tool_name == "tree_correct":
        return _make_compiled_tool_handler("tree_correct", "tree-correct.js", "treeCorrect", workspace, call_log)
    if tool_name == "materialize_facts":
        return _make_compiled_tool_handler(
            "materialize_facts", "materialize-facts.js", "materializeFacts", workspace, call_log
        )
    if tool_name == "merge_warnings":
        return _make_compiled_tool_handler(
            "merge_warnings", "merge-warnings.js", "mergeWarnings", workspace, call_log
        )
    if tool_name == "project_context":
        return _make_compiled_tool_handler(
            "project_context", "project-context.js", "projectContext", workspace, call_log
        )
    if tool_name == "research_query":
        return _make_compiled_tool_handler(
            "research_query", "research-query.js", "researchQuery", workspace, call_log
        )
    if tool_name == "project_create":
        return _make_compiled_tool_handler(
            "project_create", "project-create.js", "projectCreate", workspace, call_log
        )
    if tool_name == "convert_calendar":
        # Takes no projectPath; the generic handler injects one and convertCalendar
        # reads only `date` and `corrections`, so the extra key is inert.
        return _make_compiled_tool_handler(
            "convert_calendar", "convert-calendar.js", "convertCalendar", workspace, call_log
        )
    raise ValueError(f"No live handler defined for {tool_name!r}")


def _make_validate_handler(workspace: Path | None, call_log: list[dict[str, Any]]):
    """Build the live handler for validate_research_schema.

    Calls the compiled TS validator via `node --input-type=module` against
    the workspace path. The skill passes its own projectPath arg, but we
    always use workspace (the harness tempdir) because that is always correct
    and avoids any path drift between what the skill computed and what the
    harness actually populated.
    """
    validator_js = _MCP_BUILD / "tools" / "validate-research-schema.js"

    async def handler(args, _ws=workspace, _vjs=validator_js):
        if _ws is None or not _vjs.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {_vjs}"
            response: dict[str, Any] = {
                "valid": False,
                "errors": [f"validate_research_schema: {reason}"],
                "warnings": [],
                "message": f"Live validator unavailable: {reason}",
            }
        else:
            project_path = str(_ws).replace("\\", "/").replace("'", "\\'")
            # Node.js ESM requires file:// URLs for absolute imports on Windows;
            # bare drive-letter paths like C:/... fail with ERR_UNSUPPORTED_ESM_URL_SCHEME.
            vjs_posix = str(_vjs).replace("\\", "/").replace("'", "\\'")
            validator_url = ("file:///" + vjs_posix) if sys.platform == "win32" else vjs_posix
            script = (
                f"import {{ validateResearchSchema }} from '{validator_url}';"
                f" const r = await validateResearchSchema({{ projectPath: '{project_path}' }});"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script)
                if proc.stdout.strip():
                    response = json.loads(proc.stdout)
                else:
                    stderr_msg = proc.stderr.strip()[:500] if proc.stderr else "no output"
                    response = {
                        "valid": False,
                        "errors": [f"validate_research_schema: node produced no output (exit {proc.returncode}): {stderr_msg}"],
                        "warnings": [],
                        "message": f"Validator subprocess failed: {stderr_msg}",
                    }
            except Exception as e:
                response = {
                    "valid": False,
                    "errors": [f"validate_research_schema: {e}"],
                    "warnings": [],
                    "message": str(e),
                }

        entry: dict[str, Any] = {
            "tool": "mcp__genealogy__validate_research_schema",
            "args": dict(args),
            "expected_args": None,
            "matched": {"kind": "live", "index": None},
            "response_fixture": "live:validate_research_schema",
            "response": response,
        }
        call_log.append(entry)
        return {"content": [{"type": "text", "text": json.dumps(response)}]}

    return handler


def _make_log_append_handler(workspace: Path | None, call_log: list[dict[str, Any]]):
    """Build the live handler for research_log_append.

    Calls the compiled TS tool via `node --input-type=module` against the
    workspace path. The skill passes its own projectPath arg, but we always
    override it with workspace (the harness tempdir) to avoid path drift.

    Input is piped via stdin (as JSON) to avoid shell/JS string escaping
    issues with values that may contain quotes, backslashes, or newlines.
    """
    append_js = _MCP_BUILD / "tools" / "research-log-append.js"

    async def handler(args, _ws=workspace, _ajs=append_js):
        if _ws is None or not _ajs.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {_ajs}"
            response: dict[str, Any] = {
                "ok": False,
                "errors": [f"research_log_append: {reason}"],
            }
        else:
            ajs_posix = str(_ajs).replace("\\", "/").replace("'", "\\'")
            append_url = ("file:///" + ajs_posix) if sys.platform == "win32" else ajs_posix

            # Override projectPath with workspace; pipe the full input via
            # stdin so no value needs JS-string escaping.
            input_obj = dict(args)
            input_obj["projectPath"] = str(_ws).replace("\\", "/")

            script = (
                f"import {{ researchLogAppend }} from '{append_url}';"
                " import { readFileSync } from 'node:fs';"
                " const input = JSON.parse(readFileSync(0, 'utf-8'));"
                " const r = await researchLogAppend(input);"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, json.dumps(input_obj))
                if proc.stdout.strip():
                    response = json.loads(proc.stdout)
                else:
                    stderr_msg = proc.stderr.strip()[:500] if proc.stderr else "no output"
                    response = {
                        "ok": False,
                        "errors": [f"research_log_append: node produced no output (exit {proc.returncode}): {stderr_msg}"],
                    }
            except Exception as e:
                response = {
                    "ok": False,
                    "errors": [f"research_log_append: {e}"],
                }

        entry: dict[str, Any] = {
            "tool": "mcp__genealogy__research_log_append",
            "args": dict(args),
            "expected_args": None,
            "matched": {"kind": "live", "index": None},
            "response_fixture": "live:research_log_append",
            "response": response,
        }
        call_log.append(entry)
        return _tool_envelope("research_log_append", response)

    return handler


def _make_research_append_handler(workspace: Path | None, call_log: list[dict[str, Any]]):
    """Build the live handler for research_append.

    Calls the compiled TS tool via `node --input-type=module` against the
    workspace path. The skill passes its own projectPath arg, but we always
    override it with workspace (the harness tempdir) to avoid path drift.

    Input is piped via stdin (as JSON) to avoid shell/JS string escaping
    issues with values that may contain quotes, backslashes, or newlines.
    """
    append_js = _MCP_BUILD / "tools" / "research-append.js"

    async def handler(args, _ws=workspace, _ajs=append_js):
        if _ws is None or not _ajs.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {_ajs}"
            response: dict[str, Any] = {
                "ok": False,
                "errors": [f"research_append: {reason}"],
            }
        else:
            ajs_posix = str(_ajs).replace("\\", "/").replace("'", "\\'")
            append_url = ("file:///" + ajs_posix) if sys.platform == "win32" else ajs_posix

            # Override projectPath with workspace; pipe the full input via
            # stdin so no value needs JS-string escaping.
            input_obj = dict(args)
            input_obj["projectPath"] = str(_ws).replace("\\", "/")

            script = (
                f"import {{ researchAppend }} from '{append_url}';"
                " import { readFileSync } from 'node:fs';"
                " const input = JSON.parse(readFileSync(0, 'utf-8'));"
                " const r = await researchAppend(input);"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, json.dumps(input_obj))
                if proc.stdout.strip():
                    response = json.loads(proc.stdout)
                else:
                    stderr_msg = proc.stderr.strip()[:500] if proc.stderr else "no output"
                    response = {
                        "ok": False,
                        "errors": [f"research_append: node produced no output (exit {proc.returncode}): {stderr_msg}"],
                    }
            except Exception as e:
                response = {
                    "ok": False,
                    "errors": [f"research_append: {e}"],
                }

        entry: dict[str, Any] = {
            "tool": "mcp__genealogy__research_append",
            "args": dict(args),
            "expected_args": None,
            "matched": {"kind": "live", "index": None},
            "response_fixture": "live:research_append",
            "response": response,
        }
        call_log.append(entry)
        return _tool_envelope("research_append", response)

    return handler


def _make_compiled_tool_handler(
    tool_name: str,
    js_filename: str,
    export_symbol: str,
    workspace: Path | None,
    call_log: list[dict[str, Any]],
):
    """Build the live handler for a compiled single-export tool — the tree
    writers (tree_edit / tree_correct) and the read-only project_context all
    share this builder (one exported async function taking the input object).

    Calls the compiled TS tool via `node --input-type=module` against the
    workspace path. The skill passes its own projectPath arg, but we always
    override it with workspace (the harness tempdir) to avoid path drift.

    Input is piped via stdin (as JSON) to avoid shell/JS string escaping
    issues with values that may contain quotes, backslashes, or newlines.
    """
    tool_js = _MCP_BUILD / "tools" / js_filename

    async def handler(args, _ws=workspace, _tjs=tool_js):
        if _ws is None or not _tjs.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {_tjs}"
            response: dict[str, Any] = {
                "ok": False,
                "errors": [f"{tool_name}: {reason}"],
            }
        else:
            tjs_posix = str(_tjs).replace("\\", "/").replace("'", "\\'")
            tool_url = ("file:///" + tjs_posix) if sys.platform == "win32" else tjs_posix

            # Override projectPath with workspace; pipe the full input via
            # stdin so no value needs JS-string escaping.
            input_obj = dict(args)
            input_obj["projectPath"] = str(_ws).replace("\\", "/")

            script = (
                f"import {{ {export_symbol} }} from '{tool_url}';"
                " import { readFileSync } from 'node:fs';"
                " const input = JSON.parse(readFileSync(0, 'utf-8'));"
                f" const r = await {export_symbol}(input);"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, json.dumps(input_obj))
                if proc.stdout.strip():
                    response = json.loads(proc.stdout)
                else:
                    stderr_msg = proc.stderr.strip()[:500] if proc.stderr else "no output"
                    response = {
                        "ok": False,
                        "errors": [f"{tool_name}: node produced no output (exit {proc.returncode}): {stderr_msg}"],
                    }
            except Exception as e:
                response = {
                    "ok": False,
                    "errors": [f"{tool_name}: {e}"],
                }

        entry: dict[str, Any] = {
            "tool": f"mcp__genealogy__{tool_name}",
            "args": dict(args),
            "expected_args": None,
            "matched": {"kind": "live", "index": None},
            "response_fixture": f"live:{tool_name}",
            "response": response,
        }
        call_log.append(entry)
        return _tool_envelope(tool_name, response)

    return handler


def expected_tool_names(call_log: list[dict[str, Any]]) -> list[str]:
    """Return tool names recorded in the call log, in invocation order."""
    return [c["tool"] for c in call_log]

