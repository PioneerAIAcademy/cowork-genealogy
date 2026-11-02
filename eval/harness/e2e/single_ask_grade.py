"""Deterministic grade for a single-ask e2e turn (spec §16, issue #3527).

Pure: every function here reads its arguments and nothing else, so the grade can
be tested on synthetic records with no network and no workspace. The spawn
predicate is the orchestrator's own, so there is one definition of an Agent call.

PASS needs all six checks (five bullets; the tool checks share one):

- ``owner`` — the first main-thread unit is the fixture's ``expected_owner``, or
  one of them when it is a list (``None`` there means no unit ran: the main
  thread answered). The ``research`` router (it always runs first) and the
  fixture's ``setup_units`` are skipped; a spawn nested inside a subagent is
  recorded but never the owner.
- ``no_research_job`` — no ``question-selection`` spawn and no ``research-plan``
  spawn (unless the ask is a plan) on any thread, and no new ``questions`` (or,
  unless a plan ask, ``plans``) entry. The persisted half catches a research job
  the spawn half misses.
- ``save`` — any one of the ``expected_save`` alternatives holds: a new
  ``sources`` entry, a new ``log`` entry whose ``tool`` (and ``outcome``, when
  given) is the expected value, or, with ``absent``, no new entry in the section.
  New = id in the final ``research.json`` and absent from the starting one.
- ``forbidden_tools`` / ``required_tools`` — none of the first, and every one of
  the second, was called on any thread (bare tool names); a required call that
  errored does not count. Beside a background spawn, a forbidden-tool or
  ``absent`` pass fails: the spawn can act after the grade reads the record.

- ``stop`` — the turn ended on its own. A turn a cap or watchdog cut off fails
  here: what it saved before the cut is not an answer the patron got. The cost
  cap is not a cut-off (it only labels a finished run), so it does not fail this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from e2e.orchestrator import _is_agent_tool

ROUTER_UNIT = "research"
SAVE_SECTIONS = ("log", "sources")
CHECKS = ("owner", "no_research_job", "save", "forbidden_tools", "required_tools", "stop")
# Set after the fact from the final ResultMessage; the turn was not cut off.
LABEL_ONLY_STOPS = ("cost_cap",)
ASYNC_LAUNCH = "Async agent launched"


@dataclass(frozen=True)
class SingleAskSpec:
    id: str
    message: str
    expected_owner: str | tuple[str | None, ...]
    expected_save: dict[str, Any] | tuple[dict[str, Any], ...]
    is_plan_ask: bool = False
    setup_units: tuple[str, ...] = ()
    must_not: str = ""
    forbidden_tools: tuple[str, ...] = ()
    required_tools: tuple[str, ...] = ()


def owners(spec: SingleAskSpec) -> tuple[str | None, ...]:
    raw = spec.expected_owner if isinstance(spec.expected_owner, tuple) else (spec.expected_owner,)
    return tuple(None if o is None else _unit_name(o) for o in raw)


def saves(spec: SingleAskSpec) -> tuple[dict[str, Any], ...]:
    raw = spec.expected_save
    return raw if isinstance(raw, tuple) else (raw,)


@dataclass
class SingleAskGrade:
    passed: bool
    checks: dict[str, tuple[bool, str]]
    first_unit: str | None
    units: list[dict[str, Any]]
    delivered: bool
    extraction_appends: int
    stop: str
    background_spawns: int = 0
    failed: list[str] = field(default_factory=list)


def _bare(tool: str) -> str:
    return tool.rsplit("__", 1)[-1]


def _unit_name(raw: Any) -> str:
    """`genealogy-research:source-evaluation` -> `source-evaluation`."""
    return str(raw).rsplit(":", 1)[-1]


def _is_main(entry: dict[str, Any]) -> bool:
    # `thread` is exact (set from parent_tool_use_id when the call is streamed);
    # `agent_id` is the fallback for records that predate it, and is absent on an
    # entry whose result never arrived.
    thread = entry.get("thread")
    if thread in ("main", "sub"):
        return thread == "main"
    return entry.get("agent_id") is None


def spawned_units(tool_calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every Agent/Task and Skill call, in order, with its thread."""
    units: list[dict[str, Any]] = []
    for entry in tool_calls:
        tool = str(entry.get("tool") or "")
        args = entry.get("args") or {}
        if _is_agent_tool(tool):
            name = _unit_name(args.get("subagent_type") or "general-purpose")
        elif tool == "Skill":
            name = _unit_name(args.get("skill") or "?")
        else:
            continue
        units.append({"unit": name, "main_thread": _is_main(entry)})
    return units


