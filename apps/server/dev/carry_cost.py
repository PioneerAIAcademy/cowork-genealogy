#!/usr/bin/env python3
"""#3512: what carrying the whole conversation into each new user message costs.

A hosted session resumes its SDK session for every message in a sitting, so every call in a
new message re-reads the conversation so far, until a compaction replaces it with a summary.
This prices that carry from alpha feedback bundles, against a fresh start that would carry
only the session's first-call context plus a short seed summary.

How each figure is measured:

- **Bundles** are read with `feedback_profile.load_bundles` (`eval/harness/e2e/`): each SDK
  session's rows merged across bundles by uuid (a later bundle repeats an earlier one's), the
  other sessions a bundle ships under `_feedback/sessions/<sid>/`, a log cut to its newest rows
  (`_truncation_note`), and each agent run's longest transcript.
- **A hosted session is a project** (`project_folder_path` in the bundles' `feedback.json`).
  Its SDK sessions (a resume can start a new one) share one fresh-start baseline: the
  project's earliest main-thread call. Left out, and named: a project whose log was truncated;
  one missing an agent run, either a transcript the bundle dropped or an agent launch no
  transcript answers (`build_profile`'s `missing_agent_transcripts`); and one whose first SDK
  session does not open with a person prompt (`parentUuid` null).
- **Calls** are main-thread assistant rows in timestamp order, one per message id (its last
  entry), `<synthetic>` API-error placeholders skipped. A call's context is its input +
  cache-write + cache-read tokens.
- **A user message** is a `user` row a person sent. The text rule: the row has text, and it is
  not a tool result, `isMeta`, a compaction summary or an interrupt marker. In a log that
  records `promptSource`, the row must also be marked "sdk"; rows the mark and the text rule
  read differently, either way, are counted and printed. A message counts only if a call
  follows it. A "Yes." answering the hand-back line (`app.agent.hand_back`) is the runner's
  auto-continue or the Continue button, not a new request, so it is folded into the message
  before it; the figure without folding is printed too. As in the runner, the text a hand-back
  would end is cleared at each prompt, interrupt and API error, so only a "Yes." right after a
  turn that ended on the hand-back line is folded.
- **Excess:** for each user message, its first call's context minus (baseline + seed), floored
  at 0. The message's calls carry it from its first call until a compaction (`isCompactSummary`,
  or a "This session is being continued" prompt), which resets the carried context, and no
  call carries more than it holds beyond the fresh start. A compaction before the first call
  changes nothing: the first call's context already reflects it. The project's first message
  is the fresh start, so its excess is 0 by construction.
- **Price,** two ways, at `spend.rates_for` the call's model (`PRICE_PER_MTOK` for one it does
  not know). That is the 5-minute-TTL table, the one the alpha writes at, so a call after a
  pause of over 5 minutes already pays for the rewrite in its cache-write tokens.
  *Blended:* the excess at the rate the call paid per context token. *Positional:* the excess
  as the span right after the fresh-start prefix, at cache-read where the call read that span,
  cache-write where it rewrote it, input beyond.
- **Share,** two ways: over the project's whole cost (main thread, inline sidechains and every
  agent run, each call priced in full), and over its main-thread cost. It is reported at seeds
  of 2,000, 5,000 and 10,000 tokens (`SEEDS`), over the projects with at least 3 user messages
  (`--min-messages`), against a bar of 10% of cost (`BAR`).

    cd apps/server && uv run python dev/carry_cost.py path/to/feedback-*.zip
    cd apps/server && uv run python dev/carry_cost.py <bundles...> --explain <project or bundle>

Arguments are zips, unpacked bundles, or folders of unpacked bundles.
"""

from __future__ import annotations

import argparse
import json
import sys
from contextlib import ExitStack
from dataclasses import dataclass, field
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

from app.agent.hand_back import AUTO_CONTINUE_TEXT, ends_with_hand_back  # noqa: E402
from app.agent.spend import TOKEN_CLASSES, rates_for, usage_tokens  # noqa: E402

