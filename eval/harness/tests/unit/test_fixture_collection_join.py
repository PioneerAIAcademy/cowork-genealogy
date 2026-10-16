"""Cross-tool join guard: one collection id carries one set of attributes everywhere.

Issue #2484. Two mock fixtures can serve the same FamilySearch collection id under
two different titles or counts, and every other suite stays green because nothing
joins fixture to fixture. The contradiction then reaches the model and the judge as
fact, and whichever side the skill repeats is graded as the skill's defect.

This module joins collection ids across EVERY tool that names a collection
(collections_search results, record_search hits, record_read sources, fulltext_search
hits) and asserts each id's title and counts agree wherever it appears. The join is
keyed on the collection id, never on the fixture filename or the tool, so a conflict
that spans tools (e.g. a collections_search title vs a record_read sources[] title)
is caught.

Record ids are deliberately out of scope for this first guard (issue #2484,
"Record ids are not in scope"): a record persona's entity key is (recordId, personId),
not recordId alone, so a recordId-keyed join reports correct multi-party data as a
conflict. Collection ids have no such second key.

The discriminator that avoids the one false positive this join invites: a collection
title is read only from a position that denotes the COLLECTION, never a hit's own
`title`. In fulltext_search fixtures each hit carries BOTH a consistent `collectionTitle`
and a per-record `title` (the deed/will/baptism being quoted); reading the bare `title`
would report one collection id as holding three different "titles" when all three are
correct record data. See test_accept_fulltext_record_titles_are_not_collection_titles.
"""

import json
from collections import defaultdict
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[4]
FIXTURE_DIR = REPO_ROOT / "eval/fixtures/mcp"

COUNT_FIELDS = ("personCount", "recordCount", "imageCount")

# The minimum number of collection ids the real corpus must present in more than one
# fixture. A mistyped glob or a broken extractor collects nothing and would pass the
# "no conflicts" assertion vacuously; this floor makes that failure loud. Measured on
# main 2026-10-06: ~20 multi-fixture collection ids. Deliberately well below that.
MIN_MULTI_FIXTURE_IDS = 10


def _walk_dicts(node):
    """Yield every dict nested anywhere inside node (including node itself)."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk_dicts(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk_dicts(item)


def _id_from_collection_url(url):
    """Return the collection id embedded in a .../collections/<id> url, or None."""
    if not isinstance(url, str) or "/collections/" not in url:
        return None
    tail = url.rstrip("/").split("/collections/")[-1]
    return tail.split("/")[0].split("?")[0] or None


def _collection_claim(obj):
    """What collection-level attributes does this one dict assert?

    Returns (collection_id, title_or_None, counts_dict). (None, None, {}) if the dict
    asserts nothing about a collection. The title is taken only from a position that
    denotes the collection itself:

      1. a count-bearing object (personCount/recordCount present) -> its `title`
         is the collection name (collections_search results[]);
      2. an explicit `collectionTitle` key -> that value (record_search and
         fulltext_search hits both carry this);
      3. a record_read sources[] collection entry, identified either by a sibling
         `ark` alongside a `collectionId`, or by a `/collections/<id>` url -> its `title`.

    A bare `title` on an object that is none of these is a RECORD title and is ignored.
    """
    counts = {f: obj.get(f) for f in COUNT_FIELDS}
    has_counts = any(obj.get(f) is not None for f in ("personCount", "recordCount"))

    # 1. count-bearing collection object (collections_search results[])
    if has_counts:
        return (obj.get("id") or obj.get("collectionId"), obj.get("title"), counts)

    # 2. explicit collectionTitle key (record_search + fulltext_search hits)
    if obj.get("collectionTitle") is not None:
        return (obj.get("collectionId") or obj.get("id"), obj.get("collectionTitle"), counts)

    # 3a. record_read collection source: collectionId with a sibling ark
    if obj.get("collectionId") is not None and obj.get("ark") is not None:
        return (obj.get("collectionId"), obj.get("title"), counts)

    # 3b. record_read collection source: a /collections/<id> url, no collectionId key
    cid = _id_from_collection_url(obj.get("url"))
    if cid is not None:
        return (cid, obj.get("title"), counts)

    return (None, None, {})


def _iter_observations(data):
    """Yield (collection_id:str, field:str, value) for one fixture's response."""
    for obj in _walk_dicts(data.get("response", {})):
        cid, title, counts = _collection_claim(obj)
        if cid is None:
            continue
        cid = str(cid)
        if title is not None:
            yield (cid, "title", title)
        for field, value in counts.items():
            if value is not None:
                yield (cid, field, value)


