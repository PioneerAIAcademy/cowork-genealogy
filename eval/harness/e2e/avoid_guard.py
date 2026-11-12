"""The checks behind `apply_avoid_guard` (spec §3.4.1), one per kind of avoid finding.

An avoid finding names a claim the agent must not leave in its final tree. Each
check returns the tree objects that carry it, keyed so the same objects found in
the fixture's starting tree can be subtracted: whatever the run was handed is
never held against it.

- **Wrong-person** (`details.wrong_candidate.records` present): provenance, a
  tree object citing one of the rejected candidate's records, plus the edge
  check below unless `wrong_candidate.provenance_only` is true (a same-named
  relative the fixture allows).
- **Fact** (`type: "fact"`): the avoided value on any person or Couple, and
  provenance on `wrong_candidate.record` when one is named.
- **Wrong-relationship** (a `relationship` finding with no records): a new edge
  joining the subject to the candidate in the forbidden role, unless it is Step,
  Adoptive, Foster or Guardian.

Stdlib only: `e2e.calibrate_judge` imports this through `e2e.judge` and must
stay runnable offline.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

from e2e.validate_fixture import _fold, _tokens
from harness.dates import extract_year

_RECORD_ID = re.compile(r"1:1:[A-Z0-9]{4}-[A-Z0-9]{2,4}")

# Extra tokens that do not tell one person from another in a candidate's name:
# particles, saint names and month abbreviations (PR #3667, branch
# avoid-guard-subject-anchored). `_tokens` already drops the base stopwords.
_NAME_STOPWORDS = frozenset(
    {
        "de", "da", "do", "dos", "das", "del", "la", "le", "las", "los",
        "von", "van", "der", "den", "di", "du",
        "santo", "santa", "sao", "san", "santos", "saint", "st",
        "jan", "feb", "mar", "apr", "may", "jun",
        "jul", "aug", "sep", "sept", "oct", "nov", "dec",
    }
)

# `details.relation` -> (relationship type, the subject's role on that edge).
RELATION_ROLES: dict[str, tuple[str, str]] = {
    "child": ("ParentChild", "parent"),
    "parent": ("ParentChild", "child"),
    "parents": ("ParentChild", "child"),
    "mother": ("ParentChild", "child"),
    "father": ("ParentChild", "child"),
    "spouse": ("Couple", "couple"),
    "wife": ("Couple", "couple"),
    "husband": ("Couple", "couple"),
}

# A ParentChild edge of one of these subtypes does not assert the forbidden
# biological claim. Anything else, a misspelling included, does.
_NON_BIOLOGICAL = frozenset({"step", "adoptive", "foster", "guardian"})

_LIVE_LINK = frozenset({"confident", "probable"})

_FACT_TYPE_ALIASES = {"baptism": "christening"}

_MONTHS = {
    name: i + 1
    for i, name in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    )
}
_ISO_DATE = re.compile(r"\b(\d{4})-(\d{2})(?:-(\d{2}))?\b")
_MONTH_WORD = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b")
_DAY = re.compile(r"(?<!\d)([0-3]?\d)(?!\d)")


@dataclass
class Hit:
    person_ids: list[str]
    evidence: str


@dataclass
class FindingHits:
    branch: str
    hits: dict[tuple, Hit] = field(default_factory=dict)


def branch_of(finding: dict[str, Any]) -> str | None:
    """Which check a finding gets, read from its own shape."""
    candidate = _candidate(finding)
    if "records" in candidate:
        return "wrong-person"
    ftype = str(finding.get("type"))
    if ftype == "fact":
        return "fact"
    if ftype == "relationship":
        return "wrong-relationship"
    return None


def _candidate(finding: dict[str, Any]) -> dict[str, Any]:
    wc = (finding.get("details") or {}).get("wrong_candidate")
    return wc if isinstance(wc, dict) else {}


def candidate_name(finding: dict[str, Any]) -> str:
    """The candidate's name: `wrong_candidate.name`, else `target_person.name`."""
    name = _candidate(finding).get("name")
    if isinstance(name, str) and name.strip():
        return name
    target = (finding.get("details") or {}).get("target_person")
    if isinstance(target, dict):
        target = target.get("name")
    return target if isinstance(target, str) else ""


