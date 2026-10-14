"""Tests for `make replay-sizes` (e2e/replay_sizes.py).

The harness's failure mode is not a crash — it is a reassuring 0%. A broken
rebase, a typo'd filter or a reconstruction that lost state all make both
builds answer the same way, so every guard here is pinned in the direction
that matters: it must refuse to report, not report zero. The other direction
too: drift in a tool's argument rules must NOT read as a broken harness.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import pytest

from e2e import replay_privacy as privacy
from e2e import replay_record as rr
from e2e import replay_sizes as rs

REPO = Path(__file__).resolve().parents[4]
REAL_ERROR_RUN = REPO / "eval/runlogs/e2e/cruz-corona-ancestry/run-2026-09-25_11-30-49.json"


# --- measurement -----------------------------------------------------------


def test_a_success_is_measured_as_the_json_of_the_content_list():
    """Pins the wrapper and separators the orchestrator used (near-tautological
    for a verbatim capture: the capture IS this serialization)."""
    content = [{"type": "text", "text": '{"ok":true,"count":0}'}]
    assert rs.measure(content, is_error=False) == len(json.dumps(content))
    # The escaped quotes are why a 1,010-char pad reads as +1,014.
    pad = ',"_pad":"' + "x" * 1000 + '"'
    assert rs.measure([{"type": "text", "text": "{}" + pad}], False) - rs.measure(
        [{"type": "text", "text": "{}"}], False
    ) == 1014


def test_an_error_is_measured_as_its_plain_text_on_a_real_capture():
    """The SDK hands the orchestrator a plain string on the error path; measuring
    an error as json.dumps of a wrapper inflates every error-message change."""
    call = json.loads(REAL_ERROR_RUN.read_text(encoding="utf-8"))["tool_calls"][97]
    assert call["is_error"] is True
    content = [{"type": "text", "text": call["response_summary"]}]
    assert rs.measure(content, is_error=True) == call["result_chars"]
    assert rs.measure(content, is_error=False) != call["result_chars"]


# --- error classes ---------------------------------------------------------


@pytest.mark.parametrize("text, cls", [
    ("research.json 'plans' is missing or not an array", "state"),
    ("research.json not found in projectPath", "state"),
    ("Person 'I1' not found in tree.gedcomx.json.", "state"),
    ('section "localities" is not one of: questions, plans', "argument"),
    ("'targetId' is not a supported filter for section 'plans'", "argument"),
    ("something else broke", "other"),
])
def test_errors_are_classified_so_only_state_errors_can_exit_3(text, cls):
    assert rs.classify_error(text) == cls


def test_non_empty_success_catches_empty_but_successful_answers():
    assert rs.non_empty_success("research_query", '{"ok":true,"count":3,"items":[]}')
    assert not rs.non_empty_success("research_query", '{"ok":true,"count":0,"items":[]}')
    assert rs.non_empty_success("person_warnings", '{"warningCount":0,"warnings":[]}')
    assert not rs.non_empty_success("person_warnings", "not json")


# --- item building -----------------------------------------------------------


def _call(tool, **kw):
    c = {"tool": f"mcp__genealogy__{tool}", "args": {"projectPath": "C:\\Temp\\x", "section": "plans"},
         "result_chars": 100, "is_error": False, "response_summary": '{"ok":true}'}
    c.update(kw)
    return c


def _items(tmp_path, calls, tools=rs.REPLAYABLE, tree=True, monkeypatch=None):
    slug = "fx"
    run_dir = tmp_path / "runlogs" / slug
    run_dir.mkdir(parents=True)
    run = run_dir / "run-2026-10-06_00-00-00.json"
    run.write_text("{}", encoding="utf-8")
    if tree:
        run.with_name("run-2026-10-06_00-00-00.final-tree.gedcomx.json").write_text(
            json.dumps({"persons": []}), encoding="utf-8")
    fixture = tmp_path / "tests" / slug
    fixture.mkdir(parents=True)
    (fixture / "starting-research.json").write_text(json.dumps({"plans": []}), encoding="utf-8")
    monkeypatch.setattr(rs, "E2E_TESTS", tmp_path / "tests")
    skipped, chars = Counter(), Counter()
    out = rs.build_items(run, {"tool_calls": calls}, set(tools), skipped, chars)
    return out, skipped


def test_cap_denials_are_skipped_by_text_and_by_the_stripped_fallback(tmp_path, monkeypatch):
    calls = [
        _call("research_query", is_error=True, result_chars=29,
              response_summary="tool_calls cap (300) exceeded"),
        _call("research_query", is_error=True, result_chars=29,
              response_summary="tool_calls cap (200) exceeded"),
        dict(_call("project_context", is_error=True, result_chars=29), response_summary=None),
        _call("research_query"),
    ]
    out, skipped = _items(tmp_path, calls, monkeypatch=monkeypatch)
    assert skipped[("research_query", "harness-denied")] == 2
    assert skipped[("project_context", "harness-denied")] == 1
    assert [i.index for i in out.items] == [3]


def test_non_replayable_calls_land_in_not_replayed_with_a_reason(tmp_path, monkeypatch):
    calls = [_call("wiki_search"), _call("research_append"), _call("sidecar_read"),
             {"tool": "ToolSearch", "args": {}}, _call("research_query"), _call("image_transcribe"),
             _call("record_read", args={"recordId": "ark:/61903/1:1:X5CB-RLK", "resultsRef": "results/log_001.json"})]
    out, skipped = _items(tmp_path, calls, monkeypatch=monkeypatch)
    # A network tool is replayable only from a cassette; with none recorded it
    # is listed, never measured.
    assert skipped[("wiki_search", "no-cassette (run not in recorded set)")] == 1
    assert skipped[("image_transcribe", "not-on-replay-allow-list")] == 1
    assert skipped[("record_read", "sidecar-mode (deferred)")] == 1
    assert skipped[("research_append", "writer")] == 1
    assert skipped[("sidecar_read", "sidecar-not-committed")] == 1
    assert not any(t == "ToolSearch" for t, _ in skipped)  # not an MCP call
    assert len(out.items) == 1


def test_each_item_sees_the_state_as_of_its_call(tmp_path, monkeypatch):
    write = {"tool": "mcp__genealogy__research_append",
             "args": {"section": "questions", "op": "append", "entry": {"question": "q?"}},
             "response_summary": '{"ok":true,"entryId":"q_001"}', "result_chars": 30}
    calls = [_call("research_query", args={"section": "questions"}), write,
             _call("research_query", args={"section": "questions"})]
    out, _ = _items(tmp_path, calls, monkeypatch=monkeypatch)
    before, after = out.items
    assert not before.research.get("questions")
    assert [q["id"] for q in after.research["questions"]] == ["q_001"]


def test_tree_readers_without_a_tree_are_skipped_but_research_reads_run(tmp_path, monkeypatch):
    calls = [_call("person_warnings"), _call("research_query")]
    out, skipped = _items(tmp_path, calls, tree=False, monkeypatch=monkeypatch)
    assert skipped[("person_warnings", "no-tree")] == 1
    assert [i.tool for i in out.items] == ["research_query"]


# --- guards that must refuse to report ---------------------------------------


@pytest.mark.parametrize("text", [
    '{"ok":false,"reason":"no_project","message":"x"}',
    "projectPath is required",
    "projectPath does not exist: C:\\Temp\\x",
    "research.json not found in projectPath",
    "tree.gedcomx.json not found at /tmp/x",
    "replay-sizes: network blocked",
])
def test_a_broken_rebase_or_a_network_call_is_an_integrity_error(text):
    with pytest.raises(rs.IntegrityError):
        rs._check_answer(text, "here")


def _row(tool, base_err=False, base_text="{}", recorded_err=False):
    item = rs.Item("r", 0, tool, {}, {}, None, 10, recorded_err)
    return rs.Row(item, rs.Answer(10, base_err, base_text), rs.Answer(10, base_err, base_text))


def test_state_errors_over_the_margin_exit_3_but_argument_errors_never_do():
    state = [_row("research_query", True, "research.json 'plans' is missing or not an array")
             for _ in range(11)]
    with pytest.raises(rs.IntegrityError):
        rs.check_margins(rs.summarize(state))
    argument = [_row("research_query", True, 'section "localities" is not one of: a') for _ in range(11)]
    rs.check_margins(rs.summarize(argument))  # contract drift: printed, not fatal


def test_a_new_error_and_a_cured_one_are_not_netted_to_zero():
    rows = [_row("research_query", True, "Person 'I9' not found", recorded_err=False),
            _row("research_query", False, '{"ok":true}', recorded_err=True)]
    assert rs.summarize(rows)["research_query"].new_errors["state"] == 1


def test_main_refuses_a_typo_d_tool_filter_and_a_json_path_in_the_corpus(capsys):
    # Checked by message, not just the code: an empty filter would ALSO end in
    # "zero calls left to replay" (exit 2), which would hide a deleted guard.
    assert rs.main(["--tools", "reserch_query"]) == 2
    assert "matches no replayable tool" in capsys.readouterr().err
    assert rs.main(["--json", str(REPO / "eval/runlogs/e2e/x.json")]) == 2
    assert "corpus pollution" in capsys.readouterr().err


def test_main_refuses_a_build_without_build_info(tmp_path):
    assert rs.main(["--test", "spriggs-parents-1898", "--candidate-build", str(tmp_path)]) == 2


def _repo(tmp_path):
    """A two-commit repo: `old`, then `stamp`. Real git, independent of how deep
    this checkout's history is (CI clones shallow)."""
    def git(*args):
        return subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True,
                              text=True, encoding="utf-8").stdout.strip()
    git("init", "-q")
    shas = []
    for name in ("old", "stamp"):
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", name)
        shas.append(git("rev-parse", "HEAD"))
    return shas


