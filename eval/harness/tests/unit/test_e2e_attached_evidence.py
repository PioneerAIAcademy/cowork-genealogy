"""A record an expected finding cites must not be waiting, attached, in the tree.

A project extracts every indexed record attached to its subject before the
first question (issue #3516). Stripping never cascades to sources
(`docs/specs/e2e-test-spec.md`, "Cascade semantics"), so a record a finding
rests on can still be attached to the subject, and would then be extracted
with no research done. This check fails on any record a finding cites by its
`1:1:` ark that is attached to a `subject_person_ids` person in the starting
tree, unless `eval/tests/e2e/attached-evidence-allowlist.json` names it, with a
reason, as evidence the research legitimately starts from. It also fails on an
allow-list entry that no longer describes such a record, so the list cannot
outlive what it excuses.

What counts, and what deliberately does not:

- **Cited** is the `1:1:<id>` token. A finding that names a record by its bare
  id, with no `1:1:` prefix, is not matched: the rule is the token, and the
  corpus holds no such citation.
- **Attached** is a person-, name- or fact-level source ref on a subject
  person, mapped through the tree's `sources[].url`. Relationship-level refs
  are excluded, because most name the other party and the extraction step does
  not read them (lead, 2026-10-20). That is a known gap: umbelina-azevedo-death
  cites three records attached to its subject only through ParentChild refs
  (77F3-D8T2, 794X-QD3Z, 79FM-TFZM), and they would leak with this check green
  if the extractor ever read relationship refs.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from e2e.validate_fixture import DEFAULT_FIXTURES_ROOT

ALLOWLIST_NAME = "attached-evidence-allowlist.json"
_RECORD_TOKEN = re.compile(r"1:1:([A-Z0-9]+(?:-[A-Z0-9]+)+)")


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _attached_to_subjects(fixture_dir: Path) -> dict[str, str]:
    """Bare `1:1:` id -> tree source id, for every source a subject cites."""
    tree = _read(fixture_dir / "starting-tree.gedcomx.json")
    research = _read(fixture_dir / "starting-research.json")
    subjects = set((research.get("project") or {}).get("subject_person_ids") or [])
    url = {s.get("id"): s.get("url") or "" for s in tree.get("sources") or [] if isinstance(s, dict)}
    out: dict[str, str] = {}
    for person in tree.get("persons") or []:
        if not isinstance(person, dict) or person.get("id") not in subjects:
            continue
        holders = [person, *(person.get("names") or []), *(person.get("facts") or [])]
        for holder in holders:
            for ref in (holder.get("sources") or []) if isinstance(holder, dict) else []:
                sid = ref.get("ref") if isinstance(ref, dict) else None
                match = _RECORD_TOKEN.search(url.get(sid, ""))
                if match:
                    out.setdefault(match.group(1), sid)
    return out


def _genre(fixture_dir: Path) -> str:
    path = fixture_dir / "fixture.json"
    return (_read(path).get("genre") if path.exists() else None) or "strip"


def attached_evidence_findings(fixtures_root: Path, allowlist: object) -> list[str]:
    """Every leak, stale allow-list entry and malformed allow-list value."""
    problems: list[str] = []
    if not isinstance(allowlist, dict):
        return [f"{ALLOWLIST_NAME}: must be an object of fixture -> {{record id: reason}}"]
    for fixture, entries in allowlist.items():
        if not isinstance(entries, dict):
            problems.append(f"{ALLOWLIST_NAME}: '{fixture}' must map record ids to reasons")
            continue
        for rid, reason in entries.items():
            if not isinstance(reason, str) or not reason.strip():
                problems.append(f"{ALLOWLIST_NAME}: {fixture} {rid} needs a one-line reason")
        if not (fixtures_root / fixture / "expected-findings.json").exists():
            problems.append(f"{ALLOWLIST_NAME}: '{fixture}' is not a fixture; remove its entry")

    for fixture_dir in sorted(p for p in fixtures_root.iterdir() if (p / "expected-findings.json").exists()):
        cited = set(_RECORD_TOKEN.findall((fixture_dir / "expected-findings.json").read_text(encoding="utf-8")))
        attached = _attached_to_subjects(fixture_dir)
        leaking = {rid: sid for rid, sid in attached.items() if rid in cited}
        listed = allowlist.get(fixture_dir.name)
        listed = listed if isinstance(listed, dict) else {}
        for rid, sid in sorted(leaking.items()):
            if rid in listed:
                continue
            if _genre(fixture_dir) == "record-hint":
                fix = (
                    f"add it to {ALLOWLIST_NAME} with a reason if it is evidence the research starts "
                    "from, or take the finding to the lead if it answers one; never strip a record-hint fixture"
                )
            else:
                fix = f"strip it (`author.py strip --slug {fixture_dir.name} --sources {sid}`) or allow-list it with a reason"
            problems.append(
                f"{fixture_dir.name}: {rid} is cited by a finding and attached to a subject "
                f"(tree source {sid}), so it is extracted before any research; {fix}"
            )
        for rid in sorted(set(listed) - set(leaking)):
            problems.append(
                f"{ALLOWLIST_NAME}: {fixture_dir.name} {rid} is no longer both cited and attached "
                "to a subject; remove the entry"
            )
    return problems


# ── the committed corpus ────────────────────────────────────────────────────


def test_the_corpus_has_no_unlisted_attached_evidence():
    path = DEFAULT_FIXTURES_ROOT / ALLOWLIST_NAME
    allowlist = _read(path) if path.exists() else {}
    assert attached_evidence_findings(DEFAULT_FIXTURES_ROOT, allowlist) == []


# ── the check, both ways, on synthetic fixtures ─────────────────────────────


def _url(rid: str) -> str:
    return f"https://familysearch.org/ark:/61903/1:1:{rid}"


def _fixture(root: Path, name: str, *, cites: list[str], subject: dict, others: list[dict] = (),
             relationships: list[dict] = (), sources: dict[str, str], genre: str = "record-hint") -> None:
    d = root / name
    d.mkdir()
    findings = {"findings": [{"id": "f1", "supporting_sources": [f"ark:/61903/1:1:{c} — a record" for c in cites]}]}
    tree = {
        "persons": [subject, *others],
        "relationships": list(relationships),
        "sources": [{"id": sid, "title": "t", "url": url} for sid, url in sources.items()],
    }
    research = {"project": {"subject_person_ids": [subject["id"]]}}
    (d / "expected-findings.json").write_text(json.dumps(findings), encoding="utf-8")
    (d / "starting-tree.gedcomx.json").write_text(json.dumps(tree), encoding="utf-8")
    (d / "starting-research.json").write_text(json.dumps(research), encoding="utf-8")
    (d / "fixture.json").write_text(json.dumps({"genre": genre}), encoding="utf-8")


def _person(pid: str, refs: list[str] = (), names: list[str] = (), facts: list[str] = ()) -> dict:
    return {
        "id": pid,
        "sources": [{"ref": r} for r in refs],
        "names": [{"given": "A", "sources": [{"ref": r}]} for r in names],
        "facts": [{"type": "Birth", "sources": [{"ref": r}]} for r in facts],
    }


@pytest.mark.parametrize(
    "subject",
    [_person("P1", refs=["S1"]), _person("P1", names=["S1"]), _person("P1", facts=["S1"])],
    ids=["person-level", "name-level", "fact-level"],
)
def test_a_cited_record_attached_to_the_subject_fails_naming_fixture_and_id(tmp_path, subject):
    _fixture(tmp_path, "fx", cites=["ABCD-123"], subject=subject, sources={"S1": _url("ABCD-123")})
    problems = attached_evidence_findings(tmp_path, {})
    assert len(problems) == 1
    assert problems[0].startswith("fx: ABCD-123 is cited") and "tree source S1" in problems[0]
    assert "never strip a record-hint fixture" in problems[0]


def test_a_strip_fixture_is_told_to_strip(tmp_path):
    _fixture(tmp_path, "fx", cites=["ABCD-123"], subject=_person("P1", refs=["S1"]),
             sources={"S1": _url("ABCD-123")}, genre="strip")
    assert "author.py strip --slug fx --sources S1" in attached_evidence_findings(tmp_path, {})[0]


def test_an_allow_listed_record_passes(tmp_path):
    _fixture(tmp_path, "fx", cites=["ABCD-123"], subject=_person("P1", refs=["S1"]), sources={"S1": _url("ABCD-123")})
    assert attached_evidence_findings(tmp_path, {"fx": {"ABCD-123": "the subject's own baptism"}}) == []


@pytest.mark.parametrize(
    "kwargs",
    [
        {"subject": _person("P1"), "others": [_person("P2", refs=["S1"])]},
        {"subject": _person("P1"), "relationships": [{"id": "R1", "person1": "P1", "person2": "P2", "sources": [{"ref": "S1"}]}]},
        {"subject": _person("P1", refs=["S1"]), "url": _url("ABCD-1234")},
        {"subject": _person("P1", refs=["S1"]), "cites_bare": True},
    ],
    ids=["relative-only", "relationship-level", "longer-token", "bare-id-out-of-scope"],
)
def test_what_is_not_a_leak_passes(tmp_path, kwargs):
    url = kwargs.pop("url", _url("ABCD-123"))
    if kwargs.pop("cites_bare", False):
        d = tmp_path / "fx"
        _fixture(tmp_path, "fx", cites=[], subject=kwargs["subject"], sources={"S1": url})
        (d / "expected-findings.json").write_text(
            json.dumps({"findings": [{"id": "f1", "supporting_sources": ["death registration ABCD-123"]}]}),
            encoding="utf-8",
        )
    else:
        _fixture(tmp_path, "fx", cites=["ABCD-123"], sources={"S1": url}, **kwargs)
    assert attached_evidence_findings(tmp_path, {}) == []


def test_a_stale_entry_fails(tmp_path):
    _fixture(tmp_path, "fx", cites=[], subject=_person("P1", refs=["S1"]), sources={"S1": _url("ABCD-123")})
    problems = attached_evidence_findings(tmp_path, {"fx": {"ABCD-123": "was starting evidence"}})
    assert problems == [f"{ALLOWLIST_NAME}: fx ABCD-123 is no longer both cited and attached to a subject; remove the entry"]


def test_an_entry_for_a_missing_fixture_fails(tmp_path):
    assert attached_evidence_findings(tmp_path, {"gone": {"ABCD-123": "a reason"}}) == [
        f"{ALLOWLIST_NAME}: 'gone' is not a fixture; remove its entry"
    ]


@pytest.mark.parametrize(
    "allowlist, needle",
    [
        ({"fx": {"ABCD-123": ""}}, "needs a one-line reason"),
        ({"fx": {"ABCD-123": None}}, "needs a one-line reason"),
        ({"fx": ["ABCD-123"]}, "must map record ids to reasons"),
        (["fx"], "must be an object"),
    ],
    ids=["empty-reason", "null-reason", "list-not-object", "top-level-list"],
)
def test_a_malformed_allowlist_fails(tmp_path, allowlist, needle):
    _fixture(tmp_path, "fx", cites=["ABCD-123"], subject=_person("P1", refs=["S1"]), sources={"S1": _url("ABCD-123")})
    assert any(needle in p for p in attached_evidence_findings(tmp_path, allowlist))
