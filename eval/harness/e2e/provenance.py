"""Provenance of an e2e run — which prompt produced it.

GitHub issue #1091. An e2e run log records the run's result but not the prompt
it ran: a graded run committed alongside a SKILL.md edit could not be tied to the
version of the skill that produced it (PR #1079, the case that filed this). Two
small fields close that:

- ``git_sha`` — ``git rev-parse HEAD`` at run start. Lets a reviewer check out
  the exact tree the run started from.
- ``skills_hash`` — a single sha256 over the sorted ``{path: hash}`` map of every
  skill and agent file the run **stages**. Unlike ``git_sha`` it also catches an
  *uncommitted* local edit to a SKILL.md — the PR #1079 situation exactly — since
  it hashes working-tree content, not a commit.

**Decided (2026-08-01, refined 2026-08-04): a single digest, not a full
snapshot, and not a per-file map.** A full snapshot would add ~43% to a corpus
issue #985 is actively shrinking, to store prose nothing reads back (e2e runs are
not gated on activeness, so the content is never diffed). A per-file map answers
"which file changed" but costs ~15.8 KB/run to answer what a git SHA plus a
re-hash already answer whenever the tree was clean.

**Known limit, by design:** a hash proves *whether* two runs used the same
prompt; it can never tell you *what* changed. Reconstruct the diff from the git
SHA plus the hash when the tree was clean.

This is **evidence for a human reviewer, not a gate.** An e2e run is graded days
after the tree has moved, so any "committed hash matches working tree" check would
red every e2e PR. Nothing in CI reads these fields.

Reuses ``normalize`` / ``hash_content`` from ``harness.snapshot`` (importing
``harness.*`` from ``e2e.*`` is the established pattern). It deliberately does
**not** call ``harness.snapshot.build_snapshot``: that is the unit harness's
per-skill function — it covers one skill dir plus ``eval/tests/unit/<skill>/**``
plus that skill's MCP fixtures, none of which is what an e2e run executes.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from harness.snapshot import hash_content, hash_file, normalize

def _is_excluded(parts: tuple[str, ...]) -> bool:
    """A staged file dropped from the hash — mirrors `harness.snapshot._embed_tree`.

    `build_workspace`'s `copytree` carries dotfiles and `__pycache__`, but they
    are gitignored non-prompt noise; dropping them keeps the hash stable across a
    local harness run that left a `.pyc` in a skill's `scripts/` dir.
    """
    return any(p.startswith(".") or p == "__pycache__" for p in parts)


def staged_file_hashes(skills_dir: Path, agents_dir: Path) -> dict[str, str]:
    """`{staging-relative path: sha256(normalized content)}` for exactly the
    prompt files `orchestrator.build_workspace` stages, minus dotfiles/__pycache__.

    Mirrors `build_workspace` (`orchestrator.py`): every **non-dot subdirectory**
    of `skills_dir`, recursively, plus `agents_dir.glob("*.md")` top level only.
    Loose files directly in `skills_dir` are not staged, so they are not hashed.

    Keys are **staging-relative** (`skills/<skill>/...`, `agents/<name>.md`), not
    repo-relative, so a `--skills-dir` pointing outside the repo still hashes
    deterministically. The key's extension is all `normalize` needs; none live
    under `eval/tests/unit/`, so its cosmetic-test-field strip never fires here.
    """
    out: dict[str, str] = {}

    skills_dir = Path(skills_dir)
    if skills_dir.is_dir():
        for skill in sorted(skills_dir.iterdir()):
            if not skill.is_dir() or skill.name.startswith("."):
                continue
            for path in sorted(skill.rglob("*")):
                if not path.is_file():
                    continue
                rel_parts = path.relative_to(skill).parts
                if _is_excluded(rel_parts):
                    continue
                key = "skills/" + path.relative_to(skills_dir).as_posix()
                out[key] = hash_content(normalize(key, path.read_bytes()))

    agents_dir = Path(agents_dir)
    if agents_dir.is_dir():
        for agent_file in sorted(agents_dir.glob("*.md")):
            key = "agents/" + agent_file.name
            out[key] = hash_content(normalize(key, agent_file.read_bytes()))

    return out


def skills_hash(skills_dir: Path, agents_dir: Path) -> str:
    """One sha256 over the sorted `{path: hash}` map — the run's prompt identity.

    Built from `staged_file_hashes` so a test can inspect the map (which file is
    in scope) while the run stores only the ~40-byte digest.
    """
    file_map = staged_file_hashes(skills_dir, agents_dir)
    return hash_content(json.dumps(file_map, sort_keys=True, ensure_ascii=False))


def findings_hash(expected_findings_path: Path) -> str:
    """One sha256 over the normalized `expected-findings.json` — the identity of
    the findings a grade was produced against (issue #1719).

    Stamped into a `.ann.json` at grade time and re-checked by
    `calibrate_judge`'s loader: an amended finding body (same id) changes this
    hash and is caught, where the id-vs-key drift check stays silent. Normalized
    via `hash_file` (parse → re-emit `sort_keys=True, indent=2,
    ensure_ascii=False` → sha256), so a reformat or key reorder does not fire but
    any content edit — including one confined to `supporting_sources`, which the
    judge still reads — does.

    **This is the single implementation both sides call** (the loader and the
    `stamp_findings_hash` writer), so they cannot disagree on whitespace or
    `ensure_ascii` for a corpus full of em-dashes and accented names. The key
    string `"expected-findings.json"` is fixed here for the same reason.
    """
    return hash_file("expected-findings.json", expected_findings_path)


def git_sha(repo_root: Path) -> str | None:
    """`git rev-parse HEAD` at `repo_root`, or `None` on any failure.

    Best-effort — never raises, so a run outside a git checkout (or with no git on
    PATH) still logs; the field is simply absent. Matches the capture helpers'
    posture (`subagent_capture`, the session-transcript copy): provenance must
    never fail an otherwise-loggable run.
    """
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    sha = out.stdout.strip()
    return sha or None