def test_a_base_older_than_the_build_stamp_is_refused(tmp_path):
    old, stamp = _repo(tmp_path)
    with pytest.raises(rs.UsageError, match="predates"):
        rs.check_base_supported(old, repo=tmp_path, stamp=stamp)
    rs.check_base_supported(stamp, repo=tmp_path, stamp=stamp)  # the stamp itself is supported


def test_a_clone_without_the_stamp_says_shallow_not_predates(tmp_path):
    _, head = _repo(tmp_path)
    with pytest.raises(rs.UsageError, match="shallow"):
        rs.check_base_supported(head, repo=tmp_path, stamp="e8607990d")


def test_zero_items_after_skips_is_a_usage_error(monkeypatch):
    monkeypatch.setattr(rs, "select_runs", lambda test, tracked: ([(Path("x"), {"tool_calls": []})], 0))
    monkeypatch.setattr(rs, "build_version", lambda b: "v")
    assert rs.main(["--base-build", "/tmp", "--candidate-build", "/tmp"]) == 2


# --- end to end against the real compiled engine -------------------------------


@pytest.mark.requires_engine_build
def test_an_unchanged_build_replays_to_exactly_zero_with_real_answers(capsys):
    build = REPO / "packages/engine/mcp-server/build"
    code = rs.main(["--test", "spriggs-parents-1898", "--tracked-only", "--tools", "research_query",
                    "--base-build", str(build), "--candidate-build", str(build)])
    out = capsys.readouterr().out
    assert code == 0, out
    row = next(line for line in out.splitlines() if line.startswith("research_query "))
    assert "+0 " in row
    stats_row = next(line for line in out.splitlines() if line.strip().startswith("research_query")
                     and "/" in line)
    non_empty = int(stats_row.split()[2].replace(",", ""))
    assert non_empty > 0  # real, non-empty answers — not a replay of empties


