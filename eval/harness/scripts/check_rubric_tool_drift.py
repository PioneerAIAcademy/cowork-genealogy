#!/usr/bin/env python3
"""GH Action: warn when eval grading prose drifts behind a tool contract.

For every skill, compares the MCP tool names that appear in its
`rubric.md` and its tests' `judge_context` notes against the tools its
`SKILL.md` `allowed-tools` frontmatter actually declares. A tool name
mentioned in grading prose but absent from allowed-tools means the corpus
is grading against a call the skill is no longer allowed to make — usually
because the call was folded into another tool and the prose was never
updated. That happened twice unnoticed (`same_person`/`source_attachments`
folded into `record_search`, `rank_search_matches` folded away as a
standalone step): the judge kept failing correct runs for not making calls
the architecture had retired.

Does the same check for plugin agents: a tool name mentioned in an agent's
body that is in neither its `tools:` nor its `disallowedTools:` frontmatter
(the union, since naming a disallowed tool to explain why it's denied is a
legitimate, expected mention, not drift).

This is the exact inverse of check_tool_coverage.py's reverse check (a test
fixture referencing a tool absent from allowed-tools): that check catches
a corpus that calls a tool it shouldn't; this one catches a corpus that
*talks about* a tool it shouldn't.

Two mechanical (not heuristic) sources of false positives are filtered out:

- A skill that delegates to a plugin agent (`@plugin:<name>` in its
  SKILL.md, e.g. record-extraction -> record-extractor) legitimately
  describes calls that agent makes on its behalf. `delegated_tools()` reads
  the referenced agent's own `tools:` frontmatter — real ground truth, not
  a guess — and unions it into the skill's declared set.
- COMMON_WORD_EXEMPTIONS drops tool names that double as ordinary English
  words (`login`, `logout`) from the vocabulary entirely: a skill's own
  contract never legitimately requires *it* to call these (they're
  user-driven OAuth flows), so a match is far more likely to be the English
  word than the tool.

Warn-only: this never fails the build (always exits 0). There is a third,
NOT mechanically filterable, false-positive shape: grading prose naming a
tool that belongs to a *different* skill (a routing test's judge_context
naming the destination skill's tool, or "not this skill's job, that's
$OTHER_SKILL's" prose). Distinguishing that from real drift would require
either an allow-comment convention or fragile natural-language matching —
left as an open decision (docs/TODOs.md) rather than guessed at here.

Run by .github/workflows/check-runlogs.yml. Self-contained: stdlib only
(the workflow installs no dependencies).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
REPO_ROOT = HARNESS_DIR.parents[1]

SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
TESTS_DIR = REPO_ROOT / "eval" / "tests" / "unit"
AGENTS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "agents"
MANIFEST = REPO_ROOT / "packages" / "engine" / "mcp-server" / "manifest.json"

# Tool names that double as ordinary English words, keyed by name -> the
# reason, so the exemption is self-documenting and never becomes a silent
# dumping ground (same idiom as check_tool_coverage.py's EXEMPT_TOOLS). Keep
# this list short and justified — a tool belongs here only when a false
# match is clearly more likely than a true one.
COMMON_WORD_EXEMPTIONS: dict[str, str] = {
    "login": (
        "collides with the ordinary English word (\"a login may be "
        "required\"). Skills never call login themselves — it's a "
        "user-driven OAuth flow outside any skill's tool contract — so a "
        "match is far more likely to be the word than the tool."
    ),
    "logout": "same collision as login, for the same reason.",
}

_PLUGIN_DELEGATION_RE = re.compile(r"@plugin:([a-z0-9-]+)")


def gh_warning(message: str, *, file: str | None = None) -> None:
    """Emit a GitHub warning annotation (visible on the PR; non-blocking)."""
    prefix = f"::warning file={file}::" if file else "::warning::"
    print(f"{prefix}{message}")


def load_manifest_tools(manifest: Path) -> set[str] | None:
    """Valid MCP tool names from the mcpb manifest (the install contract,
    kept in sync with allToolSchemas). None if absent/unreadable, in which
    case the whole check is skipped with a note."""
    if not manifest.exists():
        return None
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    names = {t.get("name") for t in data.get("tools", []) if isinstance(t, dict)}
    return {n for n in names if isinstance(n, str)}


def usable_vocabulary(manifest_tools: set[str]) -> set[str]:
    """Manifest tool names minus COMMON_WORD_EXEMPTIONS — the set this
    script actually scans prose for."""
    return manifest_tools - set(COMMON_WORD_EXEMPTIONS)


def find_mentions(text: str, vocabulary: set[str]) -> set[str]:
    """Whole-word occurrences of any vocabulary tool name in text."""
    return {
        tool
        for tool in vocabulary
        if re.search(rf"\b{re.escape(tool)}\b", text)
    }


def declared_tools(skill_md: Path) -> list[str]:
    """Parse the `allowed-tools` block-list from a SKILL.md frontmatter.

    Stdlib only — no yaml dependency (the CI workflow installs none).
    Bare names and `mcp__server__`-qualified names both normalize to the
    bare tool name. Mirrors check_tool_coverage.py::declared_tools (each
    of these scripts is self-contained, per repo convention).
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


