"""Authoring toolkit for e2e benchmark fixtures — the scripted half of
the `/author-e2e-fixture` skill.

The skill used to have the model hand-transcribe a 30-45 KB FamilySearch
tree into `starting-tree.gedcomx.json`, minting ids and normalizing shapes
as it went. That is ~3,700 output tokens of pure transcription per fixture,
and it is where the corpus's four competing relationship-id conventions came
from. This module does it deterministically instead.

Four subcommands, one command shape (from `eval/harness/`):

    uv run python -m e2e.author snapshot --slug <slug> --pid <PID>
    uv run python -m e2e.author strip    --slug <slug> --persons ... --facts ...
    uv run python -m e2e.author scaffold --slug <slug> --name "..." ...
    uv run python -m e2e.author validate --slug <slug>

`snapshot` is the only one that touches the network, and it does so by
shelling to the engine's existing `dev/try-person-read.ts` (auth lives in
the engine, not here). Everything else is offline and re-runnable.

The pipeline, and why it is ordered this way:

    snapshot  ->  unstripped-tree.gedcomx.json   (committed; the answer is IN it)
    [model writes expected-findings.json]
    strip     ->  starting-tree.gedcomx.json     (the benchmark input)
    validate  ->  the landing gate

`snapshot` never writes `starting-tree.gedcomx.json`: until `strip` runs
there is no starting tree, so an aborted authoring run leaves an obviously
incomplete fixture rather than one whose starting tree still contains the
answer. `strip` always reads the committed unstripped tree and never its own
output, so it is idempotent and replayable offline, forever.

Design notes worth knowing before you edit:

* **`living` is part of simplified GedcomX.** `person_read` emits it on every
  person and the FamilySearch ToS gate below is built on it, so the schema
  carries it explicitly. A *missing* `living` is a refusal, not a pass — see
  `living_gate` rule 2.
* **Ids are preserved, not re-minted.** FamilySearch fact ids are UUIDs and
  its person/source ids are PIDs; we keep them verbatim. Ids are synthesized
  only where FS supplies none — always for names and relationships, sometimes
  for facts. No id pattern is enforced anywhere, and nothing reads meaning out
  of an id's shape; `ark` (not the id) says whether a person is in the FS tree.
  See `docs/specs/simplified-gedcomx-spec.md` §3.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
from itertools import count
from pathlib import Path
from typing import Any, Iterable, Iterator

from e2e.validate_fixture import (
    DEFAULT_FIXTURES_ROOT,
    REPO_ROOT,
    check_stripping,
    finding_name_tokens,
    finding_type_token,
    format_suspect,
    index_tree,
    tree_integrity_errors,
)
from harness.schema_validator import (
    SCHEMAS_DIR,
    validate_research_json,
    validate_tree_gedcomx_json,
)


FIXTURES_ROOT = DEFAULT_FIXTURES_ROOT
ENGINE_DIR = REPO_ROOT / "packages" / "engine" / "mcp-server"
TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

UNSTRIPPED_TREE = "unstripped-tree.gedcomx.json"
STARTING_TREE = "starting-tree.gedcomx.json"
STARTING_RESEARCH = "starting-research.json"
EXPECTED_FINDINGS = "expected-findings.json"
FIXTURE_JSON = "fixture.json"

# fixture.json `genre` (spec §3.6). "strip" hides an answer the tree already
# had; "record-hint" strips nothing — the answer lives in a record, so the
# committed snapshot must stay identical to the starting tree.
GENRES = ("strip", "record-hint")

# FamilySearch's own privacy rule: presumed living unless a death is known or
# the birth is more than this many years ago.
PRESUMED_LIVING_YEARS = 110
DEATH_FACT_TYPES = frozenset({"Death", "Burial", "Cremation"})
BIRTH_FACT_TYPES = frozenset({"Birth", "Christening", "Baptism"})

_YEAR = re.compile(r"\b(1\d{3}|20\d{2})\b")

# Field allow-lists, in the key order we emit. Mirrors
# docs/specs/schemas/tree-gedcomx.schema.json. Persons carry no `sources` —
# in the tree format, source references hang off names/facts/relationships.
_PERSON_FIELDS = ("id", "ark", "gender", "living", "names", "facts")
_NAME_FIELDS = ("id", "preferred", "given", "surname", "prefix", "suffix", "type", "sources")
_FACT_FIELDS = (
    "id", "type", "primary", "date", "standard_date", "place",
    "standard_place", "value", "sources",
)
_PARENT_CHILD_FIELDS = ("id", "type", "parent", "child", "subtype", "notes", "sources")
_COUPLE_FIELDS = ("id", "type", "person1", "person2", "facts", "notes", "sources")
_SOURCE_FIELDS = ("id", "title", "citation", "author", "url")
_SOURCE_REF_FIELDS = ("ref", "page", "quality")


class AuthorError(Exception):
    """A refusal or a hard failure. Printed as ERROR; exits 2."""


# The PID is pasted out of a chat message and — on Windows — ends up in a
# `cmd /c npx ...` argv, where subprocess does NOT escape cmd.exe
# metacharacters (`&`, `|`, `^`, `%VAR%`): a PID like `KWZQ-8Q4&calc` would
# execute `calc`. Validate the shape before it reaches any subprocess.
_VALID_PID = re.compile(r"^[A-Za-z0-9-]+$")

# Slugs become path components under eval/tests/e2e/ — reject separators and
# dot-traversal outright rather than writing outside the fixtures root.
_VALID_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def _slug_arg(value: str) -> str:
    if not _VALID_SLUG.match(value):
        raise argparse.ArgumentTypeError(
            f"slug must be kebab-case ([a-z0-9-], no leading dash), got {value!r}"
        )
    return value


# --- json io ---------------------------------------------------------------


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as e:
        raise AuthorError(f"missing required file: {path}") from e
    except json.JSONDecodeError as e:
        raise AuthorError(f"{path.name} did not parse: {e}") from e


def _write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


# --- schema helpers --------------------------------------------------------


@lru_cache(maxsize=1)
def _canonical_fact_types() -> dict[str, str]:
    """Lowercased -> PascalCase, from the schema's own examples list."""
    enums = json.loads((SCHEMAS_DIR / "enums.schema.json").read_text(encoding="utf-8"))
    examples = enums["$defs"]["gedcomx_fact_type_recommended"].get("examples") or []
    return {t.lower(): t for t in examples}


def _canonical_fact_type(value: Any) -> Any:
    """`move` -> `Move`. Unrecognized types pass through untouched."""
    if not isinstance(value, str):
        return value
    return _canonical_fact_types().get(value.strip().lower(), value)


def _schema_errors_for_tree(tree: dict[str, Any]) -> list[str]:
    return validate_tree_gedcomx_json(tree)


# --- normalization ---------------------------------------------------------


def _prune(obj: dict[str, Any], allowed: tuple[str, ...], dropped: Counter) -> dict[str, Any]:
    """Keep only `allowed` keys, emitted in `allowed` order. Tally the rest."""
    for key in obj:
        if key not in allowed:
            dropped[key] += 1
    return {k: obj[k] for k in allowed if k in obj}


