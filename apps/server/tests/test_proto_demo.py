"""Offline tests for D19's proto/demo.py: the opening prompt, the acceptance queries and their
rendering, the verdict, and the make target that runs it. No Postgres, no stack, no model."""

from __future__ import annotations

import re

import pytest

from proto import demo, turn
from tests.test_proto_config import _recipe

IDS = ("turn_x", "sess_y", "proj_z")


# ── opening prompt ──────────────────────────────────────────────────────────────────


def test_opening_prompt_uses_the_fixture_question_unless_overridden():
    meta = {"researcher_question": "Who was the father of William A. Bagley?"}
    assert demo.opening_prompt(meta, None) == "Who was the father of William A. Bagley?"
    assert demo.opening_prompt(meta, "  Find his mother.  ") == "Find his mother."


def test_opening_prompt_refuses_a_fixture_without_a_question():
    with pytest.raises(ValueError, match="--prompt"):
        demo.opening_prompt({}, None)
    with pytest.raises(ValueError):
        demo.opening_prompt({"researcher_question": "   "}, "")


# ── acceptance queries ──────────────────────────────────────────────────────────────


def test_acceptance_queries_cover_the_criteria_and_bind_only_their_ids():
    qs = demo.acceptance_queries(*IDS)
    labels = " | ".join(label for label, _, _ in qs)
    assert "criterion 1" in labels and "criterion 2" in labels and "tokens" in labels
    for label, sql, params in qs:
        assert sql.lstrip().upper().startswith("SELECT"), label
        assert sql.count("%s") == len(params), label
        assert set(params) <= set(IDS), label
    # criterion 1 reads the redelivery counter D17 judges receive_count >= 2 from
    c1 = next(sql for label, sql, _ in qs if label.startswith("criterion 1"))
    assert "receive_count" in c1 and "completed_at" in c1 and "FROM turns" in c1
    # the token query names every column turn.py sums
    tok = next(sql for label, sql, _ in qs if label.startswith("tokens"))
    assert all(c in tok for c in turn.TOKEN_COLUMNS)


def test_section_counts_sql_counts_every_array_key_without_a_section_list():
    sql = demo.section_counts_sql()
    assert "jsonb_object_keys" in sql and "jsonb_typeof" in sql and "'array'" in sql
    assert "jsonb_array_length" in sql and sql.count("%s") == 1
    assert "'sources'" not in sql  # generic: no hand-picked section names


# ── rendering ───────────────────────────────────────────────────────────────────────


def test_render_query_prints_label_pasteable_sql_and_rows():
    out = demo.render_query("criterion 1: turns", "SELECT a FROM t WHERE id = %s AND s = %s",
                            ("x'y", "z"), [(1, "ok"), (2, None)])
    lines = out.splitlines()
    assert lines[0] == "-- criterion 1: turns"
    assert lines[1] == "SELECT a FROM t WHERE id = 'x''y' AND s = 'z'"  # psql-ready, quote doubled
    assert lines[2].strip() == "1  ok" and lines[3].strip() == "2  None"


def test_render_query_says_no_rows_rather_than_nothing():
    out = demo.render_query("l", "SELECT 1 WHERE false", (), [])
    assert out.splitlines()[-1].strip() == "(no rows)"


# ── verdict ─────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("done, c3, reauth, code", [
    (True, True, False, 0),
    (False, True, False, 1),
    (True, False, False, 1),
    (True, True, True, 1),
])
def test_verdict(done, c3, reauth, code):
    assert demo.verdict(done, c3, reauth) == code


def test_default_deadline_covers_one_shim_driven_resume():
    # READ_TIMEOUT_S is 1800 per attempt; a one-ceiling deadline reports FAIL as attempt 2 begins
    assert demo.DEFAULT_DEADLINE_S > 2 * 1800


# ── the make targets ────────────────────────────────────────────────────────────────


def test_proto_demo_target_brings_the_stack_up_and_runs_the_script():
    body = "\n".join(_recipe("proto-demo"))
    assert "apps/server/proto/env.sh" in body, "the recipe must source env.sh (model key + FS token)"
    assert "ANTHROPIC_API_KEY" in body, "refuse without a model key, as proto-turn does"
    assert re.search(r"up -d --wait .*\bworker\b.*\bshim\b.*\bweb\b", body), "wait for worker, shim and web"
    assert "proto/demo.py" in body
    assert re.search(r"\$\(or \$\(FIXTURE\),\s*bagley-father-1884\)", body), "FIXTURE defaults to the D17 fixture"


def test_proto_test_runs_the_d17_and_demo_suites():
    body = "\n".join(_recipe("proto-test"))
    for name in ("tests/test_proto_d17.py", "tests/test_proto_demo.py"):
        assert name in body, f"make proto-test does not run {name}"