def skill_delegated_agents(skill_md: Path) -> set[str]:
    """Plugin agent names a skill delegates to, via `@plugin:<name>`
    references anywhere in its SKILL.md (frontmatter or body)."""
    if not skill_md.exists():
        return set()
    text = skill_md.read_text(encoding="utf-8")
    return set(_PLUGIN_DELEGATION_RE.findall(text))


def delegated_tools(skill_md: Path, agents_dir: Path) -> set[str]:
    """Tools a skill's delegated agents are allowed to call.

    Only the delegate's `tools:` list is unioned in — not its
    `disallowedTools:` — since the question is "can the delegate make this
    call on the skill's behalf," not "does the delegate's frontmatter
    mention this name." A missing agent file contributes nothing rather
    than erroring; a stale/typo'd @plugin: reference is not this check's
    job to catch.
    """
    out: set[str] = set()
    for agent in skill_delegated_agents(skill_md):
        tools, _disallowed = agent_declared_tools(agents_dir / f"{agent}.md")
        out |= tools
    return out


def rubric_mentions(
    rubric_md: Path, vocabulary: set[str], *, declared: set[str]
) -> set[str]:
    """Tool names mentioned in a skill's rubric.md that aren't declared."""
    if not rubric_md.exists():
        return set()
    text = rubric_md.read_text(encoding="utf-8")
    return find_mentions(text, vocabulary) - declared