def _drop_unless_true(obj: dict[str, Any], key: str) -> None:
    """`preferred` and `primary` are `const: true` — a `false` is not valid."""
    if key in obj and obj[key] is not True:
        del obj[key]


def _backfill_ids(prefix: str, taken: Iterable[str]) -> Iterator[str]:
    """Yield `<prefix><n>` ids for objects that arrived without one.

    Steps over ids the document already spends, because arriving ids are kept
    verbatim: a tree whose first two facts are `F1`/`F2` and whose third has
    none must not have `F1` minted onto the third.
    """
    spent = set(taken)
    for n in count(1):
        candidate = f"{prefix}{n}"
        if candidate not in spent:
            yield candidate


def _ids_in(objs: Iterable[Any]) -> set[str]:
    return {str(o["id"]) for o in objs if isinstance(o, dict) and o.get("id")}


def _all_facts(raw: dict[str, Any]) -> Iterator[dict[str, Any]]:
    for holder in (raw.get("persons") or []) + (raw.get("relationships") or []):
        if isinstance(holder, dict):
            yield from (holder.get("facts") or [])


def _fix_source_refs(
    holder: dict[str, Any],
    src_map: dict[str, str],
    dropped: Counter,
    where: str,
    warnings: list[str],
) -> None:
    """Resolve `holder["sources"][*].ref` against the tree's source ids.

    Source ids are preserved verbatim, so this is normally an identity map; it
    still prunes unknown ref fields and drops refs with no matching source.
    """
    refs = holder.get("sources")
    if not refs:
        holder.pop("sources", None)
        return
    out: list[dict[str, Any]] = []
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        old = str(ref.get("ref", "")).lstrip("#")
        new = src_map.get(old)
        if new is None:
            warnings.append(f"{where}: dropped source reference {old!r} — no such source")
            continue
        pruned = _prune(ref, _SOURCE_REF_FIELDS, dropped)
        pruned["ref"] = new
        out.append(pruned)
    if out:
        holder["sources"] = out
    else:
        holder.pop("sources", None)


def _normalize_fact(
    raw: dict[str, Any],
    ids: Iterator[str],
    src_map: dict[str, str],
    dropped: Counter,
    where: str,
    warnings: list[str],
) -> dict[str, Any]:
    fact = _prune(raw, _FACT_FIELDS, dropped)
    # Preserve the FamilySearch-native id (a UUID). Only backfill when FS gave
    # none — the schema requires an id, but nothing reads meaning from its shape.
    if not fact.get("id"):
        fact["id"] = next(ids)
    if "type" in fact:
        fact["type"] = _canonical_fact_type(fact["type"])
    _drop_unless_true(fact, "primary")
    _fix_source_refs(fact, src_map, dropped, where, warnings)
    return {k: fact[k] for k in _FACT_FIELDS if k in fact}


