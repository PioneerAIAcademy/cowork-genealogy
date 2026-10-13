"""U19's alarm definitions (apps/server/proto/alarms.json), offline.

The file is what a FamilySearch engineer ports, and what ``rehearse.py`` applies. Its log
alarms are CloudWatch TERM patterns over lines that carry a syslog prefix before the JSON,
and each carries the lines it must and must not match. CloudWatch's tokenizer is not
documented closely enough to say whether an unquoted term matches a whole word or any
substring, so every sample is evaluated under BOTH readings and must agree under each;
``rehearse.py alarms --test-filters`` asks CloudWatch itself.

The samples are tied to the code: each worker sample's ``ev`` and keys are those of a real
``log(ev=...)`` call in the worker, and the web sample is the web tier's own format string,
so a renamed field or event reds this file instead of silently blinding an alarm.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path

import pytest

from proto import turn
from proto.worker import options

PROTO = Path(__file__).resolve().parents[1] / "proto"
ENGINE_SRC = Path(__file__).resolve().parents[3] / "packages" / "engine" / "mcp-server" / "src"
DOC = json.loads((PROTO / "alarms.json").read_text(encoding="utf-8"))
ALARMS = {a["name"]: a for a in DOC["alarms"]}
LOG_ALARMS = [a for a in DOC["alarms"] if a["kind"] == "log"]
PAGING = {"dlq_depth", "message_age", "reauth", "spend_cap", "long_agent"}


# -- a CloudWatch term-pattern evaluator, under both readings of an unquoted term -----

_TERM = re.compile(r'(-?)("(?:[^"\\]|\\.)*"|\S+)')


def matches(pattern: str, line: str, *, substring: bool) -> bool:
    """Every term present and every ``-term`` absent; a quoted term is a substring, an
    unquoted one a whole word (``substring=False``) or any substring (``True``)."""
    words = set(re.findall(r"[A-Za-z0-9_]+", line))
    for neg, raw in _TERM.findall(pattern):
        quoted = raw.startswith('"')
        term = raw[1:-1].replace('\\"', '"') if quoted else raw
        found = term in line if (quoted or substring) else term in words
        if found == bool(neg):
            return False
    return True


def test_the_evaluator_reads_both_readings():
    assert matches("spend_cap", '{"ev":"start","spend_cap_usd":35}', substring=True)
    assert not matches("spend_cap", '{"ev":"start","spend_cap_usd":35}', substring=False)
    assert matches('"result=refused" -x', "ev=grant_refresh result=refused", substring=False)
    assert not matches("a -b", "a b", substring=False)


# -- the file -------------------------------------------------------------------


def test_the_six_alarms_and_only_no_progress_is_held():
    assert set(ALARMS) == PAGING | {"no_progress"}
    assert {n for n, a in ALARMS.items() if a["page"] is True} == PAGING
    assert ALARMS["no_progress"]["page"] is False, "U24 question 3: no_progress must not page yet"


def test_every_alarm_is_complete():
    for a in DOC["alarms"]:
        for key in ("namespace", "metric", "statistic", "period_s", "evaluation_periods", "threshold", "comparison",
                    "treat_missing", "description", "trip"):
            assert a.get(key) not in (None, ""), (a["name"], key)
        if a["kind"] == "sqs":
            assert a["queue"] in ("worker", "dlq") and a["namespace"] == "AWS/SQS", a["name"]
        else:
            assert a["filters"] and all(f["tier"] in ("web", "worker", "tools") for f in a["filters"]), a["name"]
            assert a["samples"]["match"] and a["samples"]["no_match"], a["name"]


def test_message_age_sits_above_the_longest_legitimate_run():
    """Until U26 bounds a run, a message stays in flight up to VisibilityTimeout."""
    config = (PROTO / "eb-worker" / ".ebextensions" / "01-sqsd.config").read_text(encoding="utf-8")
    visibility = int(re.search(r'VisibilityTimeout:\s*"(\d+)"', config).group(1))
    assert ALARMS["message_age"]["threshold"] > visibility


@pytest.mark.parametrize("substring", [False, True], ids=["whole-word", "substring"])
@pytest.mark.parametrize("alarm", LOG_ALARMS, ids=lambda a: a["name"])
def test_every_sample_matches_as_labelled(alarm, substring):
    patterns = [f["pattern"] for f in alarm["filters"]]
    for line in alarm["samples"]["match"]:
        assert any(matches(p, line, substring=substring) for p in patterns), (alarm["name"], line)
    for line in alarm["samples"]["no_match"]:
        hit = [p for p in patterns if matches(p, line, substring=substring)]
        assert not hit, (alarm["name"], hit, line)


# -- the samples are the code's lines ----------------------------------------------


def _log_sites() -> dict[str, list[tuple[set[str], bool]]]:
    """``ev`` -> [(keyword names, has a ** spread)] for every log(ev="...") call."""
    sites: dict[str, list[tuple[set[str], bool]]] = {}
    for path in (PROTO / "worker" / "worker.py", PROTO / "worker" / "options.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not (isinstance(node, ast.Call) and getattr(node.func, "id", None) == "log"):
                continue
            kw = {k.arg: k.value for k in node.keywords}
            ev = kw.get("ev")
            if isinstance(ev, ast.Constant) and isinstance(ev.value, str):
                spread = any(k.arg is None for k in node.keywords)
                sites.setdefault(ev.value, []).append(({k for k in kw if k}, spread))
    return sites


SITES = _log_sites()


def _sample_lines():
    for a in LOG_ALARMS:
        for label in ("match", "no_match"):
            for line in a["samples"][label]:
                yield a["name"], line


@pytest.mark.parametrize(("name", "line"), list(_sample_lines()))
def test_each_sample_is_a_line_the_code_writes(name, line):
    prefix, _, body = line.partition(": ")
    assert re.fullmatch(r"\w{3} \d\d \d\d:\d\d:\d\d \S+ web\[\d+\]", prefix), f"no syslog prefix: {line}"
    if body.startswith("{"):
        fields = json.loads(body)
        assert body == json.dumps(fields, separators=(",", ":")), "not the worker's own serialisation"
        ev = fields["ev"]
        assert ev in SITES, f"{name}: no log(ev={ev!r}) call in the worker"
        keys = set(fields)
        if any(spread for _, spread in SITES[ev]):
            # A ``**summary`` line: its keys come from a dict, so any one site may write them.
            assert any(keys <= names or spread for names, spread in SITES[ev]), (name, ev, keys)
        else:
            # Every site writing this event must write the fields the alarm's sample carries.
            missing = [sorted(keys - names) for names, _ in SITES[ev] if not keys <= names]
            assert not missing, (name, ev, missing)
    else:
        assert any(re.fullmatch(fmt, body) for fmt in WEB_LINES), f"{name}: no web log call writes {body!r}"


def _web_lines() -> list[str]:
    """A regex per ``log.<level>("ev=...", ...)`` call in the web tier, as its own handler
    formats it (``web.app``'s formatter, so a changed prefix reds the samples)."""
    import logging
    import sys

    sys.path.insert(0, str(PROTO))
    from web import app

    formatter = app.log.handlers[0].formatter
    out = []
    source = (PROTO / "web" / "app.py").read_text(encoding="utf-8")
    for level, fmt in re.findall(r'log\.(info|warning|error)\("(ev=[^"]+)"', source):
        record = logging.LogRecord("proto.web", getattr(logging, level.upper()), "", 0, "\x00", (), None)
        prefix = formatter.format(record).split("\x00")[0]
        body = re.escape(fmt).replace("%s", r"\S+").replace("%d", r"-?\d+")
        out.append(re.escape(prefix) + body)
    return out


WEB_LINES = _web_lines()


def test_the_web_tier_logs_the_refused_result_the_reauth_filter_names():
    web = (PROTO / "web" / "app.py").read_text(encoding="utf-8")
    assert 'return "refused"' in web and 'log.info("ev=grant_refresh user_id=%s result=%s age_s=%d"' in web


# -- the reauth hook's two mirrors ----------------------------------------------------


def test_the_worker_reauth_pattern_is_the_drivers():
    """The worker image does not ship turn.py, so the pattern is copied; it must not drift."""
    assert options.REAUTH_ENTRY.pattern == turn.REAUTH_ENTRY.pattern
    assert options.REAUTH_ENTRY.flags == turn.REAUTH_ENTRY.flags


# Tools whose code reaches the token but whose result is no FamilySearch answer: login
# prints the sign-in instruction itself, research_log_append echoes text it was given.
FS_TOOLS_EXEMPT = {"login", "research_log_append"}
_IMPORT = re.compile(r"""(?:from|import)\s*\(?\s*['"](\.{1,2}/[^'"]+)['"]""")
_NAME = re.compile(r"""^\s*name:\s*['"]([a-z_]+)['"]""", re.M)


def _tools_reaching_the_token() -> set[str]:
    def deps(f: Path) -> set[Path]:
        out = set()
        for m in _IMPORT.finditer(f.read_text(encoding="utf-8")):
            t = (f.parent / m.group(1)).resolve()
            for cand in (t.with_suffix(".ts"), Path(str(t).removesuffix(".js") + ".ts"), t / "index.ts"):
                if cand.exists():
                    out.add(cand)
                    break
        return out

    graph = {f.resolve(): deps(f) for f in ENGINE_SRC.rglob("*.ts")}
    target = (ENGINE_SRC / "auth" / "refresh.ts").resolve()
    memo: dict[Path, bool] = {}

    def reaches(f: Path, seen: frozenset = frozenset()) -> bool:
        if f == target:
            return True
        if f in memo:
            return memo[f]
        if f in seen:
            return False
        memo[f] = any(reaches(d, seen | {f}) for d in graph.get(f, ()))
        return memo[f]

    names = set()
    for f in (ENGINE_SRC / "tools").glob("*.ts"):
        if reaches(f.resolve()):
            names.update(_NAME.findall(f.read_text(encoding="utf-8"))[:1])
    return names


def test_the_reauth_hook_covers_exactly_the_tools_that_reach_the_token():
    reaching = _tools_reaching_the_token()
    assert len(reaching) > 10, "the import scan found almost nothing: it no longer reads the engine"
    assert FS_TOOLS_EXEMPT <= reaching, FS_TOOLS_EXEMPT - reaching
    assert options.FS_TOOLS == reaching - FS_TOOLS_EXEMPT, {
        "missing": sorted(reaching - FS_TOOLS_EXEMPT - options.FS_TOOLS),
        "extra": sorted(options.FS_TOOLS - (reaching - FS_TOOLS_EXEMPT)),
    }
