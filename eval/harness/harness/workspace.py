"""Per-test workspace assembly + file snapshotting.

A workspace is the temp directory the harness sets as cwd for the SDK
session. It contains the scenario's research.json and tree.gedcomx.json
(if any) plus a .claude/skills/ tree mirroring plugin/skills/.

Snapshots capture the state of the workspace before and after the skill
runs. The .claude/ directory is excluded — it's harness scaffolding, not
test output.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any


# The SDK stores session entries under ~/.claude/projects/<encoded-cwd>/.
# Temp directories pile up these entries indefinitely if not cleaned.
_SESSION_STORE_ROOT = Path.home() / ".claude" / "projects"


# Session-store cleanup relies on the SDK's `project_key_for_directory`
# function. We import it lazily inside `cleanup_session_store` so that
# unrelated code paths — loading test specs, running validators offline,
# tooling around the harness — don't fail at module import if the symbol
# is missing. The pyproject.toml bound on claude-agent-sdk pins us to a
# major where this exists, but we still want offline diagnostics to work.


class InvalidScenarioError(Exception):
    """Raised when a referenced scenario directory is missing or unusable."""


def build_workspace(
    scenario_name: str | None,
    scenarios_dir: Path,
    skills_dir: Path,
    target_dir: Path,
) -> Path:
    """Populate target_dir with scenario files and a .claude/skills/ tree.

    Returns target_dir for chaining. target_dir must already exist (typically
    created by pytest's tmp_path or tempfile.mkdtemp).
    """
    target = Path(target_dir)
    if scenario_name is not None:
        src = Path(scenarios_dir) / scenario_name
        if not src.is_dir():
            raise InvalidScenarioError(f"scenario not found: {src}")
        for fname in ("research.json", "tree.gedcomx.json"):
            f = src / fname
            if f.exists():
                shutil.copy(f, target / fname)

    skills_target = target / ".claude" / "skills"
    skills_target.mkdir(parents=True, exist_ok=True)
    for skill_dir in Path(skills_dir).iterdir():
        if skill_dir.is_dir() and not skill_dir.name.startswith("."):
            shutil.copytree(skill_dir, skills_target / skill_dir.name, dirs_exist_ok=True)

    return target


def cleanup_session_store(workspace: Path) -> None:
    """Remove the SDK session-store entry for a workspace.

    The Claude Agent SDK persists session data under
    ~/.claude/projects/<encoded-cwd>/. Without cleanup, every temp-dir test
    leaves an orphan entry there — long CI runs grow it unboundedly.

    Safe to call when no entry exists (no-op). Raises ImportError when
    the SDK lacks `project_key_for_directory` — by design, so an SDK
    regression fails loudly rather than silently leaking entries.
    """
    try:
        from claude_agent_sdk import project_key_for_directory
    except ImportError as e:
        raise ImportError(
            "claude_agent_sdk.project_key_for_directory is unavailable. "
            "The harness depends on it for session-store cleanup; without "
            "it, ~/.claude/projects/ grows unboundedly. Pin or upgrade "
            "claude-agent-sdk to a version that exports this function."
        ) from e
    try:
        key = project_key_for_directory(str(workspace))
    except Exception:  # noqa: BLE001 — best-effort key derivation
        return
    target = _SESSION_STORE_ROOT / key
    if target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def snapshot_files(workspace: Path) -> dict[str, Any]:
    """Capture the state of a workspace as a dict.

    Returns:
        {
            "research_json": parsed dict or None,
            "tree_gedcomx_json": parsed dict or None,
            "files": {<rel_path>: <str>, ...},  # excludes the two JSONs above
        }

    The .claude/ directory is excluded — it's harness scaffolding.
    """
    workspace = Path(workspace)
    snap: dict[str, Any] = {
        "research_json": None,
        "tree_gedcomx_json": None,
        "files": {},
    }

    research = workspace / "research.json"
    if research.exists():
        try:
            snap["research_json"] = json.loads(research.read_text())
        except json.JSONDecodeError:
            snap["research_json"] = None

    tree = workspace / "tree.gedcomx.json"
    if tree.exists():
        try:
            snap["tree_gedcomx_json"] = json.loads(tree.read_text())
        except json.JSONDecodeError:
            snap["tree_gedcomx_json"] = None

    for path in workspace.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(workspace).as_posix()
        # Exclude scaffolding and the two JSON files captured above.
        if rel.startswith(".claude/"):
            continue
        if rel in ("research.json", "tree.gedcomx.json"):
            continue
        try:
            snap["files"][rel] = path.read_text()
        except UnicodeDecodeError:
            snap["files"][rel] = "<binary>"

    return snap
