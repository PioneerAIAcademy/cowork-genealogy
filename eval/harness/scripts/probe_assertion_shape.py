"""Misread probe for research_query's grouped `assertions` shape (#4412).

Does a model read a per-fact field as reliably from a grouped answer as from
the flat one it replaces? Both answers come from real recorded calls: each is
replayed over research.json rebuilt as of that call (`e2e.replay_sizes`), the
flat one by the BASE build (today's exact answer, key order included) and the
grouped one by the CANDIDATE build. The two are checked to hold the same
assertions before any model sees them.

For each page a fixed set of assertions is sampled — deep inside a group, a
different informant from the group's first fact, a missing record_persona_id —
and the model is asked, by assertion id, for information_quality,
record_basis, informant, informant_proximity and record_persona_id. The right
answer is read from the flat answer, so scoring is exact: the JSON value, or
ABSENT when the assertion has no such key.

Models are the assertion readers' own pins: claude-sonnet-5 (medium),
claude-sonnet-5-5 (medium), claude-haiku-5-5 (low). The ship rule, from the
plan: grouped ships iff, per model, its total misreads are <= flat's and no
fact misread grouped on record_persona_id was read right flat.

Costs money (Anthropic API, ANTHROPIC_API_KEY or eval/.env). `--dry-run`
builds the pages and questions and prints a size estimate with no model call.

    uv run python scripts/probe_assertion_shape.py --base-build <dir> --out <scratch.json> [--dry-run]

Exit codes: 0 grouped ships · 1 grouped does not ship · 2 usage/selection error ·
3 integrity error (the two shapes disagree, a model refused, malformed output).
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_DIR))

from e2e.replay_collapse import _flatten_items  # noqa: E402
from e2e.replay_sizes import (  # noqa: E402
    ENGINE_DIR, IntegrityError, UsageError, build_items, ensure_build_at, run_arms, select_runs,
)

FIELDS = ("information_quality", "record_basis", "informant", "informant_proximity", "record_persona_id")
ABSENT = "ABSENT"
MODELS = (("claude-sonnet-5", "medium"), ("claude-sonnet-5-5", "medium"), ("claude-haiku-5-5", "low"))
SHAPES = ("flat", "grouped")
PER_PAGE = 8
PER_RUN = 2

SYSTEM = (
    "You are reading the result of a research_query tool call from a genealogy research "
    "project. Answer every question from the result alone. For each assertion id and field, "
    "give the field's value as JSON (a string in quotes, null, a number), or ABSENT when "
    "that assertion has no such field."
)

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {
        "answers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "assertion_id": {"type": "string"},
                    "field": {"type": "string"},
                    "value": {"type": "string"},
                },
                "required": ["assertion_id", "field", "value"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["answers"],
    "additionalProperties": False,
}


# --------------------------------------------------------------------------
# Pure parts (unit-tested)
# --------------------------------------------------------------------------


def expected(assertion: dict[str, Any], field: str) -> str:
    """The right answer: the field's JSON value, or ABSENT."""
    return json.dumps(assertion[field], ensure_ascii=False) if field in assertion else ABSENT


def matches(want: str, got: str) -> bool:
    """`got` reads as `want`. A bare string without quotes counts as that string."""
    got = got.strip()
    if want == ABSENT:
        return got.upper() == ABSENT
    if got == want:
        return True
    try:
        return json.loads(got) == json.loads(want)
    except ValueError:
        return json.dumps(got, ensure_ascii=False) == want