def collect_observations(fixture_dir):
    """Scan every *.json fixture. Return id -> field -> {value: sorted[filenames]}.

    Values are keyed by their raw Python value, so the int 0 and the string "0" are
    distinct keys and a type-laundered count still reads as a conflict (never coerced
    to agreement).
    """
    table = defaultdict(lambda: defaultdict(lambda: defaultdict(set)))
    for path in sorted(fixture_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for cid, field, value in _iter_observations(data):
            table[cid][field][value].add(path.name)
    return table


def find_conflicts(fixture_dir):
    """Return a sorted list of conflict dicts: {id, field, values:{value:[files]}}.

    A conflict is one collection id for which a single field (title or a count) carries
    more than one distinct value anywhere in the corpus.
    """
    table = collect_observations(fixture_dir)
    conflicts = []
    for cid in sorted(table):
        for field in sorted(table[cid]):
            values = table[cid][field]
            if len(values) > 1:
                conflicts.append(
                    {
                        "id": cid,
                        "field": field,
                        "values": {v: sorted(files) for v, files in values.items()},
                    }
                )
    return conflicts


def multi_fixture_id_count(fixture_dir):
    """How many collection ids appear in more than one distinct fixture file."""
    table = collect_observations(fixture_dir)
    count = 0
    for cid, fields in table.items():
        files = set()
        for value_files in fields.values():
            for fs in value_files.values():
                files |= fs
        if len(files) > 1:
            count += 1
    return count


def _format(conflicts):
    lines = ["Collection ids served with conflicting attributes across fixtures:"]
    for c in conflicts:
        lines.append(f"  {c['id']} .{c['field']}:")
        for value, files in c["values"].items():
            lines.append(f"      {value!r}  <- {', '.join(files)}")
    return "\n".join(lines)


# --- The guard over the real corpus ---------------------------------------


def test_join_examines_more_than_one_collection_id():
    """Guard against a mistyped glob / broken extractor that collects nothing."""
    n = multi_fixture_id_count(FIXTURE_DIR)
    assert n >= MIN_MULTI_FIXTURE_IDS, (
        f"join examined only {n} multi-fixture collection ids (expected >= "
        f"{MIN_MULTI_FIXTURE_IDS}); the fixture glob or the extractor is broken, so a "
        "clean result would prove nothing"
    )


def test_no_collection_attribute_conflicts_across_corpus():
    """Every collection id carries one set of attributes everywhere it appears."""
    conflicts = find_conflicts(FIXTURE_DIR)
    assert not conflicts, _format(conflicts)


def test_known_fulltext_ids_are_not_false_positives():
    """The three fulltext ids whose per-record `title` varies must never conflict."""
    conflicts = {c["id"] for c in find_conflicts(FIXTURE_DIR)}
    for cid in ("2220359", "2334571", "1784529"):
        assert cid not in conflicts, (
            f"{cid} flagged as a conflict; its varying fulltext `title` is a record "
            "title, not the collection title (collectionTitle is consistent)"
        )


# --- Acceptance checks: both directions, on synthetic inputs ---------------
# These run the real collector over a throwaway fixture dir, so they are green
# regardless of the live corpus state and pin the join's behaviour precisely.


def _write(d, name, tool, response):
    (d / name).write_text(
        json.dumps({"tool": tool, "description": name, "args": {"x": 1}, "response": response}),
        encoding="utf-8",
    )


def _cs(results):
    return {"results": results}


def _col(cid, title, pc=None, rc=None, ic=None):
    o = {"id": cid, "title": title, "url": f"https://x/collections/{cid}"}
    if pc is not None:
        o["personCount"] = pc
    if rc is not None:
        o["recordCount"] = rc
    if ic is not None:
        o["imageCount"] = ic
    return o


# break it several ways -----------------------------------------------------


def test_break_a_third_personcount_is_named(tmp_path):
    _write(tmp_path, "a.json", "collections_search", _cs([_col("111", "Coll", pc=100)]))
    _write(tmp_path, "b.json", "collections_search", _cs([_col("111", "Coll", pc=100)]))
    _write(tmp_path, "c.json", "collections_search", _cs([_col("111", "Coll", pc=999)]))
    conflicts = find_conflicts(tmp_path)
    assert [(c["id"], c["field"]) for c in conflicts] == [("111", "personCount")]
    assert set(conflicts[0]["values"][999]) == {"c.json"}
    assert set(conflicts[0]["values"][100]) == {"a.json", "b.json"}


def test_break_b_title_only_conflict_fires_when_counts_agree(tmp_path):
    # A counts-only check would pass this; a title-only disagreement must still fire.
    _write(tmp_path, "a.json", "collections_search", _cs([_col("222", "Name One", pc=5)]))
    _write(tmp_path, "b.json", "collections_search", _cs([_col("222", "Name Two", pc=5)]))
    fields = {(c["id"], c["field"]) for c in find_conflicts(tmp_path)}
    assert fields == {("222", "title")}


def test_break_c_string_zero_not_coerced_to_int_zero(tmp_path):
    _write(tmp_path, "a.json", "collections_search", _cs([_col("333", "Coll", pc=0)]))
    _write(tmp_path, "b.json", "collections_search", _cs([_col("333", "Coll", pc="0")]))
    conflicts = find_conflicts(tmp_path)
    assert [(c["id"], c["field"]) for c in conflicts] == [("333", "personCount")]
    # both the int and the string value are present as distinct, un-coerced keys
    assert 0 in conflicts[0]["values"] and "0" in conflicts[0]["values"]


def test_break_d_title_conflict_fires_across_tools_not_keyed_on_filename(tmp_path):
    # A collections_search title vs a record_read sources[] title for one id: the join
    # must span tools, not compare within a filename prefix.
    _write(tmp_path, "cs.json", "collections_search", _cs([_col("444", "Church Books 1797-1958", pc=1)]))
    _write(
        tmp_path,
        "rr.json",
        "record_read",
        {"sources": [{"id": "s1", "ark": "ark:/61903/1:1:ZZ", "collectionId": "444",
                      "title": "Church Books 1815-1930"}]},
    )
    fields = {(c["id"], c["field"]) for c in find_conflicts(tmp_path)}
    assert fields == {("444", "title")}


# legitimate variants it must still accept ----------------------------------


def test_accept_identical_across_three_fixtures(tmp_path):
    for n in ("a.json", "b.json", "c.json"):
        _write(tmp_path, n, "collections_search", _cs([_col("555", "Same", pc=10, rc=10, ic=3)]))
    assert find_conflicts(tmp_path) == []
    assert multi_fixture_id_count(tmp_path) == 1


def test_accept_reordered_results_array(tmp_path):
    _write(tmp_path, "a.json", "collections_search",
           _cs([_col("1", "A", pc=1), _col("2", "B", pc=2)]))
    _write(tmp_path, "b.json", "collections_search",
           _cs([_col("2", "B", pc=2), _col("1", "A", pc=1)]))
    assert find_conflicts(tmp_path) == []


def test_accept_id_in_exactly_one_fixture(tmp_path):
    _write(tmp_path, "a.json", "collections_search", _cs([_col("777", "Solo", pc=1)]))
    assert find_conflicts(tmp_path) == []


def test_accept_omitted_optional_field_is_absent_not_zero(tmp_path):
    # imageCount present in one fixture, omitted in another -> absent, never a 0-conflict.
    _write(tmp_path, "a.json", "collections_search", _cs([_col("888", "Coll", pc=5, ic=42)]))
    _write(tmp_path, "b.json", "collections_search", _cs([_col("888", "Coll", pc=5)]))
    assert find_conflicts(tmp_path) == []


def test_accept_fulltext_record_titles_are_not_collection_titles(tmp_path):
    # A fulltext id whose per-record `title` varies but whose collectionTitle is
    # consistent must NOT conflict. This is the specific false positive the join invites.
    hits = [
        {"collectionId": "999", "collectionTitle": "Pennsylvania Land Records",
         "title": "Deed — Sheridan to Flynn"},
        {"collectionId": "999", "collectionTitle": "Pennsylvania Land Records",
         "title": "Deed — Brennan to Dougherty"},
    ]
    _write(tmp_path, "ft1.json", "fulltext_search", {"results": hits})
    assert find_conflicts(tmp_path) == []
    # and a fulltext collectionTitle that genuinely disagrees DOES fire
    _write(tmp_path, "ft2.json", "fulltext_search",
           {"results": [{"collectionId": "999", "collectionTitle": "Something Else",
                         "title": "Deed — x"}]})
    assert {(c["id"], c["field"]) for c in find_conflicts(tmp_path)} == {("999", "title")}


def test_accept_record_read_persona_sources_are_ignored(tmp_path):
    # A record_read persona source (ark, no collectionId, ark:/ url) is not a collection
    # and must contribute no observation.
    _write(
        tmp_path,
        "rr.json",
        "record_read",
        {"sources": [
            {"id": "sd_c", "collectionId": "1234", "ark": "ark:/61903/1:1:AA", "title": "The Collection"},
            {"id": "sd_p", "ark": "ark:/61903/1:1:BB", "title": "Entry for Jane Doe",
             "url": "https://x/ark:/61903/1:1:BB"},
        ]},
    )
    obs = collect_observations(tmp_path)
    assert set(obs) == {"1234"}
    assert obs["1234"]["title"] == {"The Collection": {"rr.json"}}
