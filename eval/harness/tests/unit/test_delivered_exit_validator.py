"""Direct tests for `test_a_bounded_turn_ends_with_the_delivery_signal` (#2813 item 1,
the enforcement half).

The skill body telling the model to "end your turn" is not what ends it. On the hosted
plane an SDK Stop hook vetoes a voluntary stop while the objective is incomplete; the
only arm that lets a bounded turn stop is `delivered`, set when the model calls
`research_delivered`. Nothing asserted the call, and the tool was advertised nowhere in
the unit harness, so every unit run graded the skill on prose it had no way to act on.

These pin the validator in BOTH directions: it must fail the turn that never signals,
and it must not fire on a run that is legitimately not a bounded delivery.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = next(
    q for q in Path(__file__).resolve().parents
    if (q / "eval/harness/validators").is_dir()
)
sys.path.insert(0, str(REPO / "eval/harness/validators"))

from test_research import (  # noqa: E402
    test_a_bounded_turn_ends_with_the_delivery_signal as validator,
)

TAGGED = {"tags": ["bounded-request", "ends-with-delivery"]}
#: `ut_research_023` really carries this shape: bounded-request WITHOUT the new tag,
#: because `--autonomous` means run the job and do not deliver.
CARVE_OUT = {"tags": ["routing", "routes-to:question-selection", "bounded-request"]}


def _call(tool, **args):
    return {"tool": tool, "args": args}


DELIVERED = _call("mcp__genealogy__research_delivered", summary="Transcribed image 004022578_00190.")
READ = _call("mcp__genealogy__project_context", projectPath="/p")


def test_a_bounded_turn_that_signals_passes():
    validator([READ, DELIVERED], TAGGED)


def test_a_bounded_turn_that_never_signals_fails():
    """THE regression: answered, then stopped without the signal. On the hosted plane
    that stop is vetoed and the agent is nudged on into more research."""
    with pytest.raises(AssertionError, match="must end by calling"):
        validator([READ], TAGGED)


def test_delivering_then_carrying_on_fails():
    """THE regression the first version of this validator let through.

    `research_delivered` -> `record_search` -> `research_append` is deliver-then-keep-
    researching -- precisely what the researcher reports. It passed, because the
    validator only asked whether the tool was called *somewhere*. It is invisible in
    this harness by construction: the tool is inert here, so nothing stops the run."""
    with pytest.raises(AssertionError, match="must be the LAST tool call"):
        validator(
            [READ, DELIVERED, _call("mcp__genealogy__record_search", q="x"),
             _call("mcp__genealogy__research_append", section="log")],
            TAGGED,
        )


def test_an_empty_first_signal_is_not_rescued_by_a_later_one():
    """The hosted arm halts on the FIRST main-thread call, so that call's summary is what
    the researcher reads and the later call never runs. The first version read the LAST
    call, so an empty first signal passed whenever a later one happened to carry text.

    Caught here by the last-call rule rather than the summary rule -- a second signal is
    itself a call after the first -- which is why the two assertions are ordered this way:
    the stronger statement fires first and names the real problem."""
    with pytest.raises(AssertionError, match="must be the LAST tool call"):
        validator(
            [_call("mcp__genealogy__research_delivered", summary="   "),
             _call("mcp__genealogy__research_delivered", summary="Transcribed it.")],
            TAGGED,
        )


def test_an_empty_summary_fails():
    """The hosted plane puts the summary in front of the stop reason, so an empty one
    is what the researcher reads."""
    with pytest.raises(AssertionError, match="one-sentence summary"):
        validator([_call("mcp__genealogy__research_delivered", summary="   ")], TAGGED)


def test_a_missing_summary_fails():
    """Nothing validates the tool's inputSchema, so the key can simply be absent."""
    with pytest.raises(AssertionError, match="one-sentence summary"):
        validator([_call("mcp__genealogy__research_delivered")], TAGGED)


def test_the_autonomous_carve_out_is_not_graded():
    """The OTHER direction, which breaking the repo cannot test. `bounded-request` alone
    must not arm this: under `--autonomous` the router runs the job and delivering is the
    failure. Gating on that tag instead of its own would fail a correct run."""
    with pytest.raises(pytest.skip.Exception):
        validator([READ], CARVE_OUT)


def test_an_untagged_run_is_not_graded():
    with pytest.raises(pytest.skip.Exception):
        validator([READ], {"tags": []})


def test_a_test_with_no_tags_key_is_not_graded():
    with pytest.raises(pytest.skip.Exception):
        validator([READ], {})


