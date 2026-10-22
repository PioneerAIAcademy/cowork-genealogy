"""The `instrument` fingerprint: what produced and graded a unit run log.

`snapshot` certifies the skill-side files a run read. This module fingerprints
the rest of what decides a run's verdict, so `check_runlogs.py` rule 2c can tell
a run log that its instrument moved since it was written (issue #2479, PR 3):

- ``validators`` -- the validator files `validator_runner.run_validators` loads
  for the suite, as a normalised whole-module AST. ``suite`` is
  ``test_<skill>.py`` plus every sibling module in ``validators/`` it imports,
  transitively (``extraction_validators.py`` for extraction-append and
  record-structurer); ``shared`` is ``test_universal.py`` + ``validators_lib.py``.
- ``tools`` -- the ``description`` and ``inputSchema`` the mock advertises, from
  ``build/tool-schemas.js``. ``fixture`` is every tool the suite's own fixtures
  serve; ``live`` is the remaining ``LIVE_TOOLS``, which every suite advertises.
- ``live_modules`` -- the compiled entry module of each live tool a run called.

The suite-specific halves (``validators.suite``, ``tools.fixture``) block;
``validators.shared``, ``tools.live`` and ``live_modules`` warn, because a
blocking corpus-wide input would owe a paid re-run of every suite (decided
2026-10-14 on issue #2479; see eval/CLAUDE.md, rule 2c).

Not covered, by construction: a live tool's imports beyond its entry module; and
every module a validator file imports other than `validators_lib` -- today
`harness.allowed_tools`, `harness.dates` (via `validators_lib`), `harness.mock_mcp`
(the catalog read through `validators_lib.tool_input_keys`), `harness.ownership`,
`harness.record_basis`, `harness.schema_validator`, `harness.skill_invocation`,
`harness.skill_runner`, `harness.ts_validator`, `harness.workspace` and the
top-level `provenance_report` (re-derive with an AST walk of the imports in
`eval/harness/validators/*.py`). A change there can move a verdict without moving
this fingerprint. ``ast.dump`` output is specific to the Python
minor version, so a bump from 3.12 re-hashes every suite.

Stdlib-only: `check_runlogs.py` imports this on a bare interpreter.
"""

from __future__ import annotations

import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Iterable

from harness.snapshot import collect_refs

