#!/usr/bin/env python3
"""GH Action: the e2e grading gate (a discipline check on committed files).

## Grading gate (BLOCKING)

Every run log ADDED in this PR that produced a final tree must ship its
``run-<ts>.ann.json`` in the same PR — grading is same-PR (the developer +
genealogist teams grade every run they commit; docs/e2e-testing-guide.md
"Grading a run"). A treeless run (crashed or skipped before a final tree) is
exempt: there is nothing to grade. Scoped to PR-added run logs via
``git diff --diff-filter=A`` (BASE_SHA / HEAD_SHA), mirroring check_runlogs.py
rule 1; skipped when run outside a PR (env unset), so local runs still work.

The grading gate checks annotation *presence*, not content. Deeper content
validity (drift / incomplete / malformed) is the maintainer's
``calibrate_judge --dry-run`` step and the loader's own classification — kept
out of CI so this script stays stdlib-only and never needs the harness venv.
The one content check that lives here is the component-derivation drift warning
below: it is pure stdlib JSON arithmetic, so it meets the same constraint.

## Unresolved-draft check (WARN only)

A `genre: "record-hint"` fixture ships as a draft: its README carries
``DRAFT PENDING ADJUDICATION`` until a genealogist resolves the hint
(Step 1a of docs/e2e-testing-guide.md), and `/resolve-record-hint` clearing
that marker is what makes it resolved. Committing a *run* for a fixture whose
marker is still there means the run scored the unverified hint rather than the
truth — the run is not wrong to exist, but its grade means much less, so the
reviewer should know. Warn-only: never blocks.

Scoped to **PR-added run logs**, deliberately. An earlier fixture-validity
warning was removed for re-flagging every un-run fixture in the repo on every
e2e PR; this one can only fire on a fixture the PR itself committed a run for,
so it stays silent until someone actually does the thing worth flagging.

## Component-derivation drift check (WARN only)

``apply_component_derivation`` (e2e/judge.py, e2e-test-spec.md §3.4.2) recomputes
a finding's ``matched`` from its own ``components``, but only for ``relationship``
findings. A ``source``, ``fact`` or ``person`` finding keeps whatever ``matched``
the judge wrote — even when its ``components``, sitting in the same object in the
format the derivation consumes, resolve to a different label — and nothing
reports it (issue #1721). This warns when a PR-added run log carries such a
finding (stored ``matched`` != ``derive_matched(components)``) so the reviewer can
confirm the label. It does **not** widen the derivation: ``source``/``person``
cannot be calibrated against the committed corpus, so the disagreement is
reported, not corrected. Warn-only, never blocks. Findings derivation already
reconciled (``matched_model`` present) and ``avoid`` findings (whose ``matched``
is not a link tally) are skipped.

## Not gated: fixture validity

Whether a fixture has a committed *passing* run log (proof it is solvable from
live FamilySearch — e2e-test-spec.md §14) is a recommended practice surfaced in
the authoring docs, **not** a CI check. A fixture can land without one — draft
and PID-less fixtures routinely do — so this script no longer emits a
fixture-validity warning.

Self-contained — stdlib only. Run by .github/workflows/check-e2e-fixtures.yml.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
RUNLOGS_DIR = REPO_ROOT / "eval" / "runlogs" / "e2e"

# The marker `/resolve-record-hint` strips from a record-hint fixture's README
# when a genealogist resolves it. Its presence == still an unverified draft.
DRAFT_MARKER = "DRAFT PENDING ADJUDICATION"


# --------------------------------------------------------------------------- #
# Grading gate (blocking): PR-added run logs with a tree must ship their ann
# --------------------------------------------------------------------------- #

def _is_primary_runlog(name: str) -> bool:
    """True for a ``run-<ts>.json`` result file, excluding its siblings
    (``.ann.json``, ``.final-tree.gedcomx.json``, ``.final-research.json``)."""
    return (
        name.startswith("run-")
        and name.endswith(".json")
        and not name.endswith(".ann.json")
        and ".final-" not in name
    )


def git_added_e2e_runlogs() -> list[Path] | None:
    """PR-added primary run logs under eval/runlogs/e2e/, as repo-relative Paths.

    Returns ``None`` when not running in a PR context (BASE_SHA / HEAD_SHA
    unset) — the grading gate only applies to files added in the PR, mirroring
    check_runlogs.py rule 1 (``git diff --diff-filter=A``). Local runs skip it.
    """
    base = os.environ.get("BASE_SHA")
    head = os.environ.get("HEAD_SHA")
    if not base or not head:
        return None
    out = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=A", base, head],
        text=True,
        cwd=REPO_ROOT,
    )
    added: list[Path] = []
    for line in out.splitlines():
        path = line.strip()
        if not path:
            continue
        p = Path(path)
        if (
            len(p.parts) >= 4
            and p.parts[:3] == ("eval", "runlogs", "e2e")
            and _is_primary_runlog(p.name)
        ):
            added.append(p)
    return added


def check_added_runlogs_graded(added: list[Path]) -> list[str]:
    """Blocking gate: every PR-added run log that produced a tree must ship its
    committed ``run-<ts>.ann.json`` in the same PR.

    A treeless run (crashed / skipped before a final tree) is exempt — the
    loader can't grade it and neither can a human, so no annotation is owed.
    Detected by the absence of the ``run-<ts>.final-tree.gedcomx.json`` sibling,
    which is exactly the file the grade loader requires.
    """
    violations: list[str] = []
    for rel in added:
        runlog = REPO_ROOT / rel
        stem = rel.name[: -len(".json")]  # run-<ts>
        slug_dir = runlog.parent
        tree = slug_dir / f"{stem}.final-tree.gedcomx.json"
        ann = slug_dir / f"{stem}.ann.json"
        if not tree.exists():
            continue  # treeless run — nothing to grade
        if not ann.exists():
            violations.append(
                f"run log '{rel}' produced a final tree but no committed "
                f"'{stem}.ann.json'. Grade it in this PR with /grade-e2e-run and "
                "commit the annotation (grading is same-PR; "
                "docs/e2e-testing-guide.md 'Grading a run')."
            )
    return violations


# --------------------------------------------------------------------------- #
# Unresolved-draft check (warn only): a run committed for a still-draft fixture
# --------------------------------------------------------------------------- #

def check_added_runlogs_resolved(added: list[Path]) -> list[str]:
    """Warn-only: a PR-added run log whose fixture README still carries
    ``DRAFT PENDING ADJUDICATION``.

    The run scored an unverified hint rather than a genealogist-confirmed
    answer, so its verdict and its grade both mean less than they look like
    they do. One warning per fixture, not per run log.
    """
    warnings: list[str] = []
    for slug in sorted({rel.parts[3] for rel in added if len(rel.parts) >= 4}):
        # Resolved against REPO_ROOT at call time, like check_added_runlogs_graded.
        readme = REPO_ROOT / "eval" / "tests" / "e2e" / slug / "README.md"
        if not readme.exists():
            continue
        if DRAFT_MARKER in readme.read_text(encoding="utf-8"):
            warnings.append(
                f"fixture '{slug}' still carries '{DRAFT_MARKER}' in its "
                "README, but this PR commits a run for it. The run scored the "
                "unverified hint, not a resolved answer — resolve the hint "
                "first (/resolve-record-hint, e2e-testing-guide.md Step 1a) "
                "and re-run, or say in the PR why the draft run is worth "
                "committing."
            )
    return warnings


# --------------------------------------------------------------------------- #
# Component-derivation drift check (warn only): a finding's stored `matched`
# disagrees with the label its own `components` roll up to
# --------------------------------------------------------------------------- #

# Hand-kept in sync with `derive_matched` in eval/harness/e2e/judge.py. That
# module imports `anthropic`, so importing it here would drag the harness venv
# into a check the workflow runs on a bare `python` (stdlib only). The tally is
# a few lines of pure JSON arithmetic, so it is duplicated rather than imported;
# e2e-test-spec.md §3.4.2 is the shared contract both obey.
def derive_matched(components: list[dict] | None) -> str | None:
    """Roll a finding's ``link`` components up to a ``matched`` label, or return
    ``None`` when it carries no ``link`` components (nothing to derive).

    - ``false``   — any link contradicted, or no link supported
    - ``true``    — every link supported
    - ``partial`` — anything in between
    """
    links = [
        c for c in (components or [])
        if isinstance(c, dict) and c.get("kind") == "link"
    ]
    if not links:
        return None
    statuses = [c.get("status") for c in links]
    if "contradicted" in statuses:
        return "false"
    supported = sum(1 for s in statuses if s == "supported")
    if supported == 0:
        return "false"
    if supported == len(statuses):
        return "true"
    return "partial"


def avoid_finding_ids(slug: str) -> set[str]:
    """``id``s of ``avoid``-polarity findings in the fixture's
    expected-findings.json.

    For an ``avoid`` finding ``matched: "true"`` means "correctly declined to
    assert", which is not a link tally, so the drift check skips them — matching
    ``apply_component_derivation``'s own exclusion. Returns an empty set when the
    fixture or its file is unreadable (the check then treats every finding as
    non-avoid, erring toward surfacing rather than hiding a disagreement)."""
    ef = REPO_ROOT / "eval" / "tests" / "e2e" / slug / "expected-findings.json"
    try:
        findings = json.loads(ef.read_text(encoding="utf-8")).get("findings") or []
    except (OSError, ValueError):
        return set()
    return {
        str(f.get("id"))
        for f in findings
        if isinstance(f, dict) and str(f.get("polarity", "recover")) == "avoid"
    }


def check_matched_vs_components(added: list[Path]) -> list[str]:
    """Warn-only: a PR-added run log whose judge left a finding's ``matched``
    disagreeing with the label its own ``components`` roll up to.

    ``apply_component_derivation`` reconciles this automatically, but only for
    ``relationship`` findings (e2e-test-spec.md §3.4.2). A ``source``, ``fact``
    or ``person`` finding keeps whatever ``matched`` the judge wrote even when
    its own ``components`` resolve to a different label, and nothing reports it
    (issue #1721). This surfaces that disagreement for the reviewer without
    widening the derivation.

    Skipped per finding when: it was already derived (``matched_model`` present —
    the stored ``matched`` is the derived value), it is an ``avoid`` finding
    (its ``matched`` is not a link tally), or it carries no ``link`` components
    (nothing to derive). Malformed logs are skipped, never raised on.
    """
    warnings: list[str] = []
    for rel in added:
        try:
            data = json.loads((REPO_ROOT / rel).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        per_finding = (data.get("judge_output") or {}).get("per_finding") or []
        slug = rel.parts[3] if len(rel.parts) >= 4 else ""
        avoid_ids = avoid_finding_ids(slug)
        for entry in per_finding:
            if not isinstance(entry, dict):
                continue
            if "matched_model" in entry:  # derivation already reconciled it
                continue
            fid = str(entry.get("finding_id"))
            if fid in avoid_ids:
                continue
            derived = derive_matched(entry.get("components"))
            if derived is None:
                continue
            stored = entry.get("matched")
            if stored != derived:
                warnings.append(
                    f"run log '{rel}' finding {fid}: the judge emitted "
                    f"matched={stored!r} but its own components resolve to "
                    f"{derived!r}. Component derivation is relationship-only "
                    f"(e2e-test-spec.md §3.4.2), so this finding's label was "
                    f"trusted as the judge wrote it — confirm it is right."
                )
    return warnings


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main() -> int:
    # --- Grading gate (blocking) — PR-added run logs with a tree need an ann ---
    added = git_added_e2e_runlogs()
    if added is None:
        print("E2E grading gate skipped (no PR context: BASE_SHA/HEAD_SHA unset).")
        return 0

    # --- Unresolved-draft check (warn only) — runs first so its output is
    # --- visible even when the blocking gate below fails the job.
    for w in check_added_runlogs_resolved(added):
        print(f"::warning::{w}")
        print(f"  ! {w}", file=sys.stderr)

    # --- Component-derivation drift (warn only) — matched vs its own components.
    for w in check_matched_vs_components(added):
        print(f"::warning::{w}")
        print(f"  ! {w}", file=sys.stderr)

    grade_violations = check_added_runlogs_graded(added)
    if grade_violations:
        print(
            "E2E grading gate — PR-added run logs missing their annotation:",
            file=sys.stderr,
        )
        for v in grade_violations:
            print(f"::error::{v}")
            print(f"  - {v}", file=sys.stderr)
        return 1

    print(f"E2E grading gate OK ({len(added)} added run log(s) checked).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
