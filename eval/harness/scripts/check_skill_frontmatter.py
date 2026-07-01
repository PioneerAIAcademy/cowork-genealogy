#!/usr/bin/env python3
"""GH Action: lint every plugin skill's + agent's frontmatter.

Checks the parts of a skill's / agent's Markdown frontmatter that, if wrong,
break the artifact before it can run or get the whole plugin rejected by
Cowork's loader at install time.

Hard rules (fail the build, exit 1):
  - `name` present, kebab-case, <=64 chars, and equal to the directory name
    (skills) or the file stem (agents).
  - `description` present, non-empty, <=1024 chars, and free of angle
    brackets (`<` / `>`). The *full folded value* is checked, including
    plain multi-line scalars and `>-`/`|` block scalars — Cowork enforces
    both limits on the folded value, and these are exactly the two failures
    that used to escape to install time: an over-length multi-line
    description, and a `<placeholder>` sitting on a continuation line. The
    1024 cap is a self-imposed standard, not a Cowork limit: every
    description is always resident in the orchestrator's context and the
    descriptions compete for its attention on every turn, so a tight
    description triggers more precisely. Angle brackets can collide with
    prompt scaffolding — write "before 1850" in the description, not
    "<1850" (the body may use `<`). See docs/skill-authoring-guide.md §3.

Soft rules (warning annotation only, never block) — skills only:
  - Unrecognized top-level frontmatter key (catches typos like
    `descrption:` or `allowed_tools:` with an underscore).
  - An `allowed-tools` entry that doesn't resolve to a real MCP tool
    (sourced from packages/engine/mcp-server/manifest.json). The skill
    could not call it — it would be denied at runtime. (The fixture side
    of allowed-tools drift is covered by check_tool_coverage.py.)

The gate is on from the start: the corpus passes today, so there's no
backlog to grandfather in. A PR that introduces a hard violation fails.

Run by .github/workflows/check-runlogs.yml, and by scripts/package-plugin.sh
as a pre-zip gate. Self-contained: stdlib only (the workflow installs no
dependencies — same reason check_tool_coverage.py hand-parses frontmatter
instead of importing yaml). The frontmatter parser folds multi-line and
block scalars itself; it assumes single-paragraph descriptions (no blank
lines inside the value), which the corpus follows.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
REPO_ROOT = HARNESS_DIR.parents[1]

PLUGIN_DIR = REPO_ROOT / "packages" / "engine" / "plugin"
SKILLS_DIR = PLUGIN_DIR / "skills"
AGENTS_DIR = PLUGIN_DIR / "agents"
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
# Block/plain-scalar markers that can follow `description:` on the key line.
# Empty means an empty inline value (value continues on indented lines); the
# others are YAML block-scalar indicators. `|`-family is literal (newlines
# preserved); `>`-family is folded (newlines -> spaces).
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


def parse_frontmatter(md_path: Path) -> dict | None:
    """Parse the YAML frontmatter into the fields the lint needs.

    Stdlib only — no yaml dependency. Handles the scalar styles the corpus
    uses: single-line (plain or quoted), plain multi-line (indented
    continuation lines), and `>`/`|` block scalars. The full `description`
    value is folded (plain/folded → joined with spaces, literal `|` → joined
    with newlines) so the length and angle-bracket checks see every line, not
    just the first. `name`/`model` are single-line; `allowed-tools` is a
    `  - name` block list. Returns None when there is no frontmatter block.
    """
    if not md_path.exists():
        return None
    text = md_path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None

    keys: list[str] = []
    name: str | None = None
    allowed: list[str] = []

    have_description = False
    desc_inline: str | None = None
    desc_cont: list[str] = []
    desc_literal = False

    # Which multi-line block we're inside, so an indented line is attributed
    # to the right key. Reset on every top-level key.
    state: str | None = None  # None | "description" | "allowed"

    for line in parts[1].splitlines():
        if re.match(r"^[A-Za-z]", line):  # a top-level key
            state = None
            m = re.match(r"^([A-Za-z0-9_-]+):(.*)$", line)
            if not m:
                continue
            key, raw = m.group(1), m.group(2).strip()
            keys.append(key)
            if key == "name":
                name = _unquote(raw)
            elif key == "description":
                have_description = True
                if raw in _BLOCK_MARKERS:
                    # Block scalar or empty inline: value lives on the
                    # following indented lines.
                    desc_inline = None
                    desc_literal = raw.startswith("|")
                else:
                    desc_inline = _unquote(raw)
                    desc_literal = False
                state = "description"
            elif key == "allowed-tools":
                state = "allowed"
        elif state == "description":
            desc_cont.append(line)
        elif state == "allowed":
            stripped = line.strip()
            if stripped.startswith("- "):
                allowed.append(stripped[2:].strip().split("__")[-1])
            elif stripped == "":
                continue
            else:
                state = None

    description: str | None = None
    if have_description:
        pieces: list[str] = []
        if desc_inline:
            pieces.append(desc_inline)
        pieces.extend(s for s in (ln.strip() for ln in desc_cont) if s)
        sep = "\n" if desc_literal else " "
        description = sep.join(pieces) or None

    return {
        "keys": keys,
        "name": name,
        "description": description,
        "allowed_tools": allowed,
    }


def name_violations(name: str | None, what: str, expected: str) -> list[str]:
    """Hard-rule checks on a `name` field. Shared by skills and agents."""
    if not name:
        return [f"{what} is missing a `name`."]
    errs: list[str] = []
    if not KEBAB_RE.match(name):
        errs.append(
            f"{what} name `{name}` is not kebab-case (lowercase letters/digits, "
            f"single hyphens, no leading/trailing/double hyphen)."
        )
    if len(name) > NAME_MAX:
        errs.append(f"{what} name is {len(name)} chars; max is {NAME_MAX}.")
    if name != expected:
        errs.append(
            f"{what} frontmatter name is `{name}` but must equal `{expected}`."
        )
    return errs


def description_violations(desc: str | None, what: str) -> list[str]:
    """Hard-rule checks on a `description` field. Shared by skills and agents.

    `desc` is the full folded value from parse_frontmatter, so these fire on
    multi-line and block-scalar descriptions, not just single-line ones.
    """
    if not desc:
        return [f"{what} is missing a `description`."]
    errs: list[str] = []
    if len(desc) > DESCRIPTION_MAX:
        errs.append(
            f"{what} description is {len(desc)} chars; max is {DESCRIPTION_MAX}. "
            f"Trim via the description optimizer (docs/skill-lifecycle.md), not "
            f"by hand — blind cuts drop triggers."
        )
    if "<" in desc or ">" in desc:
        errs.append(
            f"{what} description contains an angle bracket (`<` or `>`). Write "
            f"'before 1850', not '<1850', in the description — angle-bracket "
            f"tokens read as XML tags and Cowork rejects them (the body may "
            f"use `<`)."
        )
    return errs


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
    agents_checked = 0

    # Skills ----------------------------------------------------------------
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

        for msg in name_violations(fm["name"], f"skill `{skill}`", skill):
            hard += 1
            gh_error(msg, file=rel)
        for msg in description_violations(fm["description"], f"skill `{skill}`"):
            hard += 1
            gh_error(msg, file=rel)

        # unknown keys (soft) ----------------------------------------------
        for key in fm["keys"]:
            if key not in KNOWN_KEYS:
                soft += 1
                gh_warning(
                    f"skill `{skill}` has unrecognized frontmatter key "
                    f"`{key}` (typo? known keys: {sorted(KNOWN_KEYS)}).",
                    file=rel,
                )

        # allowed-tools resolution (soft) ----------------------------------
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

    # Agents ----------------------------------------------------------------
    # Plugin agents (packages/engine/plugin/agents/<name>.md) carry the same
    # name/description frontmatter and are subject to the same Cowork limits,
    # so they get the shared hard rules. Their `tools`/`model` keys differ
    # from skills, so the skill-only soft checks (KNOWN_KEYS, allowed-tools)
    # are intentionally not applied here.
    if AGENTS_DIR.is_dir():
        for agent_md in sorted(AGENTS_DIR.glob("*.md")):
            stem = agent_md.stem
            rel = f"packages/engine/plugin/agents/{agent_md.name}"
            agents_checked += 1

            fm = parse_frontmatter(agent_md)
            if fm is None:
                hard += 1
                gh_error(
                    f"agent `{stem}` has no YAML frontmatter block.", file=rel
                )
                continue

            for msg in name_violations(fm["name"], f"agent `{stem}`", stem):
                hard += 1
                gh_error(msg, file=rel)
            for msg in description_violations(fm["description"], f"agent `{stem}`"):
                hard += 1
                gh_error(msg, file=rel)

    print()
    if manifest_tools is None:
        print(
            "Note: manifest.json not found — skipped the allowed-tools "
            "resolution check."
        )
    scope = f"{skills_checked} skill(s)"
    if agents_checked:
        scope += f" + {agents_checked} agent(s)"
    if hard or soft:
        print(
            f"Frontmatter lint: {hard} hard violation(s) (fail the build), "
            f"{soft} warning(s) across {scope}. See above."
        )
    else:
        print(f"All {scope} have clean frontmatter.")

    return 1 if hard else 0


if __name__ == "__main__":
    sys.exit(main())