# Bare tool names that are always registered as live handlers rather than
# fixture-backed mocks (`mock_mcp.py` imports this; see its module docstring).
LIVE_TOOLS: set[str] = {
    "validate_research_schema",
    "research_log_append",
    "research_append",
    "extraction_append",
    "tree_edit",
    "tree_correct",
    "materialize_facts",
    "merge_warnings",
    # Reads tree.gedcomx.json from the workspace. The compiled-tool handler
    # computes every tag from the workspace tree, so a live handler is more
    # faithful than a canned answer. Its one networked check
    # (hasBirthFarFromParentsResidence) is switched off through
    # `_COMPILED_TOOL_EXTRA_ARGS`: a unit run must not reach the Places API, and
    # the tool skips that check when a lookup returns nothing. Live since 2026-09-03
    # (lead ruling on PR #2151).
    "person_warnings",
    # Served by its own handler (`_make_person_quality_handler`), registered
    # outside both loops in `create_mock_server`. The tool first decides what to
    # score with no network call: a project's local id is looked up in the
    # workspace tree and resolved to the person's FamilySearch link; a person with
    # no link gets the tool's own sentence, which is safe and faithful to run for
    # real. A call that resolves to a FamilySearch id is answered from the test's
    # person_quality fixtures keyed on THAT id, or refused. Kept in this set
    # because allowed_tools' callee-fixture check exempts LIVE_TOOLS members.
    "person_quality",
    "project_context",
    # The bounded-delivery signal. Live rather than fixture-backed because the
    # tool IS inert by contract -- no network, no auth, no project write; it
    # returns a fixed acknowledgement (`research-delivered.ts`) -- so running the
    # real one is both free and more faithful than a canned answer.
    #
    # It was advertised NOWHERE in this harness until now, which is why #2813
    # item 1 reached alpha untested: the hosted Stop hook only allows a bounded
    # turn to stop when the model calls this tool, and a model that cannot see
    # the tool cannot call it. Every unit eval therefore graded the skill on
    # prose it had no way to act on.
    "research_delivered",
    # Read-only projection over the workspace's own research.json — same shape
    # as project_context, and deterministic, so mocking it would only invite
    # drift. Added when search-records / research were pointed at it in place of
    # whole-file Reads; without it a skill following that instruction hits an
    # uncovered tool call and grades badly for doing the right thing.
    "research_query",
    # The reader for the two sidecar classes research_query cannot serve — a
    # verdict body under evaluations/ and a text upload under uploads/. Same
    # deterministic-in-workspace-state rationale as research_query; the
    # gps-mentor agent's existing-verdict skip depends on it being live.
    "sidecar_read",
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
    # Census arithmetic whose computed answer (how many children are missing, and
    # each birth window) is exactly what check-warnings' tests grade; a canned
    # fixture would grade a number the test author typed. Unlike convert_calendar
    # it reads workspace state in tree mode (motherId): the injected projectPath
    # points it at the test's own tree.
    "census_children_gap",
    # Same rationale as convert_calendar: URL-templating with no network
    # dependency, so a canned fixture would supply the exact URL string
    # search-external-sites' eval exists to measure. Its one workspace write
    # (the hand-off log entry, only when the agent passes projectPath) runs
    # against the harness workspace — see _OPTIONAL_PROJECT_PATH_TOOLS.
    "build_external_search_url",
    # Same rationale as convert_calendar: a pure table lookup with no workspace
    # or network dependency. Nothing calls it until issue #1828; kept live so
    # that PR's eval doesn't quietly get the answer from a canned fixture.
    "get_name_variants",
    # A person timeline computed from the workspace's own links: a canned
    # fixture would supply the events and gaps the timeline suite grades. Its
    # Places lookups are answered from the test's place_search fixtures
    # (`_make_timeline_build_handler`), so it stays offline.
    "timeline_build",
}

# The compiled entry module each live handler loads, relative to the build dir.
# Kept apart from mock_mcp's `_COMPILED_TOOLS` because five live tools are served
# by dedicated handlers that never consult that table.
LIVE_MODULES: dict[str, str] = {
    "validate_research_schema": "tools/validate-research-schema.js",
    "research_log_append": "tools/research-log-append.js",
    "research_append": "tools/research-append.js",
    "extraction_append": "tools/extraction-append.js",
    "tree_edit": "tools/tree-edit.js",
    "tree_correct": "tools/tree-correct.js",
    "materialize_facts": "tools/materialize-facts.js",
    "merge_warnings": "tools/merge-warnings.js",
    "person_warnings": "tools/person-warnings.js",
    "person_quality": "tools/person-quality.js",
    "project_context": "tools/project-context.js",
    "research_delivered": "tools/research-delivered.js",
    "research_query": "tools/research-query.js",
    "sidecar_read": "tools/sidecar-read.js",
    "project_create": "tools/project-create.js",
    "convert_calendar": "tools/convert-calendar.js",
    "census_children_gap": "tools/census-children-gap.js",
    "build_external_search_url": "tools/build-external-search-url.js",
    "get_name_variants": "tools/name-variants.js",
    "timeline_build": "tools/timeline-build.js",
}

SHARED_VALIDATOR_FILES: tuple[str, ...] = ("test_universal.py", "validators_lib.py")

_REPO_ROOT = Path(__file__).resolve().parents[3]
ENGINE_DIR = _REPO_ROOT / "packages" / "engine" / "mcp-server"


class CatalogUnavailable(RuntimeError):
    """The compiled tool catalog could not be read, so `tools` cannot be computed."""


