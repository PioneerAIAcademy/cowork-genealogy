"""Parse the skill rubric.md format defined in unit-test-spec-v2.md §7.

Conventions enforced when a rubric is present and non-empty:
- exactly one H1 — the skill name
- one or more H2s, each a dimension name
- each H2 section MUST contain three bullets: pass, partial, fail
- no other H2-level structure (the parser is strict by design)

The rubric layer is **opt-in**. A skill with no `rubric.md`, or with a
present-but-empty file, is graded on the base dimensions only. Use
`parse_rubric_or_empty(skill_name, text)` to opt into the empty-rubric
path; `parse_rubric(text)` retains the strict contract for callers
that want to validate a non-empty file directly.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field


class InvalidRubricError(Exception):
    """Raised when a non-empty rubric.md file doesn't match the spec format."""


@dataclass
class RubricDimension:
    name: str
    description: str
    pass_criteria: str
    partial_criteria: str
    fail_criteria: str


@dataclass
class Rubric:
    skill: str
    preamble: str
    dimensions: list[RubricDimension]
    content_hash: str
    raw: str = field(repr=False, default="")


_H1 = re.compile(r"^# +(.+?)\s*$", re.MULTILINE)
_H2 = re.compile(r"^## +(.+?)\s*$", re.MULTILINE)
_BULLET = re.compile(
    r"^\s*-\s+\*\*(pass|partial|fail):\*\*\s+(.+?)\s*$", re.MULTILINE
)


def empty_rubric(skill: str) -> Rubric:
    """Return a rubric with no dimensions. Judge prompt renders this as
    `(none — base dimensions only)` and emits only the base dims."""
    return Rubric(
        skill=skill,
        preamble="",
        dimensions=[],
        content_hash=hashlib.sha256(b"").hexdigest(),
        raw="",
    )


def parse_rubric_or_empty(skill: str, text: str | None) -> Rubric:
    """Opt-in entry point. text=None (file missing) or text.strip()==""
    (present-but-empty) → empty rubric. Otherwise parse strictly."""
    if text is None or not text.strip():
        return empty_rubric(skill)
    return parse_rubric(text)


def parse_rubric(text: str) -> Rubric:
    h1s = _H1.findall(text)
    if not h1s:
        raise InvalidRubricError("rubric must have exactly one H1 (skill name)")
    if len(h1s) > 1:
        raise InvalidRubricError("rubric must have exactly one H1; found multiple")
    skill = h1s[0].strip()

    h2_iter = list(_H2.finditer(text))
    if not h2_iter:
        raise InvalidRubricError("rubric must have at least one H2 dimension")

    preamble = text[: h2_iter[0].start()]
    # strip the H1 line out of the preamble for clean storage
    preamble_lines = [ln for ln in preamble.splitlines() if not ln.startswith("# ")]
    preamble_clean = "\n".join(preamble_lines).strip()

    dimensions: list[RubricDimension] = []
    for i, m in enumerate(h2_iter):
        name = m.group(1).strip()
        start = m.end()
        end = h2_iter[i + 1].start() if i + 1 < len(h2_iter) else len(text)
        section = text[start:end]

        bullets = {kind: body for kind, body in _BULLET.findall(section)}
        for required in ("pass", "partial", "fail"):
            if required not in bullets:
                raise InvalidRubricError(
                    f"dimension '{name}' is missing the **{required}** bullet"
                )

        # Description is everything before the first bullet.
        first_bullet_match = _BULLET.search(section)
        description = section[: first_bullet_match.start()].strip() if first_bullet_match else section.strip()

        dimensions.append(
            RubricDimension(
                name=name,
                description=description,
                pass_criteria=bullets["pass"],
                partial_criteria=bullets["partial"],
                fail_criteria=bullets["fail"],
            )
        )

    # Spec §7 caps each skill's rubric at 5 dimensions (the judge's
    # max_tokens budget assumes the cap holds; more dimensions also makes
    # the judge noisier — see spec §7 "Adding new dimensions"). Enforce
    # at parse time so a malformed rubric.md can't slip past CI.
    if len(dimensions) > _MAX_DIMENSIONS:
        raise InvalidRubricError(
            f"rubric has {len(dimensions)} dimensions; spec §7 caps at "
            f"{_MAX_DIMENSIONS}. Retire the lowest-variance dimensions or "
            f"merge related ones."
        )

    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return Rubric(
        skill=skill,
        preamble=preamble_clean,
        dimensions=dimensions,
        content_hash=digest,
        raw=text,
    )


_MAX_DIMENSIONS = 5