def normalize_tree(raw: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Turn `person_read` output (or a project tree) into a spec-conformant
    simplified-GedcomX document, plus the `living` flag we keep for the ToS gate.

    Closes the gaps between what `person_read` returns and what
    `tree-gedcomx.schema.json` accepts:

    * preserves every id it is given (person/source PIDs, fact UUIDs) and
      synthesizes one only where none arrived — always for names and
      relationships, which `person_read` does not identify, sometimes for
      facts. Ids are never re-minted; nothing reads meaning out of an id's
      shape (simplified-gedcomx-spec §3);
    * drops fields the schema forbids (`source.notes`, person-level
      `sources`, facts on a `ParentChild`);
    * PascalCases fact types (`move` -> `Move`);
    * drops relationships whose endpoints aren't in `persons` — `person_read
      --relatives` returns edges to grandparents and in-laws whose person
      records it did not include, and those are dangling references;
    * de-duplicates identical relationships;
    * warns on duplicate incoming ids — preserved verbatim, so a duplicate
      makes `strip`'s selectors ambiguous (and `apply_strip` refuses).

    Returns the tree and a list of WARN strings. Lenient by design — it
    warns rather than raising on structurally odd but iterable input; the
    schema check in `strip`/`validate` is the gate, not this. (Input that
    isn't shaped like a tree at all — e.g. a person that isn't an object —
    still raises.)
    """
    warnings: list[str] = []
    dropped: Counter = Counter()
    persons_in, rels_in = raw.get("persons") or [], raw.get("relationships") or []

    for kind, id_list in (
        ("person", [str(p.get("id")) for p in persons_in if isinstance(p, dict) and p.get("id")]),
        ("relationship", [str(r.get("id")) for r in rels_in if isinstance(r, dict) and r.get("id")]),
        ("fact", [str(f.get("id")) for f in _all_facts(raw) if isinstance(f, dict) and f.get("id")]),
    ):
        for dup, n in sorted(Counter(id_list).items()):
            if n > 1:
                warnings.append(
                    f"duplicate {kind} id {dup!r} appears {n} times — ids must be "
                    f"unique, and strip will refuse this tree until they are"
                )
    name_ids = _backfill_ids("N", _ids_in(n for p in persons_in for n in p.get("names") or []))
    fact_ids = _backfill_ids("F", _ids_in(_all_facts(raw)))
    rel_ids = _backfill_ids("R", _ids_in(rels_in))
    source_ids = _backfill_ids("S", _ids_in(raw.get("sources") or []))

    # 1. Sources first — everything else references them.
    src_map: dict[str, str] = {}
    sources: list[dict[str, Any]] = []
    for entry in raw.get("sources") or []:
        old_id = str(entry.get("id", ""))
        if old_id and old_id in src_map:
            warnings.append(f"duplicate source id {old_id!r} — kept the first")
            continue
        source = _prune(entry, _SOURCE_FIELDS, dropped)
        # Preserve the FamilySearch-native id (a PID). A source with no id is
        # unreferenceable anyway — refs point at ids — but the schema wants one.
        if not source.get("id"):
            source["id"] = next(source_ids)
        if old_id:
            src_map[old_id] = source["id"]
        sources.append({k: source[k] for k in _SOURCE_FIELDS if k in source})

    # 2. Persons.
    persons: list[dict[str, Any]] = []
    for entry in raw.get("persons") or []:
        person = _prune(entry, _PERSON_FIELDS, dropped)
        pid = str(person.get("id", "?"))

        names: list[dict[str, Any]] = []
        for raw_name in person.get("names") or []:
            name = _prune(raw_name, _NAME_FIELDS, dropped)
            if not name.get("id"):
                name["id"] = next(name_ids)
            _drop_unless_true(name, "preferred")
            _fix_source_refs(name, src_map, dropped, f"person {pid}", warnings)
            names.append({k: name[k] for k in _NAME_FIELDS if k in name})
        if names:
            person["names"] = names

        facts = [
            _normalize_fact(f, fact_ids, src_map, dropped, f"person {pid}", warnings)
            for f in (person.get("facts") or [])
        ]
        if facts:
            person["facts"] = facts
        else:
            person.pop("facts", None)

        persons.append({k: person[k] for k in _PERSON_FIELDS if k in person})

    known_ids = {str(p.get("id")) for p in persons}

    # 3. Relationships. Backfill ids, drop danglers, de-dupe.
    relationships: list[dict[str, Any]] = []
    seen: dict[tuple[str, ...], int] = {}  # key -> index into `relationships`
    dangling = 0
    for entry in raw.get("relationships") or []:
        rel_type = entry.get("type")
        if rel_type == "ParentChild":
            fields, endpoints = _PARENT_CHILD_FIELDS, ("parent", "child")
        elif rel_type == "Couple":
            fields, endpoints = _COUPLE_FIELDS, ("person1", "person2")
        else:
            warnings.append(f"dropped relationship with unknown type {rel_type!r}")
            continue

        refs = tuple(str(entry.get(k, "")) for k in endpoints)
        if any(r not in known_ids for r in refs):
            dangling += 1
            continue
        key = (str(rel_type), *refs)
        if key in seen:
            kept = relationships[seen[key]]
            # An upstream duplicate can be the copy that carries the Marriage
            # fact; dropping it blind would lose the fact silently.
            if rel_type == "Couple" and (entry.get("facts") or []) and "facts" not in kept:
                kept["facts"] = [
                    _normalize_fact(f, fact_ids, src_map, dropped,
                                    f"relationship {kept['id']}", warnings)
                    for f in entry.get("facts") or []
                ]
                relationships[seen[key]] = {k: kept[k] for k in fields if k in kept}
                warnings.append(
                    f"duplicate {rel_type} {refs[0]}/{refs[1]} — kept the first, "
                    f"plus the duplicate's facts (the first had none)"
                )
            else:
                warnings.append(f"duplicate {rel_type} {refs[0]}/{refs[1]} — kept the first")
            continue

        rel = _prune(entry, fields, dropped)
        if not rel.get("id"):
            rel["id"] = next(rel_ids)
        if rel_type == "Couple":
            rel_facts = [
                _normalize_fact(f, fact_ids, src_map, dropped,
                                f"relationship {rel['id']}", warnings)
                for f in (entry.get("facts") or [])
            ]
            if rel_facts:
                rel["facts"] = rel_facts
        _fix_source_refs(rel, src_map, dropped, f"relationship {rel['id']}", warnings)
        seen[key] = len(relationships)
        relationships.append({k: rel[k] for k in fields if k in rel})

    if dangling:
        warnings.append(
            f"dropped {dangling} relationship(s) pointing at persons not in the "
            f"tree — `person_read --relatives` returns edges to kin one hop "
            f"beyond the persons it includes"
        )
    for key, n in sorted(dropped.items()):
        warnings.append(f"dropped {n} unsupported field(s) named {key!r} (not in the tree schema)")

    return {"persons": persons, "relationships": relationships, "sources": sources}, warnings


# --- the living-person gate ------------------------------------------------


@dataclass
class GateResult:
    tree: dict[str, Any]
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _display_name(person: dict[str, Any]) -> str:
    name = (person.get("names") or [{}])[0]
    full = f"{name.get('given', '')} {name.get('surname', '')}".strip()
    return full or "(unnamed)"


def _fact_types(person: dict[str, Any]) -> set[str]:
    return {str(f.get("type", "")) for f in (person.get("facts") or [])}


def _birth_year(person: dict[str, Any]) -> int | None:
    for fact in person.get("facts") or []:
        if str(fact.get("type", "")) not in BIRTH_FACT_TYPES:
            continue
        for value in (fact.get("standard_date"), fact.get("date")):
            match = _YEAR.search(str(value or ""))
            if match:
                return int(match.group(1))
    return None


def _endpoints(rel: dict[str, Any]) -> tuple[str, ...]:
    keys = ("parent", "child") if rel.get("type") == "ParentChild" else ("person1", "person2")
    return tuple(str(rel.get(k, "")) for k in keys)


def _remove_persons(
    tree: dict[str, Any], removed: set[str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Drop the named persons and cascade to every relationship touching them.

    Returns (pruned tree, cut relationships). Shared by `--drop-living` and
    `snapshot --check` (which excludes live-tree living persons from the
    drift diff so they don't read as permanent false drift).
    """
    kept_rels, cut_rels = [], []
    for rel in tree.get("relationships") or []:
        (cut_rels if set(_endpoints(rel)) & removed else kept_rels).append(rel)
    pruned = {
        **tree,
        "persons": [p for p in tree.get("persons") or [] if str(p.get("id")) not in removed],
        "relationships": kept_rels,
    }
    return pruned, cut_rels


def living_gate(
    tree: dict[str, Any],
    *,
    drop_living: bool = False,
    heuristic: bool = False,
    today: date | None = None,
) -> GateResult:
    """FamilySearch's ToS forbids committing fixtures about living persons.

    We commit the *unstripped* tree, which contains parents, spouses and
    children — so this covers every person in it, not just the subject.

    1. `living: true` anywhere is a refusal. (This also catches the subject's
       HTTP-204 case: `person_read` returns a `livingPersonStub` with
       `living: true` rather than throwing.)
    2. A *missing* `living` field is a refusal. Absent is not deceased, and
       the tree schema does not require the field.
    3. `drop_living=True` is the escape hatch for rule 1: remove them,
       cascade their relationships, say exactly what went.
    4. `heuristic=True` adds a 110-year WARN. **Only ever pass this for an
       unstripped tree.** Stripping a death fact is precisely what makes a
       deceased person look living — run it post-strip and it flags the
       subject of every death-date fixture.
    """
    errors: list[str] = []
    warnings: list[str] = []
    cutoff = (today or date.today()).year - PRESUMED_LIVING_YEARS

    persons = tree.get("persons") or []

    living: list[tuple[str, str]] = []  # (person id, display label)
    missing: list[str] = []
    for person in persons:
        pid = str(person.get("id", "?"))
        label = f"{pid} ({_display_name(person)})"
        if "living" not in person:
            missing.append(label)
        elif person["living"] is True:
            living.append((pid, label))
        elif heuristic and not (_fact_types(person) & DEATH_FACT_TYPES):
            year = _birth_year(person)
            if year is not None and year > cutoff:
                warnings.append(
                    f"{label} was born {year} and has no Death/Burial/Cremation "
                    f"fact — FamilySearch would presume this person living "
                    f"(born after {cutoff}). Its `living: false` says otherwise; "
                    f"confirm before committing."
                )

    if missing:
        errors.append(
            "these persons have no `living` field, and absent is not deceased — "
            "set `living: false` on each once you have confirmed the death: "
            + ", ".join(missing)
        )

    if not living:
        return GateResult(tree, errors, warnings)

    labels = [label for _, label in living]
    if not drop_living:
        errors.append(
            "FamilySearch's terms forbid committing data about living persons, "
            "and these are marked living: " + ", ".join(labels) + ". Either pick a "
            "different subject, or re-run with --drop-living to remove them and "
            "their relationships from the tree."
        )
        return GateResult(tree, errors, warnings)

    pruned, cut_rels = _remove_persons(tree, {pid for pid, _ in living})
    warnings.append(f"--drop-living removed {len(living)} living person(s): " + ", ".join(labels))
    if cut_rels:
        warnings.append(
            f"--drop-living cascaded to {len(cut_rels)} relationship(s): "
            + ", ".join(f"{r.get('type')} {'/'.join(_endpoints(r))}" for r in cut_rels)
        )
    return GateResult(pruned, errors, warnings)


# --- the id index ----------------------------------------------------------


def _fact_line(fact: dict[str, Any], indent: int, widths: dict[str, int]) -> str:
    return (
        f"{' ' * indent}{str(fact.get('id', '?')):<{widths['fact']}}  "
        f"{str(fact.get('type', '?')):<{widths['type']}}  "
        f"{str(fact.get('date') or fact.get('standard_date') or ''):<{widths['date']}}  "
        f"{fact.get('place', '')}"
    ).rstrip()


def _width(values: Iterable[Any], minimum: int = 2) -> int:
    return max((len(str(v)) for v in values), default=minimum) or minimum


def render_index(tree: dict[str, Any]) -> str:
    """The naming surface for `strip`.

    You cannot strip what you cannot name, and normalization just invented
    every `F`/`R`/`S` id — so the model has no other way to learn them.
    Relationship-level facts are rendered too: a `Marriage` lives on the
    `Couple` relationship, so a person-only index would make a marriage
    fixture's answer invisible and unreachable by `strip`'s selectors.
    """
    persons = tree.get("persons") or []
    relationships = tree.get("relationships") or []
    sources = tree.get("sources") or []

    all_facts = [f for p in persons for f in (p.get("facts") or [])]
    all_facts += [f for r in relationships for f in (r.get("facts") or [])]
    widths = {
        "fact": _width(f.get("id", "") for f in all_facts),
        "type": _width(f.get("type", "") for f in all_facts),
        "date": _width(f.get("date") or f.get("standard_date") or "" for f in all_facts),
    }
    name_w = _width(_display_name(p) for p in persons)
    person_w = _width(p.get("id", "") for p in persons)
    rel_w = _width(r.get("id", "") for r in relationships)

    lines = [f"PERSONS ({len(persons)})"]
    for person in persons:
        gender = str(person.get("gender", "?"))[:1] or "?"
        if "living" not in person:
            status = "living?"
        else:
            status = "living" if person["living"] is True else "deceased"
        lines.append(
            f"  {str(person.get('id', '?')):<{person_w}}  {_display_name(person):<{name_w}}  "
            f"{gender}  {status}"
        )
        for fact in person.get("facts") or []:
            lines.append(_fact_line(fact, 6, widths))

    rel_type_w = _width(r.get("type", "") for r in relationships)
    lines.append(f"RELATIONSHIPS ({len(relationships)})")
    for rel in relationships:
        left, right = _endpoints(rel)
        arrow = "->" if rel.get("type") == "ParentChild" else "<->"
        lines.append(
            f"  {str(rel.get('id', '?')):<{rel_w}}  {str(rel.get('type', '?')):<{rel_type_w}}  "
            f"{left} {arrow} {right}"
        )
        for fact in rel.get("facts") or []:
            lines.append(_fact_line(fact, 6, widths))

    # Back-references, when the tree has any. `person_read` emits none; a
    # converted project tree can carry them on facts and names.
    cites: dict[str, list[str]] = {}
    for person in persons:
        pid = str(person.get("id", "?"))
        holders = [*(person.get("names") or []), *(person.get("facts") or [])]
        for holder in holders:
            for ref in holder.get("sources") or []:
                bucket = cites.setdefault(str(ref.get("ref")), [])
                if pid not in bucket:
                    bucket.append(pid)

    src_w = _width(s.get("id", "") for s in sources)
    title_w = _width(s.get("title", "") for s in sources)
    lines.append(f"SOURCES ({len(sources)})")
    for source in sources:
        sid = str(source.get("id", "?"))
        line = f"  {sid:<{src_w}}  {str(source.get('title', '')):<{title_w}}"
        if sid in cites:
            line += f"  [cites: {', '.join(cites[sid])}]"
        lines.append(line.rstrip())

    return "\n".join(lines)


# --- drift audit (`snapshot --check`) --------------------------------------


def _comparable_facts(holder: dict[str, Any]) -> list[tuple[str, ...]]:
    return sorted(
        (
            str(f.get("type", "")), str(f.get("date", "")),
            str(f.get("standard_date", "")), str(f.get("place", "")),
            str(f.get("value", "")),
        )
        for f in holder.get("facts") or []
    )


def _comparable_person(person: dict[str, Any]) -> Any:
    """A person's content with minted ids elided, so an upstream insertion
    that shifts every `F`/`N` id doesn't drown the diff in noise."""
    return {
        "gender": person.get("gender"),
        "living": person.get("living"),
        "names": sorted(
            (n.get("given", ""), n.get("surname", ""), n.get("type", ""))
            for n in person.get("names") or []
        ),
        "facts": _comparable_facts(person),
    }


def diff_trees(old: dict[str, Any], new: dict[str, Any]) -> list[str]:
    """Report how FamilySearch has drifted under a committed fixture."""
    report: list[str] = []
    old_p = {str(p.get("id")): p for p in old.get("persons") or []}
    new_p = {str(p.get("id")): p for p in new.get("persons") or []}

    for pid in sorted(new_p.keys() - old_p.keys()):
        report.append(f"person added upstream: {pid} ({_display_name(new_p[pid])})")
    for pid in sorted(old_p.keys() - new_p.keys()):
        report.append(f"person gone upstream: {pid} ({_display_name(old_p[pid])})")
    for pid in sorted(old_p.keys() & new_p.keys()):
        if _comparable_person(old_p[pid]) != _comparable_person(new_p[pid]):
            report.append(f"person changed upstream: {pid} ({_display_name(new_p[pid])})")

    def rel_map(tree: dict[str, Any]) -> dict[tuple[str, ...], list[tuple[str, ...]]]:
        return {
            (str(r.get("type")), *_endpoints(r)): _comparable_facts(r)
            for r in tree.get("relationships") or []
        }

    old_r, new_r = rel_map(old), rel_map(new)
    for key in sorted(new_r.keys() - old_r.keys()):
        report.append(f"relationship added upstream: {' '.join(key)}")
    for key in sorted(old_r.keys() - new_r.keys()):
        report.append(f"relationship gone upstream: {' '.join(key)}")
    # A Couple's facts carry the answer of every marriage fixture — a changed
    # marriage date must not read as "matches".
    for key in sorted(old_r.keys() & new_r.keys()):
        if old_r[key] != new_r[key]:
            report.append(f"relationship changed upstream: {' '.join(key)}")

    def titles(tree: dict[str, Any]) -> set[str]:
        return {str(s.get("title", "")) for s in tree.get("sources") or []}

    for title in sorted(titles(new) - titles(old)):
        report.append(f"source added upstream: {title}")
    for title in sorted(titles(old) - titles(new)):
        report.append(f"source gone upstream: {title}")

    return report


# --- fetching --------------------------------------------------------------


def _npx(args: list[str]) -> list[str]:
    # On Windows `npx` resolves to `npx.cmd`, which subprocess cannot exec
    # directly (WinError 193). `tsx` is not resolvable from the engine's
    # node_modules, so `node --import tsx` is not an option either.
    # `--yes` keeps a cold npx cache from blocking on an "Ok to proceed?"
    # prompt that capture_output makes invisible (tsx is not an engine dep).
    return (["cmd", "/c", "npx"] if os.name == "nt" else ["npx"]) + ["--yes"] + args


def fetch_person_read(pid: str) -> dict[str, Any]:
    """Shell to the engine's `dev/try-person-read.ts`, which prints exactly
    `personReadTool({...})` as JSON to stdout. Auth is the engine's
    `getValidToken()` against `~/.familysearch-mcp/tokens.json`.
    """
    if not _VALID_PID.match(pid):
        raise AuthorError(
            f"{pid!r} does not look like a FamilySearch person id (letters, "
            f"digits and dashes only, e.g. KNDX-MKG). Check the PID and retry."
        )
    cmd = _npx(["tsx", "dev/try-person-read.ts", pid, "--relatives", "--sources"])
    try:
        proc = subprocess.run(
            cmd, cwd=ENGINE_DIR, capture_output=True, text=True,
            encoding="utf-8", check=False,
        )
    except FileNotFoundError as e:
        raise AuthorError("`npx` is not on PATH — install Node.js and retry.") from e

    if proc.returncode != 0:
        stderr = (proc.stderr or "").strip()
        # Matches the engine's auth errors ("Call the login tool to
        # authenticate."). Deliberately NOT a bare "token" match — a tsx
        # crash printing "SyntaxError: Unexpected token" is a code bug, and
        # sending the author to re-login over it would be a dead end.
        if re.search(r"login tool|authenticat|not signed in", stderr, re.I):
            raise AuthorError(
                "Not signed in to FamilySearch. Run `Login.bat` (developers: "
                "`make e2e-login`), then re-run this command."
            )
        raise AuthorError(f"person_read failed for {pid} (exit {proc.returncode}):\n{stderr}")

    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise AuthorError(
            f"person_read did not return JSON for {pid}:\n{proc.stdout[:400]}"
        ) from e


# --- subcommand: snapshot --------------------------------------------------


def _emit(warnings: Iterable[str], level: str = "WARN") -> None:
    for w in warnings:
        print(f"{level}   {w}", file=sys.stderr)


def _rel(path: Path) -> str:
    """Repo-relative for display. Never raises — a path outside the repo
    (a test's tmp_path) prints in full rather than killing the command."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def cmd_snapshot(args: argparse.Namespace) -> int:
    fixture_dir = FIXTURES_ROOT / args.slug
    out_path = fixture_dir / UNSTRIPPED_TREE

    if args.from_file:
        raw = _read_json(Path(args.from_file))
    else:
        raw = fetch_person_read(args.pid)

    tree, warnings = normalize_tree(raw)

    if args.check:
        if not out_path.exists():
            raise AuthorError(f"nothing to check against: {out_path} does not exist")
        # Committed trees never contain living persons (the gate refuses or
        # --drop-living removed them), so a living person in the live tree is
        # not drift — diffing it in would report "person added upstream"
        # forever and train authors to ignore DRIFT lines.
        live = {
            str(p.get("id"))
            for p in tree.get("persons") or []
            if isinstance(p, dict) and p.get("living") is True
        }
        fresh = tree
        if live:
            fresh, _ = _remove_persons(tree, live)
            print(
                f"NOTE   [{args.slug}] excluded {len(live)} living person(s) "
                f"from the drift audit: {', '.join(sorted(live))}",
                file=sys.stderr,
            )
        drift = diff_trees(_read_json(out_path), fresh)
        if not drift:
            print(f"OK     [{args.slug}] FamilySearch matches the committed unstripped tree")
            return 0
        for line in drift:
            print(f"DRIFT  [{args.slug}] {line}")
        print(
            f"\n{len(drift)} difference(s). The fixture is NOT rebuilt from this — "
            f"`starting-tree.gedcomx.json` is the benchmark input and re-snapshotting "
            f"would silently rewrite the test. This is an audit only.",
            file=sys.stderr,
        )
        return 0

    if out_path.exists() and not args.force:
        raise AuthorError(
            f"{_rel(out_path)} already exists. A fixture is "
            f"snapshotted once; re-fetching a mutable upstream would silently "
            f"rewrite the test. Pass --force if you really mean to replace it, "
            f"or --check to audit for drift."
        )

    gate = living_gate(tree, drop_living=args.drop_living, heuristic=True)
    _emit(warnings + gate.warnings)
    if gate.errors:
        _emit(gate.errors, "ERROR")
        return 2

    schema_errors = _schema_errors_for_tree(gate.tree)
    if schema_errors:
        # Deliberate soft gate: the snapshot is raw material worth keeping on
        # disk for inspection, and `strip`/`validate` refuse until it's fixed.
        # But these are schema violations, not advisories — label them so.
        _emit(schema_errors, "ERROR")
        print(
            f"wrote {_rel(out_path)} anyway — it is committed and hand-editable, "
            f"and strip/validate will refuse until the errors above are fixed.",
            file=sys.stderr,
        )

    _write_json(out_path, gate.tree)
    print(render_index(gate.tree))
    print(f"\nwrote {_rel(out_path)}")
    print(
        f"next: write {EXPECTED_FINDINGS}, then "
        f"`uv run python -m e2e.author strip --slug {args.slug} ...`"
    )
    return 0


# --- subcommand: strip -----------------------------------------------------


@dataclass
class StripSpec:
    persons: set[str] = field(default_factory=set)
    relationships: set[str] = field(default_factory=set)
    facts: set[tuple[str, str]] = field(default_factory=set)  # (owner id, fact id)
    sources: set[str] = field(default_factory=set)

    def is_empty(self) -> bool:
        return not (self.persons or self.relationships or self.facts or self.sources)


def _id_list(values: list[str] | None) -> list[str]:
    """`--persons A,B --persons C` -> [A, B, C]."""
    return [v.strip() for value in (values or []) for v in value.split(",") if v.strip()]


def parse_strip_spec(args: argparse.Namespace) -> StripSpec:
    facts: set[tuple[str, str]] = set()
    for item in _id_list(args.facts):
        owner, sep, fact_id = item.partition(":")
        if not sep or not owner or not fact_id:
            raise AuthorError(
                f"--facts wants <owner-id>:<fact-id> (e.g. KNDX-MKG:F2 or R4:F12), got {item!r}"
            )
        facts.add((owner, fact_id))
    return StripSpec(
        persons=set(_id_list(args.persons)),
        relationships=set(_id_list(args.relationships)),
        facts=facts,
        sources=set(_id_list(args.sources)),
    )


def apply_strip(
    tree: dict[str, Any], spec: StripSpec
) -> tuple[dict[str, Any], list[str], list[str], list[str]]:
    """Remove the named persons/relationships/facts/sources.

    Returns (tree, removals, warnings, errors). Every named id must exist —
    a typo that silently no-ops would leave the answer in the tree, which is
    the one failure mode this whole module exists to prevent.
    """
    tree = copy.deepcopy(tree)
    removals: list[str] = []
    warnings: list[str] = []
    errors: list[str] = []

    persons = tree.get("persons") or []
    relationships = tree.get("relationships") or []
    sources = tree.get("sources") or []

    by_person = {str(p.get("id")): p for p in persons}
    by_rel = {str(r.get("id")): r for r in relationships}

    # Duplicate ids make every selector ambiguous: removing "the fact with id
    # F1" from a holder carrying two of them deletes both and logs one — the
    # silent-removal failure mode this module exists to prevent. Refuse.
    dup_msgs: list[str] = []
    for kind, id_list in (
        ("person", [str(p.get("id")) for p in persons if p.get("id")]),
        ("relationship", [str(r.get("id")) for r in relationships if r.get("id")]),
    ):
        dup_msgs += [
            f"duplicate {kind} id {i!r}"
            for i, n in sorted(Counter(id_list).items()) if n > 1
        ]
    for holder in (*persons, *relationships):
        hid = str(holder.get("id"))
        fact_list = [str(f.get("id")) for f in holder.get("facts") or [] if f.get("id")]
        dup_msgs += [
            f"duplicate fact id {i!r} on {hid}"
            for i, n in sorted(Counter(fact_list).items()) if n > 1
        ]
    dup_msgs += [
        f"id {i!r} names both a person and a relationship"
        for i in sorted(by_person.keys() & by_rel.keys())
    ]
    if dup_msgs:
        errors.append(
            "strip refuses a tree with ambiguous ids — fix "
            f"{UNSTRIPPED_TREE} and re-run: " + "; ".join(dup_msgs)
        )
        return tree, removals, warnings, errors

    for pid in sorted(spec.persons):
        if pid not in by_person:
            errors.append(f"--persons {pid}: no such person in {UNSTRIPPED_TREE}")
    for rid in sorted(spec.relationships):
        if rid not in by_rel:
            errors.append(f"--relationships {rid}: no such relationship in {UNSTRIPPED_TREE}")
    for owner, fact_id in sorted(spec.facts):
        holder = by_person.get(owner) or by_rel.get(owner)
        if holder is None:
            errors.append(f"--facts {owner}:{fact_id}: no person or relationship {owner}")
        elif not any(str(f.get("id")) == fact_id for f in holder.get("facts") or []):
            errors.append(f"--facts {owner}:{fact_id}: {owner} has no fact {fact_id}")
    known_sources = {str(s.get("id")) for s in sources}
    for sid in sorted(spec.sources):
        if sid not in known_sources:
            errors.append(f"--sources {sid}: no such source in {UNSTRIPPED_TREE}")
    if errors:
        return tree, removals, warnings, errors

    # Facts, before their owners can disappear underneath them.
    for owner, fact_id in sorted(spec.facts):
        holder = by_person.get(owner) or by_rel[owner]
        fact = next(f for f in holder["facts"] if str(f.get("id")) == fact_id)
        holder["facts"] = [f for f in holder["facts"] if str(f.get("id")) != fact_id]
        if not holder["facts"]:
            del holder["facts"]
        detail = " ".join(str(fact.get(k, "")) for k in ("type", "date", "place")).strip()
        removals.append(f"fact {fact_id} on {owner}: {detail}")

    # Persons, cascading to every relationship that touches them.
    for pid in sorted(spec.persons):
        removals.append(f"person {pid}: {_display_name(by_person[pid])}")
    cascaded = [
        r for r in relationships
        if set(_endpoints(r)) & spec.persons and str(r.get("id")) not in spec.relationships
    ]
    for rel in cascaded:
        removals.append(
            f"relationship {rel.get('id')} ({rel.get('type')} "
            f"{'/'.join(_endpoints(rel))}): cascaded from a removed person"
        )
    for rid in sorted(spec.relationships):
        rel = by_rel[rid]
        removals.append(f"relationship {rid} ({rel.get('type')} {'/'.join(_endpoints(rel))})")

    dead_rels = spec.relationships | {str(r.get("id")) for r in cascaded}
    tree["persons"] = [p for p in persons if str(p.get("id")) not in spec.persons]
    tree["relationships"] = [r for r in relationships if str(r.get("id")) not in dead_rels]

    for sid in sorted(spec.sources):
        title = next(s.get("title", "") for s in sources if str(s.get("id")) == sid)
        removals.append(f"source {sid}: {title}")
    tree["sources"] = [s for s in sources if str(s.get("id")) not in spec.sources]

    # A removed source leaves dangling refs behind. Sources are never
    # cascaded from persons (whether a source attests the stripped fact is a
    # judgment call), but a ref to a source that is gone is just broken.
    dangling = 0
    holders: list[dict[str, Any]] = []
    for owner in (*tree["persons"], *tree["relationships"]):
        holders += [owner, *(owner.get("names") or []), *(owner.get("facts") or [])]
    for holder in holders:
        refs = holder.get("sources")
        if not refs:
            continue
        kept = [r for r in refs if str(r.get("ref")) not in spec.sources]
        dangling += len(refs) - len(kept)
        if kept:
            holder["sources"] = kept
        else:
            del holder["sources"]
    if dangling:
        warnings.append(f"removed {dangling} now-dangling source reference(s)")

    still_referenced = {pid for r in tree["relationships"] for pid in _endpoints(r)}
    for person in tree["persons"]:
        pid = str(person.get("id"))
        if not person.get("facts") and pid not in still_referenced:
            warnings.append(
                f"{pid} ({_display_name(person)}) is now orphaned — no facts and no "
                f"relationships. Strip the person too, or leave it as a deliberate stub."
            )

    return tree, removals, warnings, errors


def stripped_summary(removals: list[str]) -> str:
    return "\n".join(f"- Removed {line}" for line in removals)


def fixture_genre(fixture_dir: Path) -> str:
    """The fixture's authoring genre from fixture.json, defaulting to "strip".

    Read leniently — a fixture mid-authoring may not have a fixture.json yet
    (scaffold can legitimately run after strip) — but an *unknown* genre is a
    refusal: it means the author intended non-default handling and this code
    doesn't know which.
    """
    path = fixture_dir / FIXTURE_JSON
    if not path.exists():
        return "strip"
    genre = str(_read_json(path).get("genre") or "strip")
    if genre not in GENRES:
        raise AuthorError(
            f"{FIXTURE_JSON} names unknown genre {genre!r} — expected one of: "
            + ", ".join(GENRES)
        )
    return genre


def _require_findings(fixture_dir: Path) -> dict[str, Any]:
    """`strip` refuses without findings.

    Existence alone is too weak: an empty `findings: []` would pass the gate
    and the stripping linter would then pass *vacuously* — no findings,
    nothing to check, a fixture that scores every run as a pass.
    """
    path = fixture_dir / EXPECTED_FINDINGS
    if not path.exists():
        raise AuthorError(
            f"{EXPECTED_FINDINGS} does not exist. Write it first — it is the "
            f"ground truth this strip is derived from, and the linter has "
            f"nothing to check without it. Use --dry-run to iterate on a strip "
            f"set before the findings are written."
        )
    findings = _read_json(path)
    if not (findings.get("findings") or []):
        raise AuthorError(
            f"{EXPECTED_FINDINGS} contains no findings. An empty findings list "
            f"makes the stripping linter pass vacuously and the fixture worthless."
        )
    return findings


def cmd_strip(args: argparse.Namespace) -> int:
    fixture_dir = FIXTURES_ROOT / args.slug
    unstripped = _read_json(fixture_dir / UNSTRIPPED_TREE)
    spec = parse_strip_spec(args)
    if args.none and not spec.is_empty():
        raise AuthorError(
            "--none means nothing is stripped — drop the other selectors, or drop --none"
        )
    if spec.is_empty() and not args.none:
        raise AuthorError(
            "nothing to strip — pass at least one of --persons/--relationships/"
            "--facts/--sources, or --none for a record-hint fixture (the "
            "snapshot IS the starting tree)"
        )

    if args.dry_run:
        # A dry run still lints when the findings exist — showing a clean dry
        # run and then WARNing on the identical real run would be a trap. It
        # only skips the findings *requirement*, so authors can iterate on a
        # strip set before expected-findings.json is written.
        try:
            findings = _require_findings(fixture_dir)
        except AuthorError:
            findings = None
    else:
        findings = _require_findings(fixture_dir)

    tree, removals, warnings, errors = apply_strip(unstripped, spec)
    if errors:
        _emit(errors, "ERROR")
        return 2

    print(f"REMOVED ({len(removals)})")
    for line in removals:
        print(f"  {line}")
    _emit(warnings)

    schema_errors = _schema_errors_for_tree(tree) + tree_integrity_errors(tree, STARTING_TREE)
    if schema_errors:
        _emit(schema_errors, "ERROR")
        print(
            f"\nWrote nothing. Fix {UNSTRIPPED_TREE} (it is committed and "
            f"hand-editable) and re-run — strip always reads it, never its own output.",
            file=sys.stderr,
        )
        return 2

    if findings is not None:
        # Lint the in-memory candidate, not the file on disk: on a first run
        # `starting-tree.gedcomx.json` does not exist yet, and on a re-run the
        # file is the *previous* strip.
        suspects = check_stripping(findings, tree)
        for suspect in suspects:
            print(format_suspect(args.slug, suspect), file=sys.stderr)

    if args.dry_run:
        print("\n--dry-run: wrote nothing.")
        return 0

    _write_json(fixture_dir / STARTING_TREE, tree)
    print(f"\nwrote {_rel(fixture_dir / STARTING_TREE)}")
    summary = stripped_summary(removals) or (
        "- Nothing removed — record-hint fixture: the snapshot is the starting tree."
    )
    print(f"\nstripped_summary (paste into README.md):\n{summary}")
    return 0


# --- subcommand: scaffold --------------------------------------------------


_PLACEHOLDER = re.compile(r"\{\{(\w+)\}\}")


def _substitute(node: Any, values: dict[str, str]) -> Any:
    """Substitute `{{key}}` in every string leaf.

    Walking the parsed JSON rather than the raw text means a value containing
    a quote or a backslash can't break the document. Missing keys are caught
    during substitution of the template string itself — a substituted *value*
    that happens to contain `{{word}}` is data, not an unfilled placeholder.
    """
    if isinstance(node, dict):
        return {k: _substitute(v, values) for k, v in node.items()}
    if isinstance(node, list):
        return [_substitute(v, values) for v in node]
    if isinstance(node, str):
        def fill(match: re.Match[str]) -> str:
            key = match.group(1)
            if key not in values:
                raise AuthorError(f"template placeholder {{{{{key}}}}} has no value")
            return values[key]
        return _PLACEHOLDER.sub(fill, node)
    return node


def render_template(name: str, values: dict[str, str]) -> dict[str, Any]:
    return _substitute(_read_json(TEMPLATES_DIR / name), values)


def cmd_scaffold(args: argparse.Namespace) -> int:
    fixture_dir = FIXTURES_ROOT / args.slug
    captured = args.captured or date.today().isoformat()
    values = {
        "slug": args.slug,
        "slug_underscored": args.slug.replace("-", "_"),
        "name": args.name,
        "source_pid": args.pid,
        # These may differ on a PID-less fixture: `source_pid` is provenance-only and stays
        # the greppable `PID-TODO` marker, while `subject_person_ids` must name a
        # person the constructed tree actually contains. `--subject-id` is how the
        # author says "the tree calls him I1." Defaulting keeps the PID path, where
        # the tree is keyed by FamilySearch PIDs, pointing at the PID.
        "subject_person_id": args.subject_id or args.pid,
        "captured_date": captured,
        "researcher_question": args.question,
        "tag_question_type": args.question_type,
        "tag_era": args.era,
        "tag_geography": args.geography,
        "difficulty": args.difficulty,
        "notes": args.notes,
    }

    targets = (FIXTURE_JSON, STARTING_RESEARCH)
    existing = [n for n in targets if (fixture_dir / n).exists()]
    if existing and not args.force:
        raise AuthorError(f"{', '.join(existing)} already exist(s) in {args.slug}. Pass --force to overwrite.")

    for template_name in targets:
        rendered = render_template(template_name, values)
        if template_name == FIXTURE_JSON:
            # Injected rather than templated: the template stays renderable
            # by callers that predate the genre field.
            rendered = {
                "id": rendered.get("id"),
                "name": rendered.get("name"),
                "genre": args.genre,
                **rendered,
            }
        _write_json(fixture_dir / template_name, rendered)
        print(f"wrote {_rel(fixture_dir / template_name)}")

    errors = validate_research_json(_read_json(fixture_dir / STARTING_RESEARCH))
    if errors:
        _emit(errors, "ERROR")
        return 2
    return 0


# --- subcommand: validate --------------------------------------------------


def presence_mirror(findings: dict[str, Any], unstripped: dict[str, Any]) -> list[str]:
    """Every expected finding must be *present* in the unstripped tree.

    The inverse of the stripping linter's "absent from the starting tree".
    Catches a finding the author described but never actually stripped, and
    catches `--drop-living` having removed the answer itself.

    Matching is deliberately LOOSER than the linter's: presence accepts a
    single shared name token, where the linter demands overlap on both the
    given and surname halves. An unknown-parent answer is named by one half
    ("the father, ___ Geach") — requiring both halves would hard-fail every
    such fixture with a misleading "was never in the tree". The linter keeps
    the stricter test because its failure mode is a warn, not a block.
    """
    errors: list[str] = []
    people = index_tree(unstripped)
    for finding in findings.get("findings") or []:
        if str(finding.get("polarity", "recover")) == "avoid":
            continue  # an avoided claim is wrong by definition — it was never in the tree
        bag = finding_name_tokens(finding)
        if not bag:
            continue  # nothing nameable to match — same skip the linter makes
        wanted = finding_type_token(finding) if str(finding.get("type")) == "fact" else set()
        present = False
        for person in people:
            if not (bag & person.name_tokens):
                continue
            if wanted and not (wanted & person.fact_types):
                continue  # the person is there, but the answer fact never was
            present = True
            break
        if not present:
            errors.append(
                f"finding {finding.get('id', '?')} names nobody present in "
                f"{UNSTRIPPED_TREE} — it was never in the tree, so stripping it "
                f"proved nothing. Check the finding, or check --drop-living did "
                f"not remove the answer."
            )
    return errors


def cmd_validate(args: argparse.Namespace) -> int:
    fixture_dir = FIXTURES_ROOT / args.slug
    if not fixture_dir.is_dir():
        raise AuthorError(f"no such fixture: {fixture_dir}")

    research = _read_json(fixture_dir / STARTING_RESEARCH)
    starting = _read_json(fixture_dir / STARTING_TREE)
    findings = _require_findings(fixture_dir)
    genre = fixture_genre(fixture_dir)

    # Absent on a PID-less fixture, which constructs its tree from a document:
    # nothing was
    # snapshotted, so there is nothing to preserve and no strip to replay.
    unstripped_path = fixture_dir / UNSTRIPPED_TREE
    unstripped = _read_json(unstripped_path) if unstripped_path.exists() else None

    errors: list[str] = []
    warnings: list[str] = []

    errors += [f"{STARTING_RESEARCH}: {e}" for e in validate_research_json(research)]
    errors += [f"{STARTING_TREE}: {e}" for e in _schema_errors_for_tree(starting)]
    errors += tree_integrity_errors(starting, STARTING_TREE)

    # The engine's runtime cross-file check requires every subject_person_id
    # to name a tree person; a typo'd `scaffold --pid` (or a forgotten
    # `--subject-id` on a PID-less fixture, where source_pid stays "PID-TODO")
    # lints
    # clean here and then fails the agent mid-run.
    tree_pids = {str(p.get("id")) for p in starting.get("persons") or []}
    for sid in (research.get("project") or {}).get("subject_person_ids") or []:
        if str(sid) not in tree_pids:
            errors.append(
                f"{STARTING_RESEARCH}: subject_person_ids names {sid!r}, which is "
                f"not a person in {STARTING_TREE} — the run's tree tools would "
                f"fail on it. On a PID-less fixture, pass "
                f"`scaffold --subject-id <tree-id>`."
            )

    gate = living_gate(starting)
    errors += [f"{STARTING_TREE}: {e}" for e in gate.errors]

    if unstripped is not None:
        errors += [f"{UNSTRIPPED_TREE}: {e}" for e in _schema_errors_for_tree(unstripped)]
        errors += tree_integrity_errors(unstripped, UNSTRIPPED_TREE)
        # heuristic=True only here: a stripped death fact makes a deceased
        # person look living, so the 110-year rule must never see a starting tree.
        gate = living_gate(unstripped, heuristic=True)
        errors += [f"{UNSTRIPPED_TREE}: {e}" for e in gate.errors]
        warnings += gate.warnings
        if genre == "record-hint":
            # Nothing is stripped in this genre, so the presence mirror is
            # meaningless (the answer lives in a record, not the tree) and
            # the snapshot must not have drifted from the starting tree.
            if unstripped != starting:
                errors.append(
                    f"genre 'record-hint' declares nothing stripped, but "
                    f"{UNSTRIPPED_TREE} and {STARTING_TREE} differ — re-run "
                    f"`strip --slug {args.slug} --none`, or fix the genre."
                )
        else:
            errors += presence_mirror(findings, unstripped)
    elif genre == "record-hint":
        warnings.append(
            f"no {UNSTRIPPED_TREE} — record-hint fixtures should commit the "
            f"snapshot (identical to {STARTING_TREE}) so `snapshot --check` "
            f"can audit upstream drift."
        )
    else:
        warnings.append(
            f"no {UNSTRIPPED_TREE} — assuming a PID-less fixture (tree constructed "
            f"from a document). The presence mirror and the 110-year check are skipped."
        )

    suspects = check_stripping(findings, starting)
    _emit(warnings)
    for suspect in suspects:
        print(format_suspect(args.slug, suspect), file=sys.stderr)

    if errors:
        _emit(errors, "ERROR")
        return 2
    print(f"OK     [{args.slug}] schema, living-person gate, and stripping checks pass")
    return 0


# --- cli -------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="e2e.author", description="Author an e2e benchmark fixture."
    )
    subs = parser.add_subparsers(dest="command", required=True)

    snap = subs.add_parser("snapshot", help="Fetch and normalize the unstripped tree.")
    snap.add_argument("--slug", required=True, type=_slug_arg)
    source = snap.add_mutually_exclusive_group(required=True)
    source.add_argument("--pid", help="FamilySearch person id (Path 1).")
    source.add_argument("--from-file", help="A pre-fetched person_read JSON (developer/testing input).")
    snap.add_argument("--force", action="store_true", help=f"Overwrite an existing {UNSTRIPPED_TREE}.")
    snap.add_argument("--drop-living", action="store_true", help="Remove living persons instead of refusing.")
    snap.add_argument("--check", action="store_true", help="Audit FamilySearch drift; write nothing.")
    snap.set_defaults(func=cmd_snapshot)

    strip = subs.add_parser("strip", help=f"Derive {STARTING_TREE} from the unstripped tree.")
    strip.add_argument("--slug", required=True, type=_slug_arg)
    strip.add_argument("--persons", action="append", metavar="ID[,ID...]")
    strip.add_argument("--relationships", action="append", metavar="ID[,ID...]")
    strip.add_argument("--facts", action="append", metavar="OWNER:FACT", help="e.g. KNDX-MKG:F2 or R4:F12")
    strip.add_argument("--sources", action="append", metavar="ID[,ID...]")
    strip.add_argument(
        "--none",
        action="store_true",
        help=f"Strip nothing: {STARTING_TREE} becomes an exact copy of the "
             f"snapshot (record-hint fixtures, where the answer lives in a "
             f"record rather than the tree).",
    )
    strip.add_argument("--dry-run", action="store_true", help="Print everything, write nothing.")
    strip.set_defaults(func=cmd_strip)

    scaffold = subs.add_parser("scaffold", help=f"Render {FIXTURE_JSON} and {STARTING_RESEARCH}.")
    scaffold.add_argument("--slug", required=True, type=_slug_arg)
    scaffold.add_argument("--name", required=True)
    scaffold.add_argument("--pid", default="PID-TODO", help="Omit for a PID-less fixture.")
    scaffold.add_argument(
        "--subject-id",
        help="The subject's id in the tree. Defaults to --pid; pass `I1` on a PID-less fixture.",
    )
    scaffold.add_argument(
        "--genre",
        choices=GENRES,
        default="strip",
        help="Fixture genre (spec §3.6). Default: strip. Pass record-hint "
             "when nothing is stripped and the answer lives in a record.",
    )
    scaffold.add_argument("--question", required=True)
    scaffold.add_argument("--question-type", required=True)
    scaffold.add_argument("--era", required=True)
    scaffold.add_argument("--geography", required=True)
    scaffold.add_argument("--difficulty", required=True, choices=("easy", "medium", "hard"))
    scaffold.add_argument("--notes", default="")
    scaffold.add_argument("--captured", help="ISO date; defaults to today.")
    scaffold.add_argument("--force", action="store_true")
    scaffold.set_defaults(func=cmd_scaffold)

    validate = subs.add_parser("validate", help="The landing gate for a finished fixture.")
    validate.add_argument("--slug", required=True, type=_slug_arg)
    validate.set_defaults(func=cmd_validate)

    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    try:
        return args.func(args)
    except AuthorError as e:
        print(f"ERROR  {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
