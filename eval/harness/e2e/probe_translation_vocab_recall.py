"""Cold-recall probe: do the bundled vocabulary tables earn their place?

WHY THIS EXISTS
    The `translation` skill ships 49 reference rows in
    `references/vocabulary-and-record-structures.md`: 22 common genealogy
    vocabulary terms, 16 Latin church-register abbreviations, and 11 German
    abbreviations. Issue #2259 would move them to the FamilySearch wiki under
    ADR-0012. Issue #2543 asks a prior question: does the production model
    already carry this vocabulary cold? If yes, the right action is deletion,
    not migration.

    This script answers that by presenting each row to the model in isolation
    — one row per API call, no skill context, no reference file, no sibling
    rows — and recording the verbatim answer. Three independent trials per row
    (147 calls total) allow the 3-of-3 pre-registered decision rule to be
    applied.

WHAT IT ANSWERS
    Per section (vocabulary / Latin abbreviations / German abbreviations):
      - How many rows does the model expand correctly on all 3 trials?
      - How many trials produce a plausible-wrong expansion vs a refusal?
    The write-up at docs/translation-vocabulary-recall-probe.md applies the
    pre-registered decision rule and records who graded each row.

    The denominator is 48 rows / 144 trials. `d. / des` (German genitive,
    not an abbreviation) is excluded from the tally; its 3 trials are run
    and reported separately. `SS.` and `par.` each carry two expansions and
    are carried only if the model produces both.

    Cold means cold: no SKILL.md, no reference file, no sibling rows in the
    same prompt. Each trial is one independent API call, not a sample in one
    conversation. Temperature: not pinned (the Agent SDK exposes no
    temperature for the model under test). Model: claude-sonnet-4-6 (the
    unit harness DEFAULT_MODEL and what the committed run logs record).

USAGE
    Needs ANTHROPIC_API_KEY (the harness reads eval/.env, which the worktree
    hook links in). From eval/harness/:
        uv run python -m e2e.probe_translation_vocab_recall
        uv run python -m e2e.probe_translation_vocab_recall --dry-run
        uv run python -m e2e.probe_translation_vocab_recall --row-index 5
        uv run python -m e2e.probe_translation_vocab_recall --model claude-sonnet-4-6

    Writes eval/harness/e2e/probe_translation_vocab_recall_raw.json with all
    147 verbatim answers. Dev probe — not shipped, not part of the test suite.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
import time
from pathlib import Path
from typing import Any

import anthropic

REPO_ROOT = Path(__file__).resolve().parents[3]
VOCAB_FILE = (
    REPO_ROOT
    / "packages"
    / "engine"
    / "plugin"
    / "skills"
    / "translation"
    / "references"
    / "vocabulary-and-record-structures.md"
)
OUTPUT_FILE = Path(__file__).parent / "probe_translation_vocab_recall_raw.json"

MODEL = "claude-sonnet-4-6"
TRIALS_PER_ROW = 3
MAX_TOKENS = 512

# Sections in the order they appear in the reference file.
_SECTION_HEADERS = {
    "## Common Genealogy Vocabulary": "vocabulary",
    "## Latin Abbreviations in Church Registers": "latin_abbreviations",
    "## German Abbreviations": "german_abbreviations",
}

# Rows with special grading rules (matched by term string, exact).
_EXCLUDE_FROM_TALLY = {"d. / des"}   # German genitive, not an abbreviation
_DUAL_EXPANSION = {"SS.", "par."}    # must produce both expansions to be carried


def _parse_vocab_file() -> list[dict[str, Any]]:
    """Parse the three table sections from VOCAB_FILE.

    Returns a list of row dicts, one per table row, in file order.
    Stops collecting when it hits any ## heading not in _SECTION_HEADERS
    (i.e. the Record Structure Templates section).
    """
    text = VOCAB_FILE.read_text(encoding="utf-8")
    rows: list[dict[str, Any]] = []
    current_section: str | None = None
    row_index = 0

    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("##"):
            if stripped in _SECTION_HEADERS:
                current_section = _SECTION_HEADERS[stripped]
            else:
                current_section = None  # stop collecting on unknown heading
            continue

        if current_section is None:
            continue

        if "|" not in line:
            continue
        cells = [c.strip() for c in line.split("|")]
        cells = [c for c in cells if c]
        if not cells or cells[0].startswith("-") or cells[0] in (
            "Term", "Abbreviation"
        ):
            continue

        if current_section == "vocabulary":
            if len(cells) < 3:
                continue
            term, language, meaning = cells[0], cells[1], cells[2]
            rows.append({
                "section": current_section,
                "row_index": row_index,
                "term": term,
                "language": language,
                "full_form": None,
                "expected_meaning": meaning,
                "special_rule": (
                    "exclude_from_tally" if term in _EXCLUDE_FROM_TALLY
                    else "dual_expansion" if term in _DUAL_EXPANSION
                    else None
                ),
            })
            row_index += 1
        else:
            if len(cells) < 3:
                continue
            abbrev, full_form, meaning = cells[0], cells[1], cells[2]
            rows.append({
                "section": current_section,
                "row_index": row_index,
                "term": abbrev,
                "language": None,
                "full_form": full_form,
                "expected_meaning": meaning,
                "special_rule": (
                    "exclude_from_tally" if abbrev in _EXCLUDE_FROM_TALLY
                    else "dual_expansion" if abbrev in _DUAL_EXPANSION
                    else None
                ),
            })
            row_index += 1

    return rows


def _build_prompt(row: dict[str, Any]) -> str:
    """Return the cold-recall prompt for one row.

    No system prompt is used. No sibling rows. No reference file. The
    acknowledgement that some abbreviations have more than one expansion
    is included in all prompts so that dual-expansion rows (SS., par.)
    get a fair shot at showing the model knows both forms.
    """
    term = row["term"]
    if row["section"] == "vocabulary":
        language = row["language"]
        return (
            f'What is the meaning of the genealogy term "{term}" in {language}?\n'
            "Give the English translation or explanation only. "
            "Some terms have more than one standard meaning — include all that apply."
        )
    elif row["section"] == "latin_abbreviations":
        return (
            f'In Latin church registers, what does the abbreviation "{term}" stand for?\n'
            "Give all possible full Latin forms and their English meanings — "
            "some abbreviations have more than one standard expansion."
        )
    else:
        return (
            f'In German genealogy records and church registers, what does the abbreviation "{term}" stand for?\n'
            "Give all possible full German forms and their English meanings — "
            "some abbreviations have more than one standard expansion."
        )


def _make_client() -> anthropic.Anthropic:
    # Reuse the harness auth path (eval/.env -> ANTHROPIC_API_KEY) when available.
    # max_retries lets the SDK ride out transient overloaded_error / 429s.
    try:
        from harness.auth import resolve_auth

        auth = resolve_auth()
        if auth.api_key:
            return anthropic.Anthropic(api_key=auth.api_key, max_retries=6)
    except Exception:  # noqa: BLE001 — fall back to the SDK's own env lookup
        pass
    return anthropic.Anthropic(max_retries=6)


def main(argv: list[str] | None = None) -> int:
    # Windows console defaults to cp1252 and dies on the non-ASCII characters
    # that model responses for Latin/German terms routinely contain.
    # Guarded by tests/unit/test_encoding_lint.py.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="parse vocabulary and print all rows with prompts; make zero API calls",
    )
    ap.add_argument(
        "--row-index",
        type=int,
        default=None,
        metavar="N",
        help="run only row N (0-based), all 3 trials",
    )
    ap.add_argument(
        "--model",
        default=MODEL,
        help=f"override model (default: {MODEL})",
    )
    args = ap.parse_args(argv)

    rows = _parse_vocab_file()
    expected_total = 49
    if len(rows) != expected_total:
        print(
            f"ERROR: expected {expected_total} rows, got {len(rows)}. "
            "The vocabulary file may have changed.",
            file=sys.stderr,
        )
        return 2

    special = [r for r in rows if r["special_rule"] is not None]
    print(f"Parsed {len(rows)} rows ({len(special)} special):")
    for r in special:
        print(f"  [{r['section']}] {r['term']!r}  -> {r['special_rule']}")
    print()

    resolved_exclude = {r["term"] for r in rows if r["special_rule"] == "exclude_from_tally"}
    resolved_dual = {r["term"] for r in rows if r["special_rule"] == "dual_expansion"}
    if resolved_exclude != _EXCLUDE_FROM_TALLY or resolved_dual != _DUAL_EXPANSION:
        print(
            f"ERROR: special-row mismatch.\n"
            f"  expected exclude_from_tally: {_EXCLUDE_FROM_TALLY!r}\n"
            f"  resolved: {resolved_exclude!r}\n"
            f"  expected dual_expansion: {_DUAL_EXPANSION!r}\n"
            f"  resolved: {resolved_dual!r}\n"
            "The vocabulary file may have been edited. "
            "Update _EXCLUDE_FROM_TALLY and _DUAL_EXPANSION to match.",
            file=sys.stderr,
        )
        return 2

    if args.dry_run:
        for r in rows:
            print(f"[{r['row_index']:02d}] {r['section']}  term={r['term']!r}")
            print(f"     prompt: {_build_prompt(r)!r}")
            print()
        return 0

    run_rows = rows
    if args.row_index is not None:
        matching = [r for r in rows if r["row_index"] == args.row_index]
        if not matching:
            print(f"ERROR: no row with index {args.row_index}", file=sys.stderr)
            return 2
        run_rows = matching

    out_file = OUTPUT_FILE
    if args.row_index is not None:
        out_file = OUTPUT_FILE.with_name(
            f"{OUTPUT_FILE.stem}_row{args.row_index}.json"
        )

    try:
        client = _make_client()
    except Exception as e:  # noqa: BLE001
        print(
            f"Could not build Anthropic client: {e}\n"
            "Set ANTHROPIC_API_KEY (or eval/.env).",
            file=sys.stderr,
        )
        return 2

    total = len(run_rows)
    trial_count = total * TRIALS_PER_ROW
    print(
        f"Running {trial_count} API calls "
        f"({total} rows × {TRIALS_PER_ROW} trials, model={args.model})\n"
    )

    trials: list[dict[str, Any]] = []
    start_ts = datetime.datetime.now(datetime.timezone.utc)
    t0 = time.monotonic()

    for row in run_rows:
        prompt = _build_prompt(row)
        for trial in range(1, TRIALS_PER_ROW + 1):
            try:
                resp = client.messages.create(
                    model=args.model,
                    max_tokens=MAX_TOKENS,
                    messages=[{"role": "user", "content": prompt}],
                )
                response_text = (
                    resp.content[0].text
                    if resp.content and hasattr(resp.content[0], "text")
                    else ""
                )
                stop_reason = resp.stop_reason or "unknown"
                input_tokens = resp.usage.input_tokens if resp.usage else 0
                output_tokens = resp.usage.output_tokens if resp.usage else 0
            except Exception as e:  # noqa: BLE001 — record error and keep going
                response_text = f"ERROR: {type(e).__name__}: {e}"
                stop_reason = "error"
                input_tokens = 0
                output_tokens = 0

            if stop_reason not in ("end_turn", "max_tokens", "error"):
                print(
                    f"  WARNING: unexpected stop_reason={stop_reason!r} "
                    f"for row {row['row_index']} trial {trial}",
                    file=sys.stderr,
                )

            print(
                f"[{row['row_index']+1:02d}/{len(rows)}] {row['term']!r:30s}"
                f"  trial {trial}/{TRIALS_PER_ROW}"
                f"  stop={stop_reason}"
                f"  out_tok={output_tokens}"
            )

            trials.append({
                "section": row["section"],
                "row_index": row["row_index"],
                "term": row["term"],
                "language": row["language"],
                "full_form": row["full_form"],
                "expected_meaning": row["expected_meaning"],
                "special_rule": row["special_rule"],
                "trial": trial,
                "prompt": prompt,
                "response": response_text,
                "stop_reason": stop_reason,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
            })

    duration = time.monotonic() - t0

    is_partial = args.row_index is not None
    meta: dict[str, Any] = {
        "script": "eval/harness/e2e/probe_translation_vocab_recall.py",
        "model": args.model,
        "temperature": None,
        "trials_per_row": TRIALS_PER_ROW,
        "total_rows": len(rows),
        "partial_run": is_partial,
        "vocab_file": str(
            VOCAB_FILE.relative_to(REPO_ROOT)
        ).replace("\\", "/"),
        "run_timestamp": start_ts.isoformat(),
        "run_duration_seconds": round(duration, 1),
    }
    if not is_partial:
        meta["primary_denominator_rows"] = 48
        meta["primary_denominator_trials"] = 144

    output: dict[str, Any] = {"meta": meta, "trials": trials}

    tmp = out_file.with_suffix(".tmp.json")
    tmp.write_text(
        json.dumps(output, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    # replace() succeeds on Windows when out_file already exists;
    # rename() would raise FileExistsError on a second run.
    tmp.replace(out_file)

    errors = [t for t in trials if t["stop_reason"] == "error"]
    print(f"\nWrote {len(trials)} trial records to {out_file}")
    if errors:
        print(
            f"ERROR: {len(errors)} of {len(trials)} trials failed and are "
            "not gradeable. Re-run them before grading.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