def suite_validator_file(skill: str) -> str:
    """The per-skill validator `validator_runner.run_validators` loads."""
    return f"test_{skill.replace('-', '_')}.py"


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --- validators ---------------------------------------------------------------

_MESSAGE_CALLS = frozenset({"pytest.skip", "pytest.fail", "pytest.xfail"})


def _drop_docstring(body: list[ast.stmt]) -> list[ast.stmt]:
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        body = body[1:]
    return body or [ast.Pass()]


class _DropMessages(ast.NodeTransformer):
    """Remove what a check *says* while keeping what it *decides*: docstrings,
    assertion messages, skip/fail reasons and AssertionError arguments.

    Except inside a `report_*` function: its failure message is the observation
    `validator_runner` hands the judge, so there the message IS graded input.
    """

    def __init__(self) -> None:
        self._in_report = False

    def _strip(self, node):  # Module, ClassDef
        node.body = _drop_docstring(node.body)
        self.generic_visit(node)
        return node

    visit_Module = visit_ClassDef = _strip

    def _function(self, node):  # FunctionDef, AsyncFunctionDef
        outer = self._in_report
        self._in_report = outer or node.name.startswith("report_")
        try:
            return self._strip(node)
        finally:
            self._in_report = outer

    visit_FunctionDef = visit_AsyncFunctionDef = _function

    def visit_Assert(self, node: ast.Assert):
        if not self._in_report:
            node.msg = None
        self.generic_visit(node)
        return node

    def visit_Call(self, node: ast.Call):
        self.generic_visit(node)
        if not self._in_report and ast.unparse(node.func) in _MESSAGE_CALLS:
            # The message goes; keywords that change behaviour, such as
            # `allow_module_level`, stay.
            node.args = []
            node.keywords = [k for k in node.keywords if k.arg not in ("reason", "msg")]
        return node

    def visit_Raise(self, node: ast.Raise):
        self.generic_visit(node)
        exc = node.exc
        if (
            not self._in_report
            and isinstance(exc, ast.Call)
            and ast.unparse(exc.func) == "AssertionError"
        ):
            exc.args = []
            exc.keywords = []
        return node