def judge_context_mentions(
    test_json: Path, vocabulary: set[str], *, declared: set[str]
) -> set[str]:
    """Tool names mentioned in a test's judge_context that aren't declared."""
    try:
        test = json.loads(test_json.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return set()
    context = test.get("judge_context")
    if not isinstance(context, list):
        return set()
    text = "\n".join(s for s in context if isinstance(s, str))
    return find_mentions(text, vocabulary) - declared


def _frontmatter_list_block(lines: list[str], key: str) -> set[str]:
    """Bare, dual-spelling-normalized names under `<key>:` in a frontmatter
    block's lines. Shared by tools:/disallowedTools: parsing below."""
    out: set[str] = set()
    in_block = False
    for line in lines:
        if not in_block:
            if line.strip() == f"{key}:":
                in_block = True
            continue
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if stripped.startswith("- "):
            out.add(stripped[2:].strip().split("__")[-1])
        elif stripped == "":
            continue
        else:
            break  # a new frontmatter key ended this block
    return out


def agent_declared_tools(agent_md: Path) -> tuple[set[str], set[str]]:
    """(tools, disallowedTools) bare-name sets from an agent's frontmatter.

    Dual-spelled MCP entries (mcp__genealogy__X and
    mcp__remote-devices__...__X) both normalize to the bare tool name `X`.
    """
    if not agent_md.exists():
        return set(), set()
    text = agent_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return set(), set()
    parts = text.split("---", 2)
    if len(parts) < 3:
        return set(), set()
    lines = parts[1].splitlines()
    return (
        _frontmatter_list_block(lines, "tools"),
        _frontmatter_list_block(lines, "disallowedTools"),
    )


def agent_body_mentions(agent_md: Path, vocabulary: set[str]) -> set[str]:
    """Tool names mentioned in an agent's body that are in neither its
    tools: nor its disallowedTools: frontmatter."""
    if not agent_md.exists():
        return set()
    text = agent_md.read_text(encoding="utf-8")
    parts = text.split("---", 2)
    body = parts[2] if text.startswith("---") and len(parts) >= 3 else text
    tools, disallowed = agent_declared_tools(agent_md)
    return find_mentions(body, vocabulary) - tools - disallowed


def main() -> int:
    manifest_tools = load_manifest_tools(MANIFEST)
    if manifest_tools is None:
        print(f"No readable manifest at {MANIFEST}; nothing to check.")
        return 0
    vocabulary = usable_vocabulary(manifest_tools)

    drift_hits = 0

    if SKILLS_DIR.is_dir():
        for skill_dir in sorted(SKILLS_DIR.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill = skill_dir.name
            skill_md = skill_dir / "SKILL.md"
            declared = set(declared_tools(skill_md)) | delegated_tools(
                skill_md, AGENTS_DIR
            )
            skill_tests = TESTS_DIR / skill

            rubric_md = skill_tests / "rubric.md"
            for tool in sorted(rubric_mentions(rubric_md, vocabulary, declared=declared)):
                drift_hits += 1
                gh_warning(
                    f"skill `{skill}`'s rubric.md mentions `{tool}`, which is "
                    f"not in `{skill}`'s allowed-tools {sorted(declared) or '[]'}. "
                    f"If `{tool}` was folded into another tool, update the "
                    f"grading prose — don't fail runs for not calling a tool "
                    f"the skill can't call.",
                    file=f"eval/tests/unit/{skill}/rubric.md",
                )

            if skill_tests.is_dir():
                for test_path in sorted(skill_tests.glob("*.json")):
                    for tool in sorted(
                        judge_context_mentions(test_path, vocabulary, declared=declared)
                    ):
                        drift_hits += 1
                        gh_warning(
                            f"test `{test_path.name}` (skill `{skill}`) has a "
                            f"judge_context mentioning `{tool}`, which is not in "
                            f"`{skill}`'s allowed-tools {sorted(declared) or '[]'}. "
                            f"The judge is being told to expect a call the skill "
                            f"can't make — update judge_context.",
                            file=f"eval/tests/unit/{skill}/{test_path.name}",
                        )

    if AGENTS_DIR.is_dir():
        for agent_md in sorted(AGENTS_DIR.glob("*.md")):
            agent = agent_md.stem
            for tool in sorted(agent_body_mentions(agent_md, vocabulary)):
                drift_hits += 1
                gh_warning(
                    f"agent `{agent}` mentions `{tool}` in its body, but "
                    f"`{tool}` is in neither its `tools:` nor its "
                    f"`disallowedTools:` frontmatter. Add it to whichever list "
                    f"is correct, or update the body if the mention is stale.",
                    file=f"packages/engine/plugin/agents/{agent_md.name}",
                )

    if drift_hits:
        print(
            f"\nRubric/judge_context/agent tool-mention drift: {drift_hits} "
            f"hit(s). Warnings above. Warn-only — this does not block the build."
        )
    else:
        print("No rubric/judge_context/agent tool-mention drift found.")

    print("\nWord-collision exemptions (never scanned for, structurally noisy):")
    for tool, reason in sorted(COMMON_WORD_EXEMPTIONS.items()):
        print(f"  - {tool}: {reason}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
