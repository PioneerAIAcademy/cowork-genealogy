"""The replay-cassette privacy lint (`e2e/replay_privacy.py`) — the rules are in eval/fixtures/replay/README.md.

Cassettes under `eval/fixtures/replay/` hold upstream FamilySearch answers in a
public repo. Dallan's 2026-10-06 ruling allowed that only on the premise that
no living person's data is committed; these four rules are what hold it, and a
rule that cannot fail would let a living person's census entry, a tree id or an
account id through with CI green.

So every rule is proven both ways on a temp copy of a clean planted set: each
planted break must EMIT its file and rule (not merely make the count non-zero),
and each legitimate variant — a collection title with a modern year, a
citation's access date, the subject's own committed id, a record-persona ARK —
must stay clean, or the lint gets switched off within a month.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from e2e import replay_privacy as privacy
from e2e import replay_sizes as rs

FLOOR = 1926
SUBJECT = "L64C-QQX"
STARTER = "KD96-TV2"
PERSONAS = "https://www.familysearch.org/service/search/hr/v2/personas"
FULLTEXT = "https://www.familysearch.org/service/search/fulltext/search"
RMS = "https://sg30p0.familysearch.org/service/records/rms/group-service/group/search"
RECORD = "https://sg30p0.familysearch.org/service/cds/recapi/records/persona/X5CB-RLK.json"
MATCH = "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples"
ATTACH = "https://www.familysearch.org/service/tree/links/sources/attachments"
PLACE = "https://api.familysearch.org/platform/places/12345"
EMPTY_SHA = hashlib.sha256(b"").hexdigest()


# --- a clean planted set -------------------------------------------------------


def persona(eid: str, *facts: dict, hints: list[str] | None = None, title: str = "Church Books, 1815-2010") -> dict:
    return {
        "id": eid,
        "hints": [{"id": h, "stars": 4} for h in hints or []],
        "content": {"gedcomx": {
            "persons": [{"id": "p_1", "facts": list(facts),
                         "identifiers": {"http://gedcomx.org/Persistent": [f"https://familysearch.org/ark:/61903/1:1:{eid}"]}}],
            "sourceDescriptions": [
                {"titles": [{"value": title}]},
                {"citations": [{"value": "\"Church Books,\" FamilySearch, accessed 20 February 2020"}]},
            ],
        }},
    }


def fact(original: str | None = None, formal: str | None = None) -> dict:
    date = {k: v for k, v in (("original", original), ("formal", formal)) if v}
    return {"type": "http://gedcomx.org/Birth", "date": date}


def fulltext(record_date: str | None = "1880", text: str = "Baptism of Anna, 1880.", dates: list[str] | None = None) -> dict:
    content = {"textDocument": text, "entities": [{"type": "DATE", "value": d} for d in dates or []]}
    if record_date:
        content["recordDate"] = record_date
    return {"id": "ft1", "collectionTitle": "Church Books, 1815-2010", "content": content}


class Planted:
    """A clean cassette set in tmp: `check()` returns [] until a test breaks it."""

    def __init__(self, tmp: Path):
        self.repo = tmp / "repo"
        self.tests_root = self.repo / "eval" / "tests" / "e2e"
        self.replay = self.repo / "eval" / "fixtures" / "replay"
        self.lines: dict[str, list[dict]] = {}
        self.calls: dict[str, dict] = {}
        self.runs = []
        for slug, stamp in (("fx", "00-00-00"), ("fy", "01-00-00")):
            run = self.repo / "eval" / "runlogs" / "e2e" / slug / f"run-2026-10-14_{stamp}.json"
            run.parent.mkdir(parents=True, exist_ok=True)
            run.write_text("{}", encoding="utf-8")
            run.with_name(f"{run.stem}.final-tree.gedcomx.json").write_text(
                json.dumps({"persons": [{"id": SUBJECT}]}), encoding="utf-8")
            (self.tests_root / slug).mkdir(parents=True, exist_ok=True)
            (self.tests_root / slug / "starting-tree.gedcomx.json").write_text(
                json.dumps({"persons": [{"id": STARTER, "ark": f"ark:/61903/4:1:{STARTER}"}]}), encoding="utf-8")
            self.runs.append(run.relative_to(self.repo).as_posix())
        self.floor = FLOOR
        self.allowed_sha = privacy.allowed_ids_sha256([STARTER, SUBJECT])
        # Legitimate variants, all present in the clean set:
        self.put("wiki", "GET", "{WIKI}/page/Benson_County", {"title": "Benson", "content": "Church Books, 1815-2010"})
        self.put("wiki", "GET", "{WIKI}/page/North%20Dakota", {"content": "a slug with %20"})
        self.put("wiki", "POST", "{WIKI}/search", {"results": [{"chunk_text": "1950 census guidance"}]},
                 body_sha="1" * 64)
        self.put("fs-search", "GET", f"{PERSONAS}?count=20&offset=0&q.surname=Spriggs", {"entries": [
            persona("X5CB-RLK", fact("1925")),
            persona("M316-6G8", fact("December 1868"), hints=[f"ark:/61903/4:1:{SUBJECT}", "ark:/61903/4:1:ZZZZ-ZZZ"]),
        ]})
        self.put("fs-search", "GET", f"{FULLTEXT}?q.text=Anna", {"entries": [fulltext()]})
        self.put("fs-search", "PUT", RMS, {"groups": []}, body_sha="2" * 64)
        self.put("fs-records", "GET", RECORD, {"persons": [{"id": "p", "facts": [fact("12 March 1880")]}],
                                               "sourceDescriptions": [{"titles": [{"value": "1950 index"}]}]})
        self.put("fs-match", "POST", MATCH, {"entries": [{"id": "ark:/61903/1:1:X5CB-RLK", "score": 0.9, "confidence": 4}],
                                             "title": "match for ark:/61903/1:1:X5CB-RLK", "updated": 1})
        self.put("fs-attachments", "POST", ATTACH, {"attachedSourcesMap": {
            "https://familysearch.org/ark:/61903/1:1:X5CB-RLK": [{"persons": [
                {"entityId": SUBJECT, "tags": ["Name"]}, {"entityId": "ZZZZ-ZZZ", "tags": []}]}]}},
            body_sha="3" * 64)
        # An fs-places line no call references (S7) — exempt from the orphan check.
        self.put("fs-places", "GET", PLACE, {"places": [{"id": "12345"}]}, referenced=False)
        # Two runs sharing one line.
        self.calls[self.runs[1]] = {"0": {"status": "recorded", "keys": [self.key_of("wiki", 0)]}}

    def key_of(self, group: str, n: int) -> str:
        return self.lines[group][n]["key"]

    def put(self, group, method, url, body, *, body_sha=EMPTY_SHA, accept="application/json", status=200,
            referenced=True, raw_body: str | None = None, line_extra: dict | None = None) -> dict:
        line = {"key": f"{method} {url} {accept} {body_sha}", "method": method, "url": url, "accept": accept,
                "body_sha256": body_sha, "status": status, "content_type": "application/json",
                "body": raw_body if raw_body is not None else json.dumps(body), "rewrites": {}}
        line.update(line_extra or {})
        self.lines.setdefault(group, []).append(line)
        if referenced:
            calls = self.calls.setdefault(self.runs[0], {})
            calls[str(len(calls))] = {"status": "recorded", "keys": [line["key"]]}
        return line

    def manifest(self) -> dict:
        return {"format": 1, "recorded_at": "2026-10-14T00:00:00Z", "engine_sha": "a" * 40, "version": "0.1.0",
                "privacy_year_floor": self.floor, "allowed_ids_sha256": self.allowed_sha,
                "tree_subrequests": "committed",
                "runs": {r: {"calls": self.calls.get(r, {})} for r in self.runs}}

    def write(self, manifest: dict | None = None) -> Path:
        cas = self.replay / "cassettes"
        cas.mkdir(parents=True, exist_ok=True)
        for f in cas.glob("*"):
            f.unlink()
        for group, lines in self.lines.items():
            rows = sorted(lines, key=lambda x: x["key"])
            (cas / f"{group}.jsonl").write_text("".join(json.dumps(x) + "\n" for x in rows), encoding="utf-8")
        (self.replay / "manifest.json").write_text(json.dumps(manifest or self.manifest(), indent=1), encoding="utf-8")
        return self.replay

    def check(self, **kw) -> list[tuple[str, str, str]]:
        self.write(kw.pop("manifest", None))
        return privacy.check(self.replay, self.repo, tests_root=self.tests_root, **kw)


@pytest.fixture
def planted(tmp_path) -> Planted:
    return Planted(tmp_path)


def rules(violations) -> set[tuple[str, str]]:
    """{(file name, rule)} — the emitted file and rule, not just a count."""
    return {(Path(f.split(":")[0]).name, rule) for f, rule, _ in violations}


# --- the committed set ----------------------------------------------------------


def test_the_committed_cassettes_pass_every_rule():
    """The lint over what is committed. Today that is the README alone (Q1 is
    open, so nothing is recorded into the repo); a cassette file committed
    without a manifest is itself a violation, so this cannot pass vacuously
    once cassettes land."""
    assert privacy.check(rs.REPLAY_FIXTURES, rs.REPO_ROOT) == []
    assert (rs.REPLAY_FIXTURES / "README.md").exists()


def test_the_clean_planted_set_passes(planted):
    """Every legitimate variant in one set: reordered/encoded URLs, a 1925 fact,
    a collection title and a citation with modern years, the subject's committed
    id, a record-persona ARK, two runs sharing a line, an unreferenced places line."""
    assert planted.check() == []


def test_a_cassette_file_without_a_manifest_is_refused(planted):
    planted.write()
    (planted.replay / "manifest.json").unlink()
    assert ("wiki.jsonl", "manifest") in rules(privacy.check(planted.replay, planted.repo, tests_root=planted.tests_root))


# --- rule 1: allowlist ------------------------------------------------------------


@pytest.mark.parametrize("group, method, url", [
    ("fs-search", "GET", "https://api.familysearch.org/platform/tree/persons/KWQ7-BCD"),
    ("fs-search", "GET", "https://api.familysearch.org/platform/memories/memories/1"),
    ("fs-search", "GET", "https://familysearch.org/service/search/hr/v2/personas?q.surname=X"),
    ("fs-search", "GET", RMS),
    ("fs-places", "GET", "https://www.openrouter.ai/api/v1/chat"),
])
def test_allowlist_breaks_are_named(planted, group, method, url):
    planted.put(group, method, url, {"x": 1}, body_sha="9" * 64)
    assert (f"{group}.jsonl", "allowlist") in rules(planted.check())


def test_an_allowlisted_line_filed_under_the_wrong_group_is_named(planted):
    planted.put("wiki", "GET", RECORD, {"persons": []}, body_sha="8" * 64)
    assert ("wiki.jsonl", "allowlist") in rules(planted.check())


def test_allowlist_legitimate_variants_classify():
    assert privacy.classify("GET", f"{PERSONAS}?offset=0&q.surname=Spriggs&count=20") == "fs-search"
    assert privacy.classify("GET", "{WIKI}/page/North%20Dakota") == "wiki"
    assert privacy.classify("PUT", RMS) == "fs-search"
    assert privacy.classify("GET", RMS) is None
    assert privacy.classify("GET", "{WIKI}/page/") is None  # a bare prefix is not a page
    assert privacy.classify("GET", "https://api.familysearch.org/platform/placesX/1") is None


# --- rule 2: year floor --------------------------------------------------------------


@pytest.mark.parametrize("group, url, body", [
    ("fs-search", PERSONAS + "?q.a=1", {"entries": [persona("A1B2-C3D", fact(formal="+1940"))]}),
    ("fs-search", PERSONAS + "?q.a=2", {"entries": [persona("A1B2-C3D", fact("April 1950"))]}),
    ("fs-search", FULLTEXT + "?q.a=3", {"entries": [fulltext(record_date="1962")]}),
    ("fs-search", FULLTEXT + "?q.a=4", {"entries": [fulltext(record_date=None)]}),
    ("fs-search", FULLTEXT + "?q.a=5", {"entries": [fulltext(text="Married in 1958 at the chapel.")]}),
    ("fs-search", FULLTEXT + "?q.a=6", {"entries": [fulltext(record_date="1880", dates=["3 May 1931"])]}),
    ("fs-records", RECORD.replace("X5CB-RLK", "Q1Q1-Q1Q"), {"persons": [{"facts": [fact("1880")]}, {"facts": [fact("1937")]}]}),
])
def test_year_floor_breaks_are_named(planted, group, url, body):
    planted.put(group, "GET", url, body)
    assert rules(planted.check()) == {(f"{group}.jsonl", "year-floor")}


def test_year_floor_legitimate_variants_pass(planted):
    planted.put("fs-search", "GET", PERSONAS + "?q.a=ok", {"entries": [
        persona("A1B2-C3D", fact("1925"), title="Census, 1950"),
        persona("A1B2-C3F", fact(formal="+1925-04-01")),
    ]})
    planted.put("fs-search", "GET", FULLTEXT + "?q.a=ok", {"entries": [
        fulltext(record_date="1890", text="Recorded 1890; page 4500; film 2345."),
    ]})
    assert planted.check() == []


def test_the_floor_is_the_manifest_value_not_a_constant(planted):
    planted.put("fs-search", "GET", PERSONAS + "?q.a=f", {"entries": [persona("A1B2-C3D", fact("1925"))]})
    planted.floor = 1925
    assert rules(planted.check()) == {("fs-search.jsonl", "year-floor")}


# --- rule 3: identifier rewrite ---------------------------------------------------------


@pytest.mark.parametrize("group, url, body", [
    ("fs-search", PERSONAS + "?q.i=1", {"entries": [persona("A1B2-C3D", fact("1880"), hints=["ark:/61903/4:1:KWQ7-BCD"])]}),
    ("fs-search", PERSONAS + "?q.i=2", {"entries": [persona("A1B2-C3D", fact("1880"), hints=["KWQ7-BCD"])]}),
    ("fs-records", RECORD.replace("X5CB-RLK", "Q2Q2-Q2Q"),
     {"persons": [{"facts": [fact("1880")], "links": {"person": "https://www.familysearch.org/tree/person/details/KWQ7-BCD"}}]}),
    ("fs-attachments", ATTACH + "?v=1", {"attachedSourcesMap": {"u": [{"persons": [{"entityId": "KWQ7-BCD", "tags": []}]}]}}),
    ("fs-attachments", ATTACH + "?v=2", {"attachedSourcesMap": {"u": [{"persons": [
        {"entityId": SUBJECT, "tags": [], "contributorId": "MMMM-XXX"}]}]}}),
    ("fs-attachments", ATTACH + "?v=3", {"attachedSourcesMap": {"u": [{"persons": [
        {"entityId": SUBJECT, "tags": [], "tfEntityRefId": "r", "modified": 1}]}]}}),
    ("wiki", "{WIKI}/page/Contributor", {"contributorId": "MMMM-XXX"}),
    ("fs-match", MATCH + "?v=1", {"entries": [{"id": "x", "score": 1, "person": {"name": "Living Person"}}]}),
])
def test_id_rewrite_breaks_are_named(planted, group, url, body):
    method = "POST" if group in ("fs-attachments", "fs-match") or url.endswith("/search") else "GET"
    planted.put(group, method, url, body, body_sha="7" * 64)
    assert (f"{group}.jsonl", "id-rewrite") in rules(planted.check())


def test_an_allowed_set_that_does_not_match_the_committed_trees_is_named(planted):
    """SF2: the manifest's sha256 must be the one `check` recomputes."""
    planted.allowed_sha = "0" * 64
    assert rules(planted.check()) == {("manifest.json", "id-rewrite")}


