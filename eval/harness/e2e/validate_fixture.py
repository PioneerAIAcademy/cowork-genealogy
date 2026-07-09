"""Fixture linter for e2e benchmark fixtures — schema + stripping checks.

Two gates, in order:

1. **JSON Schema** (hard, exit 2). `starting-tree.gedcomx.json` and
   `starting-research.json` are validated against `docs/specs/schemas/`
   via `harness.schema_validator` — the same module `e2e.author validate`
   uses, so the authoring gate and this corpus-wide gate cannot disagree.
2. **Stripping completeness** (warn-only), described below.

The crux invariant of an e2e fixture: every entry in
`expected-findings.json` must be **genuinely absent** from
`starting-tree.gedcomx.json`. If a finding's answer is still present in
the stripped tree, the agent gets it for free and the fixture silently
"passes" every run — a worthless benchmark that looks fine.

This is a *fixture* linter, not a skill validator. It operates on the
two static files of a fixture directory and runs no skill. It is
therefore standalone — NOT under `eval/harness/validators/` (those are
unit-skill validators wired to `validator_runner.py` with
before/after-state fixtures). See `docs/plan/e2e-skills.md`.

The check is intentionally a **warn, don't block** name-token overlap:
it can't know the author's intent perfectly (a subject person
legitimately stays when only a relationship was stripped), so it
surfaces *suspects* for the author to review rather than hard-failing
on a fuzzy match. Hard failures (exit 2) are reserved for structurally
broken fixture files, which are a different class of problem.

Usage (from eval/harness/):

  uv run python -m e2e.validate_fixture <fixture-dir> [<fixture-dir> ...]
  uv run python -m e2e.validate_fixture --all          # all of eval/tests/e2e/
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from harness.schema_validator import validate_research_json, validate_tree_gedcomx_json


REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_FIXTURES_ROOT = REPO_ROOT / "eval" / "tests" / "e2e"

# Tokens too common to be discriminating as a name match. Lowercased.
_STOPWORDS = frozenset(
    {
        "the", "a", "an", "of", "and", "or", "to", "from", "in", "at", "on",
        "is", "was", "were", "his", "her", "their", "father", "mother",
        "parent", "child", "son", "daughter", "spouse", "husband", "wife",
        "sibling", "brother", "sister", "unknown", "pid", "ark", "abt",
        "about", "bef", "before", "aft", "after", "circa",
    }
)

_WORD = re.compile(r"[A-Za-z]+")


def _tokens(text: str) -> set[str]:
    """Lowercased alphabetic word tokens, minus stopwords and 1-char noise."""
    return {
        w
        for w in (m.group(0).lower() for m in _WORD.finditer(text or ""))
        if len(w) > 1 and w not in _STOPWORDS
    }


@dataclass
class TreePerson:
    person_id: str
    given_tokens: set[str]
    surname_tokens: set[str]
    fact_types: set[str]  # lowercased fact `type` values on this person

    @property
    def name_tokens(self) -> set[str]:
        return self.given_tokens | self.surname_tokens


def _index_tree(tree: dict[str, Any]) -> list[TreePerson]:
    """Collect per-person name tokens (given vs surname) and fact types."""
    people: list[TreePerson] = []
    for person in tree.get("persons") or []:
        given: set[str] = set()
        surname: set[str] = set()
        for name in person.get("names") or []:
            given |= _tokens(name.get("given", ""))
            surname |= _tokens(name.get("surname", ""))
        fact_types = {
            str(f.get("type", "")).lower()
            for f in (person.get("facts") or [])
            if f.get("type")
        }
        people.append(
            TreePerson(
                person_id=str(person.get("id", "?")),
                given_tokens=given,
                surname_tokens=surname,
                fact_types=fact_types,
            )
        )
    return people


# `details` keys that name the person whose presence we're checking. The
# subject person of a finding legitimately stays in the tree (only a
# relationship/fact about them is stripped), so naming it would cause
# false positives — we deliberately do NOT treat `subject_person` as a
# target name.
_TARGET_KEYS = frozenset({"target_person", "person", "name", "target"})

# Keys whose subtree names the finding's *subject* — the person the finding
# is about, who legitimately stays in the stripped tree. The subject is
# stored as `subject_person: {name: ..., pid: ...}`, and `name` is itself a
# target key, so excluding the subject means pruning the whole subtree:
# skipping only the top-level key would still let the nested `name` leak the
# subject's name into the match bag (flagging the subject + same-named kin).
_SUBJECT_KEYS = frozenset({"subject_person", "subject"})


def _collect_target_names(value: Any, under_target_key: bool) -> list[str]:
    """Recursively collect string leaves that name the finding's *target*.

    Only descends into / collects from subtrees reached through a
    target-ish key (`target_person`, `person`, `name`, …). This keeps the
    finding's subject person — which legitimately remains in the stripped
    tree — out of the match set, avoiding the false positive where a
    relationship finding's description mentions both subject and target.
    """
    out: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            if k in _SUBJECT_KEYS:
                continue  # prune the subject subtree — it legitimately stays
            out += _collect_target_names(v, under_target_key or k in _TARGET_KEYS)
    elif isinstance(value, list):
        for v in value:
            out += _collect_target_names(v, under_target_key)
    elif isinstance(value, str) and under_target_key:
        out.append(value)
    return out


def _finding_name_tokens(finding: dict[str, Any]) -> set[str]:
    """Best-effort name token bag for the finding's *target* person.

    Prefers names under target-ish `details` keys (`target_person`,
    `person`, `name`). Only when `details` yields no target name do we
    fall back to the free-text `description` — and for `person`-type
    findings, where the whole finding *is* about one new person, the
    description is the right source. We don't separate given from surname
    inside the finding; the tree-person match requires overlap on *both*
    of the tree person's own halves, which is the discriminating test.
    """
    target_names = _collect_target_names(finding.get("details"), under_target_key=False)
    bag = _tokens(" ".join(target_names))
    if not bag:
        # No structured target name — fall back to the description. For a
        # `person` finding that's correct (the finding names one person);
        # for others it's a last resort.
        bag = _tokens(str(finding.get("description", "")))
    return bag


def _finding_type_token(finding: dict[str, Any]) -> set[str]:
    """A coarse fact-type token for `fact` findings (e.g. birth/death/marriage)."""
    blob = (
        f"{finding.get('description', '')} "
        f"{json.dumps(finding.get('details') or {})}"
    ).lower()
    hits = set()
    for kind in ("birth", "death", "marriage", "baptism", "burial", "residence",
                 "census", "immigration", "occupation"):
        if kind in blob:
            hits.add(kind)
    return hits


@dataclass
class Suspect:
    finding_id: str
    finding_type: str
    person_id: str
    shared: set[str]
    reason: str


def check_stripping(
    expected_findings: dict[str, Any], tree: dict[str, Any]
) -> list[Suspect]:
    """Return findings that look like they may NOT have been stripped.

    A suspect is a (finding, tree-person) pair where the tree person
    shares at least one given-ish token AND one surname-ish token with
    the finding — i.e. a plausible same-person match still present in
    the stripped tree. For `fact`-type findings we additionally require
    the fact type to be present on that person, since a person
    legitimately remains when only one of their facts was stripped.
    """
    people = _index_tree(tree)
    suspects: list[Suspect] = []

    for finding in expected_findings.get("findings") or []:
        fid = str(finding.get("id", "?"))
        ftype = str(finding.get("type", "?"))
        name_bag = _finding_name_tokens(finding)
        if not name_bag:
            continue  # nothing nameable to match — can't judge presence

        for person in people:
            shared_given = person.given_tokens & name_bag
            shared_surname = person.surname_tokens & name_bag
            if not (shared_given and shared_surname):
                continue

            if ftype == "fact":
                # The person staying is fine; the *fact* must be gone.
                wanted = _finding_type_token(finding)
                if wanted and not (wanted & person.fact_types):
                    continue  # person present, but the fact's type isn't — OK
                reason = (
                    "person and a matching fact type are both still present"
                    if wanted
                    else "person still present (fact type unspecified)"
                )
            else:
                reason = "person still present in the stripped tree"

            suspects.append(
                Suspect(
                    finding_id=fid,
                    finding_type=ftype,
                    person_id=person.person_id,
                    shared=shared_given | shared_surname,
                    reason=reason,
                )
            )

    return suspects


def format_suspect(fixture_name: str, s: Suspect) -> str:
    """The WARN line for one suspect.

    Lives here rather than in `main()` so `e2e.author` can lint an
    *in-memory* candidate tree — on a dry run, or before the first write —
    and still print the same advice as the standalone linter.
    """
    shared = ", ".join(sorted(s.shared))
    if s.finding_type == "fact":
        fix = (
            f"a `fact` finding leaves the person in place, so this is "
            f"only a problem if the stripped fact is still on "
            f"{s.person_id} — check its `facts` in "
            f"starting-tree.gedcomx.json and remove that fact if so."
        )
    else:
        fix = (
            f"if {s.person_id} IS the answer to this finding, delete "
            f"that person and its relationship from "
            f"starting-tree.gedcomx.json and re-run; if it's just a "
            f"relative who happens to share a surname, ignore this line."
        )
    return (
        f"WARN   [{fixture_name}] finding {s.finding_id} ({s.finding_type}): "
        f"tree person {s.person_id} is still present and its name "
        f"overlaps the answer on [{shared}]. {fix}"
    )


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def lint_fixture(fixture_dir: Path) -> tuple[list[Suspect], list[str]]:
    """Lint one fixture dir. Returns (suspects, hard_errors).

    hard_errors are structural problems — a missing or unparseable file, or a
    JSON-Schema violation — that should fail the run with exit 2; suspects are
    warn-only. `e2e.author validate` reaches the same schema check through the
    same `harness.schema_validator` module, so a fixture cannot pass one gate
    and fail the other.
    """
    fixture_dir = Path(fixture_dir)
    errors: list[str] = []
    findings_path = fixture_dir / "expected-findings.json"
    tree_path = fixture_dir / "starting-tree.gedcomx.json"

    for p in (findings_path, tree_path):
        if not p.exists():
            errors.append(f"missing required file: {p.name}")
    if errors:
        return [], errors

    try:
        expected = _load_json(findings_path)
    except (json.JSONDecodeError, OSError) as e:
        errors.append(f"expected-findings.json did not parse: {e}")
    try:
        tree = _load_json(tree_path)
    except (json.JSONDecodeError, OSError) as e:
        errors.append(f"starting-tree.gedcomx.json did not parse: {e}")
    if errors:
        return [], errors

    errors += [f"starting-tree.gedcomx.json: {e}" for e in validate_tree_gedcomx_json(tree)]

    # Optional: a Path-3 fixture under construction may not have one yet.
    research_path = fixture_dir / "starting-research.json"
    if research_path.exists():
        try:
            research = _load_json(research_path)
        except (json.JSONDecodeError, OSError) as e:
            errors.append(f"starting-research.json did not parse: {e}")
        else:
            errors += [f"starting-research.json: {e}" for e in validate_research_json(research)]

    if errors:
        return [], errors

    return check_stripping(expected, tree), []


def _iter_fixture_dirs(fixtures_root: Path) -> Iterable[Path]:
    return sorted(
        p
        for p in fixtures_root.iterdir()
        if p.is_dir() and (p / "expected-findings.json").exists()
    )


def _resolve_target(arg: Path) -> Path:
    """Resolve a positional argument to a fixture directory.

    Accepts either a path to a fixture dir (used as-is if it exists) or a
    bare slug, which is resolved against DEFAULT_FIXTURES_ROOT. A bare slug
    works from any cwd because the root is absolute. If neither resolves to
    an existing directory, the path form is returned so lint_fixture emits
    the usual "missing required file" error against it.
    """
    if arg.exists():
        return arg
    candidate = DEFAULT_FIXTURES_ROOT / arg
    if candidate.is_dir():
        return candidate
    return arg


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="e2e.validate_fixture",
        description="Lint e2e fixtures for stripping completeness.",
    )
    parser.add_argument(
        "fixture_dirs",
        nargs="*",
        type=Path,
        help=(
            "Fixtures to lint: either a path to a fixture dir or a bare slug "
            f"(resolved against {DEFAULT_FIXTURES_ROOT})."
        ),
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help=f"Lint every fixture under {DEFAULT_FIXTURES_ROOT}.",
    )
    args = parser.parse_args(argv)

    targets: list[Path] = [_resolve_target(p) for p in args.fixture_dirs]
    if args.all:
        if not DEFAULT_FIXTURES_ROOT.exists():
            print(f"Fixtures root not found: {DEFAULT_FIXTURES_ROOT}", file=sys.stderr)
            return 2
        targets += list(_iter_fixture_dirs(DEFAULT_FIXTURES_ROOT))
    if not targets:
        parser.error("pass at least one fixture dir, or --all")

    any_hard_error = False
    total_suspects = 0
    for fixture_dir in targets:
        suspects, errors = lint_fixture(fixture_dir)
        name = fixture_dir.name
        if errors:
            any_hard_error = True
            for e in errors:
                print(f"ERROR  [{name}] {e}", file=sys.stderr)
            continue
        if not suspects:
            print(f"OK     [{name}] schema valid, all findings appear stripped")
            continue
        total_suspects += len(suspects)
        for s in suspects:
            print(format_suspect(name, s))

    if any_hard_error:
        return 2  # structural problem — fix the fixture files
    if total_suspects:
        # Warn-only: surface suspects but don't block. The author reviews.
        print(
            f"\n{total_suspects} name-overlap warning(s) — advisory, not a "
            f"failure. Each is a person still in the tree whose name resembles "
            f"an answer; confirm none is the actual stripped answer. Unsure "
            f"about one? Ask Claude in this session: \"Is tree person <PID> "
            f"the answer to finding <id> in this fixture? If so, strip it and "
            f"re-run.\"",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
