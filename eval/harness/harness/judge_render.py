"""The `judge_render_hash` fingerprint: the code that renders and sends the
judge's request.

`snapshot` certifies the skill-side files a run read; `instrument` fingerprints
the validators and tools; this covers the third input to a verdict — the code
that turns a run into the bytes the judge is shown. `judge_prompt_hash` covers
`judge/prompt.md` alone, and a slot is filled as a VALUE rather than edited in
the template, so changing the code that computes one moved no fingerprint and
left every committed log ACTIVE while the judge saw different text.

**Why this is not in `instrument.py`.** That module is named in
`check_runlogs.INSTRUMENT_EVERY_SUITE_RE` and sits in the validators' import
closure, so *editing* it arms rule 2c for every suite — which then blocks on
any suite carrying pre-existing instrument drift, and the remedy for that is a
paid `make eval-skill` per suite plus its annotation. Living in its own module
keeps this card's cost to the judge regrade it is supposed to cost. Importing
`instrument` is free; only editing it arms the rule.

Stdlib-only: `check_runlogs.py` imports this on a bare interpreter, and
`judge.py` imports `anthropic`, so the gate must PARSE `judge.py`, never import
it.
"""

from __future__ import annotations

import ast
from functools import lru_cache
from pathlib import Path

from harness.instrument import (
    _REPO_ROOT,
    _DropMessages,
    _normalise_locals,
    _resolve_harness_module,
    _sha,
)


# Everything that decides the BYTES SENT to `client.messages.create` (boundary
# set by review, 2026-10-23). `judge_prompt_hash` covers `judge/prompt.md` only;
# a slot is filled as a VALUE rather than edited in the template, so changing
# the code that computes one moved no fingerprint and left every committed log
# ACTIVE while the judge saw different text.
#
# `grade` is its own root although `_run_judge` calls it: the walk follows
# same-module calls plus resolved imports, and an edge into `judge.py` that
# arrives any other way would be missed. `build_judge_grade_kwargs` is reached
# transitively from `_run_judge`.
_JUDGE_RENDER_ROOTS = (
    ("harness.orchestrator", "_run_judge"),
    ("harness.judge", "grade"),
    ("harness.judge", "_create_message_with_retry"),
    ("harness.judge", "render_prompt_parts"),
    ("harness.judge", "_grading_tool_for_rubric"),
)

# Reached by no call in the graph: `load_scenario_brief` runs in
# `_run_one_test_async` and its result arrives as the `scenario_readme`
# PARAMETER, so only naming the module puts the judge's scenario brief in scope.
_JUDGE_RENDER_WHOLE_MODULES = ("harness.scenario_brief",)

# Deliberately outside the fingerprint. `_extract_dimensions` and `_compute_cost`
# interpret the judge's ANSWER rather than render its input; `_make_client` only
# selects the API key, and the model is stamped separately as `judge_model`.
# Named rather than merely absent so that a rename cannot quietly pull one in,
# and so the resolution check below fails if one stops existing.
_JUDGE_RENDER_STOP = (
    ("harness.judge", "_extract_dimensions"),
    ("harness.judge", "_compute_cost"),
    ("harness.judge", "_make_client"),
)

# Still not covered, by construction: a call through an attribute
# (`obj.method()`) or a variable, which no static walk can resolve; and anything
# outside `eval/harness/`.


class JudgeRenderGraphError(RuntimeError):
    """A root, stop-set entry or whole-module no longer resolves.

    Raised rather than skipped: silently dropping a renamed root shrinks the
    fingerprint permanently, and the one hash move the rename causes is cleared
    by the mandated regrade — after which every edit to that code is invisible.
    """


def _is_function(node: ast.stmt | None) -> bool:
    """A def, never a class.

    `_RenderModule.funcs` also indexes ClassDef, which is right for a class
    REACHED BY A CALL -- `Rubric(...)` builds judge input. It is wrong for a
    bare name load, because a type annotation (`auth: AuthConfig`) is one:
    widening this to classes pulled `harness.auth` and `harness.loader` into
    the graph, where an unrelated field edit would have billed a regrade.
    """
    return isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))


class _RenderModule:
    """One parsed harness module: its top-level defs and classes, its
    module-level bindings, and the (module, original name) each imported bound
    name came from."""

    __slots__ = ("funcs", "assigns", "imports")

    def __init__(self, path: Path) -> None:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"))
        except (SyntaxError, UnicodeDecodeError) as exc:
            # The sibling walkers in this module guard the same way. Letting it
            # escape would abort `check_runlogs` for every later skill with a
            # bare traceback naming no file -- the failure mode rule 5 exists
            # to prevent.
            raise JudgeRenderGraphError(f"cannot parse {path}: {exc}") from exc
        self.funcs: dict[str, ast.stmt] = {}
        self.assigns: dict[str, ast.stmt] = {}
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                # ClassDef included: `ScenarioBrief` and `Rubric` are dataclasses
                # whose fields ARE judge input, and a class matches neither of
                # the other two arms.
                self.funcs[node.name] = node
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name):
                        self.assigns[target.id] = node
            elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
                self.assigns[node.target.id] = node
        # Keyed on the BOUND name, valued with the module and the ORIGINAL name:
        # `from m import f as g` binds `g` here and defines `f` there, and
        # enqueueing `g` against `m` would silently drop the callee.
        self.imports: dict[str, tuple[str, str]] = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and not node.level:
                for alias in node.names:
                    self.imports[alias.asname or alias.name] = (node.module, alias.name)


