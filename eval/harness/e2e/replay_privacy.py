"""The privacy rules for replay cassettes — one implementation, two entry points.

`make replay-sizes` replays the FamilySearch and wiki tools from recorded
upstream answers ("cassettes", `eval/fixtures/replay/`). Those answers come from
historical records, and historical records include living people. Dallan's
2026-10-06 ruling allowed committing them only on the premise that no living
person's data reaches the public repo. This module is what holds that premise.

* **`filter`** runs inside the recorder's fetch hook (`replay_fetch.mjs`), as a
  child process (`python -I replay_privacy.py filter`), on every upstream body
  BEFORE the engine sees it. The engine then builds every later request in the
  call — the match fan-out, the attachments POST — from exactly the bytes that
  get committed. A body the filter did not return is never written.
* **`check`** is the CI lint (`tests/unit/test_replay_cassettes.py`) and the
  recorder's last step. It re-checks stored bodies and never transforms them.

Default deny: an endpoint not on the allowlist taints its call, and a filter
failure aborts the whole recording.

The four rules (eval/fixtures/replay/README.md):

1. **Endpoint allowlist** — scheme + exact host + path prefix + method.
2. **Living-person year floor** (`recording year - 100`) — read from structured
   person and record dates only, never from collection titles or citations.
3. **Identifier rewrite** — a tree-person id outside the committed trees becomes
   a fixed placeholder; attachments and match responses are rebuilt to the
   fields the engine reads.
4. **Credentials** — `harness.redact.scan_for_credentials`, plus two
   cassette-only rules (no `Authorization` key, no `Bearer <token>` value).

`filter` must stay stdlib-only and must not import `harness`: `python -I`
implies `-P`, so the harness package is not on the path there.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

WIKI = "{WIKI}"

#: (group, method, scheme, host, path prefix). The wiki rows match the
#: canonical `{WIKI}` base the hook substitutes for the configured wiki URL.
ALLOWLIST: tuple[tuple[str, str, str, str, str], ...] = (
    ("wiki", "GET", "", WIKI, "/page/"),
    ("wiki", "POST", "", WIKI, "/search"),
    ("fs-search", "GET", "https", "www.familysearch.org", "/service/search/hr/v2/personas"),
    ("fs-search", "GET", "https", "www.familysearch.org", "/service/search/fulltext/search"),
    ("fs-search", "GET", "https", "sg30p0.familysearch.org", "/service/search/fulltext/search/groupNumber"),
    ("fs-search", "PUT", "https", "sg30p0.familysearch.org", "/service/records/rms/group-service/group/search"),
    ("fs-records", "GET", "https", "sg30p0.familysearch.org", "/service/cds/recapi/records/persona"),
    ("fs-places", "GET", "https", "api.familysearch.org", "/platform/places/"),
    ("fs-places", "GET", "https", "www.familysearch.org", "/service/standards/place/ws-ui/places/reps/"),
    ("fs-match", "POST", "https", "www.familysearch.org", "/service/search/record/collections/match/matchTwoExamples"),
    ("fs-attachments", "POST", "https", "www.familysearch.org", "/service/tree/links/sources/attachments"),
)
GROUPS = ("wiki", "fs-search", "fs-records", "fs-places", "fs-match", "fs-attachments")
#: The two `record_search` sub-requests that touch the tree (Q1, for Dallan).
TREE_GROUPS = frozenset({"fs-match", "fs-attachments"})

#: Reserved placeholders, one per id shape. Never derived from the real id: an
#: unsalted hash over a 31^7 id space can be enumerated back to the original.
PLACEHOLDER_4_3 = "ZZZZ-ZZZ"
PLACEHOLDER_4_4 = "ZZZZ-ZZZZ"
PLACEHOLDERS = frozenset({PLACEHOLDER_4_3, PLACEHOLDER_4_4})

_ID = r"[A-Z0-9]{4}-[A-Z0-9]{3,4}(?![A-Za-z0-9-])"
#: Tree-person id carriers. `1:1:` record-persona ARKs share the id shape and
#: must survive, so this is never a bare id regex.
_TREE_ARK = re.compile(r"(ark:/61903/4:1:)(" + _ID + ")")
_TREE_URL = re.compile(r"(/tree/persons?/(?:[a-z]+/)?)(" + _ID + ")")
_YEAR = re.compile(r"(?<!\d)(\d{4})(?!\d)")
_TEXT_YEAR_CEILING = 2100

#: Keys an attachments body may never carry (the attacher's account id and
#: tree bookkeeping). `contributorId` is refused in every group.
_ATTACHMENT_DROPPED = ("contributorId", "tfEntityRefId", "modified", "sourceId")
_MATCH_TOP = frozenset({"entries", "title", "updated"})
_MATCH_ENTRY = frozenset({"id", "score", "confidence"})

FILE_BYTES_CAP = 20 * 1024 * 1024
#: Provisional: Phase A measures the real total and Promise sets this (Q3). The
#: decision is "the first recording's measured total, rounded up; over 30 MB raw,
#: drop whole runs".
CASSETTE_BYTES_CAP = 30 * 1024 * 1024
#: The Q3 set is the newest committed run of each fixture.
MAX_RECORDED_RUNS = 14

_BEARER = re.compile(r"Bearer\s+([A-Za-z0-9._~+/=-]+)")
_AUTH_KEY = re.compile(r'\\*"authorization\\*"\s*:', re.IGNORECASE)
#: The fake token the replay harness logs in with — not a credential.
FAKE_TOKEN = "replay-not-a-real-token"


# --------------------------------------------------------------------------
# Rule 1 — endpoint allowlist
# --------------------------------------------------------------------------


def _split(url: str) -> tuple[str, str, str]:
    """(scheme, host, path) of a canonical URL; `{WIKI}` has no scheme."""
    if url.startswith(WIKI):
        return "", WIKI, url[len(WIKI):].split("?", 1)[0]
    parts = urlsplit(url)
    return parts.scheme, parts.netloc, parts.path


def _under(path: str, prefix: str) -> bool:
    if prefix.endswith("/"):
        return path.startswith(prefix) and len(path) > len(prefix)
    return path == prefix or path.startswith(prefix + "/")


def classify(method: str, url: str) -> str | None:
    """The allowlist group for this request, or None (taints the call).

    The most specific prefix wins, so the sg30p0 `groupNumber` row is not read
    as the www fulltext row (different hosts anyway) and vice versa."""
    scheme, host, path = _split(url)
    best: tuple[int, str] | None = None
    for group, m, s, h, prefix in ALLOWLIST:
        if m == method and s == scheme and h == host and _under(path, prefix):
            if best is None or len(prefix) > best[0]:
                best = (len(prefix), group)
    return best[1] if best else None


# --------------------------------------------------------------------------
# Rule 2 — living-person year floor
# --------------------------------------------------------------------------


def _years(text: Any) -> list[int]:
    if not isinstance(text, str):
        return []
    return [int(y) for y in _YEAR.findall(text)]


def _date_years(date: Any) -> list[int]:
    """Every year in a GedcomX date: `formal`, `original`, and `normalized[]`."""
    if isinstance(date, str):
        return _years(date)
    if not isinstance(date, dict):
        return []
    out = _years(date.get("formal")) + _years(date.get("original"))
    for n in date.get("normalized") or []:
        if isinstance(n, dict):
            out += _years(n.get("value"))
    return out


def fact_years(node: Any) -> list[int]:
    """Years of every `facts[].date` anywhere under `node` (persons and
    relationships). Collection titles and citations live elsewhere, so a
    "Church Books, 1815-2010" title is never read as a person's date."""
    out: list[int] = []
    if isinstance(node, dict):
        display = node.get("display")
        if isinstance(display, dict):
            for k in ("birthDate", "deathDate", "marriageDate"):
                out += _years(display.get(k))
        facts = node.get("facts")
        if isinstance(facts, list):
            for f in facts:
                if isinstance(f, dict):
                    out += _date_years(f.get("date"))
        for k, v in node.items():
            if k not in ("facts", "display"):
                out += fact_years(v)
    elif isinstance(node, list):
        for v in node:
            out += fact_years(v)
    return out


