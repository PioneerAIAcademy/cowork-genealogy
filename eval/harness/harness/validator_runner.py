"""Invoke deterministic validators per unit-test-spec.md §8.

The harness imports test_universal.py + test_<skill>.py if present, finds all
top-level test_* functions, and calls each with the args from its signature
(a subset of {before_state, after_state, tool_calls, skill_frontmatter}).

This matches the spec's "Validators that don't need an argument simply ignore
it" while remaining compatible with the seed validators' pytest-style fixtures.
"""

from __future__ import annotations

import importlib.util
import inspect
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

# Validators authored as pytest test functions use pytest.skip() to signal
# "not applicable to this state." We catch that explicitly rather than
# string-matching the exception name.
from _pytest.outcomes import Skipped


@dataclass
class ValidatorRunResult:
    name: str
    passed: bool
    error: str | None


def run_validators(
    *,
    skill: str,
    validators_dir: Path,
    before_state: dict[str, Any],
    after_state: dict[str, Any],
    tool_calls: list[dict[str, Any]],
    skill_frontmatter: dict[str, Any] | None = None,
    test: dict[str, Any] | None = None,
) -> list[ValidatorRunResult]:
    """Run universal validators + the per-skill validator file if present."""
    results: list[ValidatorRunResult] = []

    available_args = {
        "before_state": before_state,
        "after_state": after_state,
        "tool_calls": tool_calls,
        "skill_frontmatter": skill_frontmatter or {},
        # `test` is the parsed test JSON dict (the inner "test" block).
        # Validators gate test-specific checks on test["tags"], e.g.
        #   if "slug-apostrophe" not in test.get("tags", []): pytest.skip(...)
        "test": test or {},
    }

    universal = validators_dir / "test_universal.py"
    if universal.exists():
        module = _import_validator_module(universal, "harness_validators_universal")
        results.extend(_run_module(module, available_args))

    skill_validator = validators_dir / f"test_{skill.replace('-', '_')}.py"
    if skill_validator.exists():
        module = _import_validator_module(
            skill_validator, f"harness_validators_{skill.replace('-', '_')}"
        )
        results.extend(_run_module(module, available_args))

    return results


def _import_validator_module(path: Path, name: str):
    """Import a validator file as a module.

    Adds the validator file's directory to sys.path so seed validators
    can `from validators_lib import ...` (the shared helpers module).
    Without this, importlib.util.spec_from_file_location loads the file
    but the validator's internal imports fail.
    """
    parent_str = str(path.parent)
    needs_cleanup = parent_str not in sys.path
    if needs_cleanup:
        sys.path.insert(0, parent_str)
    try:
        spec = importlib.util.spec_from_file_location(name, path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"cannot load validator module from {path}")
        module = importlib.util.module_from_spec(spec)
        # Register in sys.modules so dataclasses / inspect can resolve types.
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        if needs_cleanup:
            try:
                sys.path.remove(parent_str)
            except ValueError:
                pass


def _run_module(module, available_args: dict[str, Any]) -> list[ValidatorRunResult]:
    out: list[ValidatorRunResult] = []
    for attr_name in dir(module):
        if not attr_name.startswith("test_"):
            continue
        fn = getattr(module, attr_name)
        if not callable(fn):
            continue
        sig = inspect.signature(fn)
        try:
            kwargs = {
                name: available_args[name]
                for name in sig.parameters
                if name in available_args
            }
            # If the function declares a parameter we don't know about, skip
            # it gracefully — pytest fixtures we can't supply.
            if len(kwargs) != len(sig.parameters):
                missing = set(sig.parameters) - set(kwargs)
                valid = sorted(available_args.keys())
                out.append(
                    ValidatorRunResult(
                        name=attr_name,
                        passed=False,
                        error=(
                            f"validator declares unknown parameter(s): "
                            f"{sorted(missing)}. Valid harness-supplied "
                            f"args are: {valid}"
                        ),
                    )
                )
                continue
            fn(**kwargs)
            out.append(ValidatorRunResult(name=attr_name, passed=True, error=None))
        except AssertionError as e:
            out.append(
                ValidatorRunResult(
                    name=attr_name, passed=False, error=str(e) or "assertion failed"
                )
            )
        except Skipped as e:
            # pytest.skip() raises Skipped (a BaseException subclass). Treat
            # it as "validator did not apply" → passed with reason captured.
            out.append(
                ValidatorRunResult(
                    name=attr_name,
                    passed=True,
                    error=f"skipped: {e}",
                )
            )
        except Exception as e:  # noqa: BLE001 — validator bug, surface verbatim
            out.append(
                ValidatorRunResult(
                    name=attr_name,
                    passed=False,
                    error=f"{type(e).__name__}: {e}",
                )
            )
    return out


def all_passed(results: list[ValidatorRunResult]) -> bool:
    return all(r.passed for r in results)


def as_dicts(results: list[ValidatorRunResult]) -> list[dict[str, Any]]:
    return [
        {"name": r.name, "passed": r.passed, "error": r.error} for r in results
    ]
