"""Tests for scripts/prune_runlogs.py.

The rehash sweep rewrites every committed run log in place, so its two
correctness properties are load-bearing and easy to get silently wrong:
it must be exact (digests identical to a fresh build_snapshot, so no skill's
active state moves) and idempotent (re-running changes nothing).
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

from harness.snapshot import hash_content

_SPEC = importlib.util.spec_from_file_location(
    "prune_runlogs",
    Path(__file__).resolve().parents[2] / "scripts" / "prune_runlogs.py",
)
prune_runlogs = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(prune_runlogs)


SKILL_MD = "packages/engine/plugin/skills/s1/SKILL.md"
SRC_KEY = "packages/engine/mcp-server/src/constants.ts"


def _write_log(root: Path, name: str, *, schema_version: int, snapshot: dict) -> Path:
    d = root / "s1"
    d.mkdir(parents=True, exist_ok=True)
    p = d / name
    p.write_text(
        json.dumps({"schema_version": schema_version, "skill": "s1", "snapshot": snapshot}),
        encoding="utf-8",
    )
    return p


def test_rehash_replaces_content_with_digests(tmp_path: Path):
    p = _write_log(tmp_path, "v1_2026-07-01_00-00-00.json", schema_version=2,
                   snapshot={SKILL_MD: "body\n"})

    prune_runlogs.cmd_rehash(tmp_path, dry_run=False)

    log = json.loads(p.read_text(encoding="utf-8"))
    assert log["schema_version"] == 3
    assert log["snapshot"] == {SKILL_MD: hash_content("body\n")}


def test_rehash_drops_dead_mcp_src_keys(tmp_path: Path):
    """build_snapshot stopped emitting these and the differ already skips
    them — hashing them would preserve pure weight."""
    p = _write_log(tmp_path, "v1_2026-07-01_00-00-00.json", schema_version=2,
                   snapshot={SKILL_MD: "body\n", SRC_KEY: "export const UA = 'x';\n"})

    prune_runlogs.cmd_rehash(tmp_path, dry_run=False)

    assert SRC_KEY not in json.loads(p.read_text(encoding="utf-8"))["snapshot"]


def test_rehash_is_idempotent(tmp_path: Path):
    p = _write_log(tmp_path, "v1_2026-07-01_00-00-00.json", schema_version=2,
                   snapshot={SKILL_MD: "body\n"})
    prune_runlogs.cmd_rehash(tmp_path, dry_run=False)
    first = p.read_text(encoding="utf-8")

    prune_runlogs.cmd_rehash(tmp_path, dry_run=False)
    assert p.read_text(encoding="utf-8") == first


def test_rehash_skips_scratch_and_partial(tmp_path: Path):
    """Both are gitignored local artifacts — the sweep must not touch them."""
    scratch = _write_log(tmp_path, "scratch_2026-07-01_00-00-00.json",
                         schema_version=2, snapshot={SKILL_MD: "body\n"})
    partial = _write_log(tmp_path, ".partial_2026-07-01_00-00-00.json",
                         schema_version=2, snapshot={SKILL_MD: "body\n"})
    before = (scratch.read_text(encoding="utf-8"), partial.read_text(encoding="utf-8"))

    prune_runlogs.cmd_rehash(tmp_path, dry_run=False)

    assert (scratch.read_text(encoding="utf-8"), partial.read_text(encoding="utf-8")) == before


def test_rehash_ignores_annotation_siblings(tmp_path: Path):
    ann = _write_log(tmp_path, "v1_2026-07-01_00-00-00.ann.json",
                     schema_version=2, snapshot={SKILL_MD: "body\n"})
    before = ann.read_text(encoding="utf-8")

    prune_runlogs.cmd_rehash(tmp_path, dry_run=False)

    assert ann.read_text(encoding="utf-8") == before


def test_dry_run_changes_nothing(tmp_path: Path):
    p = _write_log(tmp_path, "v1_2026-07-01_00-00-00.json", schema_version=2,
                   snapshot={SKILL_MD: "body\n"})
    before = p.read_text(encoding="utf-8")

    prune_runlogs.cmd_rehash(tmp_path, dry_run=True)

    assert p.read_text(encoding="utf-8") == before


# ---- rehash-tags (issue #2694) -----------------------------------------

TEST_JSON_KEY = "eval/tests/unit/s1/ut_1.json"
TEST_JSON_BODY = {
    "test": {"id": "ut_1", "skill": "s1", "name": "n",
             "description": "d", "tags": ["grade:trigger"], "type": "positive"},
    "input": {"user_message": "m"},
}


def _old_rule_hash(body: dict) -> str:
    """Compute hash under the OLD rule (tags stripped)."""
    return hash_content(
        prune_runlogs._normalize_old_rule(
            TEST_JSON_KEY, json.dumps(body).encode("utf-8")
        )
    )


def _new_rule_hash(body: dict) -> str:
    """Compute hash under the NEW rule (tags kept)."""
    from harness.snapshot import normalize
    return hash_content(
        normalize(TEST_JSON_KEY, json.dumps(body).encode("utf-8"))
    )


def _make_repo_with_test(tmp_path: Path) -> Path:
    """Create a minimal repo root with one test JSON on disk."""
    repo = tmp_path / "repo"
    test_dir = repo / "eval" / "tests" / "unit" / "s1"
    test_dir.mkdir(parents=True)
    (test_dir / "ut_1.json").write_text(
        json.dumps(TEST_JSON_BODY), encoding="utf-8"
    )
    return repo


def test_rehash_tags_rewrites_matching_keys(tmp_path: Path):
    """When the stored hash matches the old rule, the key is rewritten."""
    repo = _make_repo_with_test(tmp_path)
    runlogs = tmp_path / "runlogs"

    old_hash = _old_rule_hash(TEST_JSON_BODY)
    new_hash = _new_rule_hash(TEST_JSON_BODY)
    assert old_hash != new_hash, "tags must actually change the hash"

    p = _write_log(runlogs, "v1_2026-07-01_00-00-00.json",
                   schema_version=3, snapshot={
                       SKILL_MD: hash_content("body\n"),
                       TEST_JSON_KEY: old_hash,
                   })

    rc = prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=False)
    assert rc == 0

    log = json.loads(p.read_text(encoding="utf-8"))
    assert log["snapshot"][TEST_JSON_KEY] == new_hash


def test_rehash_tags_reports_mismatch(tmp_path: Path, capsys):
    """A pre-drifted key is reported loudly, not silently absorbed."""
    repo = _make_repo_with_test(tmp_path)
    runlogs = tmp_path / "runlogs"

    # Store a hash that doesn't match EITHER rule — pure pre-existing staleness.
    p = _write_log(runlogs, "v1_2026-07-01_00-00-00.json",
                   schema_version=3, snapshot={
                       SKILL_MD: hash_content("body\n"),
                       TEST_JSON_KEY: "0" * 64,  # wrong hash
                   })

    rc = prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=False)
    # Zero rewrites → exit 1 (the zero-rewrite guard).
    assert rc == 1

    out = capsys.readouterr().out
    assert "MISMATCH" in out
    assert TEST_JSON_KEY in out


def test_rehash_tags_fails_on_zero_rewrites(tmp_path: Path):
    """The script must fail if nothing was rewritten — the 'exit 0 having done
    nothing' trap."""
    repo = tmp_path / "repo"
    test_dir = repo / "eval" / "tests" / "unit" / "s1"
    test_dir.mkdir(parents=True)
    # A test with NO tags field at all — old and new rule produce the same hash
    # because there's nothing to strip. (Note: empty tags [] DOES differ because
    # the old rule removes the key entirely and the new rule keeps it.)
    no_tags_body = {
        "test": {"id": "ut_1", "skill": "s1", "name": "n",
                 "description": "d", "type": "positive"},
        "input": {"user_message": "m"},
    }
    (test_dir / "ut_1.json").write_text(
        json.dumps(no_tags_body), encoding="utf-8"
    )

    old_hash = _old_rule_hash(no_tags_body)
    new_hash = _new_rule_hash(no_tags_body)
    assert old_hash == new_hash, "no-tags test should produce identical hashes"

    runlogs = tmp_path / "runlogs"
    _write_log(runlogs, "v1_2026-07-01_00-00-00.json",
               schema_version=3, snapshot={
                   SKILL_MD: hash_content("body\n"),
                   TEST_JSON_KEY: old_hash,
               })

    rc = prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=False)
    assert rc == 1  # zero rewrites → failure