def _render_graph_nodes(validators_dir: Path) -> list[tuple[str, str, ast.stmt]]:
    """Every (module, name, node) the judge's render code reaches.

    A depth-first walk (the pending list is LIFO) from `_JUDGE_RENDER_ROOTS`
    that follows a call into ANOTHER harness module, because
    `build_judge_grade_kwargs` calls four functions defined elsewhere --
    `empty_rubric` (rubric.py) and `spawned_agents` / `agent_return_text` /
    `judge_skills_slot` (skill_runner.py). `agent_return_text` selects the text
    the judge grades and `judge_skills_slot` IS the skills-invoked block, so a
    same-module walk would drop the very code this fingerprint exists to cover.

    A module-level name a reached function reads is collected with it: a
    constant like `JUDGE_TEMPERATURE` decides the request as much as a
    statement does. The walk does not test whether that name is shadowed by a
    local, so a local of the same name pulls its module-level namesake in --
    over-inclusion, never under. Rename invisibility comes from
    `_normalise_locals`, not from this step.

    Raises `JudgeRenderGraphError` when a root, stop-set entry or whole-module
    does not resolve.
    """
    cache: dict[str, _RenderModule | None] = {}

    def index(module: str) -> _RenderModule | None:
        if module not in cache:
            path = _resolve_harness_module(module, validators_dir)
            cache[module] = _RenderModule(path) if path else None
        return cache[module]

    # Every hand-written entry must still resolve. Without this a rename drops
    # the whole subtree behind it with no error (verified in review: renaming
    # one root dropped 8 nodes silently).
    for module, name in _JUDGE_RENDER_ROOTS + _JUDGE_RENDER_STOP:
        mod = index(module)
        if mod is None or name not in mod.funcs:
            raise JudgeRenderGraphError(
                f"{module}.{name} no longer resolves; update _JUDGE_RENDER_ROOTS "
                f"/ _JUDGE_RENDER_STOP in judge_render.py"
            )
    for module in _JUDGE_RENDER_WHOLE_MODULES:
        if index(module) is None:
            raise JudgeRenderGraphError(f"whole-module {module} no longer resolves")

    stop = set(_JUDGE_RENDER_STOP)
    collected: dict[tuple[str, str], ast.stmt] = {}
    pending = list(_JUDGE_RENDER_ROOTS)
    seen: set[tuple[str, str]] = set()

    for module in _JUDGE_RENDER_WHOLE_MODULES:
        mod = index(module)
        if mod is None:
            continue
        for name, node in {**mod.assigns, **mod.funcs}.items():
            collected[(module, name)] = node

    while pending:
        key = pending.pop()
        if key in seen or key in stop:
            continue
        seen.add(key)
        module, name = key
        mod = index(module)
        if mod is None or name not in mod.funcs:
            continue
        node = mod.funcs[name]
        collected[key] = node
        for sub in ast.walk(node):
            if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name):
                called = sub.func.id
                if called in mod.funcs:
                    pending.append((module, called))
                elif called in mod.imports:
                    pending.append(mod.imports[called])
            elif isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Load):
                # A function PASSED BY VALUE is render code too. `_render` takes
                # its live-args strategy as a parameter -- `_live_args_omitted`,
                # `_live_args_as_is`, `_live_args_string_capped` are handed in,
                # never called by name here -- so following only `ast.Call` left
                # all three outside the graph. Editing the "args omitted by
                # harness" marker changed every judge's input and moved no hash.
                if _is_function(mod.funcs.get(sub.id)):
                    pending.append((module, sub.id))
                elif sub.id in mod.assigns:
                    collected[(module, sub.id)] = mod.assigns[sub.id]
                elif sub.id in mod.imports:
                    other_mod, other_name = mod.imports[sub.id]
                    other = index(other_mod)
                    if other is None:
                        continue
                    if _is_function(other.funcs.get(other_name)):
                        pending.append((other_mod, other_name))
                    elif other_name in other.assigns:
                        collected[(other_mod, other_name)] = other.assigns[other_name]
    return [(m, n, collected[(m, n)]) for m, n in sorted(collected)]


def judge_render_graph_modules(validators_dir: Path | None = None) -> set[str]:
    """The harness modules the graph actually reaches.

    `check_runlogs.py` compares its hand-written trigger paths against this, so
    a graph that grows past that list fails a test instead of silently
    downgrading a block to a warning.
    """
    if validators_dir is None:
        validators_dir = _REPO_ROOT / "eval" / "harness" / "validators"
    return {module for module, _, _ in _render_graph_nodes(validators_dir)}


@lru_cache(maxsize=4)
def _judge_render_hash_cached(validators_dir: str) -> str:
    nodes = _render_graph_nodes(Path(validators_dir))
    if not nodes:
        return _sha("absent:judge-render-graph")
    module = ast.Module(body=[node for _, _, node in nodes], type_ignores=[])
    module = _DropMessages().visit(module)
    _normalise_locals(module)
    keys = [f"{mod}:{name}" for mod, name, _ in nodes]
    dumped = ast.dump(module, annotate_fields=True, include_attributes=False)
    return _sha("\n".join(keys) + "\n" + dumped)


def judge_render_hash(validators_dir: Path | None = None) -> str:
    """Fingerprint of the code that renders and sends the judge's request.

    Derived by an AST walk at hash time, never a hand-written list -- the
    "Not covered" list beside the instrument fingerprint went stale that way.

    Stdlib-only and text-only on purpose: `check_runlogs.py` recomputes this on
    a bare interpreter, and `judge.py` imports `anthropic`, so the gate must
    PARSE `judge.py` rather than import it.

    Memoized: `check_runlogs` calls this once per touched skill and again per
    suite, and one call re-parses ~5,700 lines.
    """
    if validators_dir is None:
        validators_dir = _REPO_ROOT / "eval" / "harness" / "validators"
    return _judge_render_hash_cached(str(validators_dir))


