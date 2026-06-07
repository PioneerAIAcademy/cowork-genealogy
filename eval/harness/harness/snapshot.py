"""Run-log snapshot building and content normalization.

A snapshot is a `{repo-relative-path: normalized-content}` mapping that
captures everything needed to reproduce a run on the skill side: the
skill folder, the test definitions + rubric, and the referenced
scenarios + MCP fixtures. The judge prompt is tracked separately via
`judge_prompt_hash` (it's global and not part of skill-side state).

The `normalize(path, content) → str` contract is shared with the
TypeScript CRUD UI (eval/app/lib/snapshot.ts). Both sides must produce
byte-identical canonical text for the active-state check to work
across Windows + macOS + Linux developer machines. Test vectors in
`tests/test_snapshot.py` + `eval/app/tests/unit/snapshot.test.ts` are
the shared contract.

See docs/plan/eval-runlog-versioning.md §A4 and §A7.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


_COSMETIC_TEST_FIELDS = ("name", "description", "tags")
_JSON_EXTS = {".json"}
_TEXT_EXTS = {
    ".md",
    ".txt",
    ".yaml",
    ".yml",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".css",
    ".html",
    ".sh",
    ".toml",
}


def normalize(repo_relative_path: str, content: bytes) -> str:
    """Return canonical text for `content` interpreted as the named file.

    Rules:
      - `.json`: parse and re-emit with `sort_keys=True, indent=2`, trailing
        newline. Test JSONs (under `eval/tests/unit/`) also strip the
        cosmetic top-level `test.{name,description,tags}` fields so typo
        fixes there don't invalidate the active-state check.
      - Text-ish extensions: CRLF -> LF, ensure trailing newline.
      - Other extensions: best-effort UTF-8 decode; falls back to hex.
    """
    ext = _ext_of(repo_relative_path)

    if ext in _JSON_EXTS:
        try:
            obj = json.loads(content.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return _normalize_text(content)
        if _is_test_json_path(repo_relative_path) and isinstance(obj, dict):
            obj = _strip_cosmetic_test_fields(obj)
        text = json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False)
        if not text.endswith("\n"):
            text += "\n"
        return text

    if ext in _TEXT_EXTS:
        return _normalize_text(content)

    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return content.hex()


def hash_content(text: str) -> str:
    """SHA-256 hex digest of normalized text. Inputs come from `normalize()`."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def hash_file(repo_relative_path: str, abs_path: Path) -> str:
    """Hash a file's contents after normalization. Empty hash if missing."""
    if not abs_path.exists():
        return ""
    return hash_content(normalize(repo_relative_path, abs_path.read_bytes()))


def build_snapshot(
    *,
    skill: str,
    repo_root: Path,
    test_ids: Iterable[str] | None = None,
) -> dict[str, str]:
    """Build a `{path: normalized content}` snapshot for a skill run.

    Embeds:
      - `packages/engine/plugin/skills/<skill>/**`
      - `eval/tests/unit/<skill>/**` (rubric + test files)
      - `eval/fixtures/scenarios/<name>/**` for each scenario referenced
        by an included test
      - `eval/fixtures/mcp/<name>.json` for each MCP fixture referenced
      - `packages/engine/mcp-server/src/**/*.ts` (all MCP tool source). Conservative:
        any change to MCP source invalidates every skill's runlog. A
        change to a shared util (`auth/`, `constants.ts`, `types/`) can
        affect any tool's behavior, so tracking the whole tree is the
        only way to avoid silently missed invalidations.

    When `test_ids` is given, only those tests' scenarios + fixtures are
    embedded. When None, every test in the skill contributes.
    """
    snapshot: dict[str, str] = {}

    skill_dir = repo_root / "packages" / "engine" / "plugin" / "skills" / skill
    _embed_tree(snapshot, skill_dir, repo_root)

    tests_dir = repo_root / "eval" / "tests" / "unit" / skill
    _embed_tree(snapshot, tests_dir, repo_root)

    refs = _collect_refs(tests_dir, test_ids)

    for scenario in sorted(refs["scenarios"]):
        scenario_dir = repo_root / "eval" / "fixtures" / "scenarios" / scenario
        _embed_tree(snapshot, scenario_dir, repo_root)

    for fixture in sorted(refs["fixtures"]):
        fixture_path = repo_root / "eval" / "fixtures" / "mcp" / f"{fixture}.json"
        if fixture_path.is_file():
            rel = f"eval/fixtures/mcp/{fixture}.json"
            snapshot[rel] = normalize(rel, fixture_path.read_bytes())

    mcp_src_dir = repo_root / "packages" / "engine" / "mcp-server" / "src"
    _embed_tree(snapshot, mcp_src_dir, repo_root)

    return snapshot