# --- network replay (T1.4c): offline, against planted upstream answers ------------
#
# These record a small synthetic run through the REAL recorder and the real
# compiled engine, with the hook's `upstream` test seam standing in for the
# network, then replay it. No request leaves the machine: the replay hook never
# calls the original fetch, and the recorder's upstream is a local module.

SPRIGGS = REPO / "eval/tests/e2e/spriggs-parents-1898"
SUBJECT = "L64C-QQX"
RECORDED_WIKI = "http://wiki.example.test/wiki"  # a base WITH a path (S1)
BUILD = REPO / "packages/engine/mcp-server/build"


def _persona(eid, year, hint=None):
    e = {"id": eid, "score": 3.0, "content": {"gedcomx": {
        "persons": [{"principal": True, "id": "p_1",
                     "display": {"name": "Reuben Spriggs", "gender": "Male", "birthDate": year},
                     "names": [{"nameForms": [{"fullText": "Reuben Spriggs"}]}],
                     "facts": [{"type": "http://gedcomx.org/Birth", "date": {"original": year},
                                "place": {"original": "Benson, North Dakota"}}],
                     "identifiers": {"http://gedcomx.org/Persistent": [
                         f"https://familysearch.org/ark:/61903/1:1:{eid}"]}}],
        "sourceDescriptions": [
            {"resourceType": "http://gedcomx.org/Collection",
             "about": "https://familysearch.org/collections/1325221",
             "titles": [{"value": "United States Census, 1900"}]},
            {"titles": [{"value": f"Entry for Reuben Spriggs {eid}"}],
             "identifiers": {"http://gedcomx.org/Persistent": [f"https://familysearch.org/ark:/61903/1:2:{eid}"]}},
        ]}}}
    if hint:
        e["hints"] = [{"id": hint, "stars": 4}]
    return e


