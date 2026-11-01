"""Suite-specific validators for the evaluate-search-results agent (issue #3522).

evaluate-search-results judges ONE full-text search hit against ONE tree person.
It reads the project with `project_context`, the hit with `sidecar_read`, the
target and its one-hop family with one `tree_query` that carries no
`factTypes`, and records one `hit_verdicts` row with `research_append`. It
labels and never extracts.

These are the mechanical checks; whether a verdict is genealogically sound lives
in the rubric. Each reads a deterministic artifact: the call log, the
after-state's `hit_verdicts`, or the contract lines the agent returns above its
`---`. A hit is compared by its log id and its bare id (the part after the last
`:` of an ARK), so either spelling of the id passes, as it does in the tool.

Tag gates: `hit-verdict` marks a test that should end in one verdict.
`expect-match`, `expect-possible-match` and `expect-not-a-match` pin the verdict,
`new-vital` and `no-new-vital` the flag, and `already-extracted` and
`not-extracted` the return's `alreadyExtracted` line. Those are a genealogist's
gold labels, which the schema's enum cannot check. `hand-back` is shared with
test_universal's `test_hand_back_names_its_owner`, which holds a hand-back to no
tool call; the check here holds it to an unchanged project.

See test_universal.py module docstring for the validator function-signature
contract.
"""

from __future__ import annotations

import json
import re

import pytest

from validators_lib import as_mapping, bare_ark_id, bare_tool_name, new_section_entries

_AGENT = "evaluate-search-results"
_SECTION = "hit_verdicts"
_HIT_REF_LINE = re.compile(r"(?m)^\s*hitRef\s*:\s*(?P<ref>\S+)")
_TARGET_LINE = re.compile(r"(?m)^\s*target\s*:\s*(?P<id>[A-Za-z0-9_-]+)")
_REF = re.compile(r"results/(?P<log>log_\d+)\.json#(?P<hit>.+)")
_CONTRACT_LINE = re.compile(
    r"^(?:[-•>]\s*)?(hitRef|verdict|newVitalInfo|alreadyExtracted)\s*:\s*(\S.*)$", re.IGNORECASE
)
_CONTRACT_KEYS = {k.lower(): k for k in ("hitRef", "verdict", "newVitalInfo", "alreadyExtracted")}
_VERDICT_VALUE = re.compile(r"^(possible[ _-]match|not[ _-]a[ _-]match|match)\b")
_BOOL_VALUE = re.compile(r"^(true|false)\b")
_GOLD_VERDICT = {
    "expect-match": "match",
    "expect-possible-match": "possible_match",
    "expect-not-a-match": "not_a_match",
}
_GOLD_FLAG = {"new-vital": True, "no-new-vital": False}
_GOLD_EXTRACTED = {"already-extracted": True, "not-extracted": False}


def _as_list(value) -> list:
    """A list argument a model may have sent as a JSON string, or as a bare
    scalar. Absent reads as empty, which is what the tool does with it."""
    if value is None:
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return [value]
        value = parsed
    return value if isinstance(value, list) else [value]


def _calls(tool_calls, name: str) -> list[dict]:
    return [c for c in (tool_calls or []) if bare_tool_name(c.get("tool", "")) == name]


def _hit_of(ref) -> tuple[str, str] | None:
    """(log id, bare hit id) of a `results/<log_id>.json#<hit id>` ref: its
    first word, less a closing `.`, `,` or `;`."""
    words = ref.split() if isinstance(ref, str) else []
    m = _REF.fullmatch(words[0].rstrip(".,;")) if words else None
    return (m.group("log"), bare_ark_id(m.group("hit"))) if m else None


def _delegated(test) -> tuple[str, str]:
    m = _HIT_REF_LINE.search(str(test.get("delegation") or ""))
    hit = _hit_of(m.group("ref")) if m else None
    assert hit, "Test drift: the delegation carries no `hitRef: results/<log_id>.json#<hit id>` line."
    return hit


def _target(test, before_state) -> str | None:
    """The delegation's `target`, else the project's first subject person."""
    m = _TARGET_LINE.search(str(test.get("delegation") or ""))
    if m:
        return m.group("id")
    project = ((before_state or {}).get("research_json") or {}).get("project") or {}
    subjects = project.get("subject_person_ids") or []
    return subjects[0] if subjects else None


def _new_rows(before_state, after_state) -> list[dict]:
    return new_section_entries(before_state or {}, after_state or {}, _SECTION)


def _row(before_state, after_state) -> dict:
    rows = _new_rows(before_state, after_state)
    assert rows, f"no new {_SECTION} row was written, so there is no verdict to compare"
    return rows[-1]