def name_tokens(text: str) -> set[str]:
    return {t for t in _tokens(text) if t not in _NAME_STOPWORDS}


def name_is_matchable(name: str) -> bool:
    """At least two name tokens before the first comma, so a given and a
    surname can both be hit. What follows a comma is description
    ("Ricardo, baptized 3 Apr 1874")."""
    return len(name_tokens(name.split(",")[0])) >= 2


def relation_role(finding: dict[str, Any]) -> tuple[str, str] | None:
    relation = (finding.get("details") or {}).get("relation")
    return RELATION_ROLES.get(str(relation).strip().lower()) if isinstance(relation, str) else None


def avoided_value(finding: dict[str, Any]) -> tuple[str | None, str | None]:
    """(date, place) the fact finding forbids; either may be None."""
    details = finding.get("details") or {}
    candidate = _candidate(finding)
    date = details.get("date") or candidate.get("date") or details.get("wrong_value")
    place = details.get("place") or candidate.get("place")
    return (
        date if isinstance(date, str) and date.strip() else None,
        place if isinstance(place, str) and place.strip() else None,
    )


# --- provenance -------------------------------------------------------------


def _record_ids(values: Iterable[Any]) -> set[str]:
    return {m for v in values if isinstance(v, str) for m in _RECORD_ID.findall(v)}


def _provenance(
    record_values: Iterable[Any], tree: dict[str, Any], research: dict[str, Any]
) -> dict[tuple, Hit]:
    candidates = _record_ids(record_values)
    hits: dict[tuple, Hit] = {}
    if not candidates:
        return hits

    sources: set[str] = set()
    for s in tree.get("sources") or []:
        text = " ".join(str(s.get(k) or "") for k in ("url", "citation", "title"))
        if _record_ids([text]) & candidates:
            sources.add(str(s.get("id")))

    assertions = {
        str(a.get("id")): a
        for a in research.get("assertions") or []
        if _record_ids([a.get("record_id"), a.get("record_persona_id")]) & candidates
    }
    research_sources = {str(s.get("id")): s for s in research.get("sources") or []}
    for a in assertions.values():
        rs = research_sources.get(str(a.get("source_id")))
        if rs and rs.get("gedcomx_source_description_id"):
            sources.add(str(rs["gedcomx_source_description_id"]))

    def cites(obj: dict[str, Any]) -> bool:
        return any(str(ref.get("ref")) in sources for ref in obj.get("sources") or [])

    persons = {str(p.get("id")) for p in tree.get("persons") or []}
    for p in tree.get("persons") or []:
        pid = str(p.get("id"))
        if cites(p):
            hits[("person", pid)] = Hit([pid], f"person {pid} cites the candidate's record")
        for n in p.get("names") or []:
            if cites(n):
                hits[("name", pid, str(n.get("id")))] = Hit(
                    [pid], f"name {n.get('id')} on {pid} cites the candidate's record"
                )
        for f in p.get("facts") or []:
            if cites(f):
                hits[("fact", pid, str(f.get("id")))] = Hit(
                    [pid], f"{f.get('type')} fact {f.get('id')} on {pid} cites the candidate's record"
                )
    for r in tree.get("relationships") or []:
        ends = _ends(r)
        rid = str(r.get("id"))
        if cites(r):
            hits[("edge", rid, *ends)] = Hit(ends, f"{r.get('type')} {rid} cites the candidate's record")
        for f in r.get("facts") or []:
            if cites(f):
                hits[("edge-fact", rid, str(f.get("id")))] = Hit(
                    ends, f"{f.get('type')} fact on {rid} cites the candidate's record"
                )
    for pe in research.get("person_evidence") or []:
        pid = str(pe.get("person_id"))
        if (
            str(pe.get("assertion_id")) in assertions
            and pe.get("confidence") in _LIVE_LINK
            and not pe.get("superseded_by")
            and pid in persons
        ):
            hits[("link", pid)] = Hit(
                [pid], f"{pid} is linked ({pe.get('confidence')}) to the candidate's record"
            )
    return hits


def _ends(rel: dict[str, Any]) -> list[str]:
    return [str(rel[k]) for k in ("parent", "child", "person1", "person2") if rel.get(k) is not None]


# --- value ------------------------------------------------------------------


