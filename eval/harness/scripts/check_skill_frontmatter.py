#!/usr/bin/env python3
"""GH Action: lint every skill's SKILL.md frontmatter.

Checks the parts of a skill's frontmatter that, if wrong, break the skill
before it can run or quietly degrade how Cowork's orchestrator triggers it.

Hard rules (fail the build, exit 1):
  - `name` present, kebab-case, <=64 chars, and equal to the directory name.
  - `description` present, non-empty, <=1024 chars, and free of angle
    brackets (`<` / `>`). The 1024 cap is a self-imposed standard, not a
    Cowork limit: every skill's description is always resident in the
    orchestrator's context and the ~28 descriptions compete for its
    attention on every turn, so a tight description triggers more
    precisely. Angle brackets can collide with prompt scaffolding — write
    "before 1850" in the description, not "<1850" (the body may use `<`).
    See docs/skill-authoring-guide.md §3.

Soft rules (warning annotation only, never block):
  - Unrecognized top-level frontmatter key (catches typos like
    `descrption:` or `allowed_tools:` with an underscore).
  - An `allowed-tools` entry that doesn't resolve to a real MCP tool
    (sourced from packages/engine/mcp-server/manifest.json). The skill
    could not call it — it would be denied at runtime. (The fixture side
    of allowed-tools drift is covered by check_tool_coverage.py.)
  - A `description` that isn't a single-line scalar, so its length can't
    be measured here — keep descriptions single-line.

The gate is on from the start: the corpus passes today, so there's no
backlog to grandfather in. A PR that introduces a hard violation fails.

Run by .github/workflows/check-runlogs.yml. Self-contained: stdlib only
(the workflow installs no dependencies — same reason check_tool_coverage.py
hand-parses frontmatter instead of importing yaml).
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
MANIFEST = REPO_ROOT / "packages" / "engine" / "mcp-server" / "manifest.json"

DESCRIPTION_MAX = 1024
NAME_MAX = 64
KEBAB_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
# Keys a SKILL.md frontmatter may carry. The four in active use plus the
# optional ones the skill format allows; anything else is likely a typo.
KNOWN_KEYS = {
    "name",
    "description",
    "model",
    "allowed-tools",
    "license",
    "metadata",
    "compatibility",
}
# Block-scalar / empty markers that mean "description isn't a single line".
_BLOCK_MARKERS = {"", "|", ">", "|-", ">-", "|+", ">+"}


def gh_warning(message: str, *, file: str | None = None) -> None:
    """Emit a GitHub warning annotation (visible on the PR; non-blocking)."""
    prefix = f"::warning file={file}::" if file else "::warning::"
    print(f"{prefix}{message}")


def gh_error(message: str, *, file: str | None = None) -> None:
    """Emit a GitHub error annotation for a hard-rule violation. The build
    fails because main() returns 1 when any hard violation is found."""
    prefix = f"::error file={file}::" if file else "::error::"
    print(f"{prefix}{message}")


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def parse_frontmatter(skill_md: Path) -> dict | None:
    """Parse the YAML frontmatter into the fields the lint needs.

    Stdlib only — no yaml dependency. Relies on the convention that these
    skills keep `name`/`description`/`model` as single-line scalars and
    `allowed-tools` as a `  - name` block list (verified across the
    corpus). Returns None when there is no frontmatter block at all.
    """
    if not skill_md.exists():
        return None
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None

    keys: list[str] = []
    name: str | None = None
    description: str | None = None
    description_block = False
    allowed: list[str] = []
    in_allowed = False

    for line in parts[1].splitlines():
        if re.match(r"^[A-Za-z]", line):  # a top-level key
            in_allowed = False
            m = re.match(r"^([A-Za-z0-9_-]+):(.*)$", line)
            if not m:
                continue
            key, raw = m.group(1), m.group(2).strip()
            keys.append(key)
            if key == "name":
                name = _unquote(raw)
            elif key == "description":
                if raw in _BLOCK_MARKERS:
                    description_block = True
                else:
                    description = _unquote(raw)
            elif key == "allowed-tools":
                in_allowed = True
        elif in_allowed:
            stripped = line.strip()
            if stripped.startswith("- "):
                allowed.append(stripped[2:].strip().split("__")[-1])
            elif stripped == "":
                continue
            else:
                in_allowed = False

    return {
        "keys": keys,
        "name": name,
        "description": description,
        "description_block": description_block,
        "allowed_tools": allowed,
    }


def load_manifest_tools() -> set[str] | None:
    """Valid MCP tool names from the mcpb manifest (the install contract,
    kept in sync with allToolSchemas). None if absent/unreadable, in which
    case the allowed-tools resolution check is skipped with a note."""
    if not MANIFEST.exists():
        return None
    try:
        data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    names = {t.get("name") for t in data.get("tools", []) if isinstance(t, dict)}
    return {n for n in names if isinstance(n, str)}


def main() -> int:
    if not SKILLS_DIR.is_dir():
        print(f"No skills directory at {SKILLS_DIR}; nothing to check.")
        return 0

    manifest_tools = load_manifest_tools()
    hard = 0
    soft = 0
    skills_checked = 0

    for skill_dir in sorted(SKILLS_DIR.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_dir.is_dir() or not skill_md.exists():
            continue
        skill = skill_dir.name
        rel = f"packages/engine/plugin/skills/{skill}/SKILL.md"
        skills_checked += 1

        fm = parse_frontmatter(skill_md)
        if fm is None:
            hard += 1
            gh_error(f"skill `{skill}` has no YAML frontmatter block.", file=rel)
            continue

        # name --------------------------------------------------------------
        name = fm["name"]
        if not name:
            hard += 1
            gh_error(f"skill `{skill}` is missing a `name`.", file=rel)
        else:
            if not KEBAB_RE.match(name):
                hard += 1
                gh_error(
                    f"skill `{skill}` name `{name}` is not kebab-case "
                    f"(lowercase letters/digits, single hyphens, no leading/"
                    f"trailing/double hyphen).",
                    file=rel,
                )
            if len(name) > NAME_MAX:
                hard += 1
                gh_error(
                    f"skill `{skill}` name is {len(name)} chars; max is {NAME_MAX}.",
                    file=rel,
                )
            if name != skill:
                hard += 1
                gh_error(
                    f"skill `{skill}` frontmatter name is `{name}` but must "
                    f"equal the directory name `{skill}`.",
                    file=rel,
                )

        # description -------------------------------------------------------
        if fm["description_block"]:
            soft += 1
            gh_warning(
                f"skill `{skill}` description is not a single-line scalar; "
                f"its length can't be checked. Keep descriptions single-line.",
                file=rel,
            )
        else:
            desc = fm["description"]
            if not desc:
                hard += 1
                gh_error(f"skill `{skill}` is missing a `description`.", file=rel)
            else:
                if len(desc) > DESCRIPTION_MAX:
                    hard += 1
                    gh_error(
                        f"skill `{skill}` description is {len(desc)} chars; max "
                        f"is {DESCRIPTION_MAX}. Trim via the description "
                        f"optimizer (docs/skill-lifecycle.md), not by hand — "
                        f"blind cuts drop triggers.",
                        file=rel,
                    )
                if "<" in desc or ">" in desc:
                    hard += 1
                    gh_error(
                        f"skill `{skill}` description contains an angle bracket "
                        f"(`<` or `>`). Write 'before 1850', not '<1850', in the "
                        f"description (the body may use `<`).",
                        file=rel,
                    )

        # unknown keys ------------------------------------------------------
        for key in fm["keys"]:
            if key not in KNOWN_KEYS:
                soft += 1
                gh_warning(
                    f"skill `{skill}` has unrecognized frontmatter key "
                    f"`{key}` (typo? known keys: {sorted(KNOWN_KEYS)}).",
                    file=rel,
                )

        # allowed-tools resolution -----------------------------------------
        if manifest_tools is not None:
            for tool in fm["allowed_tools"]:
                if tool not in manifest_tools:
                    soft += 1
                    gh_warning(
                        f"skill `{skill}` allowed-tools lists `{tool}`, which is "
                        f"not a known MCP tool (manifest.json). The skill could "
                        f"not call it — it would be denied at runtime. Typo?",
                        file=rel,
                    )

    print()
    if manifest_tools is None:
        print(
            "Note: manifest.json not found — skipped the allowed-tools "
            "resolution check."
        )
    if hard or soft:
        print(
            f"Frontmatter lint: {hard} hard violation(s) (fail the build), "
            f"{soft} warning(s) across {skills_checked} skill(s). See above."
        )
    else:
        print(f"All {skills_checked} skill(s) have clean frontmatter.")

    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