_HARNESS = str(SERVER_DIR.parents[1] / "eval" / "harness")
sys.path.insert(0, _HARNESS)
try:
    from e2e.feedback_profile import (  # noqa: E402
        COMPACTION_PREFIX,
        _is_api_error,
        build_profile,
        load_bundles,
        parse_when,
        resolve_inputs,
    )
finally:
    # Out again at once: `eval/harness/tests` is a regular package, and on the path it
    # would shadow `apps/server/tests` for every later `from tests... import`.
    sys.path.remove(_HARNESS)

SEEDS = (2_000, 5_000, 10_000)
BAR = 0.10


@dataclass
class Call:
    model: str | None
    tokens: tuple  # TOKEN_CLASSES order: input, cache_write, cache_read, output

    @property
    def context(self) -> int:
        return self.tokens[0] + self.tokens[1] + self.tokens[2]

    def cost(self) -> float:
        rates = rates_for(self.model)
        return sum(t / 1_000_000 * rates[name] for name, t in zip(TOKEN_CLASSES, self.tokens))

    def carry_cost(self, excess: int, fresh: int, positional: bool) -> float:
        """What carrying `excess` tokens past a `fresh`-token prefix cost on this call."""
        excess = min(excess, self.context - fresh)  # never more than the call holds
        if excess <= 0:
            return 0.0
        rates = rates_for(self.model)
        if not positional:
            paid = sum(t * rates[name] for name, t in zip(TOKEN_CLASSES[:3], self.tokens[:3]))
            return excess * paid / self.context / 1_000_000
        read, write = self.tokens[2], self.tokens[1]
        lo, hi = fresh, fresh + excess
        in_read = max(0, min(hi, read) - lo)
        in_write = max(0, min(hi, read + write) - max(lo, read))
        rest = excess - in_read - in_write
        return (in_read * rates["cache_read"] + in_write * rates["cache_write"]
                + rest * rates["input"]) / 1_000_000


@dataclass
class Message:
    when: str
    first_context: int | None = None
    carrying: list[Call] = field(default_factory=list)
    after_compaction: int = 0
    folded: int = 0

    def excess(self, fresh: int) -> int:
        return max(0, (self.first_context or 0) - fresh)

    def cost(self, fresh: int, positional: bool) -> float:
        return sum(c.carry_cost(self.excess(fresh), fresh, positional) for c in self.carrying)


@dataclass
class Project:
    name: str
    bundles: list[str]
    sessions: list[str]
    excluded: str | None = None
    baseline: int = 0
    messages: dict[bool, list[Message]] = field(default_factory=dict)  # by fold
    main_calls: list[Call] = field(default_factory=list)
    other_calls: list[Call] = field(default_factory=list)
    compactions: int = 0
    disagree: int = 0  # user rows the "sdk" mark and the text rule read differently

    def cost(self, main_only: bool = False) -> float:
        calls = self.main_calls if main_only else self.main_calls + self.other_calls
        return sum(c.cost() for c in calls)

    def excess_cost(self, seed: int, positional: bool, fold: bool = True) -> float:
        return sum(m.cost(self.baseline + seed, positional) for m in self.messages[fold])


def _text(row: dict) -> str | None:
    """A user row's text, or None for a tool result or a row with no text."""
    content = (row.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        blocks = [b for b in content if isinstance(b, dict)]
        if any(b.get("type") == "tool_result" for b in blocks):
            return None
        return "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text")
    return None


def _is_compaction(row: dict) -> bool:
    text = _text(row) if row.get("type") == "user" else None
    return bool(row.get("isCompactSummary")) or bool(text and text.startswith(COMPACTION_PREFIX))


def _by_text(row: dict) -> bool:
    """The text rule: a `user` row with text that is not a tool result, `isMeta`, a compaction
    summary or an interrupt marker."""
    if row.get("type") != "user" or row.get("isMeta") or _is_compaction(row):
        return False
    text = (_text(row) or "").strip()
    return bool(text) and not text.startswith("[Request interrupted")