UPSTREAM_RULES = [
    {"method": "GET", "host": "wiki.example.test", "path": "/wiki/page/",
     "body": {"title": "Benson County", "content": "Benson County, North Dakota genealogy.", "source_url": "x"}},
    {"method": "POST", "host": "wiki.example.test", "path": "/wiki/search",
     "body": {"query": "q", "total_chunks_searched": 9, "results": [{"rank": 1, "chunk_text": "census guidance"}]}},
    {"method": "GET", "host": "www.familysearch.org", "path": "/service/search/hr/v2/personas",
     "body": {"results": 3, "index": 0, "entries": [
         _persona("X5CB-RLK", "1898", hint="ark:/61903/4:1:KWQ7-BCD"),
         _persona("M316-6G8", "+1940"),  # dropped by the year floor before the engine sees it (B2)
         _persona("QPRC-WPBZ", "1897", hint=f"ark:/61903/4:1:{SUBJECT}"),
     ]}},
    {"method": "POST", "host": "www.familysearch.org",
     "path": "/service/search/record/collections/match/matchTwoExamples",
     "body": {"entries": [{"id": "ark:/61903/1:1:X5CB-RLK", "score": 0.81, "confidence": 4,
                           "content": {"gedcomx": {"persons": [{"names": "not kept"}]}}}],
              "title": "Match for ark:/61903/1:1:BCDF-GHJ", "updated": 1700000000000}},
    {"method": "POST", "host": "www.familysearch.org", "path": "/service/tree/links/sources/attachments",
     "attachments": [{"sourceId": "S1", "persons": [{"entityId": "KWQ7-BCD", "tags": ["Name"],
                                                     "contributorId": "MMMM-XXX", "tfEntityRefId": "r",
                                                     "modified": 1}]}]},
    {"method": "GET", "host": "sg30p0.familysearch.org", "path": "/service/cds/recapi/records/persona/",
     "body": {"persons": [{"id": "p_1", "principal": True,
                           "identifiers": {"http://gedcomx.org/Persistent": [
                               "https://familysearch.org/ark:/61903/1:1:X5CB-RLK"]},
                           "names": [{"nameForms": [{"fullText": "John Spriggs"}]}],
                           "facts": [{"type": "http://gedcomx.org/Birth", "date": {"original": "December 1868"}}]}]}},
]


def _upstream_module(tmp_path: Path, rules=UPSTREAM_RULES, name="upstream") -> Path:
    data = tmp_path / f"{name}-rules.json"
    data.write_text(json.dumps(rules), encoding="utf-8")
    mod = tmp_path / f"{name}.mjs"
    mod.write_text(
        'import { readFileSync, appendFileSync } from "node:fs";\n'
        f"const rules = JSON.parse(readFileSync({json.dumps(str(data))}, 'utf8'));\n"
        f"const seen = {json.dumps(str(tmp_path / 'upstream-seen.log'))};\n"
        "export default async function (input, init) {\n"
        "  const u = new URL(String(input)); const m = String(init?.method ?? 'GET').toUpperCase();\n"
        "  appendFileSync(seen, `${m} ${u.host}${u.pathname}\\n`);\n"
        "  for (const r of rules) {\n"
        "    if (r.method !== m || r.host !== u.host || !u.pathname.startsWith(r.path)) continue;\n"
        "    let body = r.body;\n"
        "    if (r.attachments) body = { attachedSourcesMap: Object.fromEntries("
        "JSON.parse(init.body).uris.map((x) => [x, r.attachments])) };\n"
        "    return new Response(JSON.stringify(body), "
        "{ status: r.status ?? 200, headers: { 'content-type': 'application/json' } });\n"
        "  }\n"
        "  return new Response('{\"error\":\"not found\"}', "
        "{ status: 404, headers: { 'content-type': 'application/json' } });\n"
        "}\n",
        encoding="utf-8",
    )
    return mod


def _net_call(tool, args, chars=500):
    return {"tool": f"mcp__genealogy__{tool}", "args": args, "result_chars": chars, "is_error": False,
            "response_summary": "{}"}


def _synthetic_run(tmp_path: Path, monkeypatch) -> tuple[Path, dict]:
    """A run of five calls — four network tools and one local read — over the
    spriggs fixture's starting state. Idempotent per tmp_path."""
    slug = "replay-synthetic"
    tests = tmp_path / "tests"
    run = tmp_path / "runlogs" / slug / "run-2026-10-14_00-00-00.json"
    monkeypatch.setattr(rs, "E2E_TESTS", tests)
    if run.exists():
        return run, json.loads(run.read_text(encoding="utf-8"))
    (tests / slug).mkdir(parents=True)
    for name in ("starting-research.json", "starting-tree.gedcomx.json"):
        shutil.copy(SPRIGGS / name, tests / slug / name)
    run.parent.mkdir(parents=True)
    shutil.copy(SPRIGGS / "starting-tree.gedcomx.json", run.with_name(f"{run.stem}.final-tree.gedcomx.json"))
    log = {"tool_calls": [
        _net_call("wiki_read", {"url": "https://www.familysearch.org/en/wiki/Benson_County,_North_Dakota_Genealogy"}),
        _net_call("wiki_search", {"query": "Benson County North Dakota census"}),
        _net_call("record_search", {"surname": "Spriggs", "givenName": "Reuben", "subjectId": SUBJECT,
                                    "projectPath": "C:\\Users\\x\\Temp\\e2e-spriggs"}),
        _net_call("record_read", {"recordId": "ark:/61903/1:1:X5CB-RLK"}),
        _net_call("research_query", {"section": "questions", "projectPath": "C:\\x"}),
    ]}
    run.write_text(json.dumps(log), encoding="utf-8")
    return run, log