def _fact_type_key(value: Any) -> str:
    key = re.sub(r"[^a-z]", "", _fold(str(value or "")).lower())
    return _FACT_TYPE_ALIASES.get(key, key)


def parse_date(text: str | None) -> tuple[int, int | None, int | None] | None:
    """(year, month, day) stated by a date string; month and day may be None."""
    if not text:
        return None
    folded = _fold(text).lower()
    iso = _ISO_DATE.search(folded)
    if iso:
        return (int(iso.group(1)), int(iso.group(2)), int(iso.group(3)) if iso.group(3) else None)
    year = extract_year(folded)
    if year is None:
        return None
    month_match = _MONTH_WORD.search(folded)
    month = _MONTHS[month_match.group(1)] if month_match else None
    day = None
    if month is not None:
        day_match = _DAY.search(folded.replace(year, " "))
        day = int(day_match.group(1)) if day_match else None
    return (int(year), month, day)


def _date_matches(avoided: tuple[int, int | None, int | None], fact: dict[str, Any]) -> bool:
    for text in (fact.get("standard_date"), fact.get("date")):
        stated = parse_date(text if isinstance(text, str) else None)
        if stated and all(a is None or a == b for a, b in zip(avoided, stated)):
            return True
    return False


def _place_matches(place: str, fact: dict[str, Any]) -> bool:
    first = _fold(place.split(",")[0]).strip().lower()
    return bool(first) and any(
        first in _fold(str(fact.get(k) or "")).lower() for k in ("place", "standard_place")
    )


def _value(finding: dict[str, Any], tree: dict[str, Any]) -> dict[tuple, Hit]:
    hits: dict[tuple, Hit] = {}
    ftype = _fact_type_key((finding.get("details") or {}).get("fact_type"))
    date, place = avoided_value(finding)
    avoided_date = parse_date(date)
    if not ftype or not (avoided_date or place):
        return hits

    def scan(holder: tuple[str, ...], facts: list[dict[str, Any]], ids: list[str], label: str) -> None:
        for f in facts or []:
            if _fact_type_key(f.get("type")) != ftype:
                continue
            found = _date_matches(avoided_date, f) if avoided_date else _place_matches(place or "", f)
            if found:
                stated = f.get("standard_date") or f.get("date") or f.get("place")
                hits[(*holder, ftype, avoided_date or place)] = Hit(
                    ids, f"{f.get('type')} {stated!r} on {label}"
                )

    for p in tree.get("persons") or []:
        pid = str(p.get("id"))
        scan(("person", pid), p.get("facts") or [], [pid], pid)
    for r in tree.get("relationships") or []:
        ends = _ends(r)
        scan(("edge", *sorted(ends)), r.get("facts") or [], ends, f"{r.get('type')} {r.get('id')}")
    return hits


# --- edge -------------------------------------------------------------------


def _person_name_tokens(person: dict[str, Any] | None) -> tuple[set[str], set[str]]:
    given: set[str] = set()
    surname: set[str] = set()
    for n in (person or {}).get("names") or []:
        given |= _tokens(n.get("given", ""))
        surname |= _tokens(n.get("surname", ""))
    return given, surname


