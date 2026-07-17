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
"""

from __future__ import annotations

import functools
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
    "tree_edit",
    "tree_correct",
    "project_context",
}

# Path to the compiled MCP server build output, used by live tool handlers.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_MCP_BUILD = _REPO_ROOT / "packages" / "engine" / "mcp-server" / "build"

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


@functools.lru_cache(maxsize=1)
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
    per test. The returned structures are treated as read-only.
    """
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
        proc = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            capture_output=True,
            text=True,
            timeout=30,
        )
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


def _stage_search_results(
    workspace: Path, tool_name: str, response: dict[str, Any]
) -> dict[str, Any] | None:
    """Materialize a staged file for a mocked search response by calling the
    compiled `stageSearchResults`, mirroring what the real search tool does.

    Returns the StagedHandle ({"resultsRef", "returnedCount"}) or None on a nil
    search / staging failure (in which case the caller leaves `staged` null).
    """
    stager_js = _MCP_BUILD / "utils" / "results-staging.js"
    if not stager_js.exists():
        return None
    sjs_posix = str(stager_js).replace("\\", "/").replace("'", "\\'")
    stager_url = ("file:///" + sjs_posix) if sys.platform == "win32" else sjs_posix
    input_obj = {
        "projectPath": str(workspace).replace("\\", "/"),
        "tool": tool_name,
        "response": response,
    }
    script = (
        f"import {{ stageSearchResults }} from '{stager_url}';"
        " import { readFileSync } from 'node:fs';"
        " const input = JSON.parse(readFileSync(0, 'utf-8'));"
        " const r = await stageSearchResults(input);"
        " process.stdout.write(JSON.stringify(r));"
    )
    try:
        proc = subprocess.run(
            ["node", "--input-type=module", "--eval", script],
            input=json.dumps(input_obj),
            capture_output=True,
            text=True,
            timeout=30,
        )
        out = proc.stdout.strip()
        if not out:
            return None
        return json.loads(out)  # StagedHandle, or null -> None
    except Exception:
        return None


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
            # tool returning staged.resultsRef). Only when projectPath was
            # passed and results came back; nil searches retain nothing.
            if (
                _name in STAGING_SEARCH_TOOLS
                and _workspace is not None
                and "error" not in response
                and args.get("projectPath")
                and isinstance(response.get("results"), list)
                and response.get("results")
            ):
                staged = _stage_search_results(_workspace, _name, response)
                if staged is not None:
                    response = {**response, "staged": staged}

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
    if tool_name == "tree_edit":
        return _make_compiled_tool_handler("tree_edit", "tree-edit.js", "treeEdit", workspace, call_log)
    if tool_name == "tree_correct":
        return _make_compiled_tool_handler("tree_correct", "tree-correct.js", "treeCorrect", workspace, call_log)
    if tool_name == "project_context":
        return _make_compiled_tool_handler(
            "project_context", "project-context.js", "projectContext", workspace, call_log
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
                proc = subprocess.run(
                    ["node", "--input-type=module", "--eval", script],
                    capture_output=True, text=True, timeout=30,
                )
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
                proc = subprocess.run(
                    ["node", "--input-type=module", "--eval", script],
                    input=json.dumps(input_obj),
                    capture_output=True, text=True, timeout=30,
                )
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
        return {"content": [{"type": "text", "text": json.dumps(response)}]}

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
                proc = subprocess.run(
                    ["node", "--input-type=module", "--eval", script],
                    input=json.dumps(input_obj),
                    capture_output=True, text=True, timeout=30,
                )
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
        return {"content": [{"type": "text", "text": json.dumps(response)}]}

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
                proc = subprocess.run(
                    ["node", "--input-type=module", "--eval", script],
                    input=json.dumps(input_obj),
                    capture_output=True, text=True, timeout=30,
                )
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
        return {"content": [{"type": "text", "text": json.dumps(response)}]}

    return handler


def expected_tool_names(call_log: list[dict[str, Any]]) -> list[str]:
    """Return tool names recorded in the call log, in invocation order."""
    return [c["tool"] for c in call_log]
