"""Tests for harness.snapshot — normalize() + build_snapshot().

The normalize() contract is shared with eval/app/lib/snapshot.ts; the
test vectors below mirror eval/app/tests/unit/snapshot.test.ts so the
two implementations are forced to agree byte-for-byte.
"""

import json
from pathlib import Path

import pytest

from harness.snapshot import (
    build_snapshot,
    diff_snapshot_vs_disk,
    hash_content,
    hash_file,
    hash_snapshot,
    normalize,
)


# ---- normalize contract --------------------------------------------------


def test_normalize_json_sorts_keys_and_pretty_prints():
    raw = b'{"b": 2, "a": 1}'
    out = normalize("eval/foo.json", raw)
    assert out == '{\n  "a": 1,\n  "b": 2\n}\n'


def test_normalize_json_strips_cosmetic_test_fields():
    raw = json.dumps({
        "test": {
            "id": "ut_001",
            "name": "human-readable name",
            "description": "longer prose",
            "tags": ["foo"],
            "skill": "search-wiki",
        },
        "input": {"user_message": "do the thing"},
    }).encode()
    out = normalize("eval/tests/unit/search-wiki/ut_001.json", raw)
    parsed = json.loads(out)
    # Cosmetic stripped; grading-relevant kept.
    assert "name" not in parsed["test"]
    assert "description" not in parsed["test"]
    assert "tags" not in parsed["test"]
    assert parsed["test"]["id"] == "ut_001"
    assert parsed["test"]["skill"] == "search-wiki"


def test_normalize_json_outside_tests_keeps_all_fields():
    """Cosmetic stripping is scoped to eval/tests/unit/ only."""
    raw = json.dumps({"test": {"id": "x", "name": "kept here"}}).encode()
    out = normalize("plugin/skills/foo/SKILL.json", raw)
    assert "kept here" in out


def test_normalize_text_crlf_to_lf():
    raw = b"line one\r\nline two\r\n"
    out = normalize("plugin/skills/foo/SKILL.md", raw)
    assert out == "line one\nline two\n"
    assert "\r" not in out


def test_normalize_text_ensures_trailing_newline():
    raw = b"no newline at end"
    out = normalize("plugin/skills/foo/SKILL.md", raw)
    assert out.endswith("\n")


def test_normalize_text_idempotent():
    raw = b"already normalized\n"
    out1 = normalize("foo.md", raw)
    out2 = normalize("foo.md", out1.encode())
    assert out1 == out2


def test_normalize_json_idempotent():
    raw = b'{"x": 1, "y": [3, 1, 2]}'
    out1 = normalize("eval/foo.json", raw)
    out2 = normalize("eval/foo.json", out1.encode())
    assert out1 == out2


def test_normalize_unknown_extension_decodes_utf8():
    raw = "plain text".encode()
    out = normalize("foo.bin", raw)
    assert out == "plain text"


def test_hash_content_is_sha256():
    h = hash_content("hello\n")
    # Sanity: 64 hex chars.
    assert len(h) == 64
    assert all(c in "0123456789abcdef" for c in h)


def test_hash_file_missing_returns_empty(tmp_path: Path):
    missing = tmp_path / "nope.md"
    assert hash_file("eval/nope.md", missing) == ""


def test_hash_file_matches_normalize(tmp_path: Path):
    f = tmp_path / "x.md"
    f.write_bytes(b"hi\r\n")  # Will be normalized to "hi\n"
    h = hash_file("plugin/skills/foo/x.md", f)
    assert h == hash_content("hi\n")


# ---- build_snapshot ------------------------------------------------------


