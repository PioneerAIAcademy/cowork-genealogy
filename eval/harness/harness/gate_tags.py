"""Which test tags gate which validators, read statically from validator source.

Recognizes the repo-wide opt-in gate idiom — an `if` whose test is
`"<tag>" not in test.get("tags", [])` and whose body calls `pytest.skip(...)`:

    if "no-browse-no-write" not in test.get("tags", []):
        pytest.skip("not a no-browse-no-write scenario")

The tag check may be one operand of a compound condition, as in citation's
`if test.get("type") != "positive" and "no-new-source" not in
test.get("tags", []):`, so the whole `if` test is walked rather than
shape-matched. Both `test.get("tags", [])` and `(test.get("tags") or [])`
spellings are recognized.

Only the `not in` direction counts. The inverse (`"<tag>" in tags` -> skip) is
an *exclusion* gate — it turns a validator OFF for tagged tests (e.g.
`redirect-no-browse`), so it can never be the invariant a grade_on_invariant
test relies on.

Static (ast) rather than by import: the validator modules declare pytest
fixtures the harness injects by signature, so importing them to introspect
would drag in a fixture-resolution dependency neither caller has any business
owning.

Two views, for two callers:

- `file_gate_tags` — every gate tag anywhere in the module. The runnability
  gate (`runnability.tag_gated_validator_tags`) asks only "does any validator
  here gate on this tag", and that answer counts `report_*` functions too.
- `validator_gate_tags` — per `test_*` function, which is what
  `check_runlogs.py` rule 11 needs to match a run log's validator results. It
  follows a bare-name call to a module-level helper one level deep
  (source-evaluation's `_requires_index_discrepancy`) and a `from <sibling>
  import *`. It leaves out `report_*` functions: their passing and skipped
  results never reach a run log (`validator_runner.as_dicts` drops
  `reporting_only`), so a skip there is not visible to compare.

Stdlib only: `check_runlogs.py` imports this on a bare interpreter.
"""

from __future__ import annotations

import ast
from typing import Callable


def _gate_tags_in(node: ast.AST) -> set[str]:
    tags: set[str] = set()
    for sub in ast.walk(node):
        if not isinstance(sub, ast.If):
            continue
        if not any(
            isinstance(call, ast.Call)
            and ast.unparse(call.func).endswith("pytest.skip")
            for call in ast.walk(sub)
        ):
            continue
        for cmp_node in ast.walk(sub.test):
            if not isinstance(cmp_node, ast.Compare):
                continue
            if len(cmp_node.ops) != 1 or not isinstance(cmp_node.ops[0], ast.NotIn):
                continue
            if not (
                isinstance(cmp_node.left, ast.Constant)
                and isinstance(cmp_node.left.value, str)
            ):
                continue
            if "tags" not in ast.unparse(cmp_node.comparators[0]):
                continue
            tags.add(cmp_node.left.value)
    return tags


def _parse(source: str | None) -> ast.Module | None:
    if source is None:
        return None
    try:
        return ast.parse(source)
    except SyntaxError:
        return None


def file_gate_tags(source: str | None) -> set[str]:
    """Every gate tag in the module. Empty when `source` is None or unparseable
    — the runnability gate turns that into its "no invariant validator"
    failure, which is the correct verdict either way."""
    tree = _parse(source)
    return _gate_tags_in(tree) if tree is not None else set()


def validator_gate_tags(
    source: str | None,
    *,
    sibling: Callable[[str], str | None] = lambda _name: None,
) -> dict[str, set[str]]:
    """{top-level `test_*` function name: the tags that gate it}.

    An ungated validator maps to an empty set. `sibling(name)` returns the
    source of `validators/<name>.py`, or None; a `from <name> import *` it
    resolves merges that module's validators (a local definition wins, as it
    does at import). Empty when `source` is None or unparseable.
    """
    tree = _parse(source)
    if tree is None:
        return {}

    result: dict[str, set[str]] = {}
    for stmt in tree.body:
        if (
            isinstance(stmt, ast.ImportFrom)
            and stmt.level == 0
            and stmt.module
            and any(alias.name == "*" for alias in stmt.names)
        ):
            result.update(validator_gate_tags(sibling(stmt.module), sibling=sibling))

    helpers = {
        stmt.name: _gate_tags_in(stmt)
        for stmt in tree.body
        if isinstance(stmt, ast.FunctionDef) and not stmt.name.startswith("test_")
    }
    for stmt in tree.body:
        if not (isinstance(stmt, ast.FunctionDef) and stmt.name.startswith("test_")):
            continue
        tags = _gate_tags_in(stmt)
        for call in ast.walk(stmt):
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Name):
                tags |= helpers.get(call.func.id, set())
        result[stmt.name] = tags
    return result