def _sdk_marked(rows: list[dict]) -> bool:
    """Whether the log records `promptSource` on its user rows."""
    return any(r.get("type") == "user" and r.get("promptSource") for r in rows)


def _is_person(row: dict, sdk_marked: bool) -> bool:
    """The text rule, and the "sdk" mark too in a log that records one."""
    return _by_text(row) and (not sdk_marked or row.get("promptSource") == "sdk")


def _assistant_text(row: dict) -> str:
    content = (row.get("message") or {}).get("content")
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content
                         if isinstance(b, dict) and b.get("type") == "text")
    return content if isinstance(content, str) else ""


def _ordered(rows) -> list[dict]:
    """Rows in timestamp order; a row with no readable timestamp is dropped."""
    timed = [(t, i, r) for i, r in enumerate(rows) if (t := parse_when(r.get("timestamp"))) is not None]
    return [r for _t, _i, r in sorted(timed, key=lambda e: (e[0], e[1]))]


def _calls(rows: list[dict]) -> dict[str, Call]:
    """Each assistant message id's call from its LAST entry in `rows`' order."""
    calls = {}
    for row in rows:
        message = row.get("message") or {}
        if row.get("type") == "assistant" and message.get("id") and message.get("usage") \
                and not _is_api_error(row):
            calls[message["id"]] = Call(message.get("model"), usage_tokens(message["usage"]))
    return calls


def _walk(rows: list[dict], fold: bool) -> tuple[list[Message], list[Call], int, int]:
    """One SDK session's user messages (with the calls that carry each), calls, compactions,
    and how many user rows the "sdk" mark and the text rule read differently, either way."""
    final = _calls(rows)
    sdk_marked = _sdk_marked(rows)
    disagree = sum(1 for r in rows if r.get("type") == "user"
                   and (r.get("promptSource") == "sdk") != _by_text(r)) if sdk_marked else 0
    messages: list[Message] = []
    calls: list[Call] = []
    seen: set[str] = set()
    compactions = 0
    current: Message | None = None
    carrying = False
    # The text a hand-back would end, as the runner keeps it: cleared at each new prompt,
    # interrupt and API error, so only the turn's own last text can be answered by "Yes.".
    last_text = ""
    for row in rows:
        if _is_person(row, sdk_marked):
            text = (_text(row) or "").strip()
            folding = fold and current is not None and text == AUTO_CONTINUE_TEXT \
                and ends_with_hand_back(last_text)
            last_text = ""
            if folding:
                current.folded += 1
                continue
            current = Message(str(row.get("timestamp", ""))[:19])
            messages.append(current)
            carrying = False
        elif _is_compaction(row):
            compactions += 1
            carrying = False
        elif _is_api_error(row) or (row.get("type") == "user" and (_text(row) or "").strip()
                                    .startswith("[Request interrupted")):
            last_text = ""
        elif row.get("type") == "assistant":
            last_text = _assistant_text(row) or last_text
            mid = (row.get("message") or {}).get("id")
            if not mid or mid in seen or mid not in final:
                continue
            seen.add(mid)
            call = final[mid]
            calls.append(call)
            if current is None:
                continue
            if current.first_context is None:
                current.first_context = call.context
                carrying = True
            if carrying:
                current.carrying.append(call)
            else:
                current.after_compaction += 1
    return [m for m in messages if m.first_context is not None], calls, compactions, disagree


def _projects_of(bundles: list[tuple[str, Path]]) -> dict[str, str]:
    """Bundle name -> its project, from `feedback.json` (the bundle's own name if absent)."""
    out = {}
    for name, path in bundles:
        project = None
        try:
            meta = json.loads((path / "_feedback" / "feedback.json").read_text(encoding="utf-8"))
            project = meta.get("project_folder_path") if isinstance(meta, dict) else None
        except (OSError, ValueError):
            pass
        out[name] = project if isinstance(project, str) and project else name
    return out


