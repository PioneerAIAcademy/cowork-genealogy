"""The misread probe's scoring, sampling and ship rule — no model, no network."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts import probe_assertion_shape as p  # noqa: E402


def test_expected_is_the_json_value_or_absent():
    a = {"id": "a_1", "informant": "Mary", "record_persona_id": None, "information_quality": "primary"}
    assert p.expected(a, "informant") == '"Mary"'
    assert p.expected(a, "record_persona_id") == "null"
    assert p.expected(a, "record_basis") == p.ABSENT


def test_matches_reads_quoted_bare_and_absent_answers():
    assert p.matches('"Mary"', '"Mary"')
    assert p.matches('"Mary"', "Mary")
    assert not p.matches('"Mary"', "John")
    assert p.matches("null", "null")
    assert not p.matches("null", p.ABSENT)
    # ABSENT and null are different answers both ways.
    assert p.matches(p.ABSENT, "absent")
    assert not p.matches(p.ABSENT, "null")
    assert not p.matches('"p1"', p.ABSENT)


def test_score_counts_a_missing_answer_as_a_misread():
    flat = {"a_1": {"id": "a_1", "informant": "Mary"}}
    rows = p.score(flat, [{"assertion_id": "a_1", "field": "informant", "value": "Mary"}], ["a_1"])
    by_field = {r["field"]: r["ok"] for r in rows}
    assert by_field["informant"] is True
    assert by_field["record_basis"] is False  # asked, never answered
    assert len(rows) == len(p.FIELDS)


def test_pick_puts_the_hard_cases_first_and_is_stable():
    head = {"record_id": "R", "record_persona_id": "p", "record_role": "x", "source_id": "s", "log_entry_id": "l"}
    facts = [{"id": f"a_{i}", "informant": "Mary" if i != 1 else "John"} for i in range(4)]
    grouped = [{**head, "facts": facts}, {"record_id": "R2", "facts": [{"id": "a_9"}]}]
    flat = [{**head, **f} for f in facts] + [{"record_id": "R2", "id": "a_9"}]
    picked = p.pick(flat, grouped, "seed", n=8)
    # a_1 (other informant), a_2/a_3 (deep), a_9 (no persona id) are hard; a_0 is not.
    assert set(picked[:4]) == {"a_1", "a_2", "a_3", "a_9"}
    assert set(picked) == {"a_0", "a_1", "a_2", "a_3", "a_9"}
    assert p.pick(flat, grouped, "seed", n=8) == picked
    assert len(p.pick(flat, grouped, "seed", n=2)) == 2


def _rows(model, shape, misses, persona_miss=()):
    rows = []
    for i in range(10):
        rows.append({"model": model, "shape": shape, "page": "pg", "assertion_id": f"a_{i}",
                     "field": "informant", "ok": i >= misses})
        rows.append({"model": model, "shape": shape, "page": "pg", "assertion_id": f"a_{i}",
                     "field": "record_persona_id", "ok": f"a_{i}" not in persona_miss})
    return rows


def test_decide_ships_when_grouped_is_no_worse_on_every_model():
    rows = []
    for model, _ in p.MODELS:
        rows += _rows(model, "flat", 2) + _rows(model, "grouped", 2)
    assert p.decide(rows) == (True, [])


def test_decide_blocks_more_grouped_misreads_on_any_model():
    model = p.MODELS[2][0]
    ships, reasons = p.decide(_rows(model, "flat", 1) + _rows(model, "grouped", 3))
    assert not ships and model in reasons[0]


def test_decide_blocks_a_persona_id_misread_only_grouped_even_when_totals_favour_grouped():
    model = p.MODELS[0][0]
    rows = _rows(model, "flat", 5) + _rows(model, "grouped", 0, persona_miss=("a_7",))
    ships, reasons = p.decide(rows)
    assert not ships and "record_persona_id" in reasons[0] and "a_7" in reasons[0]