def test_a_tree_edited_after_recording_moves_the_allowed_set(planted):
    planted.write()
    tree = planted.tests_root / "fx" / "starting-tree.gedcomx.json"
    tree.write_text(json.dumps({"persons": [{"id": STARTER}, {"id": "NEW1-NEW"}]}), encoding="utf-8")
    got = privacy.check(planted.replay, planted.repo, tests_root=planted.tests_root)
    assert rules(got) == {("manifest.json", "id-rewrite")}


# --- rule 4: credentials ------------------------------------------------------------------


@pytest.mark.parametrize("raw", [
    '{"accessToken":"abcDEF123live"}',
    '{"note":"sk-or-v1-0123456789abcdef"}',
    '{"note":"Bearer abc.def"}',
    '{"Authorization":"x"}',
])
def test_credential_breaks_are_named(planted, raw):
    planted.put("wiki", "GET", "{WIKI}/page/Cred", None, raw_body=raw)
    assert rules(planted.check()) == {("wiki.jsonl", "credentials")}


def test_a_stored_request_header_is_refused(planted):
    planted.put("wiki", "GET", "{WIKI}/page/H", {"content": "x"}, line_extra={"request_headers": {"Accept": "x"}})
    assert ("wiki.jsonl", "format") in rules(planted.check())