def analyze(bundles: list[tuple[str, Path]]) -> list[Project]:
    corpus = load_bundles(bundles)
    # Dropped transcripts AND agent launches no transcript answers, as the profile counts them.
    missing = {s["session"]: s["missing_agent_transcripts"] for s in build_profile(corpus)["sessions"]}
    project_of_bundle = _projects_of(bundles)
    by_project: dict[str, Project] = {}
    for sid, names in corpus["session_bundles"].items():
        project = project_of_bundle[sorted(names)[0]]
        p = by_project.setdefault(project, Project(project, [], []))
        p.sessions.append(sid)
        p.bundles = sorted(set(p.bundles) | set(names))
    project_of_sid = {sid: p.name for p in by_project.values() for sid in p.sessions}

    for p in by_project.values():
        threads = {sid: _ordered(corpus["sessions"][sid].values()) for sid in p.sessions}
        main = {sid: [r for r in rows if not r.get("isSidechain")] for sid, rows in threads.items()}
        if any(sid in corpus["truncated"] for sid in p.sessions):
            p.excluded = "log truncated"
        elif any(missing.get(sid) for sid in p.sessions):
            p.excluded = "agent transcripts missing"
        first_sid = min((sid for sid in p.sessions if main[sid]),
                        key=lambda sid: parse_when(main[sid][0].get("timestamp")), default=None)
        opener = main[first_sid][0] if first_sid else None
        if p.excluded is None and (opener is None or opener.get("parentUuid") is not None
                                   or not _is_person(opener, _sdk_marked(main[first_sid]))):
            p.excluded = "does not open with a person prompt"
        for fold in (True, False):
            p.messages[fold] = []
        for sid in sorted(p.sessions, key=lambda s: parse_when(main[s][0].get("timestamp")) if main[s] else 0):
            for fold in (True, False):
                messages, calls, compactions, disagree = _walk(main[sid], fold)
                p.messages[fold] += messages
                if fold:
                    p.main_calls += calls
                    p.compactions += compactions
                    p.disagree += disagree
            sidechain = [r for r in threads[sid] if r.get("isSidechain")]
            p.other_calls += _calls(sidechain).values()
        if p.main_calls:  # sessions were walked in start order, so this is the first call
            p.baseline = p.main_calls[0].context
    for agent in corpus["agents"].values():
        p = by_project.get(project_of_sid.get(agent.get("session"), ""))
        if p is not None:
            p.other_calls += _calls(agent["rows"]).values()
    return sorted(by_project.values(), key=lambda p: p.name)


def _money(x: float) -> str:
    return f"${x:,.2f}"


def _pct(part: float, whole: float) -> str:
    return f"{100 * part / whole:.1f}%" if whole else "-"