def _record(tmp_path, monkeypatch, *, out=None, rules=UPSTREAM_RULES, build=BUILD, **kw):
    run, log = _synthetic_run(tmp_path, monkeypatch)
    out = out or tmp_path / "cassettes-out"
    home = tmp_path / "home"
    rs.write_fake_login(home, RECORDED_WIKI)
    upstream = _upstream_module(tmp_path, rules, name=f"upstream-{abs(hash(json.dumps(rules))) % 10**8}")
    result = asyncio.run(rr.record([(run, log)], build, out, home=home, upstream=upstream, **kw))
    return run, log, out, result


def _replay(run, log, cassette_dirs, *, base=BUILD, candidate=BUILD, item_filter=None, repeat=1):
    cassettes = rs.load_cassettes(cassette_dirs)
    skipped, chars = Counter(), Counter()
    items = rs.build_items(run, log, set(rs.REPLAYABLE), skipped, chars, cassettes)
    if item_filter:
        items.items = [i for i in items.items if item_filter(i)]
    items.items = [i for i in items.items for _ in range(repeat)]
    rows, _ = asyncio.run(rs.run_arms([items], base, candidate, ("v", "v"), cassettes))
    return rows, skipped


def _cassette_lines(out: Path) -> list[dict]:
    return [json.loads(x) for f in sorted((out / "cassettes").glob("*.jsonl"))
            for x in f.read_text(encoding="utf-8").splitlines()]


def _candidate_build(tmp_path: Path, rel: str, old: str, new: str) -> Path:
    """A copy of the compiled engine with one string patched, beside links to
    the real node_modules and config (which the build resolves relative to itself)."""
    engine = tmp_path / f"engine-{abs(hash((rel, new))) % 10**8}"
    shutil.copytree(BUILD, engine / "build")
    for name in ("node_modules", "config"):
        (engine / name).symlink_to(REPO / "packages/engine/mcp-server" / name, target_is_directory=True)
    shutil.copy(REPO / "packages/engine/mcp-server/package.json", engine / "package.json")
    target = engine / "build" / rel
    text = target.read_text(encoding="utf-8")
    assert old in text, f"{old!r} not in {rel} — the compiled source moved; update the test's patch"
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    return engine / "build"


@pytest.mark.requires_engine_build
def test_a_recording_replays_with_every_key_hit_and_delta_zero(tmp_path, monkeypatch):
    """A4 + B2 + S1: recorded under a wiki base WITH a path, replayed under one
    without; the subject-mode search had an entry dropped by the year floor, and
    its match fan-out and attachments POST still hit on replay; Δ is 0."""
    run, log, out, result = _record(tmp_path, monkeypatch)
    calls = result.manifest["runs"][rs.run_key(run)]["calls"]
    assert {c["tool"]: c["status"] for c in calls.values()} == {
        "wiki_read": "recorded", "wiki_search": "recorded", "record_search": "recorded", "record_read": "recorded"}
    groups = {f.name for f in (out / "cassettes").glob("*.jsonl")}
    assert {"fs-match.jsonl", "fs-attachments.jsonl", "fs-search.jsonl", "fs-records.jsonl", "wiki.jsonl"} <= groups
    assert result.year_floor_dropped == 1
    raw = json.dumps(_cassette_lines(out))
    assert "M316-6G8" not in raw and "MMMM-XXX" not in raw and "KWQ7-BCD" not in raw  # B2 + rule 3
    assert "ZZZZ-ZZZ" in raw
    assert privacy.check(out, rs.REPO_ROOT, tests_root=rs.E2E_TESTS) == []

    rows, _ = _replay(run, log, [out])
    assert [r.bucket for r in rows] == [None] * 5
    assert all(r.base.chars == r.candidate.chars for r in rows)
    stats = rs.summarize(rows)
    for tool in ("wiki_read", "wiki_search", "record_search", "record_read"):
        assert stats[tool].base_non_empty == 1, tool
    search = json.loads(next(r for r in rows if r.item.tool == "record_search").base.text)
    assert search.get("ranked"), "the subject-mode search must have ranked (match fan-out replayed)"
    assert "rankingError" not in search