def _bound_names(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    """Every name bound anywhere inside a top-level function, in a fixed order,
    excluding the function's own parameters."""
    own = {a.arg for a in (*fn.args.posonlyargs, *fn.args.args, *fn.args.kwonlyargs)}
    if fn.args.vararg:
        own.add(fn.args.vararg.arg)
    if fn.args.kwarg:
        own.add(fn.args.kwarg.arg)
    declared: set[str] = set()
    names: list[str] = []

    def add(name: str | None) -> None:
        if name and name not in own and name not in names:
            names.append(name)

    for stmt in fn.body:
        for node in ast.walk(stmt):
            if isinstance(node, (ast.Global, ast.Nonlocal)):
                declared.update(node.names)
            elif isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                add(node.id)
            elif isinstance(node, ast.arg):
                add(node.arg)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                add(node.name)
            elif isinstance(node, ast.ExceptHandler):
                add(node.name)
            elif isinstance(node, ast.alias) and "." not in node.name:
                add(node.asname or node.name)
            elif isinstance(node, (ast.MatchAs, ast.MatchStar)):
                add(node.name)
            elif isinstance(node, ast.MatchMapping):
                add(node.rest)
    return [n for n in names if n not in declared]


def _nested_params(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, set[str]]:
    """Each function nested inside `fn`, by name, with its parameter names: a
    keyword argument on a call to it is a reference to one of those bindings."""
    out: dict[str, set[str]] = {}
    for stmt in fn.body:
        for node in ast.walk(stmt):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                a = node.args
                out.setdefault(node.name, set()).update(
                    x.arg for x in (*a.posonlyargs, *a.args, *a.kwonlyargs)
                )
    return out


class _Rename(ast.NodeTransformer):
    def __init__(self, mapping: dict[str, str], nested: dict[str, set[str]]):
        self.m = mapping
        # nested function name -> its parameter names
        self.nested = nested

    def visit_Call(self, node: ast.Call):
        # A keyword names a binding only on a call to the nested function that
        # declares it; on any other callee it is that callee's parameter name.
        callee = node.func.id if isinstance(node.func, ast.Name) else None
        params = self.nested.get(callee, set())
        for kw in node.keywords:
            if kw.arg in params:
                kw.arg = self.m.get(kw.arg, kw.arg)
        self.generic_visit(node)
        return node

    def _match_name(self, node, attr):
        value = getattr(node, attr)
        if value:
            setattr(node, attr, self.m.get(value, value))
        self.generic_visit(node)
        return node

    def visit_MatchAs(self, node: ast.MatchAs):
        return self._match_name(node, "name")

    def visit_MatchStar(self, node: ast.MatchStar):
        return self._match_name(node, "name")

    def visit_MatchMapping(self, node: ast.MatchMapping):
        return self._match_name(node, "rest")

    def visit_Name(self, node: ast.Name):
        node.id = self.m.get(node.id, node.id)
        return node

    def visit_arg(self, node: ast.arg):
        node.arg = self.m.get(node.arg, node.arg)
        self.generic_visit(node)
        return node

    def _named(self, node):
        node.name = self.m.get(node.name, node.name)
        self.generic_visit(node)
        return node

    visit_FunctionDef = visit_AsyncFunctionDef = visit_ClassDef = _named

    def visit_ExceptHandler(self, node: ast.ExceptHandler):
        if node.name:
            node.name = self.m.get(node.name, node.name)
        self.generic_visit(node)
        return node

    def visit_alias(self, node: ast.alias):
        bound = node.asname or node.name
        if "." not in node.name and bound in self.m:
            node.asname = self.m[bound]
        return node


def _normalise_locals(tree: ast.Module) -> None:
    """Alpha-rename every top-level function's locals to `_v0, _v1, …`.

    One mapping per top-level function, covering nested scopes too, so two
    distinct names never merge (a rename stays invisible; a repointed read does
    not). Module-level names are left alone, since they are read across functions.
    """
    scopes = (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    module_names: set[str] = set()
    for node in tree.body:
        if isinstance(node, scopes):
            module_names.add(node.name)
            continue
        for sub in ast.walk(node):
            if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store):
                module_names.add(sub.id)
            elif isinstance(sub, ast.alias):
                module_names.add((sub.asname or sub.name).split(".")[0])

    def top_level_functions(body):
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                yield node
            elif isinstance(node, ast.ClassDef):
                yield from top_level_functions(node.body)

    for fn in top_level_functions(tree.body):
        bound = [n for n in _bound_names(fn) if n not in module_names]
        mapping = {name: f"_v{i}" for i, name in enumerate(bound)}
        if not mapping:
            continue
        renamer = _Rename(mapping, _nested_params(fn))
        fn.body = [renamer.visit(stmt) for stmt in fn.body]


def canonical_module(source: str) -> str:
    """A validator file's decision-bearing structure, as text.

    Comments, docstrings, message strings, layout and local names drop out;
    conditions, computed values, control flow, helpers, constants, signatures and
    the `test_`/`report_` prefix stay.
    """
    tree = ast.parse(source)
    tree = _DropMessages().visit(tree)
    _normalise_locals(tree)
    return ast.dump(tree, annotate_fields=True, include_attributes=False)


def hash_validator_file(path: Path) -> str:
    """Hash of `canonical_module`, or of an "absent" marker for a missing file,
    so the file appearing later counts as a change."""
    if not path.is_file():
        return _sha(f"absent:{path.name}")
    return _sha(canonical_module(path.read_text(encoding="utf-8")))


def sibling_validator_imports(path: Path, validators_dir: Path) -> list[str]:
    """Modules in `validators_dir` that `path` imports, transitively, other than
    the shared ones. `test_extraction_append.py` is a docstring and `from
    extraction_validators import *`: without following that import its `suite`
    half would fingerprint no decision at all."""
    found: set[str] = set()
    pending = [path]
    while pending:
        current = pending.pop()
        if not current.is_file():
            continue
        try:
            tree = ast.parse(current.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError):
            continue
        names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names.add(node.module)
            elif isinstance(node, ast.Import):
                names.update(a.name for a in node.names)
        for name in names:
            filename = f"{name}.py"
            if (
                filename not in SHARED_VALIDATOR_FILES
                and filename not in found
                and (validators_dir / filename).is_file()
            ):
                found.add(filename)
                pending.append(validators_dir / filename)
    return sorted(found)


def validators_fingerprint(skill: str, validators_dir: Path) -> dict[str, str]:
    shared = {name: hash_validator_file(validators_dir / name) for name in SHARED_VALIDATOR_FILES}
    suite_path = validators_dir / suite_validator_file(skill)
    suite = {suite_path.name: hash_validator_file(suite_path)}
    for name in sibling_validator_imports(suite_path, validators_dir):
        suite[name] = hash_validator_file(validators_dir / name)
    return {
        "suite": _sha(json.dumps(suite, sort_keys=True)),
        "shared": _sha(json.dumps(shared, sort_keys=True)),
    }


# --- tools ------------------------------------------------------------------


def fixture_tools(skill: str, tests_dir: Path, fixtures_dir: Path) -> set[str]:
    """Every tool named by a fixture any test in the suite references."""
    suite = tests_dir / skill
    if not suite.is_dir():
        return set()
    tools: set[str] = set()
    for name in collect_refs(suite, None)["fixtures"]:
        path = fixtures_dir / f"{name}.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        tool = data.get("tool") if isinstance(data, dict) else None
        if isinstance(tool, str) and tool:
            tools.add(tool)
    return tools


def _surface(catalog: dict[str, dict[str, Any]], names: Iterable[str]) -> str:
    entries = {
        name: (
            {"description": catalog[name].get("description"), "inputSchema": catalog[name].get("inputSchema")}
            if name in catalog
            else None
        )
        for name in sorted(names)
    }
    return _sha(json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def tools_fingerprint(catalog: dict[str, dict[str, Any]], fixture_backed: set[str]) -> dict[str, str]:
    """`fixture` covers the tools the suite serves from its own fixtures, live or
    not; `live` covers the remaining LIVE_TOOLS, which every suite advertises."""
    return {
        "fixture": _surface(catalog, fixture_backed),
        "live": _surface(catalog, LIVE_TOOLS - fixture_backed),
    }


# --- live modules ---------------------------------------------------------------


def live_tools_called(tests: Iterable[dict[str, Any]]) -> set[str]:
    """Bare names of the live tools a run log's runs actually called."""
    called: set[str] = set()
    for test in tests:
        for run in test.get("runs") or []:
            for call in (run.get("output") or {}).get("tool_calls") or []:
                if (call.get("matched") or {}).get("kind") == "live":
                    called.add(str(call.get("tool") or "").split("__")[-1])
    return called & LIVE_TOOLS


def live_modules_fingerprint(called: Iterable[str], build_dir: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for tool in sorted(set(called) & set(LIVE_MODULES)):
        path = build_dir / LIVE_MODULES[tool]
        out[tool] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else _sha(f"absent:{tool}")
    return out


# --- the compiled catalog --------------------------------------------------------


def node_module_url(p: Path | str) -> str:
    """A compiled module's path as a Node ESM import specifier, safe to embed in
    a single-quoted JS string. Windows needs a ``file:///`` URL: Node rejects a
    bare drive-letter path (``C:/...``) with ERR_UNSUPPORTED_ESM_URL_SCHEME."""
    posix = str(p).replace("\\", "/").replace("'", "\\'")
    return ("file:///" + posix) if sys.platform == "win32" else posix


def stale_build_files(src_dir: Path, build_dir: Path) -> list[tuple[Path, str]]:
    """`(ts_path, "missing" | "outdated")` for every source whose compiled JS is
    absent or older than it. Empty when the build is fresh or `src_dir` is absent."""
    if not src_dir.exists():
        return []
    stale: list[tuple[Path, str]] = []
    for ts_path in src_dir.rglob("*.ts"):
        if ts_path.name.endswith(".d.ts"):
            continue
        js_path = build_dir / ts_path.relative_to(src_dir).with_suffix(".js")
        if not js_path.exists():
            stale.append((ts_path, "missing"))
        elif js_path.stat().st_mtime < ts_path.stat().st_mtime:
            stale.append((ts_path, "outdated"))
    return stale


def _run_node(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", "--input-type=module", "--eval", script],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )


def load_tool_catalog(
    build_dir: Path = ENGINE_DIR / "build",
    *,
    run: Callable[[str], Any] = _run_node,
    require_fresh: bool = False,
    src_dir: Path = ENGINE_DIR / "src",
) -> dict[str, dict[str, Any]]:
    """``{tool: {"description", "inputSchema"}}`` from ``build/tool-schemas.js``.

    Raises `CatalogUnavailable` naming the build on any failure -- a missing
    file, a node error, empty or unparseable output -- and, with
    ``require_fresh``, on a build older than its sources. Never returns ``{}``:
    an empty catalog must not read as "no tools advertised".
    """
    fix = "cd packages/engine/mcp-server && npm run build"
    schemas_js = build_dir / "tool-schemas.js"
    if not schemas_js.is_file():
        raise CatalogUnavailable(f"{schemas_js} does not exist (fix: {fix})")
    if require_fresh:
        stale = stale_build_files(src_dir, build_dir)
        if stale:
            ts, why = stale[0]
            raise CatalogUnavailable(
                f"the build at {build_dir} is stale ({len(stale)} file(s), e.g. {ts.name} {why}; fix: {fix})"
            )
    script = (
        f"import {{ allToolSchemas }} from '{node_module_url(schemas_js)}';"
        " const out = allToolSchemas.map("
        "(s) => ({ name: s.name, description: s.description, inputSchema: s.inputSchema })"
        ");"
        " process.stdout.write(JSON.stringify(out));"
    )
    try:
        proc = run(script)
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        # ValueError covers UnicodeDecodeError: a stray non-UTF-8 byte on node's
        # stdout/stderr must read as "unavailable", not escape as a traceback.
        raise CatalogUnavailable(f"could not run node on {schemas_js}: {e}") from e
    if getattr(proc, "returncode", 0) not in (0, None):
        raise CatalogUnavailable(
            f"node exited {proc.returncode} reading {schemas_js}: {(proc.stderr or '').strip()[:300]}"
        )
    out = (proc.stdout or "").strip()
    if not out:
        raise CatalogUnavailable(f"node printed nothing reading {schemas_js}")
    try:
        entries = json.loads(out)
        catalog = {
            e["name"]: {"description": e.get("description"), "inputSchema": e.get("inputSchema")}
            for e in entries
        }
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        raise CatalogUnavailable(f"unreadable catalog from {schemas_js}: {e}") from e
    if not catalog:
        raise CatalogUnavailable(f"{schemas_js} advertises no tools")
    return catalog


# --- the envelope field -----------------------------------------------------------


def instrument_for(
    skill: str,
    repo_root: Path,
    *,
    catalog: dict[str, dict[str, Any]],
    live_called: Iterable[str] | None = None,
) -> dict[str, Any]:
    """The `instrument` envelope value for one suite. `live_modules` is included
    only when `live_called` is given (the final write knows the run's calls)."""
    out: dict[str, Any] = {
        "validators": validators_fingerprint(skill, repo_root / "eval" / "harness" / "validators"),
        "tools": tools_fingerprint(
            catalog,
            fixture_tools(skill, repo_root / "eval" / "tests" / "unit", repo_root / "eval" / "fixtures" / "mcp"),
        ),
    }
    if live_called is not None:
        out["live_modules"] = live_modules_fingerprint(
            live_called, repo_root / "packages" / "engine" / "mcp-server" / "build"
        )
    return out