def first_unit(units: list[dict[str, Any]], setup_units: tuple[str, ...] = ()) -> str | None:
    skip = {ROUTER_UNIT, *setup_units}
    for u in units:
        if u["main_thread"] and u["unit"] not in skip:
            return u["unit"]
    return None


def _ids(research: dict[str, Any] | None, section: str) -> set[str]:
    rows = (research or {}).get(section)
    if not isinstance(rows, list):
        return set()
    return {str(r.get("id")) for r in rows if isinstance(r, dict) and r.get("id") is not None}


def _new_rows(
    starting: dict[str, Any] | None, final: dict[str, Any] | None, section: str
) -> list[dict[str, Any]]:
    before = _ids(starting, section)
    rows = (final or {}).get(section)
    if not isinstance(rows, list):
        return []
    return [
        r for r in rows
        if isinstance(r, dict) and r.get("id") is not None and str(r["id"]) not in before
    ]


def _owner_text(expected: tuple[str | None, ...]) -> str:
    return "|".join(o or "none" for o in expected)


def _save_check(
    alt: dict[str, Any], starting: dict[str, Any] | None, final: dict[str, Any]
) -> tuple[bool, str]:
    section = str(alt.get("section") or "")
    new = _new_rows(starting, final, section)
    if alt.get("absent"):
        return (not new, f"no new {section}" if not new else f"{len(new)} new {section}, expected none")
    if section == "log":
        want_tool, want_outcome = alt.get("tool"), alt.get("outcome")
        want = f"log tool={want_tool}" + (f" outcome={want_outcome}" if want_outcome else "")
        hit = any(
            r.get("tool") == want_tool and (not want_outcome or r.get("outcome") == want_outcome)
            for r in new
        )
        got = [f"{r.get('tool')}/{r.get('outcome')}" for r in new]
        return (hit, want if hit else f"missing {want} (new log rows: {got or 'none'})")
    return (bool(new), f"{len(new)} new {section}" if new else f"missing new {section}")


