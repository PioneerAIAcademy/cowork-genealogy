"""`harness.instrument` -- the run-log `instrument` fingerprint (issue #2479 PR 3).

Each guard is proven in both directions on the real validator files: an edit that
changes what a validator decides must move the hash, and an edit that changes
only what it says or how it is laid out must not. A whole-file byte hash would
pass every must-fail here and fail every must-pass, which is how a guard like
this ends up skipped within a month.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from types import SimpleNamespace

import jsonschema
import pytest

from harness import instrument
from harness.instrument import (
    LIVE_MODULES,
    LIVE_TOOLS,
    CatalogUnavailable,
    canonical_module,
    hash_validator_file,
    live_modules_fingerprint,
    live_tools_called,
    load_tool_catalog,
    tools_fingerprint,
    validators_fingerprint,
)

REPO = Path(__file__).resolve().parents[4]
VALIDATORS = REPO / "eval" / "harness" / "validators"


def _swap_once(source: str, old: str, new: str) -> str:
    assert source.count(old) >= 1, f"premise gone: {old!r} no longer in the validator"
    return source.replace(old, new, 1)


# --- validators: must fail (the hash moves) -------------------------------------

CONVERT_DATES = (VALIDATORS / "test_convert_dates.py").read_text(encoding="utf-8")


def test_renaming_a_gate_tag_moves_the_hash():
    """Must-fail 1: the validator now gates on a tag no test carries, so it skips forever."""
    mutated = _swap_once(CONVERT_DATES, '"no-gregorian-equivalent" not in', '"renamed-tag" not in')
    assert canonical_module(mutated) != canonical_module(CONVERT_DATES)


def test_inverting_an_assertion_moves_the_hash():
    """Must-fail 2."""
    mutated = _swap_once(CONVERT_DATES, "assert not accepted", "assert accepted")
    assert canonical_module(mutated) != canonical_module(CONVERT_DATES)


def test_changing_a_computed_value_an_assertion_reads_moves_the_hash():
    """Must-fail 4: the Assert node is byte-identical; only the value it reads changed.
    A hash over assertions alone passes this."""
    mutated = _swap_once(CONVERT_DATES, '.get("ok")]', '.get("error")]')
    assert canonical_module(mutated) != canonical_module(CONVERT_DATES)


def test_flipping_a_skip_condition_in_the_shared_validators_moves_the_hash():
    """Must-fail 5: only the `if` around the skip changed, not the skip call."""
    source = (VALIDATORS / "test_universal.py").read_text(encoding="utf-8")
    mutated = _swap_once(source, 'if test.get("type") != "positive":', 'if test.get("type") == "positive":')
    assert canonical_module(mutated) != canonical_module(source)


@pytest.mark.parametrize(
    "before, after",
    [
        # a nested function repointed from the outer variable to its own (must-fail 8)
        ("return total + seen", "return seen + seen"),
        # a parameter rename: validators receive fixtures by parameter name
        ("def test_y(x):", "def test_y(z):"),
        # a gating check demoted to report-only
        ("def test_y(x):", "def report_y(x):"),
        # `raise AssertionError` as the failure path, not an assert
        ("    assert inner(x)\n", "    if not inner(x):\n        raise AssertionError('no')\n"),
    ],
    ids=["nested-repoint", "param-rename", "test-to-report", "assert-to-raise"],
)
def test_decision_changes_move_the_hash(before, after):
    src = (
        "def test_y(x):\n"
        "    total = 1\n"
        "    def inner(v):\n"
        "        seen = v\n"
        "        return total + seen\n"
        "    assert inner(x)\n"
    )
    assert canonical_module(src.replace(before, after)) != canonical_module(src)


# --- validators: must pass (the hash holds) --------------------------------------


def _rename_first_local(source: str) -> tuple[str, str, str]:
    """Rename the first assigned local of the first top-level function that has
    one, inside that function's text only. Returns (new_source, old, new)."""
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    for fn in tree.body:
        if not isinstance(fn, ast.FunctionDef):
            continue
        params = {a.arg for a in fn.args.args}
        for node in ast.walk(fn):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store) and node.id not in params:
                old = node.id
                new = f"{old}_renamed_local"
                start, end = fn.lineno - 1, fn.end_lineno
                body = re.sub(rf"\b{re.escape(old)}\b", new, "".join(lines[start:end]))
                return "".join(lines[:start]) + body + "".join(lines[end:]), old, new
    raise AssertionError("no top-level function with a local to rename")