@pytest.mark.parametrize("raw", [
    '{"content":"the replay login uses replay-not-a-real-token"}',
    '{"content":"Bearer replay-not-a-real-token"}',
])
def test_the_fake_replay_token_is_not_a_credential(planted, raw):
    planted.put("wiki", "GET", "{WIKI}/page/Fake", None, raw_body=raw)
    assert planted.check() == []


def test_a_credential_in_the_manifest_is_named(planted):
    m = planted.manifest()
    m["note"] = "sk-or-v1-0123456789abcdef"
    assert ("manifest.json", "credentials") in rules(planted.check(manifest=m))


# --- manifest integrity ---------------------------------------------------------------------


def test_an_orphan_line_is_named_but_an_orphan_places_line_is_not(planted):
    planted.put("wiki", "GET", "{WIKI}/page/Orphan", {"content": "x"}, referenced=False)
    assert rules(planted.check()) == {("wiki.jsonl", "manifest")}


def test_a_recorded_call_naming_a_missing_key_is_named(planted):
    planted.calls[planted.runs[0]]["99"] = {"status": "recorded", "keys": ["GET {WIKI}/page/Gone  " + EMPTY_SHA]}
    assert rules(planted.check()) == {("manifest.json", "manifest")}


def test_a_malformed_key_and_unsorted_lines_are_named(planted):
    planted.put("wiki", "GET", "{WIKI}/page/K", {"content": "x"}, line_extra={"key": "GET {WIKI}/page/K"})
    got = planted.check()
    assert ("wiki.jsonl", "format") in rules(got)