def persona_entry_too_recent(entry: Any, floor: int) -> bool:
    return any(y >= floor for y in fact_years(entry))


def fulltext_entry_too_recent(entry: Any, floor: int) -> bool:
    """Dropped when any structured date is >= floor, any year in the text is,
    or the entry has neither a `recordDate` nor a `DATE` entity — it cannot be
    shown to be old."""
    content = entry.get("content") if isinstance(entry, dict) else None
    if not isinstance(content, dict):
        return True
    record_date = content.get("recordDate")
    dates = [e.get("value") for e in content.get("entities") or []
             if isinstance(e, dict) and e.get("type") == "DATE"]
    if not record_date and not dates:
        return True
    years = _years(record_date)
    for d in dates:
        years += _years(d)
    if any(y >= floor for y in years):
        return True
    return any(floor <= y <= _TEXT_YEAR_CEILING for y in _years(content.get("textDocument")))


def _is_fulltext(url: str) -> bool:
    return _split(url)[2] == "/service/search/fulltext/search"


def _is_personas(url: str) -> bool:
    return _split(url)[2] == "/service/search/hr/v2/personas"


# --------------------------------------------------------------------------
# Rule 3 — identifier rewrite
# --------------------------------------------------------------------------


def placeholder_for(pid: str) -> str:
    return PLACEHOLDER_4_4 if len(pid.split("-", 1)[1]) == 4 else PLACEHOLDER_4_3


