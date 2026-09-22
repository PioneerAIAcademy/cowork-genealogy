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