@pytest.mark.requires_engine_build
def test_b1_minted_ids_replay_twice_in_one_arm_and_once_in_each(tmp_path, monkeypatch):
    run, log, out, _ = _record(tmp_path, monkeypatch)
    rows, _ = _replay(run, log, [out], item_filter=lambda i: i.tool == "record_search", repeat=2)
    assert len(rows) == 2 and [r.bucket for r in rows] == [None, None]
    assert all(r.misses == 0 for r in rows)


@pytest.mark.requires_engine_build
def test_b1_without_the_persistent_id_mask_the_match_requests_miss(tmp_path, monkeypatch):
    """The other direction: the mask is what makes B1 hit. With it removed from
    the hook, the minted ids move every match key and the search goes stale."""
    patched = tmp_path / "replay_fetch_unmasked.mjs"
    text = rs.HOOK.read_text(encoding="utf-8")
    old = "return JSON.stringify(maskPersistent(JSON.parse(text)));"
    assert old in text
    patched.write_text(text.replace(old, "return text;"), encoding="utf-8")
    monkeypatch.setattr(rs, "HOOK", patched)
    run, log, out, _ = _record(tmp_path, monkeypatch)
    rows, _ = _replay(run, log, [out], item_filter=lambda i: i.tool == "record_search")
    assert rows[0].bucket == rs.STALE and rows[0].misses >= 1


@pytest.mark.requires_engine_build
def test_a_deleted_line_is_stale_counted_once_although_the_engine_retried(tmp_path, monkeypatch):
    run, log, out, _ = _record(tmp_path, monkeypatch)
    wiki = out / "cassettes" / "wiki.jsonl"
    kept = [x for x in wiki.read_text(encoding="utf-8").splitlines() if "/page/" not in x]
    wiki.write_text("".join(x + "\n" for x in kept), encoding="utf-8")
    rows, _ = _replay(run, log, [out])
    wiki_row = next(r for r in rows if r.item.tool == "wiki_read")
    assert wiki_row.bucket == rs.STALE
    assert wiki_row.misses == 1  # fetchWithRetry re-issued it; the key counts once
    stats = rs.summarize(rows)
    assert stats["wiki_read"].calls == 0 and stats["wiki_read"].stale == 1
    text = rs.render(header=[], stats=stats, rows=rows, skipped=Counter(), skipped_chars=Counter(),
                     all_mcp_chars=1000, substitutions=0)
    assert "CASSETTE MISSES" in text
    assert not any(line.startswith("wiki_read ") for line in text.splitlines())  # not a +0 row


def test_stale_beyond_the_margin_exits_3_with_re_record():
    def row(bucket):
        item = rs.Item("r", 0, "wiki_read", {}, {}, None, 10, False)
        return rs.Row(item, rs.Answer(10, True, "x"), rs.Answer(10, True, "x"), bucket, 1)

    with pytest.raises(rs.IntegrityError, match="cassettes stale: re-record"):
        rs.check_margins(rs.summarize([row(rs.STALE) for _ in range(11)]))
    rs.check_margins(rs.summarize([row(rs.STALE) for _ in range(10)]))  # inside the margin
    rs.check_margins(rs.summarize([row(rs.CANDIDATE_NEW) for _ in range(50)]))  # never fatal


@pytest.mark.requires_engine_build
def test_a_candidate_that_changes_a_request_lands_in_candidate_new_request(tmp_path, monkeypatch):
    run, log, out, _ = _record(tmp_path, monkeypatch)
    cand = _candidate_build(tmp_path, "tools/wiki-search.js", "JSON.stringify({ query: input.query })",
                            "JSON.stringify({ query: input.query, limit: 5 })")
    rows, _ = _replay(run, log, [out], candidate=cand)
    assert next(r for r in rows if r.item.tool == "wiki_search").bucket == rs.CANDIDATE_NEW
    assert [r.bucket for r in rows if r.item.tool != "wiki_search"] == [None] * 4


@pytest.mark.requires_engine_build
def test_a_candidate_that_changes_only_user_agent_still_hits(tmp_path, monkeypatch):
    run, log, out, _ = _record(tmp_path, monkeypatch)
    cand = _candidate_build(tmp_path, "tools/wiki-search.js", '"User-Agent": "genealogy-mcp-server/0.0.1"',
                            '"User-Agent": "genealogy-mcp-server/9.9.9"')
    rows, _ = _replay(run, log, [out], candidate=cand)
    assert [r.bucket for r in rows] == [None] * 5


@pytest.mark.requires_engine_build
def test_a2_a_fattened_candidate_shows_the_exact_padding(tmp_path, monkeypatch):
    run, log, out, _ = _record(tmp_path, monkeypatch)
    cand = _candidate_build(tmp_path, "tools/wiki-read.js", "content: data.content",
                            'content: data.content + "x".repeat(1000)')
    rows, _ = _replay(run, log, [out], candidate=cand)
    stats = rs.summarize(rows)
    assert stats["wiki_read"].base_successes == 1
    assert stats["wiki_read"].candidate - stats["wiki_read"].base == 1000 * stats["wiki_read"].base_successes
    for tool in ("wiki_search", "record_search", "record_read", "research_query"):
        assert stats[tool].candidate == stats[tool].base, tool