def pick(flat: list[dict[str, Any]], grouped: list[Any], seed: str, n: int = PER_PAGE) -> list[str]:
    """Assertion ids to ask about: the hard cases first, then a stable sample."""
    hard: list[str] = []
    for g in grouped:
        if not isinstance(g, dict) or not isinstance(g.get("facts"), list):
            continue
        facts = [f for f in g["facts"] if isinstance(f, dict) and isinstance(f.get("id"), str)]
        if not facts:
            continue
        first = facts[0]
        for i, f in enumerate(facts):
            deep = i >= 2
            differs = f.get("informant") != first.get("informant")
            unpersona = "record_persona_id" not in g
            if deep or differs or unpersona:
                hard.append(f["id"])
    def stable(ids: list[str]) -> list[str]:
        return sorted(dict.fromkeys(ids), key=lambda i: hashlib.sha256(f"{seed}:{i}".encode()).hexdigest())

    hard = stable(hard)[: n - n // 4]
    ids = [a["id"] for a in flat if isinstance(a, dict) and isinstance(a.get("id"), str)]
    return (hard + [i for i in stable(ids) if i not in hard])[:n]


def score(page_flat: dict[str, dict[str, Any]], answers: list[dict[str, Any]], asked: list[str]) -> list[dict[str, Any]]:
    """One row per (assertion, field) asked; a missing answer is a misread."""
    got = {(a.get("assertion_id"), a.get("field")): str(a.get("value", "")) for a in answers if isinstance(a, dict)}
    rows = []
    for aid in asked:
        for field in FIELDS:
            want = expected(page_flat[aid], field)
            answer = got.get((aid, field))
            rows.append({"assertion_id": aid, "field": field, "want": want, "got": answer,
                         "ok": answer is not None and matches(want, answer)})
    return rows


def decide(results: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    """The plan's ship rule over every scored row: `(ships, reasons it does not)`."""
    reasons: list[str] = []
    for model, _ in MODELS:
        mine = [r for r in results if r["model"] == model]
        if not mine:
            continue
        miss = Counter(r["shape"] for r in mine if not r["ok"])
        if miss["grouped"] > miss["flat"]:
            reasons.append(f"{model}: grouped misreads {miss['grouped']} > flat {miss['flat']}")
        flat_ok = {(r["page"], r["assertion_id"]) for r in mine
                   if r["shape"] == "flat" and r["field"] == "record_persona_id" and r["ok"]}
        worse = sorted(f"{r['page']} {r['assertion_id']}" for r in mine
                       if r["shape"] == "grouped" and r["field"] == "record_persona_id" and not r["ok"]
                       and (r["page"], r["assertion_id"]) in flat_ok)
        if worse:
            reasons.append(f"{model}: record_persona_id misread grouped, right flat: {', '.join(worse[:5])}")
    return not reasons, reasons


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------


def _body(text: str) -> dict[str, Any]:
    try:
        body = json.loads(text)
    except ValueError as exc:
        raise IntegrityError(f"answer is not JSON: {text[:120]}") from exc
    if not isinstance(body, dict) or body.get("ok") is not True:
        raise IntegrityError(f"answer is not ok:true: {text[:120]}")
    return body


async def build_pages(base: Path, candidate: Path, n_pages: int) -> list[dict[str, Any]]:
    runs_logs, _ = select_runs(None, tracked_only=True)
    runs = []
    for path, log in runs_logs:
        run = build_items(path, log, {"research_query"}, Counter(), Counter(), frozenset({"assertions"}))
        if run and run.items:
            run.items = sorted(run.items, key=lambda i: -i.recorded_chars)[:PER_RUN]
            runs.append(run)
    rows, _ = await run_arms(runs, base, candidate, ("same", "same"))
    pages = []
    for row in sorted(rows, key=lambda r: -r.base.chars):
        if row.base.is_error or row.candidate.is_error:
            continue
        flat_body, grouped_body = _body(row.base.text), _body(row.candidate.text)
        flat = flat_body.get("items") or []
        grouped = grouped_body.get("items") or []
        if len(flat) < 4:
            continue
        where = f"{row.item.run}#{row.item.index}"
        if _flatten_items("assertions", grouped, row.item.args) != flat:
            raise IntegrityError(f"{where}: the grouped answer does not flatten to the flat one")
        if any(isinstance(g, dict) and "facts" in g for g in flat):
            raise IntegrityError(f"{where}: the base build already groups — pass a pre-#4412 --base-build")
        asked = pick(flat, grouped, where)
        pages.append({"page": where, "flat_text": row.base.text, "grouped_text": row.candidate.text,
                      "flat": {a["id"]: a for a in flat if isinstance(a, dict) and "id" in a}, "asked": asked})
        if len(pages) >= n_pages:
            break
    if len(pages) < n_pages:
        raise UsageError(f"only {len(pages)} usable assertion pages, wanted {n_pages}")
    return pages


def _prompt(text: str, asked: list[str]) -> str:
    qs = "\n".join(f"- {aid}: {', '.join(FIELDS)}" for aid in asked)
    return f"<tool_result>\n{text}\n</tool_result>\n\nFor each assertion id below, give each listed field:\n{qs}"


# --------------------------------------------------------------------------
# Model calls
# --------------------------------------------------------------------------


def ask(client: Any, model: str, effort: str, text: str, asked: list[str]) -> tuple[list[dict], Any]:
    import anthropic

    try:
        response = client.messages.create(
            model=model,
            max_tokens=16000,
            system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": ANSWER_SCHEMA}},
            messages=[{"role": "user", "content": _prompt(text, asked)}],
        )
    except anthropic.APIStatusError as exc:
        raise IntegrityError(f"{model}: API error {exc.status_code}: {exc.message}") from exc
    if response.stop_reason == "refusal":
        raise IntegrityError(f"{model}: refused ({getattr(response.stop_details, 'category', None)})")
    if response.stop_reason == "max_tokens":
        raise IntegrityError(f"{model}: hit max_tokens")
    out = next((b.text for b in response.content if b.type == "text"), None)
    if out is None:
        raise IntegrityError(f"{model}: no text block")
    return json.loads(out).get("answers") or [], response.usage


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--base", help="git ref of a pre-#4412 build (flat answers)")
    parser.add_argument("--base-build", type=Path, help="an already-built pre-#4412 build/ dir")
    parser.add_argument("--candidate-build", type=Path, default=ENGINE_DIR / "build")
    parser.add_argument("--pages", type=int, default=24)
    parser.add_argument("--out", type=Path, required=True, help="where to write every scored row (JSON)")
    parser.add_argument("--dry-run", action="store_true", help="build pages and questions; call no model")
    args = parser.parse_args(argv)
    try:
        if args.pages < 1:
            raise UsageError("--pages must be at least 1")
        if not (args.base or args.base_build):
            raise UsageError("pass --base <ref> or --base-build <dir>: the flat arm is a pre-#4412 build")
        base = args.base_build or ensure_build_at(args.base)
        pages = asyncio.run(build_pages(base, args.candidate_build, args.pages))
    except UsageError as exc:
        print(f"probe: {exc}", file=sys.stderr)
        return 2
    except IntegrityError as exc:
        print(f"probe: INTEGRITY ERROR — {exc}", file=sys.stderr)
        return 3

    chars = sum(len(p["flat_text"]) + len(p["grouped_text"]) for p in pages)
    questions = sum(len(p["asked"]) for p in pages) * len(FIELDS)
    print(f"{len(pages)} pages, {questions} questions per shape per model, "
          f"~{chars // 4:,} input tokens per model ({len(MODELS)} models, {len(MODELS) * len(pages) * 2} calls)")
    if args.dry_run:
        return 0

    import anthropic

    from harness.auth import _load_api_key

    client = anthropic.Anthropic(api_key=_load_api_key()) if _load_api_key() else anthropic.Anthropic()
    results: list[dict[str, Any]] = []
    usage: Counter = Counter()
    try:
        for model, effort in MODELS:
            for p in pages:
                for shape in SHAPES:
                    answers, u = ask(client, model, effort, p[f"{shape}_text"], p["asked"])
                    usage[(model, "in")] += u.input_tokens + (u.cache_read_input_tokens or 0) + (u.cache_creation_input_tokens or 0)
                    usage[(model, "out")] += u.output_tokens
                    for row in score(p["flat"], answers, p["asked"]):
                        results.append({"model": model, "effort": effort, "shape": shape, "page": p["page"], **row})
    except IntegrityError as exc:
        print(f"probe: INTEGRITY ERROR — {exc}", file=sys.stderr)
        return 3
    finally:
        args.out.write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")

    print(f"\n{'model':<20}{'shape':<9}" + "".join(f"{f[:14]:>16}" for f in FIELDS) + f"{'total':>8}")
    for model, _ in MODELS:
        for shape in SHAPES:
            mine = [r for r in results if r["model"] == model and r["shape"] == shape]
            miss = Counter(r["field"] for r in mine if not r["ok"])
            print(f"{model:<20}{shape:<9}" + "".join(f"{miss[f]:>16}" for f in FIELDS) + f"{sum(miss.values()):>8}")
    print("\nmisreads out of", questions, "answers per row; tokens:",
          ", ".join(f"{m} {usage[(m, 'in')]:,} in / {usage[(m, 'out')]:,} out" for m, _ in MODELS))
    ships, reasons = decide(results)
    print("\nGROUPED SHIPS" if ships else "\nGROUPED DOES NOT SHIP:\n  " + "\n  ".join(reasons))
    return 0 if ships else 1


if __name__ == "__main__":
    raise SystemExit(main())