def test_rehash_tags_dry_run_changes_nothing(tmp_path: Path):
    repo = _make_repo_with_test(tmp_path)
    runlogs = tmp_path / "runlogs"

    old_hash = _old_rule_hash(TEST_JSON_BODY)
    p = _write_log(runlogs, "v1_2026-07-01_00-00-00.json",
                   schema_version=3, snapshot={
                       SKILL_MD: hash_content("body\n"),
                       TEST_JSON_KEY: old_hash,
                   })
    before = p.read_text(encoding="utf-8")

    prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=True)

    assert p.read_text(encoding="utf-8") == before


def test_rehash_tags_is_idempotent(tmp_path: Path):
    """Running the migration twice should not change the output."""
    repo = _make_repo_with_test(tmp_path)
    runlogs = tmp_path / "runlogs"

    old_hash = _old_rule_hash(TEST_JSON_BODY)
    p = _write_log(runlogs, "v1_2026-07-01_00-00-00.json",
                   schema_version=3, snapshot={
                       SKILL_MD: hash_content("body\n"),
                       TEST_JSON_KEY: old_hash,
                   })

    prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=False)
    first_run = p.read_text(encoding="utf-8")

    # Second run: stored hash now matches the NEW rule, so it's detected as
    # already-migrated and skipped — file unchanged, exit 0.
    prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=False)
    assert p.read_text(encoding="utf-8") == first_run


def test_rehash_tags_second_run_exits_zero(tmp_path: Path):
    """A fully-migrated tree must exit 0, not 1 — re-running the command on
    a correct steady state is not an error (Gennecis review, PR #2815)."""
    repo = _make_repo_with_test(tmp_path)
    runlogs = tmp_path / "runlogs"

    old_hash = _old_rule_hash(TEST_JSON_BODY)
    _write_log(runlogs, "v1_2026-07-01_00-00-00.json",
               schema_version=3, snapshot={
                   SKILL_MD: hash_content("body\n"),
                   TEST_JSON_KEY: old_hash,
               })

    rc1 = prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=False)
    assert rc1 == 0

    rc2 = prune_runlogs.cmd_rehash_tags(runlogs, repo_root=repo, dry_run=False)
    assert rc2 == 0, "second run on fully-migrated tree must exit 0"