# --- size --------------------------------------------------------------------------------------


def _total(planted) -> int:
    planted.write()
    return sum(f.stat().st_size for f in (planted.replay / "cassettes").glob("*"))


def test_exactly_at_the_cap_passes_and_one_byte_over_fails(planted):
    total = _total(planted)
    assert planted.check(bytes_cap=total) == []
    assert rules(planted.check(bytes_cap=total - 1)) == {("cassettes", "size")}


def test_one_file_over_the_file_cap_is_named(planted):
    planted.write()
    biggest = max((planted.replay / "cassettes").glob("*"), key=lambda f: f.stat().st_size)
    got = planted.check(file_cap=biggest.stat().st_size - 1)
    assert (biggest.name, "size") in rules(got)


def test_too_many_recorded_runs_is_named(planted):
    assert rules(planted.check(max_runs=1)) == {("manifest.json", "size")}


# --- the filter: the transform side of the same rules ---------------------------------------


ALLOWED = frozenset({SUBJECT, STARTER})


def _filter(method, url, body, status=200):
    return privacy.filter_exchange(method, url, status, json.dumps(body), floor=FLOOR, allowed=ALLOWED)


def test_filter_withholds_an_unlisted_endpoint_and_a_recent_record():
    assert _filter("GET", "https://api.familysearch.org/platform/tree/persons/KWQ7-BCD", {})["reason"] == \
        "endpoint-not-allowlisted"
    got = _filter("GET", RECORD, {"persons": [{"facts": [fact("1880")]}, {"facts": [fact("1937")]}]})
    assert got == {"action": "withhold", "reason": "privacy-year-floor"}
    assert _filter("GET", RECORD, {"persons": [{"facts": [fact("1880")]}]})["action"] == "store"