def _allowed(pid: str, allowed: frozenset[str]) -> bool:
    return pid in allowed or pid in PLACEHOLDERS


def rewrite_text_ids(text: str, allowed: frozenset[str], counts: dict[str, int]) -> str:
    def sub(m: re.Match) -> str:
        pid = m.group(2)
        if _allowed(pid, allowed):
            return m.group(0)
        counts["tree_id"] = counts.get("tree_id", 0) + 1
        return m.group(1) + placeholder_for(pid)

    return _TREE_URL.sub(sub, _TREE_ARK.sub(sub, text))


def _rewrite_id_segment(value: Any, allowed: frozenset[str], counts: dict[str, int]) -> Any:
    """Rewrite the final id segment of a hint id / entity id (bare, ARK or URL)."""
    if not isinstance(value, str):
        return value
    m = re.search(r"(" + _ID + r")$", value)
    if not m or _allowed(m.group(1), allowed):
        return value
    counts["tree_id"] = counts.get("tree_id", 0) + 1
    return value[: m.start(1)] + placeholder_for(m.group(1))


def _rebuild_match(body: Any) -> dict:
    """`{entries:[{id, score, confidence}], title, updated}` — what `scorePair`
    (`utils/match-engine.ts`) reads, and nothing else."""
    out: dict[str, Any] = {}
    if isinstance(body, dict):
        entries = []
        for e in body.get("entries") or []:
            if isinstance(e, dict):
                entries.append({k: e[k] for k in ("id", "score", "confidence") if k in e})
        out["entries"] = entries
        for k in ("title", "updated"):
            if k in body:
                out[k] = body[k]
    return out


def _rebuild_attachments(body: Any, allowed: frozenset[str], counts: dict[str, int]) -> dict:
    """`{attachedSourcesMap:{url:[{persons:[{entityId, tags}]}]}}` — what
    `source-attachments.ts` reads. The attacher's account id never survives."""
    src = body.get("attachedSourcesMap") if isinstance(body, dict) else None
    out: dict[str, list] = {}
    if isinstance(src, dict):
        for url, entries in src.items():
            rebuilt = []
            for entry in entries if isinstance(entries, list) else []:
                persons = []
                for p in (entry.get("persons") if isinstance(entry, dict) else None) or []:
                    if isinstance(p, dict):
                        persons.append({
                            "entityId": _rewrite_id_segment(p.get("entityId"), allowed, counts),
                            "tags": p.get("tags") if isinstance(p.get("tags"), list) else [],
                        })
                rebuilt.append({"persons": persons})
            out[url] = rebuilt
    return {"attachedSourcesMap": out}


# --------------------------------------------------------------------------
# `filter` — record-mode transform
# --------------------------------------------------------------------------


