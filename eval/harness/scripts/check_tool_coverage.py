#!/usr/bin/env python3
"""GH Action: warn on skill tool-coverage drift.

For every skill, compares the MCP tools its SKILL.md `allowed-tools`
frontmatter declares against the tools its test corpus actually has
fixtures for, in both directions:

- forward — a declared tool with no fixture in any of the skill's tests
  means no eval test can exercise that tool path (a coverage gap);
- reverse — a test that references a fixture for a tool the skill does
  NOT declare. If the skill makes that call it is denied and the run
  aborts; this is the static catch for "allowed-tools contradicts the
  test corpus."

Warn-only: this never fails the build (always exits 0). It surfaces each
gap as a GitHub warning annotation on every run so the gap stays visible
and gets burned down deliberately rather than rediscovered. The runtime
counterpart is the harness's `unmatched_tool_call` abort
(docs/specs/unit-test-spec.md §15 "Uncovered tool calls"): together, the
static check and the runtime abort make tool-coverage drift impossible
to lose track of.

Tools in EXEMPT_TOOLS are never flagged — they cannot be exercised
in-harness for a structural reason (recorded in each entry's reason
string). The exemption list is printed on every run so it stays visible
rather than silently swallowing a gap.

Run by .github/workflows/check-runlogs.yml. Self-contained: stdlib only
(the workflow installs no dependencies).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
REPO_ROOT = HARNESS_DIR.parents[1]

SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
TESTS_DIR = REPO_ROOT / "eval" / "tests" / "unit"
FIXTURES_DIR = REPO_ROOT / "eval" / "fixtures" / "mcp"

# Tools that cannot be covered by an mcp_fixture for a structural reason.
# Keyed by tool name -> the reason, so the exemption is self-documenting
# and never becomes a silent dumping ground. Keep this list short and
# justified; a tool belongs here only when in-harness coverage is
# impossible, not merely unwritten.
EXEMPT_TOOLS: dict[str, str] = {
    "image_read": (
        "the mock MCP server serializes every fixture response as a text "
        "block and cannot emit an `image` content block, so image_read — "
        "which returns the image itself for the model to read — cannot be "
        "exercised in-harness. Tool-code correctness is covered by Vitest "
        "(packages/engine/mcp-server/tests/); transcription behavior is verified via the "
        "layered manual testing playbooks (docs/testing-guides/)."
    ),
    "research_log_append": (
        "registered as a LIVE_TOOL in mock_mcp.py — calls the real compiled "
        "implementation rather than matching a fixture. The tool handles id "
        "assignment, timestamping, camelCase-to-snake_case field renaming, "
        "and validation. No fixture needed; it is always available."
    ),
}


def gh_warning(message: str, *, file: str | None = None) -> None:
    """Emit a GitHub warning annotation (visible on the PR; non-blocking)."""
    prefix = f"::warning file={file}::" if file else "::warning::"
    print(f"{prefix}{message}")


def declared_tools(skill_md: Path) -> list[str]:
    """Parse the `allowed-tools` block-list from a SKILL.md frontmatter.

    Stdlib only — no yaml dependency (the CI workflow installs none).
    Handles the block style used throughout packages/engine/plugin/skills/:
    `allowed-tools:` followed by `  - name` lines. Bare names and
    `mcp__server__`-qualified names both normalize to the bare tool name.

    A missing `allowed-tools` key and an empty list both return [] —
    deliberately not distinguished. In the harness this is correct:
    `harness/allowed_tools.py::compute_allowed_tools` grants baseline file
    tools only for both cases (an absent key is NOT "unrestricted"
    in-harness, unlike production Claude Code — see the WS3 finding). So
    either way a test that references an MCP fixture for a tool the skill
    never declares would have its call denied and abort, and the reverse
    check's warning holds. Revisit only if compute_allowed_tools ever
    makes an absent key mean "all tools allowed."
    """
    if not skill_md.exists():
        return []
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return []
    parts = text.split("---", 2)
    if len(parts) < 3:
        return []
    out: list[str] = []
    in_block = False
    for line in parts[1].splitlines():
        if not in_block:
            if line.strip() == "allowed-tools:":
                in_block = True
            continue
        stripped = line.strip()
        if stripped.startswith("- "):
            out.append(stripped[2:].strip().split("__")[-1])
        elif stripped == "":
            continue
        else:
            break  # a new frontmatter key ended the allowed-tools block
    return out


def fixture_tool_refs(skill: str) -> dict[str, list[str]]:
    """Map each MCP tool name to the test files in this skill's corpus
    that reference a fixture for it (via the test's `mcp_fixtures` array).

    The key set is the tools the corpus can exercise; the values let the
    reverse check name the offending test.
    """
    refs: dict[str, list[str]] = {}
    skill_tests = TESTS_DIR / skill
    if not skill_tests.is_dir():
        return refs
    for test_path in sorted(skill_tests.glob("*.json")):
        try:
            test = json.loads(test_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        for fixture_name in test.get("mcp_fixtures") or []:
            fixture_path = FIXTURES_DIR / f"{fixture_name}.json"
            if not fixture_path.exists():
                continue
            try:
                fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            tool = fixture.get("tool")
            if isinstance(tool, str):
                refs.setdefault(tool, [])
                if test_path.name not in refs[tool]:
                    refs[tool].append(test_path.name)
    return refs


def main() -> int:
    if not SKILLS_DIR.is_dir():
        print(f"No skills directory at {SKILLS_DIR}; nothing to check.")
        return 0

    forward_gaps = 0
    reverse_gaps = 0
    tool_using_skills = 0
    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill = skill_dir.name
        declared = sorted(set(declared_tools(skill_dir / "SKILL.md")))
        refs = fixture_tool_refs(skill)
        if declared:
            tool_using_skills += 1

        # Forward: a declared tool that no fixture in the corpus covers —
        # no eval test can exercise that tool path.
        missing = sorted(set(declared) - set(refs) - set(EXEMPT_TOOLS))
        if missing:
            forward_gaps += 1
            plural = "these tools" if len(missing) > 1 else "this tool"
            gh_warning(
                f"skill `{skill}` declares allowed-tools {declared} but its "
                f"test corpus has no fixture for: {missing}. No eval test can "
                f"exercise {plural} — add a test with an mcp_fixture for each, "
                f"or drop the tool from allowed-tools.",
                file=f"packages/engine/plugin/skills/{skill}/SKILL.md",
            )

        # Reverse: a test references a fixture for a tool the skill's
        # allowed-tools does not grant. If the skill makes that call it is
        # denied and the run aborts (unmatched_tool_call); at best the
        # fixture is dead weight. This is the static catch for the
        # "allowed-tools contradicts the test corpus" class of bug.
        for tool in sorted(refs):
            if tool in declared:
                continue
            for test_name in refs[tool]:
                reverse_gaps += 1
                gh_warning(
                    f"test `{test_name}` (skill `{skill}`) references an "
                    f"mcp_fixture for `{tool}`, but `{tool}` is not in "
                    f"`{skill}`'s allowed-tools {declared or '[]'}. The skill "
                    f"cannot call it — the call would be denied and the run "
                    f"would abort. Inline the data into the test, or move "
                    f"the test to a skill that declares `{tool}`.",
                    file=f"eval/tests/unit/{skill}/{test_name}",
                )

    if forward_gaps or reverse_gaps:
        print(
            f"\nTool-coverage drift: {forward_gaps} skill(s) with an uncovered "
            f"declared tool, {reverse_gaps} test fixture(s) for an undeclared "
            f"tool. Warnings above. Warn-only — this does not block the build."
        )
    else:
        print(
            f"All {tool_using_skills} tool-using skill(s) have consistent "
            f"fixture coverage."
        )

    if EXEMPT_TOOLS:
        print("\nCoverage-exempt tools (structurally untestable, never flagged):")
        for tool, reason in sorted(EXEMPT_TOOLS.items()):
            print(f"  - {tool}: {reason}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
