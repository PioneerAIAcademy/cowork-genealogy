"""Do the four advisory return-fields fire, and does the agent act on them?

GitHub issue #3199 (split from #2479; the detector of closed #2067). Four
non-blocking advisories ride the engine's tool responses today — two from the
search tools, two in a `validation.warnings` list — each nudging the agent to
close a gap it left (a staged search never logged, a nil search never recorded,
sources with no assertions, logs with nothing persisted). None refuses anything.
Whether any should BECOME a refusal is the lead's call, and that call wants a
number first: how often does each note fire, and when it fires, does the agent
do the thing it asks?

This report answers that over the committed e2e corpus — no live run, no model,
no API spend, same posture as `nudge_report.py` and `ranked_read_report.py`. It
turns no advisory into a refusal; it only measures.

## The four fields and where each shows up

| field | emitted by | how it appears | shipped |
|---|---|---|---|
| `unloggedSearches` | the 3 search tools | top-level key of the decoded response | `a283c42c9` (PR #2064) |
| `nilSearchNeedsLog` | the 3 search tools | top-level key of the decoded response | `a283c42c9` |
| sources-without-assertions | `research_append`, `extraction_append` | a string in `validation.warnings` | `c8cc64250` (#1478) |
| log-without-persistence | `research_log_append` | a string in `validation.warnings` | `c8cc64250` |

## Four states

A call is sorted into exactly one of:

- **not-observable** — the call cannot show the field, independent of whether the
  field would have fired: the run's engine predates the shipping commit; or the
  response was not captured; or (validation fields only) the response was
  truncated before its `validation` block. This is a FOURTH state, not a form of
  "never held" — folding the two inflates the good-news number.
- **fired → acted** — the field appeared and a later call did what it asked.
- **fired → ignored** — the field appeared and nothing acted on it.
- **condition-never-held** — the call was observable and the field did not fire;
  the agent kept the invariant, so the nudge had no reason to.

not-observable + never-held + fired = every emitter call, and fired = acted +
ignored. The report prints that accounting split by `agent_type`, with run and
call denominators. Two asides sit alongside it: for `nilSearchNeedsLog`, how many
"ignored" calls were in fact logged later in the run (a batched log after the
next search, not neglect); and for `unloggedSearches`, the producer's "and N more"
tail — refs it summarised rather than listed, which acted/ignored cannot check
(the note always lists at least one ref, so the call's own verdict stands).

## Traps (each is a way to get a wrong number)

- **Decode, never substring-match** a `validation.warnings` note: the response
  arrives in two envelopes and a naive substring misses the escaped one. The two
  SEARCH notes survive truncation (they sit before `results`), so when a search
  response is cut mid-document a bare-key fallback on the raw text is valid —
  a validation note gets that fallback only when its marker survived the cut
  (its absence past a cut is not-observable, not never-held).
- **Tool names are prefixed** in the corpus (`mcp__genealogy__record_search`),
  never bare. Every comparison normalises through `bare_tool_name` first, or
  every detector silently returns zero.
- **`agent_type` present-and-None is the main thread (`<main>`); the key ABSENT
  is an older entry (`unknown`)** — never conflate them.
- **Skip `is_error: true` calls** on both the firing side and the acting side.
- **`research_log_append` / `research_append` / `extraction_append` args come in
  two shapes**: flat and batched (`ops: [...]`). Walk both.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Callable, NamedTuple

from e2e.response_summary import unwrap
from e2e.runlog_selection import (
    REPO_ROOT,
    add_since_arg,
    all_result_jsons,
    branch_scope_note,
    describe_window,
    filter_since,
    result_jsons_for,
    run_date,
)
from harness.context_policy import bare_tool_name

# The commit that first shipped each pair of notes, and the date it merged to
# main. A run whose engine predates the commit cannot show the note — observable
# is gated on the run CONTAINING the commit (via `git merge-base --is-ancestor`),
# falling back to the merge date when the run carries no usable `git_sha`.
SEARCH_SHIP_COMMIT = "a283c42c9"
SEARCH_SHIP_DATE = date(2026, 9, 1)
VALIDATION_SHIP_COMMIT = "c8cc64250"
VALIDATION_SHIP_DATE = date(2026, 8, 11)

# The three search tools (bare names). They emit both search advisories.
SEARCH_TOOLS = frozenset({"record_search", "fulltext_search", "external_links_search"})
# The two writer tools whose `ops[].section` lands sources / assertions.
SECTION_WRITERS = frozenset({"research_append", "extraction_append"})
LOG_APPEND = "research_log_append"

# Producer-verified marker substrings (NOT corpus-derived — sources-without-
# assertions never fires in the corpus, so only the producer can confirm the
# string): `sourcesWithoutAssertionsWarning` (research-append.ts) and
# `logWithoutPersistenceWarning` (research-log-append.ts), pinned by
# `test_validation_marker_is_what_the_producer_writes`.
SRC_NO_ASSERT_MARKER = "zero assertions drawn from them"
LOG_NO_PERSIST_MARKER = "logged with a positive outcome but no sources"

# A staged-results ref as it appears in an `unloggedSearches` note and as a
# `stagedResultsRef` on a later log append.
_STAGING_REF_RE = re.compile(r"results/\.staging/[^\s,\"]+?\.json")
# The producer's "…, and N more" tail (`formatUnloggedRefs`, results-staging.ts):
# the refs it summarised instead of listing, which `_acted_unlogged` cannot check.
_MORE_REFS_RE = re.compile(r"and (\d+) more")

# The four mutually-exclusive per-call states. (The summarised "N more" refs an
# `unloggedSearches` note omits are counted SEPARATELY on the row, not as a fifth
# state — the producer always lists at least one ref, so acted/ignored is always
# decidable on the listed ones.)
NOT_OBSERVABLE = "not_observable"
ACTED = "acted"
IGNORED = "ignored"
NEVER_HELD = "never_held"


# --- tool-call shape helpers ------------------------------------------------


def _bare(call: dict) -> str:
    return bare_tool_name(call.get("tool") or "")


def _is_error(call: dict) -> bool:
    return bool(call.get("is_error"))


def _as_dict(value: object) -> dict:
    """`value` if it is a dict, else `{}` — so a malformed `args`/`ops` entry
    (a string, a null, a list) is skipped rather than crashing the whole report
    on a `.get`. Nothing in the corpus carries one yet; this is a guard, not a
    fix for an observed shape."""
    return value if isinstance(value, dict) else {}


def agent_label(call: dict) -> str:
    """`<main>` for a present-but-None `agent_type`, `unknown` when the key is
    absent (older entries), else the subagent type verbatim. The two Nones are
    different facts and must not collapse to one label."""
    if "agent_type" not in call:
        return "unknown"
    return call.get("agent_type") or "<main>"


def writes_sections(call: dict) -> set[str]:
    """The `{sources, assertions}` subset a `research_append` / `extraction_append`
    call persists — reading BOTH the flat `section` and every `ops[].section`,
    since the batched shape is the dominant one. Empty for an error call, a
    different tool, or a non-sources/assertions section."""
    if _is_error(call) or _bare(call) not in SECTION_WRITERS:
        return set()
    args = _as_dict(call.get("args"))
    out: set[str] = set()
    ops = args.get("ops")
    if isinstance(ops, list):
        for op in ops:
            sec = _as_dict(op).get("section")
            if sec in ("sources", "assertions"):
                out.add(sec)
    else:
        sec = args.get("section")
        if sec in ("sources", "assertions"):
            out.add(sec)
    return out


def log_entries(call: dict) -> list[dict]:
    """Each logged search as `{outcome, stagedResultsRef}`, flattening the two
    `research_log_append` arg shapes (flat and `ops: [...]`)."""
    args = _as_dict(call.get("args"))
    ops = args.get("ops")
    if isinstance(ops, list):
        return [
            {"outcome": _as_dict(op).get("outcome"),
             "stagedResultsRef": _as_dict(op).get("stagedResultsRef")}
            for op in ops
        ]
    return [{"outcome": args.get("outcome"),
             "stagedResultsRef": args.get("stagedResultsRef")}]


def logged_refs(call: dict) -> set[str]:
    """Every truthy `stagedResultsRef` a log-append call names."""
    return {e["stagedResultsRef"] for e in log_entries(call) if e.get("stagedResultsRef")}


# --- observability ----------------------------------------------------------


class _GitProbe:
    """Cached `git` resolvability / ancestry probes, one per report run.

    Shelling once per (sha, commit) pair keeps the whole-corpus scan from
    re-forking git thousands of times. Never raises: a git that is absent or a
    repo that cannot answer makes every probe False, which the caller reads as
    "unresolvable" and routes to the captured_at fallback."""

    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self._cache: dict[tuple[str, ...], bool] = {}

    def _ok(self, args: list[str]) -> bool:
        key = tuple(args)
        if key in self._cache:
            return self._cache[key]
        try:
            res = subprocess.run(
                ["git", *args],
                cwd=self.repo_root,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            ok = res.returncode == 0
        except OSError:
            ok = False
        self._cache[key] = ok
        return ok

    def resolvable(self, sha: str) -> bool:
        return self._ok(["cat-file", "-e", f"{sha}^{{commit}}"])

    def contains(self, ship: str, sha: str) -> bool:
        """True when `ship` is an ancestor of `sha` — i.e. the run's engine
        contained the shipping commit."""
        return self._ok(["merge-base", "--is-ancestor", ship, sha])


def _captured_date(doc: dict, path: Path) -> date | None:
    """The run's date, from `captured_at` if present else the filename."""
    cap = doc.get("captured_at")
    if isinstance(cap, str):
        m = re.match(r"(\d{4}-\d{2}-\d{2})", cap)
        if m:
            try:
                return date.fromisoformat(m.group(1))
            except ValueError:
                pass
    return run_date(path)


