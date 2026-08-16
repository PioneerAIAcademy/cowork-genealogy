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


#: Prefix on the rationale of a dimension the judge did not grade because a
#: `covered_by` validator already decided it. Load-bearing in three places, so
#: it lives here rather than being spelled out at each: the run log stays
#: auditable, `check_runlogs` skips the dimension when requiring corrections,
#: and `review_sample` must NOT treat the resulting null as the
#: "rubric null on a positive test" signal — that rule exists to catch a null
#: standing in for a 1, and a covered null is the opposite of that.
COVERED_BY_PREFIX = "[covered-by]"


class InvalidRubricError(Exception):
    """Raised when a non-empty rubric.md file doesn't match the spec format."""


@dataclass
class RubricDimension:
    name: str
    description: str
    pass_criteria: str
    partial_criteria: str
    fail_criteria: str
    #: Name of a deterministic validator that decides this dimension. When that
    #: validator RAN and PASSED, the judge does not grade the dimension and the
    #: annotator is not asked to confirm it — the mechanical check already
    #: answered it, and asking twice is what let coverage grow while cost stayed
    #: flat (`question-selection` has 12 validators and 7 of 7 dead dimensions
    #: grading the same axes). Optional; None means the judge always grades it.
    covered_by: str | None = None


@dataclass
class Rubric:
    skill: str
    preamble: str
    dimensions: list[RubricDimension]
    content_hash: str
    raw: str = field(repr=False, default="")

    def dimension_names(self) -> frozenset[str]:
        """The authoritative, case-sensitive set of this rubric's dimension
        names — every `##` heading in `rubric.md`, exactly as written.

        This is what a judge-returned `source: "rubric"` dimension name
        must match to be accepted. Comparison against this set is
        case-sensitive by design: a re-cased variant of a real name is not
        the same name (see judge._extract_dimensions, #1361)."""
        return frozenset(d.name for d in self.dimensions)


_H1 = re.compile(r"^# +(.+?)\s*$", re.MULTILINE)
_H2 = re.compile(r"^## +(.+?)\s*$", re.MULTILINE)
_BULLET = re.compile(
    r"^\s*-\s+\*\*(pass|partial|fail):\*\*\s+(.+?)\s*$", re.MULTILINE
)

# Optional per-dimension retirement declaration:
#     - **covered_by:** test_expected_classifications
# Deliberately a separate pattern from _BULLET: pass/partial/fail stay
# REQUIRED (the parser is strict by design), and this one is not.
_COVERED_BY = re.compile(
    r"^\s*-\s+\*\*covered_by:\*\*\s+([A-Za-z_][A-Za-z0-9_]*)\s*$", re.MULTILINE
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

        covered = _COVERED_BY.search(section)

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
                covered_by=covered.group(1) if covered else None,
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


def split_covered_dimensions(
    rubric: "Rubric", passed_validators: set[str]
) -> tuple["Rubric", list["RubricDimension"]]:
    """Split a rubric into (what the judge grades, what a validator retired).

    A dimension is retired only when its `covered_by` validator both RAN and
    PASSED. A failing or absent validator leaves the dimension with the judge:
    the mechanical check did not answer it, so the fuzzy one still has to.

    Retiring by removing the dimension from the judge's rubric — rather than
    grading it and overwriting — is what makes this an actual saving. The judge
    never sees the criteria, so the tokens are not spent and the score cannot
    be argued with later.
    """
    if not rubric.dimensions:
        return rubric, []
    kept, retired = [], []
    for d in rubric.dimensions:
        if d.covered_by and d.covered_by in passed_validators:
            retired.append(d)
        else:
            kept.append(d)
    if not retired:
        return rubric, []
    judge_rubric = Rubric(
        skill=rubric.skill,
        preamble=rubric.preamble,
        dimensions=kept,
        content_hash=rubric.content_hash,
        raw=rubric.raw,
    )
    return judge_rubric, retired


def covered_dimension_entries(
    retired: list["RubricDimension"],
) -> list[dict]:
    """Run-log entries for retired dimensions: `null`, with the marker.

    They stay in `aggregated_dimensions` on purpose. Dropping them would make a
    covered dimension indistinguishable from one nobody thought to grade, and
    would silently change the dimension key set every reader keys on.
    """
    return [
        {
            "source": "rubric",
            "name": d.name,
            "score": None,
            "rationale": (
                f"{COVERED_BY_PREFIX} decided by the deterministic validator "
                f"`{d.covered_by}`, which ran and passed — the judge was not "
                f"asked to grade this dimension, and no correction is owed for "
                f"it."
            ),
        }
        for d in retired
    ]