@pytest.mark.requires_engine_build
def test_a_local_tool_that_touches_the_network_is_an_integrity_error(tmp_path, monkeypatch):
    run, log, out, _ = _record(tmp_path, monkeypatch)
    cand = _candidate_build(
        tmp_path, "tools/research-query.js", "export async function researchQuery(input) {",
        'export async function researchQuery(input) {\n'
        '    await globalThis.fetch("https://example.invalid/leak").catch(() => {});')
    with pytest.raises(rs.IntegrityError, match="local tool touched the network hook"):
        _replay(run, log, [out], candidate=cand)


@pytest.mark.requires_engine_build
def test_sf3_a_failing_filter_aborts_the_recording_and_writes_nothing(tmp_path, monkeypatch):
    broken = tmp_path / "broken_filter.py"
    broken.write_text("import sys\nsys.exit(1)\n", encoding="utf-8")
    out = tmp_path / "out"
    out.mkdir()
    (out / "README.md").write_text("keep me", encoding="utf-8")
    with pytest.raises(rr.RecordAbort, match="privacy filter failed"):
        _record(tmp_path, monkeypatch, out=out, privacy_script=broken)
    assert sorted(p.name for p in out.iterdir()) == ["README.md"]


@pytest.mark.requires_engine_build
def test_a_filter_that_lets_a_raw_body_through_is_caught_before_out_is_written(tmp_path, monkeypatch):
    """Defence in depth: a filter that exits 0 but stores the body unchanged
    (the 1940 entry, the attacher's account id) is refused by the check the
    recorder runs before the swap — nothing reaches OUT."""
    passthrough = tmp_path / "passthrough_filter.py"
    passthrough.write_text(
        "import json, sys\n"
        "env = json.loads(sys.stdin.buffer.read().decode('utf-8'))\n"
        "url = env['url']\n"
        "group = 'wiki' if url.startswith('{WIKI}') else 'fs-match' if 'matchTwoExamples' in url else "
        "'fs-attachments' if 'attachments' in url else 'fs-records' if 'recapi' in url else 'fs-search'\n"
        "sys.stdout.write(json.dumps({'action': 'store', 'group': group, 'body': env['body'], 'rewrites': {}}))\n",
        encoding="utf-8",
    )
    out = tmp_path / "out"
    with pytest.raises(rr.RecordAbort, match="cassette check refused"):
        _record(tmp_path, monkeypatch, out=out, privacy_script=passthrough)
    assert not out.exists()


def test_sf3_the_cli_exits_non_zero_on_an_abort(monkeypatch, capsys, tmp_path):
    async def boom(*a, **k):
        raise rr.RecordAbort("privacy filter failed: exited 1")

    monkeypatch.setattr(rr, "choose_runs", lambda spec: [(Path("x"), {})])
    monkeypatch.setattr(rr, "record", boom)
    assert rr.main(["--out", str(tmp_path / "never")]) == 3
    assert "ABORTED" in capsys.readouterr().err
    assert not (tmp_path / "never").exists()


def test_the_recorder_refuses_an_out_under_the_run_log_corpus():
    with pytest.raises(rs.UsageError, match="run-log corpus"):
        asyncio.run(rr.record([(Path("x"), {})], BUILD, rs.RUNLOGS / "e2e" / "x", home=Path("/nonexistent")))


@pytest.mark.requires_engine_build
def test_sf2_an_uncommitted_hint_id_is_recorded_as_the_placeholder(tmp_path, monkeypatch):
    _, _, out, _ = _record(tmp_path, monkeypatch)
    [search] = [x for x in _cassette_lines(out) if "/personas" in x["url"]]
    hints = [h["id"] for e in json.loads(search["body"])["entries"] for h in e.get("hints", [])]
    assert sorted(hints) == sorted(["ark:/61903/4:1:ZZZZ-ZZZ", f"ark:/61903/4:1:{SUBJECT}"])


@pytest.mark.requires_engine_build
def test_sf1_a_scratch_dir_listed_first_serves_an_unchanged_request(tmp_path, monkeypatch):
    run, log, committed, _ = _record(tmp_path, monkeypatch, out=tmp_path / "committed")
    rules = json.loads(json.dumps(UPSTREAM_RULES))
    rules[0]["body"]["content"] = "SCRATCH COPY of the Benson County page, recorded later."
    _record(tmp_path, monkeypatch, out=tmp_path / "scratch", rules=rules)
    scratch = tmp_path / "scratch"
    rows, _ = _replay(run, log, [scratch, committed], item_filter=lambda i: i.tool == "wiki_read")
    assert "SCRATCH COPY" in rows[0].base.text
    rows, _ = _replay(run, log, [committed, scratch], item_filter=lambda i: i.tool == "wiki_read")
    assert "SCRATCH COPY" not in rows[0].base.text  # the order is what decides