def version_observable(doc: dict, path: Path, ship_commit: str, ship_date: date,
                       probe: _GitProbe) -> bool:
    """Did the run's engine contain the shipping commit?

    Resolvable sha -> ancestry is decisive. Absent OR unresolvable sha (≈30% of
    sha-bearing corpus runs cite branch/rebase-orphaned commits) -> fall back to
    `captured_at` vs the merge date. An unknown date assumes observable rather
    than over-excluding — the capture gate still filters a summary-less call."""
    sha = doc.get("git_sha")
    if isinstance(sha, str) and sha and probe.resolvable(sha):
        return probe.contains(ship_commit, sha)
    cap = _captured_date(doc, path)
    return cap is None or cap >= ship_date


# --- field specs ------------------------------------------------------------


class FieldSpec(NamedTuple):
    key: str                                   # report label
    emitters: frozenset[str]                   # bare tool names that emit it
    ship_commit: str
    ship_date: date
    needs_validation_key: bool                 # validation.warnings note?
    fired: Callable[[dict], tuple[bool, dict | None]]  # (fired?, decoded doc)
    acted: Callable[[list[dict], int, dict, dict | None], str]  # -> ACTED/IGNORED


def _fired_search_key(key: str) -> Callable[[dict], tuple[bool, dict | None]]:
    def fired(call: dict) -> tuple[bool, dict | None]:
        raw = call.get("response_summary") or ""
        doc = unwrap(raw)
        if isinstance(doc, dict):
            return key in doc, doc
        # Decode failed (truncated mid-document). The search notes sit before
        # `results` and survive truncation, so a bare-key check on the raw text
        # is a valid fallback for THESE two fields only.
        return key in raw, None
    return fired