def grade(
    *,
    tool_calls: list[dict[str, Any]],
    spec: SingleAskSpec,
    starting_research: dict[str, Any] | None,
    final_research: dict[str, Any] | None,
    aborted_reason: str | None = None,
) -> SingleAskGrade:
    units = spawned_units(tool_calls)
    expected = owners(spec)
    first = first_unit(units, tuple(_unit_name(u) for u in spec.setup_units))
    checks: dict[str, tuple[bool, str]] = {}

    checks["owner"] = (
        first in expected,
        f"first main-thread unit {first or 'none'}, expected {_owner_text(expected)}",
    )

    forbidden = {"question-selection"} | (set() if spec.is_plan_ask else {"research-plan"})
    job_reasons = sorted({u["unit"] for u in units if u["unit"] in forbidden})
    if final_research is None:
        job_reasons.append("no research.json")
    else:
        if _new_rows(starting_research, final_research, "questions"):
            job_reasons.append("new questions entry")
        if not spec.is_plan_ask and _new_rows(starting_research, final_research, "plans"):
            job_reasons.append("new plans entry")
    checks["no_research_job"] = (
        not job_reasons,
        ", ".join(job_reasons) if job_reasons else "none started",
    )

    if final_research is None:
        checks["save"] = (False, "no research.json")
    else:
        results = [_save_check(alt, starting_research, final_research) for alt in saves(spec)]
        hit = next((d for ok, d in results if ok), None)
        checks["save"] = (hit is not None, hit or " or ".join(d for _, d in results))

    called = {_bare(str(e.get("tool") or "")) for e in tool_calls}
    # An errored call (auth expired, denied) read nothing.
    succeeded = {
        _bare(str(e.get("tool") or "")) for e in tool_calls if e.get("is_error") is not True
    }
    bad = [t for t in spec.forbidden_tools if t in called]
    checks["forbidden_tools"] = (
        not bad,
        f"called {', '.join(bad)}" if bad
        else f"none of [{', '.join(spec.forbidden_tools)}] called" if spec.forbidden_tools
        else "none declared",
    )
    missing = [t for t in spec.required_tools if t not in succeeded]
    checks["required_tools"] = (
        not missing,
        f"never called without error: {', '.join(missing)}" if missing
        else f"[{', '.join(spec.required_tools)}] called" if spec.required_tools
        else "none declared",
    )

    delivered = any(
        _bare(str(e.get("tool") or "")) == "research_delivered" and _is_main(e)
        for e in tool_calls
    )
    extraction_appends = sum(
        1 for e in tool_calls if _bare(str(e.get("tool") or "")) == "extraction_append"
    )
    checks["stop"] = (
        aborted_reason is None or aborted_reason in LABEL_ONLY_STOPS,
        aborted_reason or "clean",
    )
    # A background spawn's work can land after research.json is read, so a
    # `save` FAIL beside one may be a timing artifact; printed, not graded.
    background_spawns = sum(
        1 for e in tool_calls
        if _is_agent_tool(str(e.get("tool") or "")) and ASYNC_LAUNCH in str(e.get("response_summary") or "")
    )
    # A background spawn can call a tool or save after the grade reads the
    # record, so a check that passes on an absence cannot be trusted beside one.
    if background_spawns:
        if spec.forbidden_tools and checks["forbidden_tools"][0]:
            checks["forbidden_tools"] = (False, "background spawn: an absence cannot be confirmed")
        if any(alt.get("absent") for alt in saves(spec)) and checks["save"][0]:
            checks["save"] = (False, "background spawn: an absence cannot be confirmed")
    failed = [name for name in CHECKS if not checks[name][0]]
    return SingleAskGrade(
        passed=not failed,
        checks=checks,
        first_unit=first,
        units=units,
        delivered=delivered,
        extraction_appends=extraction_appends,
        stop=aborted_reason or "clean",
        background_spawns=background_spawns,
        failed=failed,
    )


def format_line(spec: SingleAskSpec, g: SingleAskGrade) -> str:
    """One line per fixture; names every failing check and how the turn stopped."""
    save_ok, save_detail = g.checks["save"]
    order = " > ".join(
        u["unit"] if u["main_thread"] else f"({u['unit']})" for u in g.units
    ) or "none"
    line = (
        f"{'PASS' if g.passed else 'FAIL'} {spec.id}  "
        f"expected={_owner_text(owners(spec))}  first={g.first_unit or 'none'}  "
        f"save={'ok' if save_ok else save_detail}  "
        f"delivered={'yes' if g.delivered else 'no'}  stop={g.stop}"
    )
    if g.failed:
        line += f"  failed=[{','.join(g.failed)}]"
    line += f"\n    units: {order}  extraction_append={g.extraction_appends}"
    if g.background_spawns:
        line += (
            f"\n    background spawns: {g.background_spawns} "
            "(their tool calls and saves can land after the grade read research.json)"
        )
    if not g.checks["no_research_job"][0]:
        line += f"\n    research job: {g.checks['no_research_job'][1]}"
    for name in ("forbidden_tools", "required_tools"):
        if not g.checks[name][0]:
            line += f"\n    {name}: {g.checks[name][1]}"
    if spec.must_not:
        line += f"\n    must not (not graded): {spec.must_not}"
    return line