def hash_snapshot(snapshot: dict[str, str]) -> dict[str, str]:
    """Return a `{path: sha256(normalized)}` mapping. Useful for the GH
    Action's snapshot-vs-working-tree diff."""
    return {p: hash_content(c) for p, c in snapshot.items()}


def diff_snapshot_vs_disk(snapshot: dict[str, str], repo_root: Path) -> dict[str, str]:
    """Compare each snapshot entry to disk; return paths where they differ.

    Value is one of:
      - "missing-on-disk" — snapshot has it, working tree doesn't
      - "content-differs" — file exists but normalized bytes differ
    Paths present on disk but absent from the snapshot are NOT flagged —
    the snapshot is the authority on what's tracked.
    """
    out: dict[str, str] = {}
    for rel, expected in snapshot.items():
        abs_path = repo_root / rel
        if not abs_path.is_file():
            out[rel] = "missing-on-disk"
            continue
        actual = normalize(rel, abs_path.read_bytes())
        if actual != expected:
            out[rel] = "content-differs"
    return out


# ---- internal helpers ----------------------------------------------------


def _ext_of(path: str) -> str:
    if "." not in path:
        return ""
    return "." + path.rsplit(".", 1)[-1].lower()


def _is_test_json_path(repo_rel: str) -> bool:
    return repo_rel.startswith("eval/tests/unit/") and repo_rel.endswith(".json")


def _strip_cosmetic_test_fields(test_raw: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(test_raw)
    test_block = out.get("test")
    if isinstance(test_block, dict):
        for field in _COSMETIC_TEST_FIELDS:
            test_block.pop(field, None)
    return out


def _normalize_text(content: bytes) -> str:
    text = content.decode("utf-8", errors="replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if text and not text.endswith("\n"):
        text += "\n"
    return text


def _embed_tree(snapshot: dict[str, str], directory: Path, repo_root: Path) -> None:
    if not directory.is_dir():
        return
    for path in sorted(directory.rglob("*")):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(directory).parts
        if any(p.startswith(".") or p == "__pycache__" for p in rel_parts):
            continue
        rel = path.relative_to(repo_root).as_posix()
        snapshot[rel] = normalize(rel, path.read_bytes())


def _collect_refs(
    tests_dir: Path, test_ids: Iterable[str] | None
) -> dict[str, set[str]]:
    scenarios: set[str] = set()
    fixtures: set[str] = set()
    ids_filter = set(test_ids) if test_ids is not None else None

    if not tests_dir.is_dir():
        return {"scenarios": scenarios, "fixtures": fixtures}

    for path in tests_dir.rglob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        test_block = data.get("test") if isinstance(data, dict) else None
        if not isinstance(test_block, dict):
            continue
        test_id = test_block.get("id", "")
        if ids_filter is not None and test_id not in ids_filter:
            continue
        scenario = (data.get("input") or {}).get("scenario")
        if scenario:
            scenarios.add(scenario)
        for fix in data.get("mcp_fixtures") or []:
            fixtures.add(fix)
    return {"scenarios": scenarios, "fixtures": fixtures}