@pytest.mark.requires_engine_build
def test_merge_records_base_and_candidate_into_one_scratch_dir(tmp_path, monkeypatch):
    """S6/SF1: a candidate that changes a request is measured by recording both
    builds into one scratch OUT; then neither arm misses."""
    run, log, out, _ = _record(tmp_path, monkeypatch)
    cand = _candidate_build(tmp_path, "tools/wiki-search.js", "JSON.stringify({ query: input.query })",
                            "JSON.stringify({ query: input.query, limit: 5 })")
    _record(tmp_path, monkeypatch, out=out, build=cand, merge=True)
    assert privacy.check(out, rs.REPO_ROOT, tests_root=rs.E2E_TESTS) == []
    rows, _ = _replay(run, log, [out], candidate=cand)
    assert [r.bucket for r in rows] == [None] * 5


@pytest.mark.requires_engine_build
def test_a1_with_no_recording_the_recorded_runs_flag_refuses(tmp_path, capsys):
    """A1 today: no committed cassettes, so `--recorded-runs` has nothing to
    replay and says so (exit 2) rather than reporting an empty +0."""
    code = rs.main(["--recorded-runs", "--cassettes", str(tmp_path), "--base-build", str(BUILD), "--tools",
                    "wiki_read,wiki_place_page,wiki_search,record_search,record_read,volume_search,fulltext_search"])
    assert code == 2
    assert "no cassette manifest names a run" in capsys.readouterr().err


def test_classify_call_applies_the_status_policy():
    def ex(key, status, group="wiki"):
        return {"event": "exchange", "key": key, "status": status, "group": group, "inflight": 0}

    assert rr.classify_call([ex("a", 200), ex("b", 404)]).status == "recorded"
    assert rr.classify_call([ex("a", 503), ex("a", 200)]).status == "recorded"  # a retry that recovered
    assert rr.classify_call([ex("a", 200), ex("a", 503)]).reason == "upstream-unavailable-at-record"
    assert rr.classify_call([{"event": "error", "key": "a", "kind": "timeout"}]).reason == \
        "upstream-unavailable-at-record"
    out = rr.classify_call([ex("a", 401), ex("p", 200, "fs-places")])
    assert (out.reason, out.auth_401, [x["key"] for x in out.store]) == ("auth-failed-at-record", True, ["p"])
    assert rr.classify_call([{"event": "withhold", "reason": "endpoint-not-allowlisted", "status": 200}]).reason \
        == "endpoint-not-allowlisted"
    assert rr.classify_call([{"event": "withhold", "reason": "privacy-year-floor", "status": 200}]).reason \
        == "privacy-year-floor"
    assert rr.classify_call([ex("m", 200, "fs-match")], exclude_tree=True).reason.startswith("tree-subrequest")
    assert rr.classify_call([ex("m", 200, "fs-match")]).status == "recorded"
    with pytest.raises(rr.RecordAbort):
        rr.classify_call([{"event": "abort", "reason": "privacy-filter-failed"}])


def test_same_length_project_dirs():
    a, b = rs.same_length_projects()
    try:
        assert len(str(a)) == len(str(b)) and a != b
    finally:
        shutil.rmtree(a)
        shutil.rmtree(b)


def test_a_network_call_gets_a_project_path_only_if_it_recorded_one():
    net = rs.Item("r", 0, "wiki_read", {"url": "u"}, {}, None, 1, False)
    staged = rs.Item("r", 0, "record_search", {"surname": "S", "projectPath": "C:\\x"}, {}, None, 1, False)
    local = rs.Item("r", 0, "research_query", {"section": "plans"}, {}, None, 1, False)
    assert "projectPath" not in rs.call_args(net, Path("/p"))
    assert rs.call_args(staged, Path("/p"))["projectPath"] == "/p"
    assert rs.call_args(local, Path("/p"))["projectPath"] == "/p"


def test_cassette_provenance_prints_date_engine_and_age(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps(
        {"recorded_at": "2026-10-04T10:00:00Z", "engine_sha": "abcdef1234567", "version": "0.1.0+x",
         "tree_subrequests": "committed", "runs": {}}), encoding="utf-8")
    [line] = rs.cassette_provenance(rs.load_cassettes([tmp_path]), today="2026-10-14")
    assert "recorded 2026-10-04T10:00:00Z" in line and "abcdef123" in line and "10 days old" in line