def _contract(agent_returns, text_response, test) -> dict[str, str]:
    """The contract lines above the reply's final `---`, keyed by their names."""
    from harness.skill_runner import subject_reply_text

    reply = subject_reply_text(agent_returns, text_response, _AGENT, test)
    parts = re.split(r"(?m)^\s*---\s*$", reply)
    block = "\n".join(parts[:-1]) if len(parts) > 1 else reply
    out: dict[str, str] = {}
    for line in block.splitlines():
        m = _CONTRACT_LINE.match(line.replace("*", "").replace("`", "").strip())
        if m:
            out.setdefault(_CONTRACT_KEYS[m.group(1).lower()], m.group(2).strip())
    return out


def _verdict_value(text) -> str | None:
    m = _VERDICT_VALUE.match((text or "").strip().lower())
    return re.sub(r"[ -]", "_", m.group(1)) if m else None


def _bool_value(text) -> bool | None:
    m = _BOOL_VALUE.match((text or "").strip().lower())
    return m.group(1) == "true" if m else None


def _gold(test, table: dict, what: str):
    tags = [t for t in table if t in test.get("tags", [])]
    assert len(tags) == 1, f"Test drift: one {what} tag expected, got {tags}"
    return table[tags[0]]


def _verdict_test(test) -> None:
    if "hit-verdict" not in test.get("tags", []):
        pytest.skip("not a hit-verdict test")


def _research_append_sections(call) -> list:
    args = as_mapping(call.get("args"))
    ops = _as_list(args.get("ops"))
    if ops:
        return [as_mapping(op).get("section") for op in ops]
    return [args.get("section")]


# --- One verdict, on the delegated hit, and nothing else -----------------

def test_one_verdict_row_on_the_delegated_hit(before_state, after_state, test):
    """Exactly one new `hit_verdicts` row, judging the delegated hit against the
    target. Read off the after-state, not the call: a refused append writes no
    row, and a second append for the same hit folds into an update."""
    _verdict_test(test)
    log_id, hit = _delegated(test)
    rows = _new_rows(before_state, after_state)
    assert len(rows) == 1, (
        f"expected exactly one new {_SECTION} row, got {len(rows)}: "
        f"{[(r.get('id'), r.get('log_id'), r.get('hit_id')) for r in rows]}"
    )
    row = rows[0]
    assert (row.get("log_id"), bare_ark_id(row.get("hit_id"))) == (log_id, hit), (
        f"the row judges {row.get('log_id')}#{row.get('hit_id')}, not the delegated hit {log_id}#{hit}"
    )
    target = _target(test, before_state)
    assert row.get("target_person_id") == target, (
        f"the row judges the hit against {row.get('target_person_id')!r}; the target is {target!r}"
    )


def test_writes_nothing_but_the_verdict(before_state, after_state, tool_calls, test):
    """The agent labels and never extracts: no research.json section but
    `hit_verdicts` changes, the tree does not change, and every
    `research_append` names `hit_verdicts`."""
    _verdict_test(test)
    before = (before_state or {}).get("research_json") or {}
    after = (after_state or {}).get("research_json") or {}
    changed = sorted(k for k in set(before) | set(after) if k != _SECTION and before.get(k) != after.get(k))
    assert not changed, f"research.json sections other than {_SECTION} changed: {changed}"
    assert (before_state or {}).get("tree_gedcomx_json") == (after_state or {}).get("tree_gedcomx_json"), (
        "tree.gedcomx.json changed; the agent records a verdict and edits nothing"
    )
    off = [s for c in _calls(tool_calls, "research_append") for s in _research_append_sections(c) if s != _SECTION]
    assert not off, f"research_append was called on {off}; this agent writes only {_SECTION}"


def test_reads_only_the_delegated_hit(tool_calls, test):
    """`sidecar_read` reads the delegated hit and nothing else: never the
    `#hits` list, never another hit. It reads the hit from its start once, and
    any further read of it pages on with an `offset`."""
    _verdict_test(test)
    log_id, hit = _delegated(test)
    reads = []
    for c in _calls(tool_calls, "sidecar_read"):
        args = as_mapping(c.get("args"))
        refs = [args["ref"]] if isinstance(args.get("ref"), str) else _as_list(args.get("refs"))
        reads.extend((r, args.get("offset")) for r in refs)
    assert reads, f"sidecar_read was never called on the delegated hit {log_id}#{hit}"
    stray = [r for r, _ in reads if _hit_of(r) != (log_id, hit)]
    assert not stray, (
        f"read {stray}; the agent reads only the delegated hit {log_id}#{hit}, never `#hits` or another hit"
    )
    from_start = [r for r, off in reads if not _pages_on(off)]
    assert len(from_start) == 1, (
        f"read the hit from its start {len(from_start)} times; one read, then pages with an offset"
    )