def _fired_validation(marker: str) -> Callable[[dict], tuple[bool, dict | None]]:
    def fired(call: dict) -> tuple[bool, dict | None]:
        raw = call.get("response_summary") or ""
        doc = unwrap(raw)
        if not isinstance(doc, dict):
            return marker in raw, None
        val = doc.get("validation")
        warnings = val.get("warnings") if isinstance(val, dict) else None
        if not isinstance(warnings, list):
            return False, doc
        return any(isinstance(w, str) and marker in w for w in warnings), doc
    return fired


def _unlogged_note(fire_call: dict, doc: dict | None) -> str:
    """The `unloggedSearches` note text, from the decoded doc or (on a truncated
    decode) the raw summary."""
    if isinstance(doc, dict) and isinstance(doc.get("unloggedSearches"), str):
        return doc["unloggedSearches"]
    raw = fire_call.get("response_summary") or ""
    m = re.search(r"unloggedSearches\\?\"?\s*:\s*\\?\"(.*?)(?<!\\)\"", raw, re.S)
    return m.group(1) if m else raw


def _acted_unlogged(calls: list[dict], idx: int, fire_call: dict,
                    doc: dict | None) -> str:
    """A later successful `research_log_append` names one of the refs the note
    listed. The producer (`formatUnloggedRefs`) always lists at least one ref, so
    acted/ignored is always decidable; the summarised "N more" tail it may append
    is counted separately on the row, never used to classify the call."""
    refs = set(_STAGING_REF_RE.findall(_unlogged_note(fire_call, doc)))
    for later in calls[idx + 1:]:
        if _is_error(later) or _bare(later) != LOG_APPEND:
            continue
        if logged_refs(later) & refs:
            return ACTED
    return IGNORED