def test_the_bare_tool_name_is_matched_whatever_the_server_prefix():
    """The harness spells it `mcp__genealogy__…`; Cowork spells it two other ways
    (CLAUDE.md, "Dual-spelled tool names"). Matching the bare suffix is why this does
    not have to know which registrar produced the log."""
    for prefix in ("", "mcp__genealogy__", "mcp__Genealogy_Research__",
                   "mcp__remote-devices__Genealogy_Research__"):
        validator([_call(prefix + "research_delivered", summary="Done.")], TAGGED)


def test_a_similarly_named_tool_does_not_satisfy_it():
    """`endswith` must not be loosened to a substring match: a tool merely *mentioning*
    the name is not the signal."""
    with pytest.raises(AssertionError, match="must end by calling"):
        validator([_call("mcp__genealogy__research_delivered_summary", summary="x")], TAGGED)


# ── The validator is only satisfiable if the harness advertises the tool ─────────
#
# These are in THIS file, beside the validator they protect, because the coupling is
# the whole point: the validator asserts a call the model can only make if the tool is
# registered. Removing the registration reds nothing without them — the validator's own
# tests pass a hand-built tool_calls list and never touch the harness — so the tool would
# silently stop being advertised and every bounded eval would fail for an invisible
# reason. That is exactly how this gap reached alpha the first time.


def _harness():
    sys.path.insert(0, str(next(
        q / "eval/harness" for q in Path(__file__).resolve().parents
        if (q / "eval/harness").is_dir()
    )))
    from harness import mock_mcp  # noqa: PLC0415

    return mock_mcp


def test_the_harness_advertises_the_delivery_tool():
    assert "research_delivered" in _harness().LIVE_TOOLS


def test_the_delivery_tool_maps_to_its_compiled_implementation():
    """In LIVE_TOOLS but absent here, `_make_live_handler` raises ValueError at call
    time — the deferred-failure shape that passes every import-time check."""
    assert _harness()._COMPILED_TOOLS.get("research_delivered") == (
        "research-delivered.js",
        "researchDelivered",
    )


def test_the_live_handler_returns_the_real_acknowledgement(tmp_path):
    """Runs the compiled tool for real. Asserting the two tables above would still pass
    if the JS export were renamed; this is what proves the wiring executes."""
    import asyncio as _asyncio  # noqa: PLC0415
    import json as _json  # noqa: PLC0415

    handler = _harness()._make_live_handler("research_delivered", tmp_path, [])
    result = handler({"summary": "Transcribed image 004022578_00190."})
    if _asyncio.iscoroutine(result):
        result = _asyncio.run(result)
    payload = _json.loads(result["content"][0]["text"])
    assert payload["acknowledged"] is True
    assert payload["summary"] == "Transcribed image 004022578_00190."


# ── The carve-out, pinned against the REAL file ─────────────────────────────────
#
# `test_the_autonomous_carve_out_is_not_graded` above uses a hand-built dict, so it
# proves the validator's logic and nothing about the corpus: someone could add
# `ends-with-delivery` to ut_research_023 and every test here would stay green. These
# read the files.


def _research_test(name: str) -> dict:
    import json as _json  # noqa: PLC0415

    path = REPO / "eval/tests/unit/research" / name
    return _json.loads(path.read_text(encoding="utf-8"))["test"]


def test_the_autonomous_test_really_is_untagged_on_disk():
    """`--autonomous` means drive the job to completion. Delivering is the FAILURE there,
    so tagging this file would assert the opposite of what it exists to prove."""
    tags = _research_test("autonomous-is-always-a-job.json")["tags"]
    assert "bounded-request" in tags, "the shape tag that must NOT be enough on its own"
    assert "ends-with-delivery" not in tags


def test_the_three_bounded_tests_really_are_tagged_on_disk():
    """The other half: a tag silently dropped would make the validator skip and the
    suite stay green while asserting nothing."""
    for name, tid in [
        ("bounded-ask-not-a-job.json", "ut_research_020"),
        ("attached-before-searching.json", "ut_research_021"),
        ("compound-bounded-ask.json", "ut_research_c1k"),
    ]:
        t = _research_test(name)
        assert t["id"] == tid, name
        assert "ends-with-delivery" in t["tags"], f"{tid} lost its gating tag"


def test_no_other_research_test_is_tagged_by_accident():
    """A job or `--autonomous` turn must not be asserted to deliver. The risk went up
    with this PR: the schema is always loaded now and the router names the tool, so a
    premature main-thread call on a JOB would end the run on the hosted plane."""
    import json as _json  # noqa: PLC0415

    tagged = sorted(
        p.name
        for p in (REPO / "eval/tests/unit/research").glob("*.json")
        if "ends-with-delivery"
        in (_json.loads(p.read_text(encoding="utf-8")).get("test", {}).get("tags") or [])
    )
    assert tagged == [
        "attached-before-searching.json",
        "bounded-ask-not-a-job.json",
        "compound-bounded-ask.json",
    ], "a fourth test gained the tag — is its turn really a bounded delivery?"