def report(projects: list[Project], min_messages: int, bundles: int) -> int:
    kept = [p for p in projects if p.excluded is None]
    qualified = [p for p in kept if len(p.messages[True]) >= min_messages]
    print(f"{bundles} bundles hold {len(projects)} hosted sessions (projects); "
          f"{len(projects) - len(kept)} left out; {len(qualified)} of the remaining {len(kept)} have "
          f">= {min_messages} user messages.")
    for p in projects:
        if p.excluded:
            print(f"  left out: {p.name} ({p.excluded}; bundles {', '.join(p.bundles)})")
    disagree = sum(p.disagree for p in projects)
    if disagree:
        print(f"  {disagree} user rows read differently by the \"sdk\" mark and the text rule:"
              " check them before trusting the message counts.")
    if not qualified:
        print("No hosted session qualifies.")
        return 1
    seed = SEEDS[1]
    header = ["project", "bundles", "SDK sessions", "user msgs", "Yes. folded", "calls",
              "compactions", "cost", "main cost", f"excess@{seed // 1000}k", f"share@{seed // 1000}k"]
    body = [[p.name, len(p.bundles), len(p.sessions), len(p.messages[True]),
             sum(m.folded for m in p.messages[True]), len(p.main_calls), p.compactions,
             _money(p.cost()), _money(p.cost(main_only=True)),
             _money(p.excess_cost(seed, positional=False)),
             _pct(p.excess_cost(seed, positional=False), p.cost())] for p in qualified]
    widths = [max(len(str(r[i])) for r in [header, *body]) for i in range(len(header))]
    for row in [header, *body]:
        print("  ".join(str(x).ljust(w) if i == 0 else str(x).rjust(w)
                        for i, (x, w) in enumerate(zip(row, widths))))

    total = sum(p.cost() for p in qualified)
    main_total = sum(p.cost(main_only=True) for p in qualified)
    print(f"\nOver {len(qualified)} hosted sessions costing {_money(total)} "
          f"(main thread {_money(main_total)}), the carried excess is:")
    print(f"  {'seed':>6}  {'blended':>9}  {'of cost':>7}  {'of main':>7}  "
          f"{'positional':>10}  {'of cost':>7}  {'of main':>7}")
    for s in SEEDS:
        blended = sum(p.excess_cost(s, positional=False) for p in qualified)
        positional = sum(p.excess_cost(s, positional=True) for p in qualified)
        print(f"  {s:>6,}  {_money(blended):>9}  {_pct(blended, total):>7}  {_pct(blended, main_total):>7}  "
              f"{_money(positional):>10}  {_pct(positional, total):>7}  {_pct(positional, main_total):>7}")
    unfolded = [p for p in kept if len(p.messages[False]) >= min_messages]
    folded = sum(m.folded for p in kept for m in p.messages[True])
    if folded:
        u_total = sum(p.cost() for p in unfolded)
        u_excess = sum(p.excess_cost(seed, positional=False, fold=False) for p in unfolded)
        print(f"Without folding the {folded} hand-back \"Yes.\" rows: {len(unfolded)} sessions qualify "
              f"and the blended excess at {seed:,} is {_pct(u_excess, u_total)} of cost.")
    print(f"The bar is {100 * BAR:.0f}% of cost.")
    return 0


def explain(projects: list[Project], target: str, seed: int) -> int:
    matches = [p for p in projects if p.name == target or target in p.bundles]
    if not matches:
        print(f"no hosted session or bundle named {target!r}")
        return 1
    p = matches[0]
    fresh = p.baseline + seed
    print(f"{p.name}: bundles {', '.join(p.bundles)}; {len(p.sessions)} SDK sessions; "
          f"{'LEFT OUT: ' + p.excluded if p.excluded else 'kept'}")
    print(f"cost {_money(p.cost())} (main thread {_money(p.cost(main_only=True))}, "
          f"{len(p.other_calls)} sidechain and agent calls); baseline {p.baseline:,}; "
          f"fresh start with a {seed:,}-token seed = {fresh:,}; {p.compactions} compactions.")
    print("  #  sent                 first-call ctx   excess  carrying  after compaction  "
          "Yes. folded   blended  positional")
    for i, m in enumerate(p.messages[True], 1):
        print(f"  {i:<2} {m.when:<19}  {m.first_context or 0:>14,}  {m.excess(fresh):>7,}  "
              f"{len(m.carrying):>8}  {m.after_compaction:>16}  {m.folded:>11}  "
              f"{_money(m.cost(fresh, False)):>8}  {_money(m.cost(fresh, True)):>10}")
    print(f"  excess total: blended {_money(p.excess_cost(seed, False))}, "
          f"positional {_money(p.excess_cost(seed, True))}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("inputs", nargs="+", help="zips, unpacked bundles, or folders of bundles")
    ap.add_argument("--min-messages", type=int, default=3)
    ap.add_argument("--explain", help="one project (or a bundle in it): per-message breakdown")
    ap.add_argument("--seed", type=int, default=SEEDS[1], help="seed tokens for --explain")
    args = ap.parse_args(argv)
    with ExitStack() as stack:
        try:
            bundles = resolve_inputs(args.inputs, stack)
        except ValueError as exc:
            ap.error(str(exc))
        projects = analyze(bundles)
        if args.explain:
            return explain(projects, args.explain, args.seed)
        return report(projects, args.min_messages, len(bundles))


if __name__ == "__main__":
    sys.exit(main())
