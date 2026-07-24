"""Lint: every plugin SKILL.md must carry a `## Re-invocation behavior`
section with a non-empty body.

Per `docs/specs/feedback-case-spec.md` §5. The contract is
load-bearing for the feedback-case iteration loop, which re-runs skills
against post-failure state.

We deliberately do NOT check the content quality of the section. A
placeholder TODO will get caught at review time, not by a regex.
Stateless skills (read-only, narration-only, pure query) legitimately
say "this skill writes no project state; safe to re-invoke" — that's
fine. The lint just catches "section missing entirely."
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[4]
PLUGIN_SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"

REINVOCATION_HEADING = re.compile(
    r"^##\s+Re-invocation behavior\s*$",
    re.MULTILINE,
)


def _skill_md_files() -> list[Path]:
    files = sorted(PLUGIN_SKILLS_DIR.glob("*/SKILL.md"))
    assert files, (
        f"No SKILL.md files found under {PLUGIN_SKILLS_DIR}. Check the "
        "plugin skills directory layout."
    )
    return files


def _section_body(text: str) -> str | None:
    """Return the body under '## Re-invocation behavior', or None if missing.

    Body = everything between the heading and the next H2-or-shallower heading
    (or EOF), stripped.
    """
    match = REINVOCATION_HEADING.search(text)
    if not match:
        return None
    start = match.end()
    rest = text[start:]
    next_heading = re.search(r"^##?\s+\S", rest, re.MULTILINE)
    body = rest[: next_heading.start()] if next_heading else rest
    return body.strip()


@pytest.mark.parametrize(
    "skill_md",
    _skill_md_files(),
    ids=lambda p: p.parent.name,
)
def test_skill_has_reinvocation_section(skill_md: Path) -> None:
    text = skill_md.read_text(encoding="utf-8")
    body = _section_body(text)
    assert body is not None, (
        f"{skill_md.relative_to(REPO_ROOT)} is missing a "
        "'## Re-invocation behavior' section.\n\n"
        "Per docs/specs/feedback-case-spec.md §5, every plugin SKILL.md "
        "must end with a section that documents:\n"
        "  1. What this skill writes (which research.json sections, GedcomX paths, sidecars).\n"
        "  2. What it does when invoked against state where it has already run\n"
        "     (supersede prior entries by ID, refine in place, or no-op).\n"
        "  3. Any specific entries the model should not duplicate.\n\n"
        "Stateless skills can simply state 'this skill writes no project "
        "state; safe to re-invoke.'"
    )


@pytest.mark.parametrize(
    "skill_md",
    _skill_md_files(),
    ids=lambda p: p.parent.name,
)
def test_skill_reinvocation_section_has_body(skill_md: Path) -> None:
    text = skill_md.read_text(encoding="utf-8")
    body = _section_body(text)
    # If the section is missing entirely, the other test will fail first.
    # Here we check the body has at least one non-whitespace line.
    if body is None:
        pytest.skip("section missing; covered by the other test")
    assert body, (
        f"{skill_md.relative_to(REPO_ROOT)} has a "
        "'## Re-invocation behavior' heading but empty body. "
        "Add at least one line describing the skill's write behavior."
    )