def _summarised_more(fire_call: dict, doc: dict | None) -> int:
    """The `N` in the note's "…, and N more" tail — refs the producer summarised
    rather than listed, which cannot be matched against a later `stagedResultsRef`.
    0 when the note listed every ref."""
    m = _MORE_REFS_RE.search(_unlogged_note(fire_call, doc))
    return int(m.group(1)) if m else 0


def _nil_logged_later(calls: list[dict], fire_idxs: list[int]) -> set[int]:
    """The nil fires that got their OWN negative log later in the run. Each
    qualifying log entry is credited to the most recent still-unlogged fire before
    it, so one entry covers one nil (never every earlier one) and an acted fire
    keeps the log that made it acted. `_acted_nil`'s before-the-next-search cutoff
    reads a batched "log after the next search" as ignored; this says how many
    ignored nils were logged at all."""
    fires = set(fire_idxs)
    pending: list[int] = []
    logged: set[int] = set()
    for i, call in enumerate(calls):
        if i in fires:
            pending.append(i)
            continue
        if _is_error(call) or _bare(call) != LOG_APPEND:
            continue
        for entry in log_entries(call):
            if pending and entry.get("outcome") == "negative" and not entry.get("stagedResultsRef"):
                logged.add(pending.pop())
    return logged


def _acted_nil(calls: list[dict], idx: int, fire_call: dict, doc: dict | None) -> str:
    """A successful `research_log_append` with a negative outcome and no
    `stagedResultsRef`, reached before the next search-tool call."""
    for later in calls[idx + 1:]:
        bare = _bare(later)
        if bare in SEARCH_TOOLS:
            return IGNORED
        if _is_error(later) or bare != LOG_APPEND:
            continue
        for entry in log_entries(later):
            if entry.get("outcome") == "negative" and not entry.get("stagedResultsRef"):
                return ACTED
    return IGNORED


def _acted_src_no_assert(calls: list[dict], idx: int, fire_call: dict,
                         doc: dict | None) -> str:
    """An assertions append before the next sources append."""
    for later in calls[idx + 1:]:
        secs = writes_sections(later)
        if "assertions" in secs:
            return ACTED
        if "sources" in secs:
            return IGNORED
    return IGNORED


def _acted_log_no_persist(calls: list[dict], idx: int, fire_call: dict,
                          doc: dict | None) -> str:
    """Any sources or assertions append before the next log append."""
    for later in calls[idx + 1:]:
        if not _is_error(later) and _bare(later) == LOG_APPEND:
            return IGNORED
        if writes_sections(later):
            return ACTED
    return IGNORED


FIELDS: list[FieldSpec] = [
    FieldSpec("unloggedSearches", SEARCH_TOOLS, SEARCH_SHIP_COMMIT, SEARCH_SHIP_DATE,
              False, _fired_search_key("unloggedSearches"), _acted_unlogged),
    FieldSpec("nilSearchNeedsLog", SEARCH_TOOLS, SEARCH_SHIP_COMMIT, SEARCH_SHIP_DATE,
              False, _fired_search_key("nilSearchNeedsLog"), _acted_nil),
    FieldSpec("sources-without-assertions", SECTION_WRITERS, VALIDATION_SHIP_COMMIT,
              VALIDATION_SHIP_DATE, True, _fired_validation(SRC_NO_ASSERT_MARKER),
              _acted_src_no_assert),
    FieldSpec("log-without-persistence", frozenset({LOG_APPEND}), VALIDATION_SHIP_COMMIT,
              VALIDATION_SHIP_DATE, True, _fired_validation(LOG_NO_PERSIST_MARKER),
              _acted_log_no_persist),
]