def test_filter_drops_recent_and_undatable_fulltext_entries_but_keeps_old_ones():
    got = _filter("GET", FULLTEXT + "?q.text=x", {"entries": [
        fulltext(), fulltext(record_date="1962"), fulltext(record_date=None), fulltext(text="in 1958")]})
    assert len(json.loads(got["body"])["entries"]) == 1
    assert got["rewrites"] == {"year_floor_dropped": 3}


def test_filter_rebuilds_attachments_to_entity_and_tags_only():
    got = _filter("POST", ATTACH, {"attachedSourcesMap": {"u": [{"sourceId": "S1", "persons": [
        {"entityId": "KWQ7-BCD", "tags": ["Name"], "contributorId": "MMMM-XXX", "tfEntityRefId": "r", "modified": 1},
        {"entityId": SUBJECT, "tags": []}]}]}})
    assert json.loads(got["body"]) == {"attachedSourcesMap": {"u": [{"persons": [
        {"entityId": "ZZZZ-ZZZ", "tags": ["Name"]}, {"entityId": SUBJECT, "tags": []}]}]}}


def test_filter_rebuilds_match_to_scores_only():
    got = _filter("POST", MATCH, {"entries": [{"id": "ark:/61903/1:1:X5CB-RLK", "score": 0.5, "confidence": 3,
                                               "content": {"gedcomx": {"persons": [{"names": "Living"}]}}}],
                                  "title": "t", "updated": 2, "links": {"x": 1}})
    assert json.loads(got["body"]) == {"entries": [{"id": "ark:/61903/1:1:X5CB-RLK", "score": 0.5, "confidence": 3}],
                                       "title": "t", "updated": 2}


