"""Unit tests for harness.ts_consts — the shared reader of engine string lists."""

from __future__ import annotations

from pathlib import Path

import pytest

from harness.ts_consts import strip_ts_comments, ts_string_list


def _ts(tmp_path: Path, body: str) -> Path:
    p = tmp_path / "t.ts"
    p.write_text(body, encoding="utf-8")
    return p


def test_a_bracket_inside_a_comment_does_not_end_the_list(tmp_path):
    p = _ts(tmp_path, 'export const X = [\n  "a",\n  // see issue [#1] first\n  "b",\n] as const;\n')
    assert ts_string_list("X", p) == ["a", "b"]


def test_a_quoted_word_inside_a_comment_is_not_a_member(tmp_path):
    p = _ts(tmp_path, 'export const X = [\n  "a", /* not "c" */\n  // nor "d"\n  "b",\n] as const;\n')
    assert ts_string_list("X", p) == ["a", "b"]


def test_a_comment_marker_inside_a_string_is_kept(tmp_path):
    assert strip_ts_comments('const u = "https://x";') == 'const u = "https://x";'


def test_a_typed_and_satisfies_declaration_still_reads(tmp_path):
    p = _ts(
        tmp_path,
        'export const X: readonly string[] = ["a", "b"] as const satisfies readonly string[];\n',
    )
    assert ts_string_list("X", p) == ["a", "b"]


def test_missing_and_empty_declarations_raise(tmp_path):
    p = _ts(tmp_path, "export const X = [] as const;\n")
    with pytest.raises(RuntimeError, match="no string members"):
        ts_string_list("X", p)
    with pytest.raises(RuntimeError, match="not found"):
        ts_string_list("Y", p)


def test_the_real_engine_lists_read():
    ok_false = ts_string_list("OK_FALSE_IS_FAILURE")
    readers = ts_string_list("NOT_A_DOCUMENT_WRITER")
    assert "research_append" in ok_false
    assert set(readers) < set(ok_false)