def _pages_on(offset) -> bool:
    try:
        return float(offset) > 0
    except (TypeError, ValueError):
        return False


def test_one_tree_query_on_the_target_with_every_fact_type(before_state, tool_calls, test):
    """One `tree_query` whose `personIds` include the target, with no
    `factTypes` filter: the verdict needs the residences and other place facts
    that a vital-only filter drops."""
    _verdict_test(test)
    calls = _calls(tool_calls, "tree_query")
    assert len(calls) == 1, f"tree_query was called {len(calls)} times; one call on the target and its family"
    args = as_mapping(calls[0].get("args"))
    target = _target(test, before_state)
    ids = _as_list(args.get("personIds"))
    assert target in ids, f"tree_query's personIds {ids} do not include the target {target!r}"
    types = _as_list(args.get("factTypes"))
    assert not types, f"tree_query was filtered to factTypes {types}; read every fact type"


# --- The gold labels -----------------------------------------------------

def test_verdict_is_the_gold_label(before_state, after_state, test):
    """The row's verdict is the one a genealogist set for this hit."""
    if (
        "expect-match" not in test.get("tags", [])
        and "expect-possible-match" not in test.get("tags", [])
        and "expect-not-a-match" not in test.get("tags", [])
    ):
        pytest.skip("no gold verdict on this test")
    gold = _gold(test, _GOLD_VERDICT, "gold verdict")
    row = _row(before_state, after_state)
    assert row.get("verdict") == gold, (
        f"gold verdict {gold}; the row says {row.get('verdict')!r} ({row.get('rationale')!r})"
    )


def test_new_vital_info_is_the_gold_flag(before_state, after_state, test):
    """The row's `new_vital_info` is the one a genealogist set for this hit."""
    if "new-vital" not in test.get("tags", []) and "no-new-vital" not in test.get("tags", []):
        pytest.skip("no gold flag on this test")
    gold = _gold(test, _GOLD_FLAG, "gold flag")
    row = _row(before_state, after_state)
    assert row.get("new_vital_info") is gold, (
        f"gold new_vital_info {gold}; the row says {row.get('new_vital_info')!r} ({row.get('rationale')!r})"
    )


def test_already_extracted_line_is_the_gold(agent_returns, text_response, test):
    """The return's `alreadyExtracted` line says whether the project already
    holds the hit. The router counts the Matches to offer from it."""
    if "already-extracted" not in test.get("tags", []) and "not-extracted" not in test.get("tags", []):
        pytest.skip("no gold extraction state on this test")
    gold = _gold(test, _GOLD_EXTRACTED, "gold extraction")
    said = _contract(agent_returns, text_response, test).get("alreadyExtracted")
    assert said is not None, "the return carries no `alreadyExtracted:` line above its `---`"
    assert _bool_value(said) is gold, f"gold alreadyExtracted {str(gold).lower()}; the return says {said!r}"


def test_return_lines_carry_the_row(before_state, after_state, agent_returns, text_response, test):
    """The contract lines name the delegated hit and repeat the row's verdict
    and flag. The router reads them to pair each return with its spawn and to
    count the Matches; a line that disagrees with the row misleads it."""
    _verdict_test(test)
    log_id, hit = _delegated(test)
    lines = _contract(agent_returns, text_response, test)
    missing = [k for k in ("hitRef", "verdict", "newVitalInfo", "alreadyExtracted") if k not in lines]
    assert not missing, f"the return lacks the contract lines {missing} above its `---`; got {lines}"
    assert _hit_of(lines["hitRef"]) == (log_id, hit), (
        f"the return's hitRef {lines['hitRef']!r} is not the delegated hit {log_id}#{hit}"
    )
    row = _row(before_state, after_state)
    assert _verdict_value(lines["verdict"]) == row.get("verdict"), (
        f"the return says verdict {lines['verdict']!r}; the row says {row.get('verdict')!r}"
    )
    assert _bool_value(lines["newVitalInfo"]) is row.get("new_vital_info"), (
        f"the return says newVitalInfo {lines['newVitalInfo']!r}; the row says {row.get('new_vital_info')!r}"
    )


# --- A hand-back writes nothing --------------------------------------------

def test_hand_back_writes_nothing(before_state, after_state, tool_calls, test):
    """A hand-back leaves the project as it found it: no `research_append`, no
    change to research.json or the tree."""
    if "hand-back" not in test.get("tags", []):
        pytest.skip("not a hand-back test")
    appends = _calls(tool_calls, "research_append")
    assert not appends, f"a hand-back called research_append {len(appends)} time(s)"
    for key, name in (("research_json", "research.json"), ("tree_gedcomx_json", "tree.gedcomx.json")):
        assert (before_state or {}).get(key) == (after_state or {}).get(key), f"a hand-back changed {name}"