def _edge(
    finding: dict[str, Any],
    tree: dict[str, Any],
    subjects: set[str],
    recover_findings: list[dict[str, Any]],
    starting_tree: dict[str, Any] | None,
) -> dict[tuple, Hit]:
    hits: dict[tuple, Hit] = {}
    role = relation_role(finding)
    if role is None or not subjects:
        return hits
    any_new = _candidate(finding).get("any_new") is True
    bag = name_tokens(candidate_name(finding))
    if not any_new and not bag:
        return hits
    persons = {str(p.get("id")): p for p in tree.get("persons") or []}
    # A recover target shares the subject's surname by construction, so the
    # subject's own name tokens never exempt anyone ("a father surnamed Hole is
    # the tell" on hole-parents-negative f3).
    own = set().union(*(set().union(*_person_name_tokens(persons.get(s))) for s in subjects)) if subjects else set()
    expected = [name_tokens(candidate_name(f)) - own for f in recover_findings]
    known = {e for r in (starting_tree or {}).get("relationships") or [] for e in _ends(r)}

    rtype, subject_role = role
    for r in tree.get("relationships") or []:
        if r.get("type") != rtype:
            continue
        if rtype == "ParentChild":
            mine, other = ("parent", "child") if subject_role == "parent" else ("child", "parent")
            if str(r.get(mine)) not in subjects or r.get(other) is None:
                continue
            if str(r.get("subtype") or "").strip().lower() in _NON_BIOLOGICAL:
                continue
            other_id = str(r.get(other))
        else:
            a, b = str(r.get("person1")), str(r.get("person2"))
            if a in subjects:
                other_id = b
            elif b in subjects:
                other_id = a
            else:
                continue
        given, surname = _person_name_tokens(persons.get(other_id))
        if any_new:
            if other_id in known or any((given | surname) & tokens for tokens in expected):
                continue
            why = "a new relative the fixture does not expect"
        elif given & bag and surname & bag:
            why = "named as the candidate"
        else:
            continue
        # Subtype is not in the key: a run that sets Biological on a starting
        # edge has not added a relationship, and the baseline must still match.
        hits[(rtype, subject_role, other_id)] = Hit(
            [other_id], f"{rtype} {r.get('id')} joins the subject to {other_id}, {why}"
        )
    return hits


# --- driver -----------------------------------------------------------------


def finding_hits(
    finding: dict[str, Any],
    *,
    tree: dict[str, Any] | None,
    research: dict[str, Any] | None,
    subject_person_ids: Iterable[str],
    recover_findings: list[dict[str, Any]],
    starting_tree: dict[str, Any] | None,
    presence: bool = False,
) -> FindingHits | None:
    """The objects in `tree` that carry what `finding` forbids, before any baseline.

    `presence=True` is the fixture lint over a starting tree: it skips the
    name-matched edge supplement on a wrong-person finding (a name cannot tell a
    starting-tree namesake from the candidate) and any `any_new` finding (every
    starting-tree relative is "new" with no baseline).
    """
    branch = branch_of(finding)
    if branch is None:
        return None
    tree = tree or {}
    research = research or {}
    subjects = {str(s) for s in subject_person_ids}
    result = FindingHits(branch)
    if branch == "wrong-person":
        result.hits.update(_provenance(_candidate(finding).get("records") or [], tree, research))
        if not presence and _candidate(finding).get("provenance_only") is not True:
            result.hits.update(_edge(finding, tree, subjects, recover_findings, starting_tree))
    elif branch == "fact":
        result.hits.update(_value(finding, tree))
        record = _candidate(finding).get("record")
        if record:
            result.hits.update(_provenance([record], tree, research))
    elif not (presence and _candidate(finding).get("any_new") is True):
        result.hits.update(_edge(finding, tree, subjects, recover_findings, starting_tree))
    return result


def guard_hits(
    expected_findings: dict[str, Any],
    *,
    final_tree: dict[str, Any] | None,
    final_research: dict[str, Any] | None,
    starting_tree: dict[str, Any] | None,
    starting_research: dict[str, Any] | None,
    subject_person_ids: Iterable[str],
) -> dict[str, FindingHits]:
    """Per avoid finding id, what the final tree carries that the starting tree did not."""
    findings = [f for f in expected_findings.get("findings") or [] if isinstance(f, dict)]
    recover = [f for f in findings if str(f.get("polarity", "recover")) != "avoid"]
    subjects = [str(s) for s in subject_person_ids]
    out: dict[str, FindingHits] = {}
    for f in findings:
        if str(f.get("polarity", "recover")) != "avoid":
            continue
        common = dict(subject_person_ids=subjects, recover_findings=recover, starting_tree=starting_tree)
        found = finding_hits(f, tree=final_tree, research=final_research, **common)
        if found is None or not found.hits:
            continue
        if starting_tree is not None:
            base = finding_hits(f, tree=starting_tree, research=starting_research, **common)
            if base is not None:
                found.hits = {k: v for k, v in found.hits.items() if k not in base.hits}
        if found.hits:
            out[str(f.get("id", "?"))] = found
    return out


def read_starting_state(fixture_dir: Path) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """The fixture's starting tree and starting research, each None when unreadable."""

    def read(name: str) -> dict[str, Any] | None:
        try:
            data = json.loads((Path(fixture_dir) / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    return read("starting-tree.gedcomx.json"), read("starting-research.json")