# --- per-call classification ------------------------------------------------


class CallRow(NamedTuple):
    run: str
    field: str
    agent: str
    state: str
    # Derived asides, populated only where they apply (defaults keep every other
    # row and the sha-ladder tests constructing rows unaffected):
    logged_later: bool = False   # a nil IGNORED call whose nil was logged later anyway
    summarised_more: int = 0     # an unloggedSearches note's unchecked "and N more" tail


def _capture_observable(call: dict, spec: FieldSpec) -> bool:
    """The call's response can show the field: summary present, and (validation
    fields) its `validation` block survived truncation."""
    raw = call.get("response_summary")
    if not raw:
        return False
    if spec.needs_validation_key:
        doc = unwrap(raw)
        if isinstance(doc, dict):
            return "validation" in doc
        return spec.fired(call)[0]
    return True


def classify_run(doc: dict, path: Path, probe: _GitProbe) -> list[CallRow]:
    """One CallRow per (emitter call, field) in the run. not-observable, fired
    (acted/ignored) and never-held partition every emitter call."""
    run = f"{path.parent.name}/{path.stem}"
    calls = doc.get("tool_calls") or []
    rows: list[CallRow] = []
    for spec in FIELDS:
        version_ok = version_observable(doc, path, spec.ship_commit, spec.ship_date, probe)
        fired_at: dict[int, int] = {}  # call index -> its row's position
        for i, call in enumerate(calls):
            if _is_error(call) or _bare(call) not in spec.emitters:
                continue
            agent = agent_label(call)
            if not version_ok or not _capture_observable(call, spec):
                rows.append(CallRow(run, spec.key, agent, NOT_OBSERVABLE))
                continue
            fired, decoded = spec.fired(call)
            if not fired:
                rows.append(CallRow(run, spec.key, agent, NEVER_HELD))
                continue
            fired_at[i] = len(rows)
            state = spec.acted(calls, i, call, decoded)
            more = _summarised_more(call, decoded) if spec.key == "unloggedSearches" else 0
            rows.append(CallRow(run, spec.key, agent, state, False, more))
        if spec.key == "nilSearchNeedsLog":
            for i in _nil_logged_later(calls, list(fired_at)):
                k = fired_at[i]
                if rows[k].state == IGNORED:
                    rows[k] = rows[k]._replace(logged_later=True)
    return rows


# --- denominators -----------------------------------------------------------


class SearchLogRatio(NamedTuple):
    run: str
    agent: str
    searches: int
    log_appends: int


def search_vs_log(doc: dict, path: Path) -> list[SearchLogRatio]:
    """Non-error search-tool calls vs non-error `research_log_append` calls, per
    run and agent. Works over pre-#2064 runs too, since it reads only tool names."""
    run = f"{path.parent.name}/{path.stem}"
    searches: Counter[str] = Counter()
    logs: Counter[str] = Counter()
    for call in doc.get("tool_calls") or []:
        if _is_error(call):
            continue
        bare = _bare(call)
        if bare in SEARCH_TOOLS:
            searches[agent_label(call)] += 1
        elif bare == LOG_APPEND:
            logs[agent_label(call)] += 1
    return [
        SearchLogRatio(run, agent, searches.get(agent, 0), logs.get(agent, 0))
        for agent in sorted(set(searches) | set(logs))
    ]


# --- scan + format ----------------------------------------------------------


class Scan(NamedTuple):
    rows: list[CallRow]
    ratios: list[SearchLogRatio]
    runs: int


def scan(paths: list[Path]) -> Scan:
    probe = _GitProbe(REPO_ROOT)
    rows: list[CallRow] = []
    ratios: list[SearchLogRatio] = []
    runs = 0
    for p in paths:
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        runs += 1
        rows.extend(classify_run(doc, p, probe))
        ratios.extend(search_vs_log(doc, p))
    return Scan(rows, ratios, runs)


_STATE_ORDER = [ACTED, IGNORED, NEVER_HELD, NOT_OBSERVABLE]
_STATE_LABEL = {
    ACTED: "fired → acted",
    IGNORED: "fired → ignored",
    NEVER_HELD: "condition-never-held",
    NOT_OBSERVABLE: "not-observable",
}