def test_build_snapshot_covers_skill_files(tmp_path: Path):
    repo = tmp_path
    skill_dir = repo / "plugin" / "skills" / "search-wiki"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("---\nname: search-wiki\n---\nbody\n")
    (skill_dir / "template.md").write_text("template\n")
    tests_dir = repo / "eval" / "tests" / "unit" / "search-wiki"
    tests_dir.mkdir(parents=True)
    (tests_dir / "rubric.md").write_text("# rubric\n")

    snap = build_snapshot(skill="search-wiki", repo_root=repo)
    assert "plugin/skills/search-wiki/SKILL.md" in snap
    assert "plugin/skills/search-wiki/template.md" in snap
    assert "eval/tests/unit/search-wiki/rubric.md" in snap


def test_build_snapshot_embeds_referenced_scenarios_and_fixtures(tmp_path: Path):
    repo = tmp_path
    (repo / "plugin" / "skills" / "x").mkdir(parents=True)
    tests_dir = repo / "eval" / "tests" / "unit" / "x"
    tests_dir.mkdir(parents=True)
    (tests_dir / "ut_001.json").write_text(json.dumps({
        "test": {"id": "ut_001", "skill": "x", "name": "n", "type": "positive",
                 "description": "x", "tags": []},
        "input": {"user_message": "m", "scenario": "scenario-a"},
        "mcp_fixtures": ["fix-1", "fix-2"],
    }))
    scen_dir = repo / "eval" / "fixtures" / "scenarios" / "scenario-a"
    scen_dir.mkdir(parents=True)
    (scen_dir / "research.json").write_text("{}")
    (scen_dir / "README.md").write_text("# scenario\n")
    fix_dir = repo / "eval" / "fixtures" / "mcp"
    fix_dir.mkdir(parents=True)
    (fix_dir / "fix-1.json").write_text('{"tool": "x", "description": "y", "response": {}}')
    (fix_dir / "fix-2.json").write_text('{"tool": "x", "description": "y", "response": {}}')

    snap = build_snapshot(skill="x", repo_root=repo)
    assert "eval/fixtures/scenarios/scenario-a/research.json" in snap
    assert "eval/fixtures/scenarios/scenario-a/README.md" in snap
    assert "eval/fixtures/mcp/fix-1.json" in snap
    assert "eval/fixtures/mcp/fix-2.json" in snap


def test_build_snapshot_skips_missing_skill(tmp_path: Path):
    """No skill dir → empty snapshot, no exception."""
    snap = build_snapshot(skill="nope", repo_root=tmp_path)
    assert snap == {}


# ---- diff vs disk --------------------------------------------------------


def test_diff_detects_content_change(tmp_path: Path):
    f = tmp_path / "skill.md"
    f.write_text("original\n")
    snapshot = {"skill.md": "original\n"}
    assert diff_snapshot_vs_disk(snapshot, tmp_path) == {}

    f.write_text("edited\n")
    diffs = diff_snapshot_vs_disk(snapshot, tmp_path)
    assert diffs == {"skill.md": "content-differs"}


def test_diff_detects_missing_file(tmp_path: Path):
    snapshot = {"missing.md": "expected\n"}
    diffs = diff_snapshot_vs_disk(snapshot, tmp_path)
    assert diffs == {"missing.md": "missing-on-disk"}


def test_diff_normalizes_before_comparing(tmp_path: Path):
    """A CRLF↔LF change on disk shouldn't flap diff."""
    f = tmp_path / "skill.md"
    f.write_bytes(b"hello\r\n")
    snapshot = {"skill.md": "hello\n"}  # Normalized form
    # Disk's CRLF normalizes to LF → matches snapshot.
    assert diff_snapshot_vs_disk(snapshot, tmp_path) == {}


# ---- hash_snapshot -------------------------------------------------------


def test_hash_snapshot_returns_per_path_hashes(tmp_path: Path):
    snap = {"a.md": "alpha\n", "b.md": "beta\n"}
    hashes = hash_snapshot(snap)
    assert set(hashes.keys()) == {"a.md", "b.md"}
    assert hashes["a.md"] == hash_content("alpha\n")
    assert hashes["b.md"] == hash_content("beta\n")