def test_reflow_reword_and_rename_leave_the_hash_alone():
    """Must-pass 1 on a real validator: reflow the module docstring, reword every
    assertion message, add a comment, and rename a local the assertions read."""
    source = (VALIDATORS / "test_person_evidence.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    doc = ast.get_docstring(tree, clean=False)
    assert doc, "premise gone: test_person_evidence.py has no module docstring"
    mutated = source.replace(doc, " ".join(doc.split()), 1)
    mutated = mutated.replace("\ndef ", "\n# a comment that decides nothing\ndef ", 1)
    mutated, _old, _new = _rename_first_local(mutated)
    assert canonical_module(mutated) == canonical_module(source)


def test_rewording_an_assertion_message_leaves_the_hash_alone():
    assert canonical_module('def test_a(x):\n    assert x, "one wording"\n') == canonical_module(
        'def test_a(x):\n    assert x, f"another wording {x}"\n'
    )


def test_renaming_a_local_a_nested_function_closes_over_leaves_the_hash_alone():
    """Must-pass 5: one mapping per top-level function keeps a closure's read in step."""
    src = "def test_y(x):\n    total = 1\n    def inner(v):\n        return total + v\n    assert inner(x)\n"
    assert canonical_module(src) == canonical_module(src.replace("total", "grand_total"))


def test_every_validator_file_canonicalises():
    for path in sorted(VALIDATORS.glob("*.py")):
        canonical_module(path.read_text(encoding="utf-8"))


# --- validators_fingerprint -------------------------------------------------------


def test_suite_and_shared_halves_move_independently(tmp_path):
    for name in ("test_universal.py", "validators_lib.py", "test_demo.py"):
        (tmp_path / name).write_text(f"def test_{name[:4]}(x):\n    assert x\n", encoding="utf-8")
    base = validators_fingerprint("demo", tmp_path)
    (tmp_path / "test_demo.py").write_text("def test_demo(x):\n    assert not x\n", encoding="utf-8")
    after_suite = validators_fingerprint("demo", tmp_path)
    assert after_suite["suite"] != base["suite"] and after_suite["shared"] == base["shared"]
    (tmp_path / "validators_lib.py").write_text("def helper(x):\n    return not x\n", encoding="utf-8")
    after_shared = validators_fingerprint("demo", tmp_path)
    assert after_shared["shared"] != after_suite["shared"] and after_shared["suite"] == after_suite["suite"]


def test_a_suite_with_no_validator_file_gets_a_marker_that_moves_when_one_appears(tmp_path):
    absent = hash_validator_file(tmp_path / "test_gps_mentor.py")
    assert re.fullmatch(r"[a-f0-9]{64}", absent)
    (tmp_path / "test_gps_mentor.py").write_text("def test_g(x):\n    assert x\n", encoding="utf-8")
    assert hash_validator_file(tmp_path / "test_gps_mentor.py") != absent


# --- tools ------------------------------------------------------------------


def _catalog(**overrides):
    names = set(LIVE_TOOLS) | {"record_search", "person_read", "brand_new_tool"}
    cat = {n: {"description": f"{n} does a thing", "inputSchema": {"type": "object"}} for n in names}
    cat.update(overrides)
    return cat


def test_a_fixture_tool_description_change_moves_only_the_fixture_half():
    """Must-fail 3."""
    base = tools_fingerprint(_catalog(), {"record_search"})
    after = tools_fingerprint(
        _catalog(record_search={"description": "rewritten", "inputSchema": {"type": "object"}}),
        {"record_search"},
    )
    assert after["fixture"] != base["fixture"] and after["live"] == base["live"]


def test_a_live_tool_description_change_moves_only_the_live_half():
    base = tools_fingerprint(_catalog(), {"record_search"})
    after = tools_fingerprint(
        _catalog(research_append={"description": "rewritten", "inputSchema": {"type": "object"}}),
        {"record_search"},
    )
    assert after["live"] != base["live"] and after["fixture"] == base["fixture"]


def test_a_tool_no_suite_advertises_moves_nothing():
    """Must-pass 2: a new tool no fixture names and that is not live."""
    cat = _catalog()
    without = {k: v for k, v in cat.items() if k != "brand_new_tool"}
    assert tools_fingerprint(cat, {"record_search"}) == tools_fingerprint(without, {"record_search"})


def test_a_live_tool_this_suite_serves_from_its_own_fixtures_counts_as_suite_specific():
    """`person_warnings` is live, yet check-warnings serves it from fixtures: its
    description there is suite-specific, so it belongs to the blocking half."""
    changed = _catalog(person_warnings={"description": "rewritten", "inputSchema": {}})
    base = tools_fingerprint(_catalog(), {"person_warnings"})
    after = tools_fingerprint(changed, {"person_warnings"})
    assert after["fixture"] != base["fixture"] and after["live"] == base["live"]


def test_fixture_tools_reads_the_suites_real_fixtures():
    tools = instrument.fixture_tools(
        "search-records", REPO / "eval" / "tests" / "unit", REPO / "eval" / "fixtures" / "mcp"
    )
    assert "record_search" in tools


# --- live modules ---------------------------------------------------------------


def test_live_modules_covers_every_live_tool():
    """The dedicated handlers (research_append & co.) never consult mock_mcp's
    `_COMPILED_TOOLS`, so the map is its own table and must stay complete."""
    assert set(LIVE_MODULES) == LIVE_TOOLS


@pytest.mark.requires_engine_build
def test_every_live_module_exists_in_the_build():
    build = REPO / "packages" / "engine" / "mcp-server" / "build"
    missing = [m for m in LIVE_MODULES.values() if not (build / m).is_file()]
    assert not missing


def test_live_tools_called_reads_only_live_calls():
    tests = [{"runs": [{"output": {"tool_calls": [
        {"tool": "mcp__genealogy__research_append", "matched": {"kind": "live"}},
        {"tool": "mcp__genealogy__record_search", "matched": {"kind": "predicate"}},
    ]}}]}]
    assert live_tools_called(tests) == {"research_append"}


def test_live_modules_fingerprint_hashes_bytes_and_moves_on_change(tmp_path):
    (tmp_path / "tools").mkdir()
    module = tmp_path / LIVE_MODULES["research_append"]
    module.write_text("export const a = 1;\n", encoding="utf-8")
    base = live_modules_fingerprint({"research_append"}, tmp_path)
    module.write_text("export const a = 2;\n", encoding="utf-8")
    assert live_modules_fingerprint({"research_append"}, tmp_path) != base


# --- the catalog never comes back empty ---------------------------------------------


def _build(tmp_path) -> Path:
    build = tmp_path / "build"
    build.mkdir()
    (build / "tool-schemas.js").write_text("// stub\n", encoding="utf-8")
    return build


def _ok(stdout: str, returncode: int = 0):
    return lambda _script: SimpleNamespace(returncode=returncode, stdout=stdout, stderr="boom")


def test_a_missing_build_raises_naming_it(tmp_path):
    with pytest.raises(CatalogUnavailable, match="tool-schemas.js"):
        load_tool_catalog(tmp_path / "build", run=_ok("[]"))


@pytest.mark.parametrize(
    "run",
    [
        _ok("", 0),
        _ok("not json", 0),
        _ok("[]", 0),
        _ok('[{"name": "a"}]', 1),
        _ok('[{"no_name": 1}]', 0),
    ],
    ids=["empty-stdout", "bad-json", "no-tools", "node-failed", "malformed-entry"],
)
def test_any_unreadable_catalog_raises_rather_than_returning_empty(tmp_path, run):
    with pytest.raises(CatalogUnavailable):
        load_tool_catalog(_build(tmp_path), run=run, src_dir=tmp_path / "src")


def test_a_readable_catalog_loads(tmp_path):
    payload = json.dumps([{"name": "a", "description": "d", "inputSchema": {"type": "object"}}])
    assert load_tool_catalog(_build(tmp_path), run=_ok(payload)) == {
        "a": {"description": "d", "inputSchema": {"type": "object"}}
    }


def test_a_stale_build_raises_only_when_freshness_is_required(tmp_path):
    """The gate requires fresh; the harness path keeps today's stale-tolerant load,
    so a local `.ts` edit does not silently empty the catalog for pytest."""
    import os
    import time

    build = _build(tmp_path)
    src = tmp_path / "src"
    src.mkdir()
    (build / "x.js").write_text("", encoding="utf-8")
    ts = src / "x.ts"
    ts.write_text("", encoding="utf-8")
    later = time.time() + 60
    os.utime(ts, (later, later))
    payload = json.dumps([{"name": "a", "description": "d", "inputSchema": {}}])
    with pytest.raises(CatalogUnavailable, match="stale"):
        load_tool_catalog(build, run=_ok(payload), require_fresh=True, src_dir=src)
    assert load_tool_catalog(build, run=_ok(payload), src_dir=src)


def test_mock_mcp_keeps_its_empty_on_failure_contract(monkeypatch, tmp_path):
    from harness import mock_mcp

    monkeypatch.setattr(mock_mcp, "_MCP_BUILD", tmp_path / "nope")
    assert mock_mcp._load_build_tool_catalog_uncached() == {}


def test_mock_mcp_reads_live_tools_from_here():
    from harness import mock_mcp

    assert mock_mcp.LIVE_TOOLS is LIVE_TOOLS


# --- the envelope value ---------------------------------------------------------


def test_instrument_for_validates_against_the_run_log_schema():
    value = instrument.instrument_for("convert-dates", REPO, catalog=_catalog(), live_called={"convert_calendar"})
    schema = json.loads((REPO / "docs/specs/schemas/run-log.schema.json").read_text(encoding="utf-8"))
    sub = schema["properties"]["instrument"]
    jsonschema.validate(value, sub)
    assert set(value) == {"validators", "tools", "live_modules"}
    assert set(value["live_modules"]) == {"convert_calendar"}


# --- review findings ----------------------------------------------------------------


def test_a_report_function_message_is_graded_so_it_moves_the_hash():
    """A failed `report_*` result's message is the observation the judge reads, so
    rewording it changes what gets graded. In a `test_*` function it does not."""
    report = 'def report_x(reply):\n    assert "locator" not in reply, "The reply quotes an invented locator"\n'
    assert canonical_module(report) != canonical_module(report.replace("an invented locator", "nothing"))
    test = report.replace("report_x", "test_x")
    assert canonical_module(test) == canonical_module(test.replace("an invented locator", "nothing"))


def test_a_report_function_raise_message_moves_the_hash():
    src = "def report_y(r):\n    if r:\n        raise AssertionError('first wording')\n"
    assert canonical_module(src) != canonical_module(src.replace("first wording", "second wording"))


def test_a_keyword_to_an_external_callee_is_not_tied_to_a_nested_parameter():
    """`sorted(xs, key=inner)` names sorted's parameter, not inner's: renaming the
    nested helper's own parameter must not read as a change (round-2 review)."""
    src = "def test_s(xs):\n    def inner(key):\n        return key\n    assert sorted(xs, key=inner)\n"
    renamed = "def test_s(xs):\n    def inner(k):\n        return k\n    assert sorted(xs, key=inner)\n"
    assert canonical_module(src) == canonical_module(renamed)
    broken = "def test_s(xs):\n    def inner(rev):\n        return rev\n    assert sorted(xs, rev=inner)\n"
    assert canonical_module(src) != canonical_module(broken)


@pytest.mark.parametrize(
    "src, changed",
    [
        # a match capture repointed to a different read
        (
            "def test_m(x):\n    y = 0\n    match x:\n        case [y]:\n            return y\n",
            "def test_m(x):\n    z = 0\n    match x:\n        case [y]:\n            return z\n",
        ),
        # a keyword argument that no longer names the nested function's parameter
        (
            "def test_k(t):\n    def inner(x):\n        return x\n    assert inner(x=t)\n",
            "def test_k(t):\n    def inner(q):\n        return q\n    assert inner(x=t)\n",
        ),
    ],
    ids=["match-capture", "nested-keyword"],
)
def test_bindings_held_as_plain_strings_are_renamed_with_their_reads(src, changed):
    """Review finding: a binding stored as a plain string (a match capture, a
    nested function's parameter named by a keyword) was left alone while its reads
    were renamed, so two different programs hashed equal."""
    assert canonical_module(src) != canonical_module(changed)


def test_renaming_a_match_capture_consistently_leaves_the_hash_alone():
    src = "def test_m(x):\n    match x:\n        case [y]:\n            return y\n"
    assert canonical_module(src) == canonical_module(src.replace("y", "item"))


def test_an_external_keyword_argument_is_not_renamed_with_a_same_named_local():
    """Only a keyword naming a NESTED function's parameter is a reference to a
    binding; `f(count=count)` to an external callee must survive a local rename."""
    src = "def test_c(f):\n    count = 1\n    assert f(count=count)\n"
    renamed = "def test_c(f):\n    n = 1\n    assert f(count=n)\n"
    assert canonical_module(src) == canonical_module(renamed)


def test_a_decode_error_from_node_reads_as_unavailable(tmp_path):
    def _raises(_script):
        raise UnicodeDecodeError("utf-8", b"\x97", 0, 1, "invalid start byte")

    with pytest.raises(CatalogUnavailable):
        load_tool_catalog(_build(tmp_path), run=_raises, src_dir=tmp_path / "src")


def test_mock_mcp_survives_a_decode_error_from_node(monkeypatch, tmp_path):
    from harness import mock_mcp

    reached = []

    def _raises(*_a, **_k):
        reached.append(True)
        raise UnicodeDecodeError("utf-8", b"\x97", 0, 1, "invalid start byte")

    monkeypatch.setattr(mock_mcp, "_MCP_BUILD", _build(tmp_path))
    monkeypatch.setattr(mock_mcp, "_run_node_eval", _raises)
    assert mock_mcp._load_build_tool_catalog_uncached() == {}
    assert reached, "the decode path was never exercised"


def test_a_fixture_that_is_not_an_object_is_skipped(tmp_path):
    suite = tmp_path / "tests" / "demo"
    suite.mkdir(parents=True)
    (suite / "t.json").write_text(
        json.dumps({"test": {"id": "ut_demo_001"}, "mcp_fixtures": ["as-array", "as-object"]}), encoding="utf-8"
    )
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    (fixtures / "as-array.json").write_text("[1, 2]", encoding="utf-8")
    (fixtures / "as-object.json").write_text(json.dumps({"tool": "record_search"}), encoding="utf-8")
    assert instrument.fixture_tools("demo", tmp_path / "tests", fixtures) == {"record_search"}



# --- sibling validator modules (self-review round 3) ------------------------------------


def _copy_validators(tmp_path, names):
    for name in names:
        (tmp_path / name).write_text((VALIDATORS / name).read_text(encoding="utf-8"), encoding="utf-8")


def test_a_suite_file_that_star_imports_its_checks_still_fingerprints_them(tmp_path):
    """`test_extraction_append.py` is a docstring and `from extraction_validators
    import *`. Inverting an assertion in the imported module must move the suite
    half for both suites that import it, and leave an unrelated suite alone."""
    names = (
        "test_universal.py", "validators_lib.py", "extraction_validators.py",
        "test_extraction_append.py", "test_record_structurer.py", "test_convert_dates.py",
    )
    _copy_validators(tmp_path, names)
    before = {s: validators_fingerprint(s, tmp_path) for s in ("extraction-append", "record-structurer", "convert-dates")}
    target = tmp_path / "extraction_validators.py"
    source = target.read_text(encoding="utf-8")
    assert "assert not " in source, "premise gone: no `assert not` to invert"
    target.write_text(source.replace("assert not ", "assert ", 1), encoding="utf-8")
    after = {s: validators_fingerprint(s, tmp_path) for s in before}
    assert after["extraction-append"]["suite"] != before["extraction-append"]["suite"]
    assert after["record-structurer"]["suite"] != before["record-structurer"]["suite"]
    assert after["convert-dates"] == before["convert-dates"]


def test_a_comment_in_an_imported_sibling_moves_nothing(tmp_path):
    _copy_validators(tmp_path, ("test_universal.py", "validators_lib.py", "extraction_validators.py", "test_extraction_append.py"))
    before = validators_fingerprint("extraction-append", tmp_path)
    target = tmp_path / "extraction_validators.py"
    target.write_text("# a comment that decides nothing\n" + target.read_text(encoding="utf-8"), encoding="utf-8")
    assert validators_fingerprint("extraction-append", tmp_path) == before


def test_sibling_imports_are_followed_transitively(tmp_path):
    (tmp_path / "test_demo.py").write_text("from helper_a import *\n", encoding="utf-8")
    (tmp_path / "helper_a.py").write_text("from helper_b import check\n", encoding="utf-8")
    (tmp_path / "helper_b.py").write_text("def check(x):\n    assert x\n", encoding="utf-8")
    assert instrument.sibling_validator_imports(tmp_path / "test_demo.py", tmp_path) == ["helper_a.py", "helper_b.py"]
    before = validators_fingerprint("demo", tmp_path)
    (tmp_path / "helper_b.py").write_text("def check(x):\n    assert not x\n", encoding="utf-8")
    assert validators_fingerprint("demo", tmp_path)["suite"] != before["suite"]


def test_a_skip_keyword_that_changes_behaviour_stays_in_the_hash():
    """`allow_module_level=True` turns a raise into a whole-file skip; only the
    reason string is a message."""
    plain = "def test_a(x):\n    pytest.skip('why')\n"
    module_level = "def test_a(x):\n    pytest.skip('why', allow_module_level=True)\n"
    assert canonical_module(plain) != canonical_module(module_level)
    assert canonical_module(plain) == canonical_module("def test_a(x):\n    pytest.skip(reason='other words')\n")


# --- harness_import_closure (issue #3691 item 3) -----------------------------------


def _harness_tree(root: Path, files: dict[str, str]) -> Path:
    """A synthetic `eval/harness/` under `root`; returns its `validators/` dir."""
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    (root / "validators").mkdir(exist_ok=True)
    return root / "validators"


_CLOSURE_TREE = {
    "harness/__init__.py": "",
    "validators/validators_lib.py": "def helper():\n    from harness.lazy import x\n    return x\n",
    "validators/test_universal.py": "import harness.plain\n",
    "validators/test_demo.py": "from harness import bare\nfrom provenance_report import f\nimport json, jsonschema\n",
    "validators/sibling.py": "from harness.via_sibling import y\n",
    "harness/lazy.py": "x = 1\n",
    "harness/plain.py": "from .relative import z\n",
    "harness/relative.py": "from . import dotted\nz = 2\n",
    "harness/dotted.py": "d = 4\n",
    "harness/bare.py": "from harness.transitive import t\n",
    "harness/transitive.py": "t = 3\n",
    "harness/via_sibling.py": "y = 5\n",
    "harness/unreached.py": "u = 6\n",
    "provenance_report.py": "def f():\n    return 7\n",
    "tests/helpers.py": "h = 8\n",
    "validators/test_imports_tests.py": "import tests.helpers\n",
}


def test_the_closure_follows_every_import_form_and_stops_at_dead_ends(tmp_path):
    """In-function, `import harness.x`, `from harness import x`, relative imports
    (`from .x import` and `from . import x`), a top-level module and transitive
    imports are followed, with the package's `__init__.py`; the stdlib, third-party, `validators/` siblings and
    `tests/` are not, and an unimported module stays out."""
    validators = _harness_tree(tmp_path, _CLOSURE_TREE)
    assert instrument.harness_import_closure(validators) == [
        "harness/__init__.py",
        "harness/bare.py",
        "harness/dotted.py",
        "harness/lazy.py",
        "harness/plain.py",
        "harness/relative.py",
        "harness/transitive.py",
        "harness/via_sibling.py",
        "provenance_report.py",
    ]


def test_a_body_change_in_a_closure_module_moves_shared_and_a_docstring_does_not(tmp_path):
    """Both directions on one tree: the transitive module's body moves `shared`
    (not `suite`), then a docstring added to it moves nothing."""
    validators = _harness_tree(tmp_path, _CLOSURE_TREE)
    base = validators_fingerprint("demo", validators)
    target = tmp_path / "harness" / "transitive.py"
    target.write_text("t = 4\n", encoding="utf-8")
    moved = validators_fingerprint("demo", validators)
    assert moved["shared"] != base["shared"] and moved["suite"] == base["suite"]
    target.write_text('"""Now with a docstring."""\nt = 4\n', encoding="utf-8")
    assert validators_fingerprint("demo", validators) == moved


def test_a_module_outside_the_closure_moves_nothing(tmp_path):
    validators = _harness_tree(tmp_path, _CLOSURE_TREE)
    base = validators_fingerprint("demo", validators)
    (tmp_path / "harness" / "unreached.py").write_text("u = 9\n", encoding="utf-8")
    assert validators_fingerprint("demo", validators) == base


def test_the_real_closure_reaches_what_the_validators_import():
    """On the real tree. `fixtures.py` and `context_policy.py` are reached only
    through other harness modules; `judge.py` is not reached at all."""
    closure = instrument.harness_import_closure(VALIDATORS)
    for rel in (
        "harness/dates.py",
        "harness/mock_mcp.py",
        "harness/fixtures.py",
        "harness/context_policy.py",
        "harness/instrument.py",
        "harness/snapshot.py",
        "harness/__init__.py",
        "provenance_report.py",
    ):
        assert rel in closure, rel
    assert "harness/judge.py" not in closure
    assert not any(rel.startswith(("validators/", "tests/")) for rel in closure)


def test_validator_harness_imports_reads_one_file_without_following_it(tmp_path):
    validators = _harness_tree(tmp_path, _CLOSURE_TREE)
    source = (validators / "test_demo.py").read_text(encoding="utf-8")
    assert instrument.validator_harness_imports("test_demo.py", source, validators) == [
        "harness/__init__.py",
        "harness/bare.py",
        "provenance_report.py",
    ]
    assert instrument.validator_harness_imports("test_demo.py", "", validators) == []
