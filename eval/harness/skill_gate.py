"""Gate a candidate SKILL.md edit against its step-4 baseline, mock-backed.

Component **A** of the E->A->B gated skill-improvement loop
(`docs/plan/gated-skill-improvement-slice.md`). This is a
**measurement-and-surfacing tool, not an automated accept/reject oracle**:
given an n=1 non-deterministic judge, it reports per-dimension evidence and a
coarse advisory signal; a human decides and adopts.

What it does (`make gate-skill SKILL=<x> TEST=<mined-id>`):

1. Runs the **gate test set** = `{TEST}` (the mined motivating test) plus the
   skill's **holdout** tests against the **candidate** (your working-tree
   SKILL.md, edits applied), mock-backed (`run_one_test` serves every tool from
   `eval/fixtures/mcp/`).
2. Reads the **incumbent** scores for those same tests from the skill's most
   recent run-log — the pre-edit `make eval-skill` run you did at **step 4** (with
   human `.ann` corrections overlaid, so the incumbent side is ground truth).
3. Diffs per `(source, name)` and prints a per-dimension comparison + a
   **LOOKS GOOD / NEEDS YOUR EYES / INCONCLUSIVE** signal.

Why the baseline is the step-4 run, not a fresh incumbent re-run: at step 4 the
skill is still the incumbent and the mined test is already in the suite, so that
run-log *is* the pre-edit baseline — and it's human-annotated. The gate therefore
runs only ONE side (the candidate), needs no `git`, and stays small.

It writes **no** run-logs (drives `run_one_test` directly) and never mutates the
working tree. The only artifact is a `gate-report.md`, printed to stdout.

Design (plan §5, §6.3): credit the named fix only when the failure **reproduced
on the incumbent** (baseline scored 1/2) and then **passed on the candidate**
(scored 3). Holdout no-regression is a weak secondary check — a drop is flagged
for the human, never auto-rejected; generalization-by-inspection is the primary
guard.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from harness.auth import AuthConfig, AuthError, resolve_auth
from harness.loader import InvalidTestError, TestSpec, load_test
from harness.orchestrator import REPO_ROOT, OrchestratorPaths, run_one_test

_SCORE_LABEL = {3: "pass", 2: "partial", 1: "fail", None: "n/a"}


# --------------------------------------------------------------------------
# Pure comparison + signal logic (unit-tested in tests/unit/test_skill_gate.py)
# --------------------------------------------------------------------------


def scores_of(entry: dict[str, Any]) -> dict[tuple[str, str], int | None]:
    """Map (source, name) -> aggregated score for one candidate test entry.

    An aborted or judge-skipped entry has no aggregated_dimensions -> empty map.
    """
    dims = (entry.get("outcome_summary") or {}).get("aggregated_dimensions") or []
    return {(d.get("source", ""), d.get("name", "")): d.get("score") for d in dims}


@dataclass
class DimRow:
    source: str
    name: str
    incumbent: int | None
    candidate: int | None

    @property
    def regressed(self) -> bool:
        return (
            self.incumbent is not None
            and self.candidate is not None
            and self.candidate < self.incumbent
        )

    @property
    def reproduced_failure(self) -> bool:
        """The failure this dimension is meant to expose showed up on the
        un-edited incumbent (step-4 baseline) — the precondition for a fix."""
        return self.incumbent in (1, 2)

    @property
    def fixed(self) -> bool:
        return self.reproduced_failure and self.candidate == 3


def compare(
    incumbent_scores: dict[tuple[str, str], int | None],
    candidate_scores: dict[tuple[str, str], int | None],
) -> list[DimRow]:
    """Join incumbent (baseline) and candidate scores by (source, name)."""
    rows: list[DimRow] = []
    for key in sorted(set(incumbent_scores) | set(candidate_scores)):
        rows.append(
            DimRow(
                source=key[0],
                name=key[1],
                incumbent=incumbent_scores.get(key),
                candidate=candidate_scores.get(key),
            )
        )
    return rows


@dataclass
class GateSignal:
    verdict: str  # LOOKS GOOD | NEEDS YOUR EYES | INCONCLUSIVE
    reasons: list[str] = field(default_factory=list)


def compute_signal(
    mined_rows: list[DimRow],
    holdout_rows_by_test: dict[str, list[DimRow]],
    *,
    named_dimension: str | None = None,
) -> GateSignal:
    """Turn the per-dimension comparison into the coarse advisory verdict.

    - INCONCLUSIVE: the motivating failure did not reproduce on the incumbent
      (no target dimension scored 1/2) — nothing to credit a fix for.
    - LOOKS GOOD: a reproduced target dimension reached pass on the candidate and
      no compared dimension regressed.
    - NEEDS YOUR EYES: everything else (fix not observed, or a regression).
    """
    if named_dimension is not None:
        targets = [r for r in mined_rows if r.name == named_dimension]
        if not targets:
            return GateSignal(
                "NEEDS YOUR EYES",
                [f"named dimension '{named_dimension}' is not scored on the mined "
                 f"test — check the name."],
            )
    else:
        targets = [r for r in mined_rows if r.reproduced_failure]

    reproduced = [r for r in targets if r.reproduced_failure]
    if not reproduced:
        which = f"'{named_dimension}'" if named_dimension else "any target dimension"
        return GateSignal(
            "INCONCLUSIVE",
            [f"the failure did not reproduce on the incumbent ({which} scored "
             f"pass at step 4) — likely jitter or a too-weak test; re-mine or "
             f"drop it."],
        )

    reasons: list[str] = []
    fixed = [r for r in reproduced if r.fixed]
    if fixed:
        reasons.append(
            "named fix landed: "
            + ", ".join(f"{r.name} {_SCORE_LABEL[r.incumbent]}->pass" for r in fixed)
        )
    else:
        reasons.append(
            "named fix did NOT land: "
            + ", ".join(
                f"{r.name} still {_SCORE_LABEL[r.candidate]}" for r in reproduced
            )
        )

    regressions = [
        r
        for rows in ([mined_rows] + list(holdout_rows_by_test.values()))
        for r in rows
        if r.regressed
    ]
    for r in regressions:
        reasons.append(
            f"regression: {r.name} {_SCORE_LABEL[r.incumbent]}->"
            f"{_SCORE_LABEL[r.candidate]}"
        )

    if fixed and not regressions:
        return GateSignal("LOOKS GOOD", reasons)
    return GateSignal("NEEDS YOUR EYES", reasons)


# --------------------------------------------------------------------------
# Test selection + the step-4 incumbent baseline
# --------------------------------------------------------------------------


def _iter_test_files(skill_tests_dir: Path):
    if not skill_tests_dir.exists():
        return
    for path in sorted(skill_tests_dir.glob("*.json")):
        if path.name == "rubric.md":
            continue
        yield path


def holdout_test_paths(skill_tests_dir: Path) -> list[Path]:
    """Test JSONs under a skill whose `test.holdout` is true (raw scan)."""
    out: list[Path] = []
    for path in _iter_test_files(skill_tests_dir):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        if (raw.get("test") or {}).get("holdout") is True:
            out.append(path)
    return out


def find_test_path_by_id(test_id: str, skill_tests_dir: Path) -> Path | None:
    for path in _iter_test_files(skill_tests_dir):
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        if (raw.get("test") or {}).get("id") == test_id:
            return path
    return None


def _latest_runlog(skill_runlog_dir: Path) -> Path | None:
    """Newest run-log (by envelope timestamp) for a skill, ignoring scratch and
    `.ann` siblings — the pre-edit step-4 baseline."""
    latest_ts, latest = "", None
    if not skill_runlog_dir.exists():
        return None
    for jf in sorted(skill_runlog_dir.glob("*.json")):
        if jf.name.endswith(".ann.json") or jf.name.startswith("scratch_"):
            continue
        try:
            env = json.loads(jf.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        ts = env.get("timestamp", "")
        if ts >= latest_ts:
            latest_ts, latest = ts, jf
    return latest


@dataclass
class Baseline:
    scores: dict[str, dict[tuple[str, str], int | None]]  # test_id -> (s,n) -> score
    path: Path
    skill_md: str | None  # the SKILL.md the baseline ran against (from the snapshot)


def incumbent_baseline(skill: str, runlogs_root: Path) -> Baseline | None:
    """Per-test incumbent scores from the skill's most recent run-log, with human
    `.ann` corrections overlaid where present (human score wins over the judge's).

    Returns None when the skill has no run-log yet — the caller tells the user to
    run `make eval-skill SKILL=<x>` (step 4) first.
    """
    log_path = _latest_runlog(runlogs_root / "unit" / skill)
    if log_path is None:
        return None
    try:
        env = json.loads(log_path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return None

    corrections: dict[tuple[str, str, str], int | None] = {}
    ann_path = Path(str(log_path)[:-len(".json")] + ".ann.json")
    if ann_path.exists():
        try:
            ann = json.loads(ann_path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            ann = {}
        for c in ann.get("corrections") or []:
            corrections[(c.get("test_id"), c.get("dimension_source"),
                         c.get("dimension_name"))] = c.get("corrected_score")

    scores: dict[str, dict[tuple[str, str], int | None]] = {}
    for t in env.get("tests") or []:
        tid = t.get("test_id")
        dims: dict[tuple[str, str], int | None] = {}
        for d in (t.get("outcome_summary") or {}).get("aggregated_dimensions") or []:
            src, name = d.get("source", ""), d.get("name", "")
            ck = (tid, src, name)
            dims[(src, name)] = corrections[ck] if ck in corrections else d.get("score")
        scores[tid] = dims

    skill_md = (env.get("snapshot") or {}).get(
        f"packages/engine/plugin/skills/{skill}/SKILL.md"
    )
    return Baseline(scores=scores, path=log_path, skill_md=skill_md)


# --------------------------------------------------------------------------
# Running the candidate + rendering
# --------------------------------------------------------------------------


def run_candidate(
    specs: list[TestSpec], *, auth: AuthConfig, timestamp: str
) -> dict[str, dict[str, Any]]:
    """Run every spec against the working-tree (candidate) skill, mock-backed,
    sequentially. Returns {test_id: entry}. `run_one_test` writes no run-log."""
    paths = OrchestratorPaths()  # defaults -> the working-tree skill
    out: dict[str, dict[str, Any]] = {}
    for i, spec in enumerate(specs, 1):
        print(f"  [candidate {i}/{len(specs)}] {spec.id} ...", flush=True)
        entry = run_one_test(spec, auth=auth, paths=paths, timestamp=timestamp)
        out[spec.id] = entry
        print(f"      -> {entry.get('outcome', '?')}", flush=True)
    return out


def _fmt(s: int | None) -> str:
    return {3: "3", 2: "2", 1: "1", None: "-"}.get(s, "?")


def _render_table(title: str, rows: list[DimRow]) -> list[str]:
    lines = [f"### {title}", ""]
    if not rows:
        lines += ["_(no comparable dimensions — the candidate test aborted or the "
                  "baseline lacks this test)_", ""]
        return lines
    lines += ["| dimension | incumbent (step 4) | candidate | note |",
              "|---|:--:|:--:|---|"]
    for r in rows:
        if r.fixed:
            note = "fixed ⬆"
        elif r.regressed:
            note = "regressed ⬇"
        elif r.incumbent == r.candidate:
            note = "="
        else:
            note = "changed"
        name = r.name + ("" if r.source == "base" else f" ({r.source})")
        lines.append(f"| {name} | {_fmt(r.incumbent)} | {_fmt(r.candidate)} | {note} |")
    lines.append("")
    return lines


def render_report(
    *,
    skill: str,
    mined_test_id: str,
    holdout_ids: list[str],
    mined_rows: list[DimRow],
    holdout_rows_by_test: dict[str, list[DimRow]],
    signal: GateSignal,
    baseline: Baseline,
    no_edit: bool,
    judge_model: str,
    total_cost: float,
) -> str:
    out = [f"# Gate report — skill `{skill}`", ""]
    out.append(f"- **Signal: {signal.verdict}**")
    out += [f"  - {r}" for r in signal.reasons]
    out.append(f"- Incumbent baseline: `{baseline.path.name}` (your step-4 run, "
               f"human-corrected)  ·  Candidate: working tree"
               + ("  ·  ⚠ SKILL.md matches the baseline — did you apply the edits?"
                  if no_edit else ""))
    out.append(f"- Motivating test: `{mined_test_id}`  ·  Holdout: "
               f"{', '.join(f'`{h}`' for h in holdout_ids) or '(none)'}")
    out.append(f"- Judge: `{judge_model}`  ·  ~${total_cost:.2f} this round "
               f"(candidate side only)")
    out += ["", "Scores: 3 = pass, 2 = partial, 1 = fail, - = n/a. Advisory only — "
            "a person adopts (plan §5, §6.3).", ""]
    out += _render_table(f"Motivating test `{mined_test_id}`", mined_rows)
    if holdout_ids:
        for hid in holdout_ids:
            out += _render_table(f"Holdout `{hid}`", holdout_rows_by_test.get(hid, []))
    else:
        out += ["### Holdout", "",
                "_No holdout tests for this skill — the no-regression check is "
                "**inert**. Designate 2-3 via the CRUD UI Hold-out toggle "
                "(plan §6.5)._", ""]
    return "\n".join(out)


def _build_is_stale() -> bool:
    """Mirror of run_tests._check_mcp_build_fresh: a stale build makes LIVE_TOOLS
    fail inside the run and looks like a skill failure."""
    src = REPO_ROOT / "packages" / "engine" / "mcp-server" / "src"
    build = REPO_ROOT / "packages" / "engine" / "mcp-server" / "build"
    if not src.exists():
        return False
    for ts in src.rglob("*.ts"):
        if ts.name.endswith(".d.ts"):
            continue
        js = build / ts.relative_to(src).with_suffix(".js")
        if not js.exists() or js.stat().st_mtime < ts.stat().st_mtime:
            return True
    return False


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="skill_gate.py",
        description="Gate a candidate SKILL.md edit against its step-4 baseline on "
        "the mined test + holdout set. Advisory; writes no run-logs and never "
        "mutates the working tree.",
    )
    p.add_argument("--skill", required=True, help="Skill under test.")
    p.add_argument("--test", required=True, dest="test_id",
                   help="The mined motivating test id (ut_...).")
    p.add_argument("--dimension", default=None,
                   help="Name the failing dimension the edit targets (optional; "
                   "default: infer from which dimensions reproduced a failure on "
                   "the incumbent).")
    return p


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = _build_parser().parse_args(sys.argv[1:] if argv is None else argv)

    if _build_is_stale():
        print("ERROR: mcp-server build is stale or missing. Run `make "
              "engine-build` (or `make gate-skill`, which rebuilds first).",
              file=sys.stderr)
        return 2

    tests_dir = REPO_ROOT / "eval/tests/unit"
    skill_tests_dir = tests_dir / args.skill

    mined_path = find_test_path_by_id(args.test_id, skill_tests_dir)
    if mined_path is None:
        print(f"ERROR: no test '{args.test_id}' under eval/tests/unit/{args.skill}/.",
              file=sys.stderr)
        return 2
    holdout_paths = [p for p in holdout_test_paths(skill_tests_dir) if p != mined_path]
    try:
        mined_spec = load_test(mined_path)
        holdout_specs = [load_test(p) for p in holdout_paths]
    except InvalidTestError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2

    baseline = incumbent_baseline(args.skill, REPO_ROOT / "eval/runlogs")
    if baseline is None:
        print(f"ERROR: no run-log for '{args.skill}' — run `make eval-skill "
              f"SKILL={args.skill}` first (step 4) so the gate has a pre-edit "
              f"baseline.", file=sys.stderr)
        return 2
    if mined_spec.id not in baseline.scores:
        print(f"ERROR: the latest run-log ({baseline.path.name}) doesn't include "
              f"'{mined_spec.id}'. Add the mined test, then run `make eval-skill "
              f"SKILL={args.skill}` (step 4) so the gate has an incumbent baseline "
              f"for it.", file=sys.stderr)
        return 2

    missing_holdout = [s.id for s in holdout_specs if s.id not in baseline.scores]
    if missing_holdout:
        print(f"  NOTE: {len(missing_holdout)} holdout test(s) are absent from the "
              f"baseline run-log and will be skipped: {', '.join(missing_holdout)}. "
              f"Re-run `make eval-skill SKILL={args.skill}` to include them.",
              file=sys.stderr)
    holdout_specs = [s for s in holdout_specs if s.id in baseline.scores]
    if not holdout_specs:
        print("  NOTE: no holdout tests in the baseline — the no-regression check "
              "is inert (plan §6.5).", file=sys.stderr)

    try:
        auth = resolve_auth()
    except AuthError as e:
        print(f"Auth error: {e}", file=sys.stderr)
        return 1
    print(f"Auth: {auth.detail}")
    if auth.api_key is None:
        print("  WARNING: no ANTHROPIC_API_KEY — the judge will fail and every "
              "dimension will be ungraded. Set it before gating.", file=sys.stderr)

    # A byte-equal SKILL.md between the baseline snapshot and the working tree
    # means no candidate edit is applied — surface it, don't fail.
    working_md = (REPO_ROOT / f"packages/engine/plugin/skills/{args.skill}/SKILL.md")
    no_edit = (
        baseline.skill_md is not None
        and working_md.exists()
        and baseline.skill_md.strip() == working_md.read_text(encoding="utf-8").strip()
    )

    gate_specs = [mined_spec] + holdout_specs
    from harness.versioning import now_utc_filename_timestamp
    ts = now_utc_filename_timestamp()
    print(f"\nGating {args.skill}: {len(gate_specs)} candidate test(s) vs the "
          f"step-4 baseline ({baseline.path.name}), mock-backed.\n")
    cand_entries = run_candidate(gate_specs, auth=auth, timestamp=ts)

    def rows_for(test_id: str) -> list[DimRow]:
        return compare(baseline.scores.get(test_id, {}),
                       scores_of(cand_entries.get(test_id, {})))

    mined_rows = rows_for(mined_spec.id)
    holdout_rows_by_test = {s.id: rows_for(s.id) for s in holdout_specs}
    signal = compute_signal(mined_rows, holdout_rows_by_test,
                            named_dimension=args.dimension)
    total_cost = sum(
        float((e.get("totals") or {}).get("total_cost_usd") or 0.0)
        for e in cand_entries.values()
    )

    from harness.judge import DEFAULT_JUDGE_MODEL
    report = render_report(
        skill=args.skill, mined_test_id=mined_spec.id,
        holdout_ids=[s.id for s in holdout_specs], mined_rows=mined_rows,
        holdout_rows_by_test=holdout_rows_by_test, signal=signal, baseline=baseline,
        no_edit=no_edit, judge_model=DEFAULT_JUDGE_MODEL, total_cost=total_cost,
    )
    fd, report_path = tempfile.mkstemp(prefix=f"gate-report-{args.skill}-", suffix=".md")
    with open(fd, "w", encoding="utf-8") as f:
        f.write(report + "\n")

    print()
    print(report)
    print()
    print(f"Report written to {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