def filter_exchange(
    method: str, url: str, status: int, body: str, *, floor: int, allowed: frozenset[str]
) -> dict[str, Any]:
    """Transform one upstream body. Returns `{"action": "store", "group",
    "body", "rewrites"}` or `{"action": "withhold", "reason"}`. A withheld body
    reaches the engine for that call but is never written."""
    group = classify(method, url)
    if group is None:
        return {"action": "withhold", "reason": "endpoint-not-allowlisted"}
    counts: dict[str, int] = {}
    ok = 200 <= status < 300
    if group in ("wiki", "fs-places"):
        return {"action": "store", "group": group, "body": body, "rewrites": counts}
    if group in TREE_GROUPS:
        if not ok:
            return {"action": "store", "group": group, "body": "", "rewrites": counts}
        parsed = json.loads(body)
        rebuilt = _rebuild_match(parsed) if group == "fs-match" else _rebuild_attachments(parsed, allowed, counts)
        text = rewrite_text_ids(json.dumps(rebuilt, ensure_ascii=False), allowed, counts)
        return {"action": "store", "group": group, "body": text, "rewrites": counts}
    parsed = None
    if ok:
        try:
            parsed = json.loads(body)
        except ValueError:
            parsed = None
    if group == "fs-records" and ok:
        if parsed is None or any(y >= floor for y in fact_years(parsed)):
            return {"action": "withhold", "reason": "privacy-year-floor"}
    if group == "fs-search" and isinstance(parsed, dict) and isinstance(parsed.get("entries"), list):
        too_recent = (
            persona_entry_too_recent if _is_personas(url)
            else fulltext_entry_too_recent if _is_fulltext(url) else None
        )
        if too_recent is not None:
            kept = [e for e in parsed["entries"] if not too_recent(e, floor)]
            dropped = len(parsed["entries"]) - len(kept)
            if dropped:
                counts["year_floor_dropped"] = dropped
                parsed["entries"] = kept
            if _is_personas(url):
                for e in kept:
                    for h in (e.get("hints") or []) if isinstance(e, dict) else []:
                        if isinstance(h, dict) and "id" in h:
                            h["id"] = _rewrite_id_segment(h["id"], allowed, counts)
            body = json.dumps(parsed, ensure_ascii=False)
    body = rewrite_text_ids(body, allowed, counts)
    return {"action": "store", "group": group, "body": body, "rewrites": counts}


def _filter_main(argv: list[str]) -> int:
    floor = None
    allowed_file = None
    it = iter(argv)
    for a in it:
        if a == "--floor":
            floor = int(next(it))
        elif a == "--allowed-ids":
            allowed_file = next(it)
    if floor is None or allowed_file is None:
        print("filter: --floor and --allowed-ids are required", file=sys.stderr)
        return 2
    allowed = frozenset(json.loads(Path(allowed_file).read_text(encoding="utf-8")))
    envelope = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    out = filter_exchange(
        envelope["method"], envelope["url"], int(envelope["status"]), envelope["body"],
        floor=floor, allowed=allowed,
    )
    sys.stdout.buffer.write(json.dumps(out, ensure_ascii=False).encode("utf-8"))
    return 0


# --------------------------------------------------------------------------
# The allowed-id set (SF2)
# --------------------------------------------------------------------------


def tree_person_ids(tree: Any) -> set[str]:
    """Person ids a committed tree already publishes: `persons[].id` and the id
    segment of `persons[].ark`."""
    out: set[str] = set()
    for p in (tree.get("persons") if isinstance(tree, dict) else None) or []:
        if not isinstance(p, dict):
            continue
        if isinstance(p.get("id"), str):
            out.add(p["id"])
        ark = p.get("ark")
        if isinstance(ark, str):
            m = re.search(r"(" + _ID + r")$", ark)
            if m:
                out.add(m.group(1))
    return out


def run_tree_paths(run_path: Path, repo_root: Path, tests_root: Path | None = None) -> list[Path]:
    """A recorded run's committed trees: its fixture's starting tree and its own
    final tree."""
    slug = run_path.parent.name
    tests_root = tests_root or repo_root / "eval" / "tests" / "e2e"
    return [
        tests_root / slug / "starting-tree.gedcomx.json",
        run_path.with_name(f"{run_path.stem}.final-tree.gedcomx.json"),
    ]


def allowed_ids(tree_paths: list[Path]) -> list[str]:
    ids: set[str] = set()
    for p in tree_paths:
        try:
            ids |= tree_person_ids(json.loads(p.read_text(encoding="utf-8")))
        except (OSError, UnicodeDecodeError, ValueError):
            continue
    return sorted(ids)


