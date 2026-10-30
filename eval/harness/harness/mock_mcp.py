"""In-process mock MCP server for unit-test harness per spec §15.

Builds a claude_agent_sdk SDK MCP server from a fixture manifest. The server's
tools dispatch via `args` predicate matching (every fixture declares its
expected args); calls that match no fixture return a structured
`fixture_not_found` error so the run log can flag missing coverage.

Tool responses are JSON-encoded into a single text content block — the SDK's
contract for tool results.

## Live tools

Some MCP tools are deterministic functions of local workspace state — their
return value depends on what the skill just wrote. `project_create` resolves
places (every place the caller enters, and any place a staged read left without
a `standard_place`) through the anonymous Places API; the mock gives the
compiled resolver a table built from the test's own `place_search` fixtures for
the places in the call's `tree` (`_place_table`), so it stays offline. A place
not in the table resolves to null, which includes a staged read's unresolved
place. Canning their response as a fixture would be dishonest: a fixture
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
- person_quality: runs the compiled tool's no-network resolution step against
  the workspace tree. A person with no FamilySearch link gets the tool's real
  answer; one that resolves to a FamilySearch id gets the test's fixture keyed on
  that id, or a refusal naming the missing fixture.
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
- sidecar_read: a paged read of one sidecar text file under the workspace's
  own `evaluations/`, `uploads/` or `results/` — deterministic in workspace
  state like research_query, so a fixture could only drift from what was
  actually written. gps-mentor reads a prior verdict body through it, an
  `image_transcribe` caller the page staged under `results/.staging/`, and a
  full-text caller one hit's transcript from a `fulltext_search` sidecar via
  `results/<file>#<hit id>` (or the hit list via `results/<file>#hits`).
- timeline_build: runs the compiled tool against the workspace, so the person
  timeline it writes is computed from the links the run actually made. Its
  Places lookups are answered from the test's own `place_search` fixtures
  (`_make_timeline_build_handler`); a place no fixture matches resolves to null,
  and the handler never makes a request.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import warnings
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from harness.fixtures import build_manifest, load_fixtures, matches
from harness.instrument import LIVE_TOOLS, CatalogUnavailable, load_tool_catalog, node_module_url

# Bare tool names that are always registered as live handlers rather than
# fixture-backed mocks. Declared in `harness.instrument`, which the stdlib-only
# `check_runlogs.py` fingerprints them from; see this module's docstring for why.

# Path to the compiled MCP server build output, used by live tool handlers.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_MCP_BUILD = _REPO_ROOT / "packages" / "engine" / "mcp-server" / "build"

# Tools whose returned `{"ok": false}` means the call could not do what was asked.
#
# The production dispatch (`src/server.ts`, shared by the stdio and HTTP
# entrypoints) marks these `isError` via
# `writerToolResult`; this harness shells out to the compiled tools directly and
# never goes through that dispatch, so without this mirror a failed write would
# read as an error in production and a SUCCESS in every unit eval run.
#
# This is `OK_FALSE_IS_FAILURE` from `src/tool-result.ts` intersected with
# LIVE_TOOLS — the two that are not live here (`tree_forget`,
# `external_links_search`) have no handler to mirror. The drift lint in
# tests/unit/test_mock_mcp.py pins that intersection, so a new tool added
# on the TypeScript side fails here rather than silently going unmirrored.
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
    "merge_tree_persons",
    "project_context",
    "tree_query",
    "research_query",
    # Every `ok: false` but `no_project` (invalid_ref, not_found, not_text) is
    # the read not happening — a failure the agent must see as one.
    "sidecar_read",
    "project_create",
    "timeline_build",
    # Its `ok: false` means the requested correction could not be applied (an
    # impossible date, a doubleYear inconsistent with the year, a quakerMonth
    # ordinal out of range, or julianToGregorianDay before 1582-10-15) - a real
    # failure the agent must see as one, not a verdict like merge_warnings' dry run.
    "convert_calendar",
    # Its `ok: false` means malformed input (a bad count, year or date). Impossible
    # counts are an `ok: true` answer carrying `conflicts`, not a failure.
    "census_children_gap",
    # Its `ok: false` means the requested URL could not be built (an unsupported
    # site, a missing baseUrl on digital_newspaper_archive, or no attributes at
    # all) - a real failure, not a verdict about the search's subject.
    "build_external_search_url",
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


# Node-subprocess timeout budgets (seconds). The default is the fast/graceful
# path used by the catalog probe, which degrades to permissive schemas on a
# trip rather than misleading anyone. The LONG budget covers every path that
# does real workspace file I/O — the live writer/validator tools and the
# search-staging bridge — where a trip is indistinguishable from a rejected
# write and gets graded down (#2025).
#
# Sizing: 2x the observed trip point (30s under 8-way concurrency; 0 trips in
# the 839 later calls at 30s, so the margin over a legitimate slow call is
# small — 41-op batches finished under 30s). NOT sized against a per-skill
# floor: this raise is global, and the tightest unit test caps wall-clock at
# 120s (tree-edit's match tests), with a 300s default when omitted. 60s keeps
# >=60s of recovery headroom on even that tightest test, so a genuinely hung
# call still fails-and-lets-the-model-recover inside the budget rather than
# consuming all of it — which a 120s node cap on a 120s test would not.
NODE_EVAL_TIMEOUT_DEFAULT = 30
NODE_EVAL_TIMEOUT_LONG = 60

#: Matches ``subprocess.TimeoutExpired.__str__`` ("Command '...' timed out after
#: N seconds") and ONLY that. A tripped node subprocess in a live tool lands in
#: that tool's ``{ok: false, errors: [...]}`` via the handler's
#: ``except Exception``, so ``orchestrator._build_warnings`` scans a recorded
#: live-tool response for this pattern to surface the flake as a warning (#2025).
#: The ``seconds`` anchor is load-bearing: the engine's ``fetchWithTimeout``
#: throws ``Request to <url> timed out after 30000ms.`` on a real upstream
#: timeout, which a network-calling live tool would fold into the same
#: ``{ok: false}`` shape — a bare ``"timed out after"`` marker would then excuse
#: a genuine FamilySearch failure as a harness flake. Python says seconds, JS
#: says ms; the anchor separates them.
NODE_EVAL_TIMEOUT_PATTERN = re.compile(r"timed out after [\d.]+ seconds")


#: Preloaded into every node subprocess under ``run_tests.py --store pg`` (U15):
#: it installs a PgS3ProjectStore-backed store, so the live tools read and write
#: Postgres + S3 instead of the workspace directory.
PG_STORE_PRELUDE = Path(__file__).resolve().parent / "pg_store_prelude.mjs"


def _store_import_args() -> list[str]:
    """``["--import", <prelude>]`` when the run is on the Postgres store, else ``[]``.

    Keyed on ``PROTO_STORE=pg``, which ``run_tests.py --store pg`` sets in the
    harness process (and its node children) after checking the stack's
    variables. A file URL, so a Windows drive-letter path loads too.
    """
    if os.environ.get("PROTO_STORE") != "pg":
        return []
    return ["--import", PG_STORE_PRELUDE.as_uri()]


def seed_pg_workspace(workspace: Path) -> None:
    """Under ``--store pg``, write a freshly built workspace into its Postgres
    project before the agent runs; a no-op on the file store.

    The prelude seeds a workspace on its first store call, so this is that call,
    made at a known moment: every file the harness staged is in the project, and
    nothing the agent writes later with its own Write tool is (on the hosted path
    no such file reaches the store either). Raises with node's stderr on failure,
    because a run whose seed failed would grade a store that holds nothing.
    """
    if os.environ.get("PROTO_STORE") != "pg":
        return
    ps_js = _MCP_BUILD / "store" / "project-store.js"
    posix = str(ps_js).replace("\\", "/").replace("'", "\\'")
    url = ("file:///" + posix) if sys.platform == "win32" else posix
    ws = str(workspace).replace("\\", "/").replace("'", "\\'")
    script = (
        f"import {{ getProjectStore }} from '{url}';"
        f" const c = await getProjectStore().classifyProject('{ws}');"
        " process.stdout.write(JSON.stringify({ c }));"
    )
    proc = _run_node_eval(script, timeout=NODE_EVAL_TIMEOUT_LONG)
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(
            f"--store pg: seeding the workspace into Postgres failed: "
            f"{(proc.stderr or 'no output').strip()[:1000]}"
        )


def pg_store_faults(workspace: Path) -> list[dict[str, str]]:
    """The store faults the prelude recorded for `workspace` under
    ``--store pg`` (``HARNESS_PG_FAULT_LOG``, one JSON line each); [] on the
    file store or when there were none.

    Read from every node process the test spawned — the live tools and the
    mock-side staging and scoring pipelines alike, which swallow their own
    failures — so a fault there reaches the run log instead of surfacing a step
    later as "nothing staged" read as model wobble.
    """
    log = os.environ.get("HARNESS_PG_FAULT_LOG")
    if os.environ.get("PROTO_STORE") != "pg" or not log:
        return []
    try:
        lines = Path(log).read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    want = os.path.realpath(workspace)
    out: list[dict[str, str]] = []
    for line in lines:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(entry, dict) and os.path.realpath(str(entry.get("dir", ""))) == want:
            out.append({"op": str(entry.get("op", "")), "message": str(entry.get("message", ""))})
    return out


def _run_node_eval(
    script: str, input_str: str | None = None, timeout: int = NODE_EVAL_TIMEOUT_DEFAULT
) -> subprocess.CompletedProcess[str]:
    """Run a Node ESM ``--eval`` script and return the completed process.

    The single choke point for every ``node --input-type=module --eval``
    invocation in this file (every call site but the catalog probe raises its
    timeout to ``NODE_EVAL_TIMEOUT_LONG``; three
    separate code-review passes flagged the hand-duplicated ``subprocess.run(...,
    capture_output=True, text=True, encoding="utf-8", timeout=...)`` shape).
    ``encoding="utf-8"`` is load-bearing, not cosmetic: without it, ``text=True``
    decodes with the platform default -- cp1252 on Windows -- and crashes on
    any non-ASCII byte Node writes to stdout (issue #1399 follow-on). Callers
    keep their own try/except and response-shaping, which differ per tool;
    only the subprocess invocation itself is shared.
    """
    return subprocess.run(
        ["node", *_store_import_args(), "--input-type=module", "--eval", script],
        input=input_str,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=timeout,
    )


def _node_module_url(p: Path | str) -> str:
    """A compiled module's path as a Node ESM import specifier; the one copy
    lives in `harness.instrument`."""
    return node_module_url(p)


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
    """The shared strict loader, mapped back to this module's `{}`-on-failure
    contract. A stale build still loads here; only the CI gate requires fresh."""
    try:
        return load_tool_catalog(_MCP_BUILD, run=_run_node_eval)
    except CatalogUnavailable:
        return {}

# Fixture-backed search tools whose canned response must be *staged* so the
# live `research_log_append` can finalize the results/<log_id>.json sidecar.
# The real record_search/fulltext_search stage their verbatim payload to
# results/.staging/<uuid>.json and return `staged.resultsRef`; the mock returns
# a canned payload, so we materialize the staged file here (via the compiled
# stager) and inject the handle. Without this, the live log tool has no staged
# source to finalize and errors ("orphan sidecar" / staging error).
STAGING_SEARCH_TOOLS: set[str] = {"record_search", "fulltext_search"}

# The search tools whose production response carries `query: echoQuery(input)`
# (record-search.ts, fulltext-search.ts). person_search echoes too but is
# served live, never from a fixture here.
ECHOING_SEARCH_TOOLS: frozenset[str] = frozenset({"record_search", "fulltext_search"})


def echo_query(args: dict[str, Any]) -> dict[str, Any]:
    """Every argument the call sent — `echoQuery`'s semantics
    (`src/utils/search-helpers.ts`). It drops only `undefined`, which a JSON
    call cannot carry: an omitted argument is absent here, and one sent as
    `null` is kept, exactly as production keeps it."""
    return dict(args)


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

#: Verbatim copy of IMAGE_TRANSCRIBE_NEEDS_PROJECT_MESSAGE in
#: packages/engine/mcp-server/src/tools/image-transcribe.ts (#2490).
IMAGE_TRANSCRIBE_NEEDS_PROJECT_MESSAGE = (
    "projectPath is required: image_transcribe stages the page under the project's "
    "results/ and returns its ref, not the text."
)

#: Mirrors UNLOGGED_REFS_SHOWN / formatUnloggedRefs in results-staging.ts. A join is
#: safe to restate here; the PAIRING rule is not, and is called out of the build.
UNLOGGED_REFS_SHOWN = 5


def _fixture_is_nil(response: dict[str, Any]) -> bool:
    """Whether a fixture response represents a genuinely nil search.

    Mirrors the production gate: an empty `results` AND a zero upstream total.
    `record_search` reports that total as `totalMatches` and `fulltext_search` as
    `totalResults`; a fixture that
    omits its total is treated as 0, since a canned response with no total claims
    no matches. Keyed on the total because `results` is the post-`mapEntry` set in
    production, and a page that fails mapping empties it while the total does not.
    """
    if response.get("results"):
        return False
    for key in ("totalMatches", "totalResults"):
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


# `surnameVariantHints` (issue #3054): the abbreviated forms of a -datter/-dotter
# patronymic, which the real record_search adds to a search that did not find
# its subject. The whole rule — trigger, field list and content — is the
# engine's `surnameVariantHints`, run out of the compiled build inside a node
# process this file already spawns for the call, so the agent sees what
# production would send for the arguments it actually used, and no fixture
# carries a hand-written copy to drift. One case gates in Python: a nil search
# with no projectPath, which spawns no process today, spawns one only when
# `_fixture_is_nil` holds. That predicate treats a fixture with no
# `totalMatches` as nil where production (whose total is always a number) would
# not; the compiled function re-checks `totalMatches === 0` itself, so such a
# fixture simply gets no hint.
SURNAME_VARIANT_HINTS_KEY = "surnameVariantHints"
_SURNAME_HINTS_JS = _MCP_BUILD / "utils" / "surname-variant-hints.js"
_warned_no_surname_hints_module = False


def _surname_hints_module_present() -> bool:
    """Whether the build carries the module. Warns once when it does not: a build
    older than #3054 serves every nil with no hint, which reads as the model
    ignoring one."""
    global _warned_no_surname_hints_module
    if _SURNAME_HINTS_JS.exists():
        return True
    if not _warned_no_surname_hints_module:
        _warned_no_surname_hints_module = True
        warnings.warn(
            f"{_SURNAME_HINTS_JS} is missing — rebuild packages/engine/mcp-server; "
            "record_search responses will carry no surnameVariantHints",
            stacklevel=2,
        )
    return False


def _surname_variant_hints(args: dict[str, Any], response: dict[str, Any]) -> dict[str, Any] | None:
    """The hint for a nil `record_search` with no projectPath — the one path that
    spawns no node process of its own. None when it does not apply or node fails
    (with a warning: a harness fault must not look like the model ignoring it)."""
    if not _surname_hints_module_present():
        return None
    script = (
        f"import {{ surnameVariantHints }} from '{_node_module_url(_SURNAME_HINTS_JS)}';"
        " import { readFileSync } from 'node:fs';"
        " const input = JSON.parse(readFileSync(0, 'utf-8'));"
        " process.stdout.write(JSON.stringify("
        " { hint: surnameVariantHints(input.args, input.response) ?? null }));"
    )
    try:
        proc = _run_node_eval(
            script,
            json.dumps({"args": args, "response": response}),
            timeout=NODE_EVAL_TIMEOUT_LONG,
        )
        return json.loads(proc.stdout.strip()).get("hint")
    except Exception as exc:  # noqa: BLE001 — advisory, never fails the call
        warnings.warn(f"mock record_search could not compute surnameVariantHints ({exc})", stacklevel=2)
        return None


def _place_before_results(response: dict[str, Any], key: str) -> dict[str, Any]:
    """`response` with `key` moved immediately before `results` — where the real
    record_search serializes `surnameVariantHints`, after the pre-`results` notes."""
    value = response[key]
    reordered: dict[str, Any] = {}
    for k, v in response.items():
        if k == key:
            continue
        if k == "results":
            reordered[key] = value
        reordered[k] = v
    reordered.setdefault(key, value)
    return reordered


# Compaction the real search tool applies to its INLINE results once they are
# staged, per tool. Both are exported from the compiled build so this harness
# runs the production function rather than a Python restatement of it: a mock
# that hands the agent a field production strips grades tool-usage and triage
# against a shape production never sends (#1826, #2009 — both now covered by
# the compactors below, not by a Python mirror).
_STAGED_COMPACTORS: dict[str, str] = {
    "record_search": "compactStagedRecordSearch",
    "fulltext_search": "compactStagedFulltextSearch",
}


def _record_match_score(
    workspace: Path, args: dict[str, Any], response: dict[str, Any]
) -> tuple[bool, dict[str, Any] | None]:
    """Write the attestation a real `same_person` call would have written, and
    work out whom the call is about.

    `same_person` is not in LIVE_TOOLS -- it calls FamilySearch -- so the
    compiled tool never executes here and `recordMatchScore` never runs. That
    left `results/.scores/` empty in every unit run, which makes any
    writer-side gate that reads it untestable and, worse, makes it refuse
    everything. Same shape as `_stage_and_compact_search_results` above: a
    fixture-backed tool still has to produce its real side effect.

    Calls the compiled build rather than restating the derivation, because a
    Python copy of the pairing rule is a second implementation no drift test
    can see. `buildRecordedScore` is exported from the tool for exactly this.
    It files the persona production resolves for the call (the caller's
    `recordPersonaId`, else the persona a sibling assertion carries for the
    `recordRole` asked), through the same lookup production uses, and the role
    the record gives that persona when the caller named it.

    The same node process also runs `describeScoredPair`, which says whom the
    call is about (the record persona and the tree person) from research.json
    and tree.gedcomx.json; `_overlay_parties` serves that, because a canned
    fixture answers every pairing its test makes with the one it was recorded
    for. A second process per call is what `_stage_and_compact_search_results`
    warns against.

    Scoped deliberately:
      * project-relative arm only -- the explicit two-GedcomX arm records
        nothing in production, so attesting on it would let a unit run satisfy
        a gate production would refuse;
      * matched fixtures only -- a `fixture_not_found` response is not a score;
      * `buildRecordedScore` returns None when the assertion has no record side,
        and `recordMatchScore` no-ops when persona id and role are both empty,
        so both cases simply write nothing and the caller stays silent.

    Returns `(attested, parties)`: whether an attestation was written, and the
    `recordPersona`/`treePerson` the documents give for this call (None when
    there are none, or the tree could not be read: that costs the overlay only,
    never the attestation). Never raises: a harness that fails the run over its
    own bookkeeping is worse than one that does not attest, and the writer-side
    gate failing loudly is the signal we want.
    """
    score = response.get("score")
    if not isinstance(score, (int, float)):
        return False, None
    assertion_id = args.get("assertionId")
    tree_person_id = args.get("treePersonId")
    if not isinstance(assertion_id, str) or not isinstance(tree_person_id, str):
        # Explicit two-document arm, or a malformed call. Correctness here does
        # not depend on this line -- `buildRecordedScore` returns null for an
        # absent assertion, so the write would not happen anyway (confirmed by
        # mutation: removing this changes no test). It is an early-out that
        # avoids spawning a node process per two-document call.
        return False, None

    sp_js = _MCP_BUILD / "tools" / "same-person.js"
    ms_js = _MCP_BUILD / "utils" / "match-scores.js"
    pio_js = _MCP_BUILD / "utils" / "project-io.js"
    if not (sp_js.exists() and ms_js.exists() and pio_js.exists()):
        return False, None

    _url = _node_module_url

    payload = {
        "projectPath": str(workspace).replace("\\", "/"),
        "assertionId": assertion_id,
        "treePersonId": tree_person_id,
        "role": args.get("recordRole"),
        "recordPersonaId": args.get("recordPersonaId"),
        "result": {
            "score": score,
            "matched": bool(response.get("matched")),
            **({"confidence": response["confidence"]}
               if isinstance(response.get("confidence"), (int, float)) else {}),
        },
    }
    # `recordMatchScore` is read-modify-write and its docstring requires the
    # caller to hold the project lock. Production takes it in
    # `samePersonFromProject`; mirroring that here keeps the mock's side effect
    # the same operation rather than a near-copy of it.
    script = (
        f"import {{ buildRecordedScore, describeScoredPair }} from '{_url(sp_js)}';"
        f"import {{ recordMatchScore }} from '{_url(ms_js)}';"
        f"import {{ readProjectJson, withProjectLock }} from '{_url(pio_js)}';"
        "let raw='';for await (const c of process.stdin) raw+=c;"
        "const i=JSON.parse(raw);"
        "const research=await readProjectJson(i.projectPath,'research.json');"
        "const rec=buildRecordedScore(research,i.assertionId,i.treePersonId,"
        "  i.role ?? undefined,i.result,i.recordPersonaId ?? undefined);"
        "if (rec!==null) await withProjectLock(i.projectPath, async () => {"
        "  await recordMatchScore(i.projectPath,rec); });"
        "let parties=null;"
        "try { const tree=await readProjectJson(i.projectPath,'tree.gedcomx.json');"
        "  parties=describeScoredPair(research,tree,i.assertionId,i.treePersonId,"
        "    i.role ?? undefined,i.recordPersonaId ?? undefined); } catch {}"
        "process.stdout.write(JSON.stringify({wrote: rec!==null, parties}));"
    )
    try:
        proc = _run_node_eval(
            script, input_str=json.dumps(payload), timeout=NODE_EVAL_TIMEOUT_LONG
        )
        if proc.returncode != 0:
            return False, None
        out = json.loads(proc.stdout or "{}")
        return bool(out.get("wrote")), out.get("parties")
    except subprocess.TimeoutExpired:
        # Never raises, by contract -- but a swallowed timeout is indistinguishable
        # from "no score", and the writer-side gate turns that into a refusal of a
        # legitimate write halfway through a run. Say so rather than let the
        # operator debug a refusal with no cause.
        warnings.warn(
            f"same_person attestation timed out after {NODE_EVAL_TIMEOUT_LONG}s "
            f"for assertion {assertion_id}; the link will be refused as unattested",
            stacklevel=2,
        )
        return False, None
    except Exception:
        return False, None


def _overlay_parties(
    response: dict[str, Any], parties: dict[str, Any] | None
) -> dict[str, Any]:
    """The served response with `recordPersona` and `treePerson` naming THIS
    call's pairing.

    A fixture whose predicate is `~` serves every pairing its test makes, so the
    persona it was recorded with is wrong for all but one of them, and the agent
    reads that persona as the one the score is about. `parties` is what the
    compiled `describeScoredPair` derives from the workspace's own documents.

    The fixture's value is kept only when nothing the documents DO say
    contradicts it. A field the documents cannot supply (a persona id the record
    never gave, a name no assertion carries) is empty in `parties`, and an empty
    field contradicts nothing, so the pairing the fixture was written for keeps
    its name; a call for another role has a role of its own that does
    contradict, so it is never handed this fixture's persona. The record persona
    and the tree person are judged separately.
    """
    if not parties:
        return response
    out = dict(response)
    for key in ("recordPersona", "treePerson"):
        derived, recorded = parties.get(key), response.get(key)
        if not isinstance(derived, dict):
            continue
        agrees = isinstance(recorded, dict) and all(
            value in (None, "") or value == recorded.get(field)
            for field, value in derived.items()
        )
        out[key] = recorded if agrees else derived
    return out


def _stage_and_compact_search_results(
    workspace: Path,
    tool_name: str,
    response: dict[str, Any],
    ranked: dict[str, Any] | None = None,
    *,
    args: dict[str, Any] | None = None,
) -> tuple[
    dict[str, Any] | None,
    dict[str, Any],
    list[dict[str, Any]],
    dict[str, Any] | None,
]:
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

    The fourth element is the `ranked` block as production leaves it. Under the
    #1212 ruling (2026-09-15) the rows are ANNOTATED IN PLACE with the match
    score and returned best first, and `ranked` keeps metadata only — one row
    list, never two — so what comes back here is `ranked` with `matches` already
    removed. There is no drop flag: the earlier shape returned one and it was
    always False, which read as a decision the mock was still making.

    `ranked` is passed IN so the annotation runs through the compiled
    `annotateResultsWithRanking` inside the process already running: a second
    node process per search is the cost #2025 warns about, and a Python
    restatement of the shaping is what eval/CLAUDE.md forbids.

    `args` (the call's own arguments) lets the same process compute
    `surnameVariantHints` over the shaped response and its `ranked` block; the
    hint comes back INSIDE `response`, so the arity stays four. On this path it
    can only fire on `ranked.subjectResolvable === false`, which needs a staged
    response — so returning the untouched response when staging fails loses no
    hint production would have sent.
    """
    stager_js = _MCP_BUILD / "utils" / "results-staging.js"
    compactor_js = _MCP_BUILD / "utils" / "staged-compaction.js"
    if not stager_js.exists():
        return None, response, [], ranked

    _url = _node_module_url

    compactor = _STAGED_COMPACTORS.get(tool_name)
    if compactor and compactor_js.exists():
        compact_import = f"import {{ {compactor} }} from '{_url(compactor_js)}';"
        compact_call = f" if (r) {compactor}(input.response);"
    else:
        compact_import = ""
        compact_call = ""

    if ranked is not None and compactor_js.exists():
        compact_import += (
            "import { annotateResultsWithRanking }"
            f" from '{_url(compactor_js)}';"
        )
        # Production annotates the search rows with the ranking and returns them
        # best first (#1212 ruling, 2026-09-15). The mock runs the SAME compiled
        # function so the agent sees production's shape — one row list, scored
        # and ordered — rather than a hand-written approximation of it. There is
        # no longer a drop decision to probe: `results` is always present.
        annotate = (
            " let rankedOut = input.ranked;"
            " if (r && input.ranked) {"
            "   const shaped = { ...input.response, ranked: input.ranked };"
            "   annotateResultsWithRanking(shaped);"
            "   input.response.results = shaped.results;"
            "   rankedOut = shaped.ranked;"
            " }"
        )
    else:
        annotate = " const rankedOut = input.ranked;"

    if args is not None and tool_name == "record_search" and _surname_hints_module_present():
        compact_import += (
            f"import {{ surnameVariantHints }} from '{_url(_SURNAME_HINTS_JS)}';"
        )
        hint = (
            " const surnameHint = r ? (surnameVariantHints(input.args,"
            " { ...input.response, ranked: rankedOut }) ?? null) : null;"
        )
    else:
        hint = " const surnameHint = null;"

    input_obj = {
        "projectPath": str(workspace).replace("\\", "/"),
        "tool": tool_name,
        "response": response,
        "ranked": ranked,
        "args": args,
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
        # Production's own annotation, run on a throwaway copy carrying the
        # `ranked` this call will fold in. The ANNOTATED ROWS cross back, which
        # is the whole output now -- there is no drop verdict any more.
        f"{annotate}"
        f"{hint}"
        " process.stdout.write(JSON.stringify({ staged: r, unlogged, response: input.response,"
        " ranked: rankedOut, surnameHint }));"
    )
    try:
        proc = _run_node_eval(script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
        out = proc.stdout.strip()
        if not out:
            warnings.warn(f"mock search staging printed nothing: {proc.stderr[:300]}", stacklevel=2)
            return None, response, [], ranked
        parsed = json.loads(out)
        unlogged = parsed.get("unlogged") or []
        staged = parsed.get("staged")  # StagedHandle, or null -> None
        if staged is None:
            return None, response, unlogged, ranked
        shaped = parsed.get("response", response)
        if parsed.get("surnameHint"):
            shaped = {**shaped, SURNAME_VARIANT_HINTS_KEY: parsed["surnameHint"]}
        return (
            staged,
            shaped,
            unlogged,
            parsed.get("ranked", ranked),
        )
    except Exception as exc:
        # Four values, like every other return here and like the caller's unpack.
        # This arm exists to ABSORB a node failure, and its own recorded failure
        # was a MISCOUNT: it once returned six against an unpack of five, which
        # turned every node timeout into `ValueError: too many values to unpack`
        # and made the degrade path itself the crash. Flagged 2026-09-11 and
        # unexercised until test_stage_and_compact_degrades_on_node_failure,
        # which asserts the arity rather than trusting it.
        warnings.warn(f"mock search staging/compaction failed in node ({exc})", stacklevel=2)
        return None, response, [], ranked


def _stage_record_read(
    workspace: Path, args: dict[str, Any], response: dict[str, Any]
) -> dict[str, Any]:
    """Stage a canned live `record_read` the way `record-read.ts` does, and
    return the response with `staged` beside the record.

    The payload is production's: `{ query: { recordId }, results: [{ recordId,
    gedcomx, indexFields? }] }` under tool `record_read`. It goes through the
    same compiled `stageSearchResults` the search tools use. A fixture may carry
    `indexFields` beside the GedcomX (a captured `record_read` sidecar does);
    it is staged and kept off the inline response, which production never
    returns it on. On a node failure the read comes back with `staged: null`
    and a `stagingError`, matching production's best-effort staging.
    """
    record_id = str(args.get("recordId") or "").strip()
    gedcomx = {k: v for k, v in response.items() if k not in ("indexFields", "staged", "imageArk")}
    element: dict[str, Any] = {"recordId": record_id, "gedcomx": gedcomx}
    index_fields = response.get("indexFields")
    if isinstance(index_fields, dict) and index_fields:
        element["indexFields"] = index_fields
    payload = {"query": {"recordId": record_id}, "results": [element]}
    staged, _payload, _unlogged, _ranked = _stage_and_compact_search_results(
        workspace, "record_read", payload
    )
    inline = {k: v for k, v in response.items() if k != "indexFields"}
    if staged is None:
        return {**inline, "staged": None, "stagingError": "mock: staging the canned record failed"}
    return {**inline, "staged": staged}


#: The compiled function that drops `image_transcribe`'s inline text once the
#: page is staged. Not in `_STAGED_COMPACTORS`: it takes the whole response,
#: where those take the `{results}` payload `_stage_and_compact_search_results`
#: hands them.
_IMAGE_TRANSCRIBE_COMPACTOR = "compactStagedImageTranscribe"

#: The `image_transcribe` arguments production stages as the element's `source`.
_IMAGE_TRANSCRIBE_SOURCE_KEYS = ("imageId", "ark", "memoryArtifactUrl", "file")


def _stage_image_transcribe(
    workspace: Path, args: dict[str, Any], response: dict[str, Any]
) -> dict[str, Any]:
    """Stage a canned `image_transcribe` page the way `image-transcribe.ts` does
    (#2490), and return the response production sends: `staged` and `digest`
    beside it and the inline `transcription` dropped.

    The payload is production's one-element `{ query, results }` under tool
    `image_transcribe`; the element's `id` is the `capture:<basename>` of a
    `file`, else the image the caller named. Staging, the digest excerpt and the
    strip all run in ONE node process, through the compiled `stageSearchResults`
    and `compactStagedImageTranscribe`, so the strip has one definition. A
    staging throw keeps the text inline with `staged: null` and `stagingError`,
    as production does; a node failure returns the same shape, with a warning.
    """
    stager_js = _MCP_BUILD / "utils" / "results-staging.js"
    compactor_js = _MCP_BUILD / "utils" / "staged-compaction.js"
    # Production folds record_read's `imageArk` into `ark` (foldImageArkInput):
    # a blank `ark` counts as absent, and a blank alias is ignored.
    alias, ark = args.get("imageArk"), args.get("ark")
    if not (isinstance(ark, str) and ark.strip()) and isinstance(alias, str) and alias.strip():
        args = {**{k: v for k, v in args.items() if k != "imageArk"}, "ark": alias}
    source = {k: args[k] for k in _IMAGE_TRANSCRIBE_SOURCE_KEYS if args.get(k) is not None}
    if isinstance(args.get("file"), str):
        element_id = "capture:" + re.sub(r"\.[A-Za-z0-9]+$", "", args["file"].split("/")[-1])
    else:
        element_id = next((str(v) for v in source.values()), "")
    metadata = response.get("metadata") if isinstance(response.get("metadata"), dict) else {}
    transcription = str(response.get("transcription") or "")
    element: dict[str, Any] = {
        "id": element_id,
        "source": source,
        "content_type": metadata.get("contentType", "image/jpeg"),
        "size_bytes": metadata.get("sizeBytes", 0),
        "model": metadata.get("model", ""),
        "transcription": transcription,
    }
    if response.get("truncated"):
        element["truncated"] = True
    if response.get("found"):
        element["found"] = response["found"]
    # Production stages the retained scan's imageRef beside the text, and
    # extraction_append cites it as the source's image_filename.
    if isinstance(response.get("imageRef"), str) and response["imageRef"]:
        element["image_ref"] = response["imageRef"]
    query = {**source, **({"lookingFor": args["lookingFor"]} if args.get("lookingFor") else {})}

    def _unstaged(why: str) -> dict[str, Any]:
        warnings.warn(f"mock image_transcribe could not be staged ({why})", stacklevel=3)
        return {**response, "staged": None, "stagingError": f"mock: staging the canned page failed ({why})"}

    if not (stager_js.exists() and compactor_js.exists()):
        return _unstaged(f"no engine build at {_MCP_BUILD}")

    script = (
        f"import {{ stageSearchResults }} from '{_node_module_url(stager_js)}';"
        f" import {{ {_IMAGE_TRANSCRIBE_COMPACTOR} }} from '{_node_module_url(compactor_js)}';"
        " import { readFileSync } from 'node:fs';"
        " const input = JSON.parse(readFileSync(0, 'utf-8'));"
        " const el = input.element;"
        " let staged; let stagingError;"
        " try { staged = await stageSearchResults({ projectPath: input.projectPath,"
        " tool: 'image_transcribe', response: { query: input.query, results: [el] } }); }"
        " catch (e) { staged = null; stagingError = String(e?.message ?? e); }"
        " const digest = { id: el.id, chars: el.transcription.length,"
        " excerpt: el.transcription.slice(0, 300),"
        " ...(el.found ? { found: el.found } : {}), ...(el.truncated ? { truncated: true } : {}) };"
        " const { metadata, ...rest } = input.response;"
        " const out = { ...rest, staged, ...(stagingError !== undefined ? { stagingError } : {}),"
        " digest, ...(metadata !== undefined ? { metadata } : {}) };"
        f" {_IMAGE_TRANSCRIBE_COMPACTOR}(out);"
        " process.stdout.write(JSON.stringify(out));"
    )
    input_obj = {
        "projectPath": str(workspace).replace("\\", "/"),
        "element": element,
        "query": query,
        "response": response,
    }
    try:
        proc = _run_node_eval(script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
        out = proc.stdout.strip()
        if proc.returncode != 0 or not out:
            return _unstaged(f"node exited {proc.returncode}: {proc.stderr.strip()[:200]}")
        parsed = json.loads(out)
        if not isinstance(parsed, dict) or "staged" not in parsed:
            return _unstaged("the node script returned no `staged` key")
        return parsed
    except Exception as exc:  # noqa: BLE001 — a harness fault degrades, never fails the call
        return _unstaged(f"{type(exc).__name__}: {exc}")


def _unlogged_staged_handles(
    workspace: Path,
    *,
    args: dict[str, Any] | None = None,
    response: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """The staged backlog for a call that stages nothing (a nil search), and —
    when `args` is given (a record_search) — its `surnameVariantHints`.

    Runs the compiled `unloggedStagedSearches` on its own. That is one node
    process where a nil search currently spawns none, so the per-call subprocess
    count does not rise — the concern behind #2025 was a SECOND process per call,
    not a first; the hint rides in the same process for the same reason. Returns
    `([], None)` on any failure, with a warning; both halves are advisory.
    """
    stager_js = _MCP_BUILD / "utils" / "results-staging.js"
    if not stager_js.exists():
        return [], None

    with_hint = args is not None and _surname_hints_module_present()
    script = (
        f"import {{ unloggedStagedSearches }} from '{_node_module_url(stager_js)}';"
        + (
            f" import {{ surnameVariantHints }} from '{_node_module_url(_SURNAME_HINTS_JS)}';"
            if with_hint
            else ""
        )
        + " import { readFileSync } from 'node:fs';"
        " const input = JSON.parse(readFileSync(0, 'utf-8'));"
        " process.stdout.write(JSON.stringify({"
        " unlogged: await unloggedStagedSearches(input.projectPath),"
        + (
            " surnameHint: surnameVariantHints(input.args, input.response) ?? null"
            if with_hint
            else " surnameHint: null"
        )
        + " }));"
    )
    try:
        proc = _run_node_eval(
            script,
            json.dumps({
                "projectPath": str(workspace).replace("\\", "/"),
                "args": args,
                "response": response or {},
            }),
            timeout=NODE_EVAL_TIMEOUT_LONG,
        )
        out = proc.stdout.strip()
        if not out:
            warnings.warn(f"mock nil-search node call printed nothing: {proc.stderr[:300]}", stacklevel=2)
            return [], None
        parsed = json.loads(out)
        return list(parsed.get("unlogged") or []), parsed.get("surnameHint")
    except Exception as exc:  # noqa: BLE001 — advisory, never fails the call
        warnings.warn(f"mock nil-search node call failed ({exc})", stacklevel=2)
        return [], None


#: Fixture-backed tools that read a staged/finalized sidecar by ref in
#: production, and the argument that carries the ref.
STAGED_REF_READERS: dict[str, str] = {
    "record_read": "resultsRef",
    "rank_search_matches": "stagedResultsRef",
}


def _readable_sidecar(workspace: Path, ref: str) -> bool:
    """True when `ref` names, exactly, a sidecar `readStagedResults` reads as is:
    a file under `results/.staging/` or a top-level `results/*.json`, whose
    `payload.results` is a list. Anything else goes to the compiled check."""
    root = workspace.resolve()
    path = Path(ref)
    path = (path if path.is_absolute() else root / path).resolve()
    results = root / "results"
    if not (path.is_relative_to(results / ".staging")
            or (path.parent == results and path.suffix == ".json")):
        return False
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    payload = envelope.get("payload") if isinstance(envelope, dict) else None
    return isinstance(payload, dict) and isinstance(payload.get("results"), list)


def _staged_ref_error(workspace: Path, tool: str, args: dict[str, Any]) -> str | None:
    """Production's refusal of a staged ref the workspace does not hold, or None.

    A fixture answers `record_read` and `rank_search_matches` whatever ref they
    carry, so a mis-copied ref used to read as a success here and a refusal in
    production (one silent slip in `search-records` v2, among 104 unchecked
    calls). The ref is checked by the COMPILED `readStagedResults` -- the same
    read, near-copy resolution and refusal production runs -- so the rule has
    one definition. None when the call carries no ref, or when node or the
    build is unavailable: a harness fault must not read as a bad ref.
    """
    field = STAGED_REF_READERS.get(tool)
    ref = args.get(field) if field else None
    if not isinstance(ref, str) or not ref.strip():
        return None
    if _readable_sidecar(workspace, ref):
        return None
    staging_js = _MCP_BUILD / "utils" / "results-staging.js"
    if not staging_js.exists():
        return None
    url = _node_module_url(staging_js)
    script = (
        f"import {{ readStagedResults }} from '{url}';"
        " import { readFileSync } from 'node:fs';"
        " const { projectPath, ref } = JSON.parse(readFileSync(0, 'utf-8'));"
        " try { await readStagedResults(projectPath, ref); process.stdout.write(JSON.stringify({ ok: true })); }"
        " catch (e) { process.stdout.write(JSON.stringify({ ok: false, message: String(e?.message ?? e) })); }"
    )
    payload = {"projectPath": str(workspace).replace("\\", "/"), "ref": ref}
    try:
        proc = _run_node_eval(script, json.dumps(payload), timeout=NODE_EVAL_TIMEOUT_LONG)
        out = json.loads(proc.stdout.strip()) if proc.stdout.strip() else None
    except Exception:
        return None
    if not isinstance(out, dict) or out.get("ok") is not False:
        return None
    return str(out.get("message") or f"{field} could not be read")


def _stage_person_read(
    workspace: Path, args: dict[str, Any], response: dict[str, Any]
) -> dict[str, Any]:
    """Stage a canned `person_read` response the way the real tool does (#2944).

    Production stages every `person_read` given a `projectPath` and returns
    `staged` (plus `stagingError` when staging failed). The envelope is built by
    the COMPILED `stagePersonRead`, so its shape has one definition, in
    person-read.ts. No `resolvedId` is passed: a fixture has no merge redirect,
    and the export defaults it to the requested id.

    Returns the response with the staging keys merged in, or the response
    untouched when node is unavailable or fails: a harness fault is not a
    production staging failure, so it must not surface as `stagingError`.
    """
    person_read_js = _MCP_BUILD / "tools" / "person-read.js"
    if not person_read_js.exists():
        _warn_unstaged(f"no engine build at {person_read_js}")
        return response

    url = _node_module_url(person_read_js)
    script = (
        f"import {{ stagePersonRead }} from '{url}';"
        " import { readFileSync } from 'node:fs';"
        " const input = JSON.parse(readFileSync(0, 'utf-8'));"
        " process.stdout.write(JSON.stringify(await stagePersonRead(input)));"
    )
    input_obj = {
        "projectPath": str(workspace).replace("\\", "/"),
        "input": {
            k: args[k]
            for k in ("personId", "relatives", "sourceDescriptions")
            if k in args
        },
        "result": response,
    }
    try:
        proc = _run_node_eval(
            script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG
        )
        out = proc.stdout.strip()
        if proc.returncode != 0 or not out:
            _warn_unstaged(f"node exited {proc.returncode}: {proc.stderr.strip()[:200]}")
            return response
        parsed = json.loads(out)
        if not isinstance(parsed, dict) or "staged" not in parsed:
            _warn_unstaged("the stager returned no `staged` key")
            return response
        # Staging keys first, as the real tool returns them (#3384): an
        # over-limit result reaches the model as a preview of its head.
        return {**parsed, **{k: v for k, v in response.items() if k not in parsed}}
    except Exception as e:
        _warn_unstaged(f"{type(e).__name__}: {e}")
        return response


def _store_external_collections(
    workspace: Path,
    args: dict[str, Any],
    response: dict[str, Any],
    stored_rows: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Write external-collections.json the way the real `external_links_search` does.

    Runs the COMPILED `dedupeCollections` + `recordExternalCollections`, so the
    file's shape and bytes have one definition, in external-collections-store.ts.
    The rows are the fixture's never-served `stored_rows` (raw API rows carrying
    record_type and place) or, absent those, its inline `results[]`; a row with no
    `place` is filed under the queried place, as production does. Adds `stored`
    (or `collectionsError` for a non-project folder) as production does. A harness
    fault returns the response untouched and warns: it is not a production error.
    """
    store_js = _MCP_BUILD / "utils" / "external-collections-store.js"
    if not store_js.exists():
        warnings.warn(f"mock external_links_search could not store its list: no engine build at {store_js}", stacklevel=2)
        return response
    rows = stored_rows if stored_rows is not None else [
        {"url": r.get("url"), "linkText": r.get("linkText", "")}
        for r in response.get("results") or []
        if isinstance(r, dict) and isinstance(r.get("url"), str)
    ]
    posix = str(store_js).replace("\\", "/").replace("'", "\\'")
    url = ("file:///" + posix) if sys.platform == "win32" else posix
    script = (
        f"import {{ dedupeCollections, recordExternalCollections, EXTERNAL_COLLECTIONS_FILE }} from '{url}';"
        " import { readFileSync } from 'node:fs';"
        " const i = JSON.parse(readFileSync(0, 'utf-8'));"
        " const rows = dedupeCollections(i.rows.filter((r) => typeof r.url === 'string'), i.place);"
        " const places = await recordExternalCollections(i.projectPath, i.place, rows);"
        " process.stdout.write(JSON.stringify(places === null ? null : { file: EXTERNAL_COLLECTIONS_FILE, places }));"
    )
    input_obj = {
        "projectPath": str(workspace).replace("\\", "/"),
        "place": args.get("standardPlace", ""),
        "rows": rows,
    }
    try:
        proc = _run_node_eval(script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
        out = proc.stdout.strip()
        if proc.returncode != 0 or not out:
            warnings.warn(
                f"mock external_links_search could not store its list: node exited "
                f"{proc.returncode}: {proc.stderr.strip()[:200]}",
                stacklevel=2,
            )
            return response
        stored = json.loads(out)
    except Exception as e:
        warnings.warn(f"mock external_links_search could not store its list: {type(e).__name__}: {e}", stacklevel=2)
        return response
    if stored is None:
        return {
            **response,
            "collectionsError": (
                "Nothing was stored: projectPath does not name a project folder (one holding "
                "research.json or tree.gedcomx.json)."
            ),
        }
    return {**response, "stored": stored}


def _warn_unstaged(why: str) -> None:
    """A canned person_read the mock could not stage. init-project now passes
    the staged ref to project_create and stops when there is none, so this reads
    as the skill stopping. Say it was the harness (#2944 Stage B)."""
    warnings.warn(
        f"mock person_read could not be staged ({why}); the response goes back with no "
        "`staged`, so a skill that needs the ref will stop for a harness reason",
        stacklevel=2,
    )


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
        if tool_name == "person_quality":
            continue  # served by _make_person_quality_handler below
        predicated = list(bucket["predicated"])
        is_error_flags = list(bucket.get("is_error") or [False] * len(predicated))
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

        stored_rows_by_source = dict(bucket.get("stored_rows") or {})

        # Capture loop variables via default args so closures bind by value.
        async def handler(
            args,
            _predicated=predicated,
            _is_error=is_error_flags,
            _name=tool_name,
            _workspace=workspace,
            _rank_predicated=rank_predicated,
            _stored_rows=stored_rows_by_source,
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
            ref_error = (
                _staged_ref_error(_workspace, _name, args) if _workspace is not None else None
            )
            if ref_error is not None:
                entry["matched"] = {"kind": "staged_ref_refused", "index": None}
                response = {"error": "staged_ref_not_found", "tool": _name, "message": ref_error}
            for i, (predicate, resp, src) in enumerate(_predicated if ref_error is None else []):
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

            # Write the attestation a real same_person call would have left.
            # Fixture-backed tool, real side effect -- same reason the search
            # tools stage their sidecar below.
            if (
                _name == "same_person"
                and _workspace is not None
                and "error" not in response
            ):
                entry["attested"], parties = _record_match_score(_workspace, args, response)
                response = _overlay_parties(response, parties)

            # Production's external_links_search stores the place's full list in
            # external-collections.json whenever it is given a projectPath (#2995).
            if (
                _name == "external_links_search"
                and _workspace is not None
                and "error" not in response
                and isinstance(args.get("projectPath"), str)
                and args["projectPath"].strip()
            ):
                response = _store_external_collections(
                    _workspace, args, response, _stored_rows.get(source_name)
                )

            # Production's person_read stages its result whenever it is given a
            # projectPath (#2944), with the same trimmed gate.
            if (
                _name == "person_read"
                and _workspace is not None
                and "error" not in response
                and isinstance(args.get("projectPath"), str)
                and args["projectPath"].strip()
            ):
                response = _stage_person_read(_workspace, args, response)

            # Production's record_search and fulltext_search return (and stage)
            # `query: echoQuery(input)` — every argument the call sent — while a
            # fixture carries whatever query it was recorded with, and a
            # predicate matches only a subset of the args. Echo the args, so the
            # staged payload is the ground truth research_log_append checks an
            # explicit query against, and the query it defaults from.
            if (
                _name in ECHOING_SEARCH_TOOLS
                and isinstance(response, dict)
                and "error" not in response
            ):
                response = {**response, "query": echo_query(args)}

            # Stage the canned payload for search tools so the live
            # research_log_append can finalize the sidecar (mirrors the real
            # tool returning staged.resultsRef), then apply the compaction the
            # real tool applies to its inline results once staged — both by
            # calling the compiled build, so the agent is graded on the shape
            # production actually sends. Only when projectPath was passed and
            # results came back; nil searches retain nothing and compact nothing.
            # Resolved BEFORE staging so the single node process below can run
            # production's own `annotateResultsWithRanking` over the staged rows
            # in the same process. Only the match depends on `args`, so moving it
            # earlier changes nothing about which fixture is chosen.
            _rank_resp: dict[str, Any] | None = None
            if _name == "record_search" and args.get("subjectId") and "error" not in response:
                for predicate, _candidate_rank, _src in _rank_predicated:
                    if matches(predicate, args):
                        _rank_resp = _candidate_rank
                        break

            if (
                _name in STAGING_SEARCH_TOOLS
                and _workspace is not None
                and "error" not in response
                and args.get("projectPath")
                and isinstance(response.get("results"), list)
                and response.get("results")
            ):
                (
                    staged,
                    response,
                    _unlogged_staged,
                    _rank_resp,
                ) = _stage_and_compact_search_results(
                    _workspace, _name, response, ranked=_rank_resp, args=dict(args)
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
                # The same process computes record_search's surnameVariantHints.
                _unlogged_staged, _surname_hint = _unlogged_staged_handles(
                    _workspace,
                    args=dict(args) if _name == "record_search" else None,
                    response=response,
                )
                if _surname_hint:
                    response = {**response, SURNAME_VARIANT_HINTS_KEY: _surname_hint}
            else:
                _unlogged_staged = []
                # A nil record_search with no projectPath spawns no process
                # otherwise; it gets one only when there is a nil to hint on.
                if (
                    _name == "record_search"
                    and isinstance(response, dict)
                    and "error" not in response
                    and _fixture_is_nil(response)
                ):
                    _surname_hint = _surname_variant_hints(dict(args), response)
                    if _surname_hint:
                        response = {**response, SURNAME_VARIANT_HINTS_KEY: _surname_hint}

            # A LIVE record_read given a projectPath stages the record and returns
            # `staged.resultsRef` beside it, and extraction_append's extractor mode
            # reads that sidecar. Without this the canned read staged nothing, the
            # extractor refused ("no results sidecar"), and every FamilySearch
            # record in the unit suite fell back to record-extractor, so no
            # committed run could exercise the code path. A read WITH `resultsRef`
            # is a sidecar read and stages nothing, exactly as production.
            if (
                _name == "record_read"
                and _workspace is not None
                and "error" not in response
                and args.get("projectPath")
                and not args.get("resultsRef")
                and isinstance(response.get("persons"), list)
            ):
                response = _stage_record_read(_workspace, args, response)

            # Production's image_transcribe stages the page and returns its ref,
            # not the text (#2490): `staged` + `digest`, `transcription` dropped.
            # The fixture keeps the full page; this is what production sends.
            # A call with no projectPath is refused before any OCR in production,
            # so it must not come back with the fixture's page.
            _refused_no_project = (
                _name == "image_transcribe"
                and "error" not in response
                and not args.get("projectPath")
            )
            if _refused_no_project:
                response = {"error": IMAGE_TRANSCRIBE_NEEDS_PROJECT_MESSAGE}
            elif (
                _name == "image_transcribe"
                and _workspace is not None
                and "error" not in response
                and args.get("projectPath")
                and isinstance(response.get("transcription"), str)
            ):
                response = _stage_image_transcribe(_workspace, args, response)

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
                and _rank_resp is not None
            ):
                # `ranked` carries metadata only; the rows it was scored from
                # are already ANNOTATED on `response["results"]` and ordered best
                # first by the compiled `annotateResultsWithRanking` run above —
                # not by a condition restated here, because a mock that shapes
                # rows itself grades triage against a shape production never
                # sends. `results` is never dropped: there is one row list.
                response = {**response, "ranked": _rank_resp}

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
            # inserted in the same pre-`results` slot. Both staging tools carry
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

            # Production serializes surnameVariantHints immediately before
            # `results`, after the pre-`results` notes above — placed last so
            # the order matches.
            if isinstance(response, dict) and SURNAME_VARIANT_HINTS_KEY in response:
                response = _place_before_results(response, SURNAME_VARIANT_HINTS_KEY)

            entry["response"] = response
            entry["response_fixture"] = source_name
            call_log.append(entry)
            envelope: dict[str, Any] = {
                "content": [
                    {"type": "text", "text": json.dumps(response)},
                ],
            }
            # A fixture marked `is_error` stands for a THROWN tool error, which
            # production's catch arms return with `isError: true` beside `{error}`.
            if entry["matched"]["kind"] == "predicate" and _is_error[entry["matched"]["index"]]:
                envelope["is_error"] = True
            if _refused_no_project:
                envelope["is_error"] = True
            return envelope

        # Prefer the production description; fall back to a generic stub
        # if the tool is not in the catalog (e.g., aspirational tools
        # like `fulltext_search` that have fixtures but no .ts source yet).
        description = tool_descriptions.get(
            tool_name, f"Mock {tool_name} — fixture-backed."
        )
        decorated = tool(tool_name, description, input_schema)(handler)
        tools.append(decorated)

    # --- Live tools ---------------------------------------------------------
    # Each live tool calls the real implementation rather than matching a
    # fixture predicate.
    #
    # A tool the TEST declared a fixture for keeps its canned response and is
    # skipped here. Registering both would define the same tool name twice and
    # the second would shadow the first. Two tools are in both sets today:
    # `person_warnings`, which the check-warnings suite drives from tuned
    # fixtures covering specific tag combinations while every other suite wants
    # the real computation over its own workspace tree, and `project_list`, whose
    # hosted answers the research suite serves from fixtures. Ordering matters and is the
    # reason this is a skip rather than a precedence rule -- fixtures are
    # registered above, so the test's own declaration wins.
    fixture_backed = set(manifest.keys())
    for live_tool_name in sorted(LIVE_TOOLS - fixture_backed - {"person_quality"}):
        live_handler = _make_live_handler(
            live_tool_name, workspace, call_log, manifest,
            place_predicated=list((manifest.get("place_search") or {}).get("predicated") or []),
        )
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

    # person_quality: one handler whether or not the test declared fixtures — it
    # needs both the real resolution step and the test's fixtures keyed on the
    # FamilySearch id that step finds.
    pq_handler = _make_person_quality_handler(
        workspace,
        call_log,
        list((manifest.get("person_quality") or {}).get("predicated") or []),
    )
    tools.append(
        tool(
            "person_quality",
            tool_descriptions.get("person_quality", "person_quality — resolves then scores."),
            (build_catalog.get("person_quality") or {}).get("inputSchema") or _PERMISSIVE_SCHEMA,
        )(pq_handler)
    )

    server = create_sdk_mcp_server(name="genealogy", version="1.0.0", tools=tools)
    tools_by_name = {t.name: t for t in tools}
    return server, call_log, tools_by_name


#: Tools served by `_make_compiled_tool_handler`: tool name -> (compiled file
#: under build/tools/, exported function). The generic handler injects the
#: workspace as `projectPath`; a tool that reads no projectPath
#: (convert_calendar) ignores the inert extra key. A tool whose projectPath is
#: OPTIONAL is in `_OPTIONAL_PROJECT_PATH_TOOLS` instead and is only rebased.
#: extraction_append's lane restriction (issue #695) lives inside its export,
#: so calling it directly here — bypassing index.ts — still enforces the lane.
_COMPILED_TOOLS: dict[str, tuple[str, str]] = {
    "tree_edit": ("tree-edit.js", "treeEdit"),
    "tree_correct": ("tree-correct.js", "treeCorrect"),
    "materialize_facts": ("materialize-facts.js", "materializeFacts"),
    "merge_warnings": ("merge-warnings.js", "mergeWarnings"),
    "merge_tree_persons": ("merge-tree-persons.js", "mergeTreePersons"),
    "person_warnings": ("person-warnings.js", "personWarningsTool"),
    "project_context": ("project-context.js", "projectContext"),
    "research_query": ("research-query.js", "researchQuery"),
    "tree_query": ("tree-query.js", "treeQuery"),
    "convert_calendar": ("convert-calendar.js", "convertCalendar"),
    "census_children_gap": ("census-children-gap.js", "censusChildrenGapTool"),
    "build_external_search_url": ("build-external-search-url.js", "buildExternalSearchUrlTool"),
    "sidecar_read": ("sidecar-read.js", "sidecarRead"),
    "get_name_variants": ("name-variants.js", "getNameVariants"),
    # Takes only `{summary}`; the handler's injected `projectPath` is the inert
    # extra key convert_calendar already tolerates.
    "research_delivered": ("research-delivered.js", "researchDelivered"),
    # Takes no input: called as `projectList(LOCAL)` (`_COMPILED_TOOLS_WITHOUT_INPUT`).
    "project_list": ("project-list.js", "projectList"),
}

#: Compiled tools whose `projectPath` is optional and changes what the call
#: does: given one, `build_external_search_url` also writes the in-flight
#: hand-off log entry. Production never supplies it on the model's behalf, so
#: injecting it here would make every run write an entry the agent never asked
#: for. These get the `person_quality` treatment: a projectPath the agent sent
#: is rebased onto the workspace, and none is added.
_OPTIONAL_PROJECT_PATH_TOOLS: frozenset[str] = frozenset({"build_external_search_url"})

#: Compiled tools whose exported function takes a `Principal` as its last
#: argument. CLAUDE.md requires every credential read to take one explicitly, so
#: a tool that gains a network path gains this parameter — and because the
#: handler script below is built from a Python f-string, no typechecker catches
#: the mismatch. A tool missing from this set calls with one argument and its
#: `principal` arrives `undefined`.
_COMPILED_TOOLS_WITH_PRINCIPAL: frozenset[str] = frozenset({"project_context", "project_list"})

#: Compiled tools that take no input, so the principal is their only argument.
_COMPILED_TOOLS_WITHOUT_INPUT: frozenset[str] = frozenset({"project_list"})

#: Extra JS arguments appended after `input` (and LOCAL) for a compiled tool.
#: `person_warnings` gets a place resolver that resolves nothing, so its
#: birthplace-distance check never makes a network call and never fires here
#: (lead ruling on issue #1962, 2026-09-27).
_COMPILED_TOOL_EXTRA_ARGS: dict[str, str] = {
    "person_warnings": "{ placeCoords: async () => null }",
}


def _make_live_handler(
    tool_name: str,
    workspace: Path | None,
    call_log: list[dict[str, Any]],
    manifest: dict[str, Any] | None = None,
    place_predicated: list | None = None,
):
    """Return an async handler for a live tool."""
    if tool_name == "extraction_append":
        return _make_extraction_append_handler(workspace, call_log, manifest or {})
    if tool_name == "project_create":
        return _make_project_create_handler(workspace, call_log, manifest or {}, place_predicated or [])
    if tool_name == "validate_research_schema":
        return _make_validate_handler(workspace, call_log)
    if tool_name == "research_log_append":
        return _make_log_append_handler(workspace, call_log)
    if tool_name == "research_append":
        return _make_research_append_handler(workspace, call_log)
    if tool_name == "timeline_build":
        return _make_timeline_build_handler(workspace, call_log, place_predicated or [])
    compiled = _COMPILED_TOOLS.get(tool_name)
    if compiled is not None:
        js_file, export_name = compiled
        return _make_compiled_tool_handler(tool_name, js_file, export_name, workspace, call_log)
    raise ValueError(f"No live handler defined for {tool_name!r}")


def _place_table(place_predicated: list, args: dict[str, Any]) -> dict[str, str | None]:
    """The place resolver's answers for one `project_create` call, from the test's
    own `place_search` fixtures.

    `project_create` standardizes every place the caller enters, and retries a
    read's unresolved ones, through the anonymous Places API. The harness stays
    offline, so the compiled resolver is given this table instead
    (`__usePlaceTableForTests`): each place in the call's `tree` argument (a
    staged read's places are not in it, so an unresolved one stays null), matched against
    the fixtures with the same `matches` a `place_search` call is, answered with
    the first result's `standardPlace`. A place no fixture matches resolves to
    null, as an unknown place does in production.
    """
    tree = args.get("tree") if isinstance(args.get("tree"), dict) else {}
    places: list[str] = []
    for holder in [*(tree.get("persons") or []), *(tree.get("relationships") or [])]:
        for fact in (holder.get("facts") if isinstance(holder, dict) else None) or []:
            if isinstance(fact, dict) and isinstance(fact.get("place"), str) and fact["place"].strip():
                places.append(fact["place"])
    table: dict[str, str | None] = {}
    for place in places:
        hit = next(
            (resp for (pred, resp, _src) in place_predicated if matches(pred, {"placeName": place})),
            None,
        )
        results = (hit or {}).get("results") or []
        first = results[0] if results and isinstance(results[0], dict) else {}
        table[place] = first.get("standardPlace") if isinstance(first.get("standardPlace"), str) else None
    return table


def _timeline_place_tables(
    workspace: Path, place_predicated: list
) -> tuple[dict[str, str | None], dict[str, dict[str, float] | None]]:
    """`timeline_build`'s Places answers, from the test's own `place_search`
    fixtures: each assertion `place` matched as a `placeName` (the first
    result's `standardPlace`), and coordinates for every standard place a
    fixture result names. `_place_table` cannot serve this — it reads places
    from the call's `tree` argument, and this tool takes only a person id."""
    research_path = workspace / "research.json"
    try:
        research = json.loads(research_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        research = {}
    places: set[str] = set()
    for a in research.get("assertions") or []:
        if isinstance(a, dict) and isinstance(a.get("place"), str) and a["place"].strip():
            places.add(a["place"])
    coords: dict[str, dict[str, float] | None] = {}
    for (_pred, resp, _src) in place_predicated:
        for result in (resp or {}).get("results") or []:
            if not isinstance(result, dict) or not isinstance(result.get("standardPlace"), str):
                continue
            lat, lon = result.get("latitude"), result.get("longitude")
            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                coords.setdefault(result["standardPlace"], {"latitude": lat, "longitude": lon})
    table: dict[str, str | None] = {}
    for place in places:
        hit = next(
            (resp for (pred, resp, _src) in place_predicated if matches(pred, {"placeName": place})),
            None,
        )
        results = (hit or {}).get("results") or []
        first = results[0] if results and isinstance(results[0], dict) else {}
        table[place] = first.get("standardPlace") if isinstance(first.get("standardPlace"), str) else None
    return table, coords


def _make_timeline_build_handler(
    workspace: Path | None,
    call_log: list[dict[str, Any]],
    place_predicated: list,
):
    """Build the live handler for timeline_build.

    Calls the compiled `timelineBuild` against the workspace with its Places
    lookups injected from the test's `place_search` fixtures
    (`_timeline_place_tables`), so the run stays offline. Census years come from
    the compiled census table, as in production. Everything else — events,
    conflicts, gaps, the write — is production's compiled code.
    """
    tool_js = _MCP_BUILD / "tools" / "timeline-build.js"

    async def handler(args, _ws=workspace, _tjs=tool_js):
        if _ws is None or not _tjs.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {_tjs}"
            response: dict[str, Any] = {"ok": False, "errors": [f"timeline_build: {reason}"]}
        else:
            input_obj = dict(args)
            input_obj["projectPath"] = str(_ws).replace("\\", "/")
            places, coords = _timeline_place_tables(_ws, place_predicated)
            script = (
                f"import {{ timelineBuild }} from '{_node_module_url(_tjs)}';"
                " import { readFileSync } from 'node:fs';"
                " const payload = JSON.parse(readFileSync(0, 'utf-8'));"
                " const deps = {"
                " resolvePlace: async (t) => payload.places[t] ?? null,"
                " placeCoords: async (s) => payload.coords[s] ?? null };"
                " const r = await timelineBuild(payload.input, deps);"
                " process.stdout.write(JSON.stringify(r));"
            )
            stdin_obj = {"input": input_obj, "places": places, "coords": coords}
            try:
                proc = _run_node_eval(script, json.dumps(stdin_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
                if proc.stdout.strip():
                    response = json.loads(proc.stdout)
                else:
                    stderr_msg = proc.stderr.strip()[:500] if proc.stderr else "no output"
                    response = {
                        "ok": False,
                        "errors": [f"timeline_build: node produced no output (exit {proc.returncode}): {stderr_msg}"],
                    }
            except Exception as e:
                response = {"ok": False, "errors": [f"timeline_build: {e}"]}

        call_log.append({
            "tool": "mcp__genealogy__timeline_build",
            "args": dict(args),
            "expected_args": None,
            "matched": {"kind": "live", "index": None},
            "response_fixture": "live:timeline_build",
            "response": response,
        })
        return _tool_envelope("timeline_build", response)

    return handler


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
            validator_url = _node_module_url(_vjs)
            script = (
                f"import {{ validateResearchSchema }} from '{validator_url}';"
                f" const r = await validateResearchSchema({{ projectPath: '{project_path}' }});"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, timeout=NODE_EVAL_TIMEOUT_LONG)
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
            append_url = _node_module_url(_ajs)

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
                proc = _run_node_eval(script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
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
            append_url = _node_module_url(_ajs)

            # Override projectPath with workspace; pipe the full input via
            # stdin so no value needs JS-string escaping.
            input_obj = dict(args)
            input_obj["projectPath"] = str(_ws).replace("\\", "/")

            script = (
                f"import {{ researchAppendFromCaller as researchAppend }} from '{append_url}';"
                " import { readFileSync } from 'node:fs';"
                " const input = JSON.parse(readFileSync(0, 'utf-8'));"
                " const r = await researchAppend(input);"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
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


PERSON_QUALITY_REFUSAL = (
    "person_quality: this person resolves to a FamilySearch id ({fsid}), and the "
    "unit harness does not contact FamilySearch. Declare a person-quality fixture "
    "keyed on that id."
)


def _make_person_quality_handler(
    workspace: Path | None,
    call_log: list[dict[str, Any]],
    predicated: list,
):
    """Build person_quality's handler.

    (a) Run the compiled tool's `resolvePersonQualityTarget` against the
    workspace tree — no network, no token, no principal. (b) A person with no
    FamilySearch link gets that real answer. (c) A person who resolves to a
    FamilySearch id is answered from the test's person_quality fixtures matched
    on `{...args without projectPath, personId: <resolved id>}`, so a fixture
    answers for a FamilySearch person whatever local id reached it; with no match
    the call is refused.

    Every answer is logged `matched.kind = "live"` with `expected_args = None`:
    the judge is shown `args` beside `expected_args` and fails a wrong
    identifier, so a fixture keyed `LZNY-BRF` answering a call made with `I1`
    must not be presented as an expected-argument mismatch. A refusal is logged
    `kind = "none"` so the uncovered-call warning names the missing fixture.
    """
    pq_js = _MCP_BUILD / "tools" / "person-quality.js"

    async def handler(args, _ws=workspace, _js=pq_js, _pred=predicated):
        entry: dict[str, Any] = {
            "tool": "mcp__genealogy__person_quality",
            "args": dict(args),
            "expected_args": None,
            "matched": {"kind": "live", "index": None},
            "response_fixture": "live:person_quality",
        }
        response: dict[str, Any]
        if not _js.exists():
            response = {"ok": False, "errors": [f"person_quality: build not found: {_js}"]}
        else:
            js_url = _node_module_url(_js)
            input_obj = dict(args)
            # Rebase only a projectPath the skill actually sent: filling one in
            # would hide a skill that drops it, which in production quietly
            # reverts every imported person to the neutral sentence.
            if _ws is not None and "projectPath" in args:
                input_obj["projectPath"] = str(_ws).replace("\\", "/")
            script = (
                f"import {{ resolvePersonQualityTarget }} from '{js_url}';"
                " import { readFileSync } from 'node:fs';"
                " const input = JSON.parse(readFileSync(0, 'utf-8'));"
                " const r = await resolvePersonQualityTarget(input);"
                " process.stdout.write(JSON.stringify(r));"
            )
            failure: str | None = None
            target: Any = None
            try:
                proc = _run_node_eval(script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
                if proc.stdout.strip():
                    target = json.loads(proc.stdout)
                else:
                    failure = (proc.stderr or "").strip()[:500] or f"no output (exit {proc.returncode})"
            except Exception as e:  # surfaced to the run as an error response
                failure = str(e)
            if not isinstance(target, dict):
                response = {
                    "ok": False,
                    "errors": [f"person_quality: resolution failed: {failure or 'unrecognised output'}"],
                }
            elif target.get("kind") == "answer":
                response = target["result"]
            else:
                fsid = target.get("familySearchId", "")
                query = {k: v for k, v in args.items() if k != "projectPath"}
                query["personId"] = fsid
                hit = next(((resp, src) for (pred, resp, src) in _pred if matches(pred, query)), None)
                if hit is not None:
                    response, entry["response_fixture"] = hit
                else:
                    entry["matched"] = {"kind": "none", "index": None}
                    entry["response_fixture"] = None
                    response = {"ok": False, "errors": [PERSON_QUALITY_REFUSAL.format(fsid=fsid)]}
        entry["response"] = response
        call_log.append(entry)
        return _tool_envelope("person_quality", response)

    return handler


def _make_compiled_tool_handler(
    tool_name: str,
    js_filename: str,
    export_symbol: str,
    workspace: Path | None,
    call_log: list[dict[str, Any]],
    place_table=None,
):
    """Build the live handler for a compiled single-export tool — the tree
    writers (tree_edit / tree_correct) and the read-only project_context all
    share this builder (one exported async function taking the input object).

    Calls the compiled TS tool via `node --input-type=module` against the
    workspace path. The skill passes its own projectPath arg, but we override
    it with workspace (the harness tempdir) to avoid path drift — always,
    except for `_OPTIONAL_PROJECT_PATH_TOOLS`, where only a projectPath the
    agent actually sent is rebased.

    Input is piped via stdin (as JSON) to avoid shell/JS string escaping
    issues with values that may contain quotes, backslashes, or newlines.
    """
    tool_js = _MCP_BUILD / "tools" / js_filename

    async def handler(args, _ws=workspace, _tjs=tool_js):
        if _ws is None or not _tjs.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {_tjs}"
            response = {
                "ok": False,
                "errors": [f"{tool_name}: {reason}"],
            }
        else:
            tool_url = _node_module_url(_tjs)

            # Override projectPath with workspace; pipe the full input via
            # stdin so no value needs JS-string escaping.
            # An optional projectPath is rebased only when the agent sent one.
            input_obj = dict(args)
            if tool_name not in _OPTIONAL_PROJECT_PATH_TOOLS or "projectPath" in args:
                input_obj["projectPath"] = str(_ws).replace("\\", "/")

            # Tools whose entry point takes a Principal as its last argument. The
            # harness is one user per process, so LOCAL is the right one — the same
            # binding the stdio dispatcher makes. Nothing typechecks this script, so
            # a signature change here surfaces only at harness runtime.
            principal_url = _node_module_url(_MCP_BUILD / "auth" / "principal.js")
            takes_principal = tool_name in _COMPILED_TOOLS_WITH_PRINCIPAL
            principal_import = (
                f" import {{ LOCAL }} from '{principal_url}';" if takes_principal else ""
            )
            call_args = "input, LOCAL" if takes_principal else "input"
            if tool_name in _COMPILED_TOOLS_WITHOUT_INPUT:
                call_args = "LOCAL"
            if tool_name in _COMPILED_TOOL_EXTRA_ARGS:
                call_args += ", " + _COMPILED_TOOL_EXTRA_ARGS[tool_name]

            # A tool that resolves places gets the test's own answers and no
            # network: the table is installed in the resolver module the tool
            # itself imports (same build path, so the same module instance).
            stdin_obj: Any = input_obj
            table_import = ""
            if place_table is not None:
                resolver_url = _node_module_url(_MCP_BUILD / "utils" / "place-resolver.js")
                table_import = (
                    f" import {{ __usePlaceTableForTests }} from '{resolver_url}';"
                    " __usePlaceTableForTests(payload.placeTable);"
                )
                stdin_obj = {"input": input_obj, "placeTable": place_table(args)}
            read_input = (
                " const payload = JSON.parse(readFileSync(0, 'utf-8'));"
                " const input = payload.input;"
                if place_table is not None
                else " const input = JSON.parse(readFileSync(0, 'utf-8'));"
            )
            script = (
                f"import {{ {export_symbol} }} from '{tool_url}';"
                f"{principal_import}"
                " import { readFileSync } from 'node:fs';"
                f"{read_input}"
                f"{table_import}"
                f" const r = await {export_symbol}({call_args});"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, json.dumps(stdin_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
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


_RECORD_TOKEN = re.compile(r"1:1:([A-Z0-9]+(?:-[A-Z0-9]+)+)", re.IGNORECASE)


def _attached_record_ids(workspace: Path, person_id: str) -> list[str]:
    """The bare `1:1:` ids attached to a tree person (by tree id, or by a
    FamilySearch id their `ark` names), from the person's own, name and fact
    refs: the set `extraction_append({ personId })` reads. Mirrors
    `findAnchor` + `collectSourceRefs` closely enough to stage fixtures."""
    try:
        tree = json.loads((workspace / "tree.gedcomx.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    persons = [p for p in tree.get("persons") or [] if isinstance(p, dict)]
    pid = person_id.strip()
    person = next((p for p in persons if p.get("id") == pid), None) or next(
        (p for p in persons if isinstance(p.get("ark"), str) and p["ark"].upper().endswith(pid.upper())), None
    )
    if person is None:
        return []
    url = {s.get("id"): s.get("url") or "" for s in tree.get("sources") or [] if isinstance(s, dict)}
    out: list[str] = []
    for holder in [person, *(person.get("names") or []), *(person.get("facts") or [])]:
        for ref in (holder.get("sources") or []) if isinstance(holder, dict) else []:
            sid = (ref.get("ref") or "").lstrip("#") if isinstance(ref, dict) else ""
            m = _RECORD_TOKEN.search(url.get(sid, ""))
            if m and m.group(1).upper() not in out:
                out.append(m.group(1).upper())
    return out


def _make_extraction_append_handler(
    workspace: Path | None,
    call_log: list[dict[str, Any]],
    manifest: dict[str, Any],
):
    """The live `extraction_append`, reading FamilySearch records from the test's
    `record_read` fixtures instead of the network (lead, 2026-09-30).

    `recordIds` makes the tool read each record live. Here each id is matched
    against the loaded `record_read` fixtures, the canned response is staged
    through `_stage_record_read` (the compiled stager, so `staged` is real), and
    the staged responses cross into the node script as a JSON map keyed by the
    id exactly as the call sent it. `runExtractionAppend`'s injected `readRecord`
    serves from that map, so every other step (the resend skip, the log batch,
    the per-record writes, the summary) is the compiled production code. A call
    with no `recordIds` goes through the same script with an empty map.
    Principal is `LOCAL`: the harness is one user per process.
    """
    tool_js = _MCP_BUILD / "tools" / "extraction-append.js"
    principal_js = _MCP_BUILD / "auth" / "principal.js"

    def _url(p: Path) -> str:
        posix = str(p).replace("\\", "/").replace("'", "\\'")
        return ("file:///" + posix) if sys.platform == "win32" else posix

    async def handler(args, _ws=workspace):
        if _ws is None or not tool_js.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {tool_js}"
            response: dict[str, Any] = {"ok": False, "errors": [f"extraction_append: {reason}"]}
        else:
            input_obj = dict(args)
            input_obj["projectPath"] = str(_ws).replace("\\", "/")
            records: dict[str, Any] = {}
            predicated = (manifest.get("record_read") or {}).get("predicated") or []
            wanted = [r for r in (input_obj.get("recordIds") or []) if isinstance(r, str)]
            if isinstance(input_obj.get("personId"), str):
                # personId mode reads the person's attached records itself, as
                # `ark:/61903/1:1:<id>`. Stage the fixtures for exactly those ids.
                wanted += [f"ark:/61903/1:1:{b}" for b in _attached_record_ids(_ws, input_obj["personId"])]
            for rid in wanted:
                key = rid.strip()
                bare = key.rsplit("1:1:", 1)[-1].rsplit("/", 1)[-1]
                canned = next(
                    (
                        resp
                        for pred, resp, *_ in predicated
                        if matches(pred, {"recordId": key}) or matches(pred, {"recordId": bare})
                    ),
                    None,
                )
                if canned is None:
                    records[key] = {"__error": f"no record_read fixture matches {key}"}
                else:
                    records[key] = _stage_record_read(
                        _ws, {"recordId": key, "projectPath": input_obj["projectPath"]}, canned
                    )
            input_obj["__records"] = records
            script = (
                f"import {{ runExtractionAppend }} from '{_url(tool_js)}';"
                f" import {{ LOCAL }} from '{_url(principal_js)}';"
                " import { readFileSync } from 'node:fs';"
                " const input = JSON.parse(readFileSync(0, 'utf-8'));"
                " const records = input.__records; delete input.__records;"
                " const deps = { readRecord: async ({ recordId }) => {"
                "   const r = records[String(recordId).trim()];"
                "   if (!r) throw new Error(`no record_read fixture for ${recordId}`);"
                "   if (r.__error) throw new Error(r.__error);"
                "   return r;"
                " } };"
                " const r = await runExtractionAppend(input, deps, LOCAL);"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, json.dumps(input_obj), timeout=NODE_EVAL_TIMEOUT_LONG)
                if proc.stdout.strip():
                    response = json.loads(proc.stdout)
                else:
                    stderr_msg = proc.stderr.strip()[:500] if proc.stderr else "no output"
                    response = {
                        "ok": False,
                        "errors": [f"extraction_append: node produced no output (exit {proc.returncode}): {stderr_msg}"],
                    }
            except Exception as e:
                response = {"ok": False, "errors": [f"extraction_append: {e}"]}
        call_log.append(
            {
                "tool": "mcp__genealogy__extraction_append",
                "args": dict(args),
                "expected_args": None,
                "matched": {"kind": "live", "index": None},
                "response_fixture": "live:extraction_append",
                "response": response,
            }
        )
        return _tool_envelope("extraction_append", response)

    return handler


def _mock_memory_kinds(read: dict[str, Any]) -> dict[str, str]:
    """Which of a canned read's sources are memories, and what kind, for
    `project_create`'s memory sources (#3384).

    Production knows each memory's media type; a canned `person_read` does not
    carry it (the response has no memory discriminator, and
    `mcp-fixture.schema.json` is closed). So the mock reads it off the shape: a
    source carrying `artifact_url` is a memory, a story when it came back with
    `text` and no retained scan (`image_ref`), a document otherwise. A
    transcribed PDF document is therefore mislabelled a story here: production
    retains no scan for a PDF either.
    """
    kinds: dict[str, str] = {}
    for src in read.get("sources") or []:
        if not isinstance(src, dict) or not isinstance(src.get("id"), str) or "artifact_url" not in src:
            continue
        story = isinstance(src.get("text"), str) and src["text"].strip() != "" and not src.get("image_ref")
        kinds[src["id"]] = "story" if story else "document"
    return kinds


def _make_project_create_handler(
    workspace: Path | None,
    call_log: list[dict[str, Any]],
    manifest: dict[str, Any],
    place_predicated: list,
):
    """The live `project_create`, reading the person from the test's
    `person_read` fixtures instead of FamilySearch (#3384).

    With `personId` the tool reads the person itself. Here the id is matched
    against the loaded `person_read` fixtures, and `runProjectCreate`'s injected
    `readPerson` serves the canned response, resolved to its first person (the
    subject, as `readPerson` guarantees), with `_mock_memory_kinds`. Every other
    step (the refusals, the build, the profile, the memory sources, the summary)
    is the compiled production code. An id with no fixture is a failed read,
    never a request. The test's place table is installed, so no place lookup
    reaches the network. The call-log entry records the canned read as
    `served_read`, so a validator can grade what reached the project against
    what the read held. Principal is `LOCAL`: the harness is one user per process.
    """
    tool_js = _MCP_BUILD / "tools" / "project-create.js"

    async def handler(args, _ws=workspace):
        served: dict[str, Any] | None = None
        if _ws is None or not tool_js.exists():
            reason = "workspace not provided" if _ws is None else f"build not found: {tool_js}"
            response: dict[str, Any] = {"ok": False, "errors": [f"project_create: {reason}"]}
        else:
            input_obj = dict(args)
            input_obj["projectPath"] = str(_ws).replace("\\", "/")
            pid = args.get("personId")
            read = None
            if isinstance(pid, str) and pid.strip():
                predicated = (manifest.get("person_read") or {}).get("predicated") or []
                hit = next(
                    ((resp, src) for pred, resp, src in predicated if matches(pred, {"personId": pid.strip()})),
                    None,
                )
                if hit is not None:
                    read = hit[0]
                    served = {"fixture": hit[1], "response": hit[0]}
            payload = {
                "input": input_obj,
                "placeTable": _place_table(place_predicated, args),
                "read": read,
                "kinds": _mock_memory_kinds(read) if isinstance(read, dict) else {},
            }
            script = (
                f"import {{ runProjectCreate }} from '{_node_module_url(tool_js)}';"
                f" import {{ LOCAL }} from '{_node_module_url(_MCP_BUILD / 'auth' / 'principal.js')}';"
                f" import {{ __usePlaceTableForTests }} from '{_node_module_url(_MCP_BUILD / 'utils' / 'place-resolver.js')}';"
                " import { readFileSync } from 'node:fs';"
                " const payload = JSON.parse(readFileSync(0, 'utf-8'));"
                " __usePlaceTableForTests(payload.placeTable);"
                " const deps = { readPerson: async (personId) => {"
                "   if (!payload.read) throw new Error(`no person_read fixture for ${personId}`);"
                "   const first = (payload.read.persons || [])[0];"
                "   return { result: structuredClone(payload.read),"
                "     resolvedId: first && typeof first.id === 'string' ? first.id : personId,"
                "     memoryKinds: payload.kinds };"
                " } };"
                " const r = await runProjectCreate(payload.input, deps, LOCAL);"
                " process.stdout.write(JSON.stringify(r));"
            )
            try:
                proc = _run_node_eval(script, json.dumps(payload), timeout=NODE_EVAL_TIMEOUT_LONG)
                if proc.stdout.strip():
                    response = json.loads(proc.stdout)
                else:
                    stderr_msg = proc.stderr.strip()[:500] if proc.stderr else "no output"
                    response = {
                        "ok": False,
                        "errors": [f"project_create: node produced no output (exit {proc.returncode}): {stderr_msg}"],
                    }
            except Exception as e:
                response = {"ok": False, "errors": [f"project_create: {e}"]}
        entry: dict[str, Any] = {
            "tool": "mcp__genealogy__project_create",
            "args": dict(args),
            "expected_args": None,
            "matched": {"kind": "live", "index": None},
            "response_fixture": "live:project_create",
            "response": response,
        }
        if served is not None:
            entry["served_read"] = served
        call_log.append(entry)
        return _tool_envelope("project_create", response)

    return handler


def expected_tool_names(call_log: list[dict[str, Any]]) -> list[str]:
    """Return tool names recorded in the call log, in invocation order."""
    return [c["tool"] for c in call_log]

