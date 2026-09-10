#!/usr/bin/env python3
"""Load the plugin's ``agents/*.md`` into ``AgentDefinition``s for the P1 probe.

Contract: `PLAN.md` at the repo root ("apps/server/dev/p1/plugin_agents.py").

The prototype registers agents through ``ClaudeAgentOptions.agents`` (bare
names, no staging into the project — see `docs/plan/search-agent-prototype.md`),
so the frontmatter has to be read here. A minimal stdlib parser covers exactly
the shapes the six shipped agents use — ``name``, ``description`` (plain or a
``>-`` / ``>`` / ``|`` block scalar), ``model``, ``tools`` (a ``- item`` list
with ``#`` comment lines) — and nothing else; PyYAML is deliberately not used.

    uv run python -m dev.p1.plugin_agents [--plugin-dir DIR]

prints one line per agent (name, model, tool count, description length) and
exits 1 if fewer than six were found.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from claude_agent_sdk import AgentDefinition

EXPECTED_AGENT_COUNT = 6

_KEY_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+(.*))?$")
_BLOCK_INDICATORS = frozenset({">", ">-", ">+", "|", "|-", "|+"})


def _is_blank_or_comment(line: str) -> bool:
    s = line.strip()
    return not s or s.startswith("#")


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _fold_block(indicator: str, lines: list[str]) -> str:
    """Collapse a block scalar's continuation lines.

    ``>`` / ``>-``: lines within a paragraph join with a space, blank lines
    separate paragraphs with a newline. ``|`` / ``|-``: lines keep their
    newlines (common indentation removed). Trailing blank lines are dropped;
    the ``-`` / ``+`` chomping distinction is irrelevant to a prompt field and
    is not reproduced.
    """
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ""
    if indicator.startswith(">"):
        paragraphs: list[list[str]] = [[]]
        for line in lines:
            if not line.strip():
                paragraphs.append([])
            else:
                paragraphs[-1].append(line.strip())
        return "\n".join(" ".join(p) for p in paragraphs if p)
    indents = [len(l) - len(l.lstrip(" ")) for l in lines if l.strip()]
    cut = min(indents) if indents else 0
    return "\n".join(l[cut:] if l.strip() else "" for l in lines)


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split an agent ``.md`` into (frontmatter mapping, body after the closing ``---``)."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise ValueError("no opening frontmatter delimiter")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration as exc:
        raise ValueError("no closing frontmatter delimiter") from exc
    fm_lines = lines[1:end]
    body = "\n".join(lines[end + 1 :]).strip("\n")

    fm: dict[str, Any] = {}
    i = 0
    while i < len(fm_lines):
        line = fm_lines[i]
        if _is_blank_or_comment(line):
            i += 1
            continue
        m = _KEY_RE.match(line)
        if m is None or line[0] in " \t":
            raise ValueError(f"unparseable frontmatter line {i + 2}: {line!r}")
        key, rest = m.group(1), (m.group(2) or "").strip()
        i += 1
        if rest in _BLOCK_INDICATORS:
            block: list[str] = []
            while i < len(fm_lines) and (
                fm_lines[i][:1] in (" ", "\t") or not fm_lines[i].strip()
            ):
                block.append(fm_lines[i])
                i += 1
            fm[key] = _fold_block(rest, block)
        elif rest == "":
            items: list[str] = []
            while i < len(fm_lines):
                s = fm_lines[i].strip()
                if _is_blank_or_comment(fm_lines[i]):
                    i += 1
                    continue
                if s.startswith("- "):
                    items.append(_unquote(s[2:].strip()))
                    i += 1
                    continue
                if fm_lines[i][:1] in (" ", "\t"):
                    raise ValueError(
                        f"unsupported frontmatter shape under {key!r} at line {i + 2}: "
                        f"{fm_lines[i]!r}"
                    )
                break
            fm[key] = items
        else:
            fm[key] = _unquote(rest)
    return fm, body


def load_agent_definitions(plugin_dir: Path) -> dict[str, AgentDefinition]:
    """``{name: AgentDefinition}`` for every ``<plugin_dir>/agents/*.md``.

    Only the fields ``AgentDefinition`` declares are passed: ``description``,
    ``prompt``, ``tools``, ``disallowedTools``, ``model``. A frontmatter deny
    is carried so that an agent binds the same under ``agents=`` (bare name)
    as under ``plugins=`` (namespaced name) — a dropped deny fails open and
    silently. No shipped agent declares one today.
    """
    from claude_agent_sdk import AgentDefinition

    agents_dir = Path(plugin_dir) / "agents"
    out: dict[str, AgentDefinition] = {}
    for md in sorted(agents_dir.glob("*.md")):
        fm, body = parse_frontmatter(md.read_text(encoding="utf-8"))
        name = fm.get("name") or md.stem
        description = fm.get("description")
        if not isinstance(description, str) or not description:
            raise ValueError(f"{md.name}: agent has no description")
        tools = fm.get("tools")
        if tools is not None and not isinstance(tools, list):
            raise ValueError(f"{md.name}: tools is not a list")
        denied = fm.get("disallowedTools")
        if denied is not None and not isinstance(denied, list):
            raise ValueError(f"{md.name}: disallowedTools is not a list")
        model = fm.get("model")
        out[name] = AgentDefinition(
            description=description,
            prompt=body,
            tools=list(tools) if tools else None,
            disallowedTools=list(denied) if denied else None,
            model=model if isinstance(model, str) and model else None,
        )
    return out


def _default_plugin_dir() -> str:
    from app.agent import real_agent

    return real_agent._PLUGIN_DIR


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="python -m dev.p1.plugin_agents",
        description="List the plugin agents as the P1 prototype would register them.",
    )
    p.add_argument("--plugin-dir", default=None, help="default: real_agent._PLUGIN_DIR")
    return p


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    plugin_dir = Path(args.plugin_dir or _default_plugin_dir())
    agents = load_agent_definitions(plugin_dir)
    for name, agent in agents.items():
        print(
            f"{name:<26} model={agent.model or '-':<18} "
            f"tools={len(agent.tools or []):<3} description_len={len(agent.description)}"
        )
    if len(agents) < EXPECTED_AGENT_COUNT:
        print(
            f"expected at least {EXPECTED_AGENT_COUNT} agents under {plugin_dir / 'agents'}, "
            f"found {len(agents)}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