def test_filter_keeps_record_persona_arks_and_rewrites_4_4_tree_ids_to_their_own_shape():
    got = _filter("GET", RMS.replace("rms/group-service/group/search", "x"), {})  # not allowlisted
    assert got["action"] == "withhold"
    text = privacy.rewrite_text_ids(
        "ark:/61903/1:1:X5CB-RLK ark:/61903/4:1:LZ8M-ZQ1N /tree/persons/KWQ7-BCD", ALLOWED, counts := {})
    assert text == "ark:/61903/1:1:X5CB-RLK ark:/61903/4:1:ZZZZ-ZZZZ /tree/persons/ZZZZ-ZZZ"
    assert counts == {"tree_id": 2}


def test_filter_output_always_passes_check(planted):
    """The two entry points cannot drift: whatever `filter` stores, `check` accepts."""
    raw = {"entries": [
        persona("A1B2-C3D", fact("1880"), hints=["ark:/61903/4:1:KWQ7-BCD"]),
        persona("A1B2-C3F", fact("1944")),
        persona("A1B2-C3G", fact("1890"), hints=[f"ark:/61903/4:1:{SUBJECT}"]),
    ]}
    stored = _filter("GET", PERSONAS + "?q.f=1", raw)["body"]
    planted.put("fs-search", "GET", PERSONAS + "?q.f=1", None, raw_body=stored)
    assert planted.check() == []
    planted.lines["fs-search"].pop()
    planted.calls[planted.runs[0]] = {k: v for k, v in planted.calls[planted.runs[0]].items()
                                      if v["keys"][0] in {x["key"] for g in planted.lines.values() for x in g}}
    planted.put("fs-search", "GET", PERSONAS + "?q.f=1", raw)  # the unfiltered body
    assert ("fs-search.jsonl", "year-floor") in rules(planted.check())