def allowed_ids_sha256(ids: list[str]) -> str:
    return hashlib.sha256(("\n".join(sorted(ids)) + "\n").encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------
# `check` — the lint over stored cassettes
# --------------------------------------------------------------------------


Violation = tuple[str, str, str]  # (file, rule, detail)


def cassette_group(path: Path) -> str | None:
    stem = path.name[: -len(".jsonl")] if path.name.endswith(".jsonl") else None
    if stem is None:
        return None
    for g in GROUPS:
        if stem == g or re.fullmatch(re.escape(g) + r"\.[0-9a-f]", stem):
            return g
    return None


def _scan_ids(text: str, allowed: frozenset[str]) -> list[str]:
    bad = [m.group(2) for rx in (_TREE_ARK, _TREE_URL) for m in rx.finditer(text)]
    return [b for b in bad if not _allowed(b, allowed)]


def _keys_anywhere(node: Any, names: tuple[str, ...]) -> list[str]:
    found: list[str] = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k in names:
                found.append(k)
            found += _keys_anywhere(v, names)
    elif isinstance(node, list):
        for v in node:
            found += _keys_anywhere(v, names)
    return found


def _credential_violations(text: str) -> list[str]:
    from harness.redact import scan_for_credentials  # lazy: never in `filter`

    out = [f"credential pattern {label}" for label in scan_for_credentials(text)]
    if _AUTH_KEY.search(text):
        out.append("an Authorization key")
    for m in _BEARER.finditer(text):
        if m.group(1) != FAKE_TOKEN:
            out.append("a Bearer token value")
            break
    return out


def check_line(
    line: dict[str, Any], group: str, *, floor: int, allowed: frozenset[str]
) -> list[tuple[str, str]]:
    """(rule, detail) violations for one stored exchange."""
    out: list[tuple[str, str]] = []
    method, url = line.get("method"), line.get("url")
    if not isinstance(method, str) or not isinstance(url, str):
        return [("format", "line has no method/url")]
    if "request_headers" in line or "headers" in line:
        out.append(("format", "a cassette line stores request headers"))
    expected = f"{method} {url} {line.get('accept', '')} {line.get('body_sha256', '')}"
    if line.get("key") != expected:
        out.append(("format", "key is not METHOD URL ACCEPT BODY_SHA256"))
    got = classify(method, url)
    if got is None:
        out.append(("allowlist", f"{method} {url} is not an allowlisted endpoint"))
    elif got != group:
        out.append(("allowlist", f"{method} {url} belongs to {got}, not {group}"))
    body = line.get("body")
    if not isinstance(body, str):
        return out + [("format", "body is not a string")]
    status = line.get("status")
    ok = isinstance(status, int) and 200 <= status < 300
    parsed: Any = None
    try:
        parsed = json.loads(body) if body else None
    except ValueError:
        parsed = None
    if got == "fs-records" and ok and (parsed is None or any(y >= floor for y in fact_years(parsed))):
        out.append(("year-floor", f"record body carries a date >= {floor}"))
    if got == "fs-search" and isinstance(parsed, dict) and isinstance(parsed.get("entries"), list):
        test = persona_entry_too_recent if _is_personas(url) else (
            fulltext_entry_too_recent if _is_fulltext(url) else None)
        if test is not None:
            n = sum(1 for e in parsed["entries"] if test(e, floor))
            if n:
                out.append(("year-floor", f"{n} search entr{'y' if n == 1 else 'ies'} dated >= {floor} (or undatable fulltext)"))
        if _is_personas(url):
            for e in parsed["entries"]:
                for h in (e.get("hints") or []) if isinstance(e, dict) else []:
                    hid = h.get("id") if isinstance(h, dict) else None
                    m = re.search(r"(" + _ID + r")$", hid) if isinstance(hid, str) else None
                    if m and not _allowed(m.group(1), allowed):
                        out.append(("id-rewrite", f"hint id {m.group(1)} is outside the committed trees"))
    bad = _scan_ids(body, allowed)
    if bad:
        out.append(("id-rewrite", f"tree-person id(s) outside the committed trees: {sorted(set(bad))}"))
    if "contributorId" in _keys_anywhere(parsed, ("contributorId",)) or '"contributorId"' in body:
        out.append(("id-rewrite", "a contributorId (an FS account id) is stored"))
    if got == "fs-attachments" and body:
        left = sorted(set(_keys_anywhere(parsed, _ATTACHMENT_DROPPED)))
        if left:
            out.append(("id-rewrite", f"attachments body keeps {left}"))
        if isinstance(parsed, dict):
            for entries in (parsed.get("attachedSourcesMap") or {}).values():
                for entry in entries or []:
                    for p in (entry.get("persons") or []) if isinstance(entry, dict) else []:
                        eid = p.get("entityId") if isinstance(p, dict) else None
                        if isinstance(eid, str) and re.fullmatch(_ID, eid) and not _allowed(eid, allowed):
                            out.append(("id-rewrite", f"attachments entityId {eid} is outside the committed trees"))
    if got == "fs-match" and body:
        if not isinstance(parsed, dict) or set(parsed) - _MATCH_TOP or any(
            not isinstance(e, dict) or set(e) - _MATCH_ENTRY for e in parsed.get("entries") or []
        ):
            out.append(("id-rewrite", "match body is not {entries:[{id,score,confidence}],title,updated}"))
    return out


def _manifest_calls(manifest: dict) -> list[tuple[str, str, dict]]:
    out = []
    for run, entry in (manifest.get("runs") or {}).items():
        for idx, call in ((entry or {}).get("calls") or {}).items():
            out.append((run, idx, call if isinstance(call, dict) else {}))
    return out


def check(
    replay_dir: Path,
    repo_root: Path,
    *,
    tests_root: Path | None = None,
    bytes_cap: int = CASSETTE_BYTES_CAP,
    file_cap: int = FILE_BYTES_CAP,
    max_runs: int = MAX_RECORDED_RUNS,
) -> list[Violation]:
    """Every rule over a cassette folder (`manifest.json` + `cassettes/`).
    Returns violations as `(file, rule, detail)`; empty means clean."""
    out: list[Violation] = []
    cassettes = replay_dir / "cassettes"
    files = sorted(cassettes.glob("*")) if cassettes.is_dir() else []
    manifest_path = replay_dir / "manifest.json"
    if not manifest_path.exists():
        for f in files:
            out.append((str(f), "manifest", "a cassette file with no manifest.json"))
        return out
    mtext = manifest_path.read_text(encoding="utf-8")
    try:
        manifest = json.loads(mtext)
    except ValueError as exc:
        return [(str(manifest_path), "manifest", f"not JSON: {exc}")]
    for detail in _credential_violations(mtext):
        out.append((str(manifest_path), "credentials", detail))
    floor = manifest.get("privacy_year_floor")
    if not isinstance(floor, int):
        out.append((str(manifest_path), "year-floor", "privacy_year_floor is missing"))
        floor = 0
    runs = list((manifest.get("runs") or {}).keys())
    if len(runs) > max_runs:
        out.append((str(manifest_path), "size", f"{len(runs)} recorded runs, cap {max_runs}"))
    ids = allowed_ids([p for r in runs for p in run_tree_paths(repo_root / r, repo_root, tests_root)])
    if manifest.get("allowed_ids_sha256") != allowed_ids_sha256(ids):
        out.append((str(manifest_path), "id-rewrite",
                    "allowed_ids_sha256 does not match the committed trees of the recorded runs — re-record"))
    allowed = frozenset(ids)

    referenced: set[str] = set()
    for run, idx, call in _manifest_calls(manifest):
        if call.get("status") == "recorded":
            referenced.update(k for k in call.get("keys") or [] if isinstance(k, str))
    stored: dict[str, str] = {}
    total = 0
    for f in files:
        group = cassette_group(f)
        if group is None:
            out.append((str(f), "format", "not a <group>.jsonl or <group>.<hex>.jsonl cassette"))
            continue
        size = f.stat().st_size
        total += size
        if size > file_cap:
            out.append((str(f), "size", f"{size:,} bytes, file cap {file_cap:,}"))
        text = f.read_text(encoding="utf-8")
        prev = None
        for n, raw in enumerate(text.splitlines(), 1):
            where = f"{f}:{n}"
            for detail in _credential_violations(raw):
                out.append((where, "credentials", detail))
            try:
                line = json.loads(raw)
            except ValueError:
                out.append((where, "format", "not a JSON line"))
                continue
            if not isinstance(line, dict):
                out.append((where, "format", "not a JSON object"))
                continue
            key = line.get("key")
            if isinstance(key, str):
                if key in stored:
                    out.append((where, "format", f"duplicate key (also in {stored[key]})"))
                stored[key] = group
                if prev is not None and key < prev:
                    out.append((where, "format", "lines are not sorted by key"))
                prev = key
            for rule, detail in check_line(line, group, floor=floor, allowed=allowed):
                out.append((where, rule, detail))
            if isinstance(key, str) and group != "fs-places" and key not in referenced:
                out.append((where, "manifest", "orphan line: no recorded call names this key"))
    if total > bytes_cap:
        out.append((str(cassettes), "size", f"{total:,} cassette bytes, cap {bytes_cap:,}"))
    for run, idx, call in _manifest_calls(manifest):
        if call.get("status") == "recorded":
            for k in call.get("keys") or []:
                if k not in stored:
                    out.append((str(manifest_path), "manifest", f"{run}#{idx} names a key no cassette holds: {k}"))
    return out


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv and argv[0] == "filter":
        return _filter_main(argv[1:])
    print("usage: replay_privacy.py filter --floor <year> --allowed-ids <file>  (stdin: envelope JSON)",
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
