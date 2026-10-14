"""The replay fetch hook (`e2e/replay_fetch.mjs`), run in a `node` subprocess
with no network (PLAN-T1.4c §1.6).

What a broken hook costs: a key that moves between two identical requests makes
every recorded call a miss (the replay reads "stale" and measures nothing); a
key that does NOT move when the response format changes serves the wrong body
and reads as a clean +0; and a record-mode hook that writes a body the privacy
filter did not return puts living people's data in a public repo. Each of those
is pinned here in the direction that matters.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from e2e import replay_privacy as privacy
from e2e import replay_sizes as rs

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")

HOOK = rs.HOOK.as_uri()
MATCH = "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples"
PERSONAS = "https://www.familysearch.org/service/search/hr/v2/personas"


def node(script: str, tmp_path: Path) -> dict:
    """Run an ES module that prints one JSON object; return it."""
    f = tmp_path / "drive.mjs"
    f.write_text(script, encoding="utf-8")
    done = subprocess.run(["node", str(f)], capture_output=True, text=True, encoding="utf-8", timeout=60)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def keys(tmp_path: Path, requests: list[dict], wiki: str = "") -> list[str]:
    """`canonicalKey` for each `{method, url, accept, body}`."""
    return node(
        f"import {{ canonicalKey }} from {json.dumps(HOOK)};\n"
        f"const reqs = {json.dumps(requests)};\n"
        f"console.log(JSON.stringify({{ keys: reqs.map(r => canonicalKey(r.method, r.url, r.accept ?? '', "
        f"r.body ?? '', {json.dumps(wiki)}).key) }}));\n",
        tmp_path,
    )["keys"]


# --- keying -------------------------------------------------------------------


def test_reordered_query_params_key_the_same_and_a_changed_value_does_not(tmp_path):
    a, b, c = keys(tmp_path, [
        {"method": "GET", "url": f"{PERSONAS}?q.surname=Spriggs&count=20&offset=0"},
        {"method": "GET", "url": f"{PERSONAS}?offset=0&q.surname=Spriggs&count=20"},
        {"method": "GET", "url": f"{PERSONAS}?offset=0&q.surname=Spriggs&count=50"},
    ])
    assert a == b
    assert a != c


def test_accept_is_in_the_key_and_a_method_change_is_too(tmp_path):
    a, b, c = keys(tmp_path, [
        {"method": "GET", "url": PERSONAS, "accept": "application/json"},
        {"method": "GET", "url": PERSONAS, "accept": "application/x-gedcomx-atom+json"},
        {"method": "PUT", "url": PERSONAS, "accept": "application/json"},
    ])
    assert len({a, b, c}) == 3


def test_the_wiki_base_becomes_WIKI_whatever_its_path(tmp_path):
    """S1: recorded under a base WITH a path, replayed under one without."""
    recorded = keys(tmp_path, [{"method": "GET", "url": "https://malachi.example.ts.net/wiki/page/Benson_County"}],
                    wiki="https://malachi.example.ts.net/wiki/")
    replayed = keys(tmp_path, [{"method": "GET", "url": "http://wiki.replay.invalid/page/Benson_County"}],
                    wiki="http://wiki.replay.invalid")
    assert recorded == replayed
    assert recorded[0].startswith("GET {WIKI}/page/Benson_County ")
    # A URL on the wiki host but outside the base path is NOT the wiki.
    other = keys(tmp_path, [{"method": "GET", "url": "https://malachi.example.ts.net/other/page/X"}],
                 wiki="https://malachi.example.ts.net/wiki")
    assert "{WIKI}" not in other[0]


def _match_body(focus_ark: str, other_ark: str, given: str = "Reuben") -> str:
    def doc(ark, name):
        return {"persons": [{"id": "I1", "identifiers": {"http://gedcomx.org/Persistent": [ark]},
                             "names": [{"nameForms": [{"fullText": name}]}]}]}
    return json.dumps({"entries": [{"content": {"gedcomx": doc(focus_ark, given)}},
                                   {"content": {"gedcomx": doc(other_ark, "Spriggs")}}]})


def test_minted_persistent_ids_in_a_match_body_do_not_move_the_key(tmp_path):
    """B1: `randomFsId` mints a fresh ark per call; the key masks every one."""
    a, b, c = keys(tmp_path, [
        {"method": "POST", "url": MATCH, "accept": "application/json",
         "body": _match_body("ark:/61903/1:1:BCDF-GHJ", "ark:/61903/1:1:KLMN-PQR")},
        {"method": "POST", "url": MATCH, "accept": "application/json",
         "body": _match_body("ark:/61903/1:1:ZZ99-XYZ", "ark:/61903/1:1:T7T7-T7T")},
        {"method": "POST", "url": MATCH, "accept": "application/json",
         "body": _match_body("ark:/61903/1:1:BCDF-GHJ", "ark:/61903/1:1:KLMN-PQR", given="Rubin")},
    ])
    assert a == b  # only the minted ids differ
    assert a != c  # the document content still keys it


def test_persistent_ids_are_masked_only_on_the_match_endpoint(tmp_path):
    attachments = "https://www.familysearch.org/service/tree/links/sources/attachments"
    a, b = keys(tmp_path, [
        {"method": "POST", "url": attachments, "body": _match_body("ark:/61903/1:1:BCDF-GHJ", "x")},
        {"method": "POST", "url": attachments, "body": _match_body("ark:/61903/1:1:ZZ99-XYZ", "x")},
    ])
    assert a != b


# --- replay mode --------------------------------------------------------------


def _cassette(tmp_path: Path, lines: list[dict]) -> Path:
    d = tmp_path / "cas"
    (d / "cassettes").mkdir(parents=True)
    (d / "cassettes" / "wiki.jsonl").write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")
    return d


def test_replay_serves_a_hit_misses_once_per_key_and_never_calls_the_network(tmp_path):
    k = keys(tmp_path, [{"method": "GET", "url": "http://w.invalid/page/A"}], wiki="http://w.invalid")[0]
    cas = _cassette(tmp_path, [{"key": k, "status": 200, "content_type": "application/json",
                                "body": '{"content":"page A"}'}])
    log = tmp_path / "hook.jsonl"
    out = node(
        "globalThis.fetch = () => { throw new Error('ORIGINAL FETCH CALLED'); };\n"
        f"const {{ install }} = await import({json.dumps(HOOK)});\n"
        f"await install({json.dumps({'mode': 'replay', 'log': str(log), 'wikiBase': 'http://w.invalid', 'cassettes': [str(cas)]})});\n"
        "const r = await fetch('http://w.invalid/page/A', { headers: { 'User-Agent': 'changed/9.9' } });\n"
        "const hit = { status: r.status, body: await r.text(), ct: r.headers.get('content-type') };\n"
        "const misses = [];\n"
        "for (let i = 0; i < 3; i++) { try { await fetch('http://w.invalid/page/B'); } catch (e) { misses.push(e.message); } }\n"
        "console.log(JSON.stringify({ hit, misses }));\n",
        tmp_path,
    )
    # A User-Agent change does not move the key.
    assert out["hit"] == {"status": 200, "body": '{"content":"page A"}', "ct": "application/json"}
    assert len(out["misses"]) == 3 and all(m.startswith("replay: cassette miss GET {WIKI}/page/B") for m in out["misses"])
    lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()]
    # The engine retries a thrown request; the harness counts the key once.
    assert rs.miss_keys(lines) == {k.replace("/page/A", "/page/B")}
    assert [x["event"] for x in lines] == ["hit", "miss", "miss", "miss"]


def test_the_first_cassette_dir_wins(tmp_path):
    """SF1/S6 overlay order: a scratch dir listed first overrides the committed set."""
    k = keys(tmp_path, [{"method": "GET", "url": "http://w.invalid/page/A"}], wiki="http://w.invalid")[0]
    committed = tmp_path / "committed"
    scratch = tmp_path / "scratch"
    for d, body in ((committed, "committed"), (scratch, "scratch")):
        (d / "cassettes").mkdir(parents=True)
        (d / "cassettes" / "wiki.jsonl").write_text(
            json.dumps({"key": k, "status": 200, "content_type": "text/plain", "body": body}) + "\n", encoding="utf-8")

    def serve(order):
        return node(
            f"const {{ install }} = await import({json.dumps(HOOK)});\n"
            f"await install({json.dumps({'mode': 'replay', 'log': str(tmp_path / 'l.jsonl'), 'wikiBase': 'http://w.invalid', 'cassettes': [str(x) for x in order]})});\n"
            "console.log(JSON.stringify({ body: await (await fetch('http://w.invalid/page/A')).text() }));\n",
            tmp_path,
        )["body"]

    assert serve([scratch, committed]) == "scratch"
    assert serve([committed, scratch]) == "committed"  # the order is load-bearing


# --- record mode: the privacy filter runs before the engine sees the body ------


def _upstream(tmp_path: Path, body: dict, status: int = 200) -> Path:
    f = tmp_path / "upstream.mjs"
    f.write_text(
        "export default async function (input, init) {\n"
        f"  return new Response({json.dumps(json.dumps(body))}, {{ status: {status}, "
        "headers: { 'content-type': 'application/json' } });\n}\n",
        encoding="utf-8",
    )
    return f


def _entry(eid: str, year: str, hint: str | None = None) -> dict:
    e = {"id": eid, "content": {"gedcomx": {"persons": [
        {"id": "p_1", "facts": [{"type": "http://gedcomx.org/Birth", "date": {"original": year}}]}]}}}
    if hint:
        e["hints"] = [{"id": hint, "stars": 5}]
    return e


def _record(tmp_path: Path, upstream: Path, script: Path = Path(privacy.__file__)) -> tuple[dict, list[dict]]:
    allowed = tmp_path / "allowed.json"
    allowed.write_text(json.dumps(["L64C-QQX"]), encoding="utf-8")
    log = tmp_path / "rec.jsonl"
    cfg = {"mode": "record", "log": str(log), "wikiBase": "http://w.invalid", "python": sys.executable,
           "privacyScript": str(script), "floor": 1926, "allowedIds": str(allowed), "upstream": str(upstream)}
    out = node(
        f"const {{ install }} = await import({json.dumps(HOOK)});\n"
        f"await install({json.dumps(cfg)});\n"
        "try {\n"
        f"  const r = await fetch({json.dumps(PERSONAS + '?q.surname=Spriggs')}, {{ headers: {{ Accept: 'application/json', Authorization: 'Bearer s3cret.tok' }} }});\n"
        "  console.log(JSON.stringify({ seen: JSON.parse(await r.text()) }));\n"
        "} catch (e) { console.log(JSON.stringify({ error: e.message })); }\n",
        tmp_path,
    )
    lines = [json.loads(x) for x in log.read_text(encoding="utf-8").splitlines()] if log.exists() else []
    return out, lines


def test_record_mode_hands_the_engine_the_filtered_body_and_writes_only_that(tmp_path):
    body = {"results": 3, "entries": [
        _entry("OLD1-AAA", "12 March 1880", hint="ark:/61903/4:1:KWQ7-BCD"),
        _entry("NEW1-AAA", "+1940"),
        _entry("SUBJ-AAA", "1898", hint="ark:/61903/4:1:L64C-QQX"),
    ]}
    out, lines = _record(tmp_path, _upstream(tmp_path, body))
    seen = out["seen"]
    # The engine never saw the 1940 entry, nor the uncommitted tree id.
    assert [e["id"] for e in seen["entries"]] == ["OLD1-AAA", "SUBJ-AAA"]
    assert seen["entries"][0]["hints"][0]["id"] == "ark:/61903/4:1:ZZZZ-ZZZ"
    assert seen["entries"][1]["hints"][0]["id"] == "ark:/61903/4:1:L64C-QQX"  # committed: kept
    [ex] = lines
    assert ex["event"] == "exchange" and ex["group"] == "fs-search"
    assert json.loads(ex["body"]) == seen  # what was written is exactly what the engine got
    assert ex["rewrites"] == {"year_floor_dropped": 1, "tree_id": 1}
    raw = json.dumps(lines)
    assert "s3cret" not in raw and "Authorization" not in raw  # no request header is ever written


def test_a_failing_filter_writes_no_line_and_throws(tmp_path):
    """SF3, hook half: the filter exits 1 -> no exchange line, an abort line,
    and the request throws (the recorder aborts on that line)."""
    broken = tmp_path / "broken_filter.py"
    broken.write_text("import sys\nsys.exit(1)\n", encoding="utf-8")
    out, lines = _record(tmp_path, _upstream(tmp_path, {"entries": [_entry("X", "1880")]}), script=broken)
    assert "privacy filter failed" in out["error"]
    assert [x["event"] for x in lines] == ["abort"]
    assert not any("body" in x for x in lines)


@pytest.mark.parametrize("bad", ["not json at all", '{"action": "store"}'])
def test_unparseable_filter_output_also_aborts(tmp_path, bad):
    broken = tmp_path / "liar_filter.py"
    broken.write_text(f"import sys\nsys.stdout.write({bad!r})\n", encoding="utf-8")
    out, lines = _record(tmp_path, _upstream(tmp_path, {"entries": []}), script=broken)
    assert "privacy filter" in out["error"]
    assert [x["event"] for x in lines] == ["abort"]