def _field_block(field: str, rows: list[CallRow]) -> list[str]:
    mine = [r for r in rows if r.field == field]
    calls = len(mine)
    runs_hit = len({r.run for r in mine})
    fired = sum(1 for r in mine if r.state in (ACTED, IGNORED))
    lines = [
        f"### {field}",
        f"  {calls} emitter call(s) across {runs_hit} run(s); fired on {fired}.",
    ]
    by_state = Counter(r.state for r in mine)
    for state in _STATE_ORDER:
        lines.append(f"    {by_state.get(state, 0):>5}  {_STATE_LABEL[state]}")
    # nilSearchNeedsLog: how many "ignored" calls were in fact logged later in the
    # run (a batched log after the next search). Without this the before-the-next-
    # search cutoff reads batched logging as neglect.
    if field == "nilSearchNeedsLog":
        later = sum(1 for r in mine if r.state == IGNORED and r.logged_later)
        ignored = by_state.get(IGNORED, 0)
        if ignored:
            lines.append(f"      of the {ignored} ignored, {later} were logged later in the run "
                         "(batched after the next search), not never")
    # unloggedSearches: the producer's "and N more" tail — refs it summarised
    # rather than listed, counted separately (issue #3199) since acted/ignored
    # above is decided on the listed refs only.
    if field == "unloggedSearches":
        notes = sum(1 for r in mine if r.summarised_more)
        refs = sum(r.summarised_more for r in mine)
        if notes:
            lines.append(f"      plus {refs} summarised ref(s) across {notes} fired note(s) not "
                         "checked (the producer's 'and N more' tail)")
    # Split by agent_type: the acted/ignored behaviour is the number the lead
    # decides on, and it differs between the main thread and each subagent.
    agents = sorted({r.agent for r in mine})
    if agents:
        lines.append("  by agent_type (acted / ignored / never-held / not-observable):")
        for agent in agents:
            counts = Counter(r.state for r in mine if r.agent == agent)
            lines.append(
                f"    {agent:<24} "
                + " / ".join(str(counts.get(s, 0)) for s in _STATE_ORDER)
            )
    return lines


def format_report(scanned: Scan) -> str:
    rows, ratios, runs = scanned
    lines = [
        f"Advisory return-fields over {runs} committed e2e run(s) (issue #3199).",
        "Partition per field: not-observable + condition-never-held + fired = "
        "emitter calls; fired = acted + ignored.",
        "",
    ]
    for spec in FIELDS:
        lines.extend(_field_block(spec.key, rows))
        lines.append("")

    lines.append("## Search calls vs research_log_append calls (all eras, split by agent_type)")
    agg_s: Counter[str] = Counter()
    agg_l: Counter[str] = Counter()
    for r in ratios:
        agg_s[r.agent] += r.searches
        agg_l[r.agent] += r.log_appends
    if not agg_s and not agg_l:
        lines.append("  (no search or log-append calls in the scanned runs)")
    else:
        for agent in sorted(set(agg_s) | set(agg_l)):
            lines.append(f"    {agent:<24} {agg_s.get(agent, 0):>5} searches   "
                         f"{agg_l.get(agent, 0):>5} log-appends")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(
        description="Do the four advisory return-fields fire, and does the agent "
        "act on them? Over committed e2e runs (issue #3199).",
    )
    parser.add_argument("--test", default=None, help="Only this fixture slug.")
    add_since_arg(parser)
    args = parser.parse_args(argv)

    all_paths = result_jsons_for(args.test) if args.test else all_result_jsons()
    cutoff = args.since
    paths = filter_since(all_paths, cutoff)
    if not paths:
        where = f" on/after {cutoff.isoformat()}" if (cutoff and all_paths) else ""
        print(f"No committed runs found{where}.", file=sys.stderr)
        print(branch_scope_note(), file=sys.stderr)
        return 1

    scanned = scan(paths)
    print(describe_window(cutoff, n_runs=len(paths), n_total=len(all_paths)))
    print(format_report(scanned))
    return 0


if __name__ == "__main__":
    sys.exit(main())
