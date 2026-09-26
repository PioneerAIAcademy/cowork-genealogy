#!/usr/bin/env python3
"""GH Action: the e2e discipline gates (checks on committed files).

## Grading gate (BLOCKING)

Every run log ADDED OR RENAMED into the corpus in this PR that produced a
final tree must ship its ``run-<ts>.ann.json`` in the same PR — grading is
same-PR (the developer +
genealogist teams grade every run they commit; docs/e2e-testing-guide.md
"Grading a run"). A treeless run (crashed or skipped before a final tree) is
exempt: there is nothing to grade. Scoped to run logs ADDED OR RENAMED into
the corpus via ``git diff --diff-filter=AR`` (BASE_SHA / HEAD_SHA), so a run
promoted out of quarantine is caught; skipped when run outside a PR (env
unset), so local runs still work.
Both siblings are resolved from the HEAD_SHA tree, never the working directory,
so a local run and CI reach the same verdict (issue #2469).

The grading gate checks annotation *presence*, not content. Deeper content
validity (drift / incomplete / malformed) is the maintainer's
``calibrate_judge --dry-run`` step and the loader's own classification — kept
out of CI so this script stays stdlib-only and never needs the harness venv.
The one content check that lives here is the component-derivation drift warning
below: it is pure stdlib JSON arithmetic, so it meets the same constraint.

## 1M-window gate (BLOCKING)

A run log added or renamed into ``eval/runlogs/e2e/`` whose ``usage.betas`` is
non-empty was made with ``--context-1m``. A 1M window changes the compaction
count and the cache-gap structure — what ``make e2e-compaction`` and
``make e2e-cache-window`` measure — and ``all_result_jsons`` scans the corpus
with no exclusion, so such a run lands at maximum weight. Keep it in a sibling
directory outside ``eval/runlogs/e2e/``. Same AR scoping and same HEAD_SHA-tree
read as the grading gate above.

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
format the derivation consumes, resolve to a different label — and nothing reports
it (issue #1721). This warns, for **every finding type**, when a PR-added run log
carries such a finding (stored ``matched`` != ``derive_matched(components)``) so
the reviewer can confirm the label. It does **not** widen the derivation:
``source``/``fact``/``person`` cannot be calibrated against the committed corpus,
so the disagreement is reported, not corrected. Warn-only, never blocks. Findings
derivation already reconciled (``matched_model`` present) and ``avoid`` findings
(whose ``matched`` is not a link tally) are skipped; ``fact`` is *not* skipped —
it is excluded from the derivation, not from this report.

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


class GateUnavailable(RuntimeError):
    """The gate could not read the tree it must check.

    Raised rather than returning a sentinel so the caller cannot mistake it for
    "no run logs were added" -- the failure mode this whole check exists to stop.
    """


def git_added_e2e_runlogs() -> list[Path] | None:
    """PR-added primary run logs under eval/runlogs/e2e/, as repo-relative Paths.

    Returns ``None`` when not running in a PR context (BASE_SHA / HEAD_SHA
    unset). Read by the two WARN-only checks, and by main() for the skip
    decision and the OK line's second denominator; both blocking gates read
    ``git_ar_e2e_runlogs()`` instead. Local runs skip it.
    """
    base = os.environ.get("BASE_SHA")
    head = os.environ.get("HEAD_SHA")
    if not base or not head:
        return None
    # An unfetched sha, a shallow clone or a cwd that is not a repo all die HERE,
    # in the selection step, before any sibling is looked up -- `check_output`
    # raises on a non-zero exit. Left uncaught that surfaces as a six-frame
    # traceback naming `subprocess`, which says nothing about what to do. Caught
    # here it becomes the one actionable line, at the only place the failure can
    # actually occur.
    try:
        out = subprocess.check_output(
            ["git", "-c", "diff.renames=true", "diff",
             "--name-only", "--diff-filter=A", base, head],
            text=True,
            encoding="utf-8",
            cwd=REPO_ROOT,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError as exc:
        raise GateUnavailable(
            f"could not diff {base}..{head} in this checkout (git exited "
            f"{exc.returncode}), so the grading gate cannot see which run logs this "
            "PR added. Either the commit was never fetched (CI uses fetch-depth: 0) "
            "or this directory is not a git repository. Refusing rather than "
            "reporting zero added run logs."
        ) from exc
    except FileNotFoundError as exc:  # git itself absent
        raise GateUnavailable(
            "git is not on PATH, so the grading gate cannot read the tree it must "
            "check. Refusing rather than reporting zero added run logs."
        ) from exc
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


QUARANTINE_HINT = (
    "a sibling directory outside eval/runlogs/e2e/ — the mechanism "
    "eval/runlogs/_2491-exploratory-quarantine/ uses for its own experiment"
)


def git_ar_e2e_runlogs() -> list[Path] | None:
    """PR-added OR renamed-into-place primary e2e run logs.

    Deliberately NOT a widening of the shared `git_added_e2e_runlogs()`, which
    the two warn-only checks still read: widening that one would change what
    they report as well. Both BLOCKING gates read this selector instead.

    Why renames matter, and why the grading gate reads this too: promoting a run
    out of quarantine arrives as a RENAME, which `--diff-filter=A` does not
    report at all. Measured 2026-09-15 —
    eval/runlogs/_2491-exploratory-quarantine/ holds four runs, every one with a
    `.final-tree.gedcomx.json` and ZERO `.ann.json` — so before this selector
    existed, that promotion landed a tree-producing, ungraded run in the
    calibration corpus by the one route neither gate could see.

    `-c diff.renames=true` is pinned on BOTH selectors, but it is the pin on
    `git_added_e2e_runlogs()` that is load-bearing. Measured: with
    `diff.renames=false` git reports a promotion as a plain `A <destination>`
    instead of `R100 <src> <destination>`. THIS selector takes the last field
    either way, so its output is unchanged and removing its pin reds nothing.
    The A selector flips from returning nothing to returning the destination,
    which recounts a promotion as an added run — without its pin this file
    fails two rows under `GIT_CONFIG_GLOBAL=<diff.renames=false>`. The pin here
    is kept as the matching half of a pair, not because it changes this output;
    `test_both_selectors_pin_rename_detection_against_the_runners_gitconfig`
    asserts the half that does.
    """
    base = os.environ.get("BASE_SHA")
    head = os.environ.get("HEAD_SHA")
    if not base or not head:
        return None
    try:
        out = subprocess.check_output(
            ["git", "-c", "diff.renames=true", "diff",
             "--name-status", "--diff-filter=AR", base, head],
            text=True,
            encoding="utf-8",
            cwd=REPO_ROOT,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError as exc:
        raise GateUnavailable(
            f"could not diff {base}..{head} in this checkout (git exited "
            f"{exc.returncode}), so the 1M-window check cannot see which run logs "
            "this PR added or renamed. Either the commit was never fetched (CI "
            "uses fetch-depth: 0) or this directory is not a git repository. "
            "Refusing rather than reporting zero."
        ) from exc
    except FileNotFoundError as exc:
        raise GateUnavailable(
            "git is not on PATH, so the 1M-window check cannot read the tree it "
            "must check. Refusing rather than reporting zero."
        ) from exc
    out_paths: list[Path] = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        # `R<score>` rows carry src AND dst; the DESTINATION is what arrived in
        # the corpus. Taking parts[-1] handles A (2 fields) and R (3) alike, and
        # matches check_runlogs.py::git_diff_changes.
        p = Path(parts[-1].strip())
        if (
            len(p.parts) >= 4
            and p.parts[:3] == ("eval", "runlogs", "e2e")
            and _is_primary_runlog(p.name)
        ):
            out_paths.append(p)
    return out_paths


def _read_at_head(head: str, rel: Path) -> dict | None:
    """Parse ``rel`` out of the git tree at ``head``. None on anything unusable.

    The content sibling of `_in_head_tree`, which answers presence only. Reading
    the WORKING DIRECTORY here would reintroduce exactly the defect PR #2550
    fixed in this file: a log edited on disk but not committed, or committed and
    then edited, would be judged on bytes CI will never see.

    Binary capture with an explicit decode, so `test_encoding_lint.py`'s
    text-mode rule does not apply and no platform default can leak in. None
    covers: undecodable, unparseable, and a root that is not an object — none
    of which make a run a 1M run.

    A non-zero `git show` RAISES rather than returning None. Every path handed
    to this function was just reported by `git_ar_e2e_runlogs()` as added or
    renamed INTO the tree at `head`, so the blob is known to be there: a
    failure is an anomaly (git gone mid-run, a transient fork failure, an
    unreadable object), not evidence of no betas. Returning None there reports
    a file it never opened as clean, which is the same silent-zero the
    selectors refuse for — and it is reachable, since these git subprocesses do
    intermittently fail under load.
    """
    proc = subprocess.run(
        ["git", "show", f"{head}:{rel.as_posix()}"],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise GateUnavailable(
            f"could not read {rel} out of the tree at {head} (git exited "
            f"{proc.returncode}), though the selector just reported it as added "
            "or renamed into that tree. Refusing rather than reporting the run "
            "as not-1M on a file that was never opened."
        )
    try:
        parsed = json.loads(proc.stdout.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def check_added_runlogs_not_1m(added: list[Path], head: str) -> list[str]:
    """Blocking: a PR-added-or-renamed run log made with the 1M context window.

    `--context-1m` sets the SDK's context-1m-2025-08-07 beta and records it in
    `usage.betas`. A 1M window changes the compaction count and the cache-gap
    structure, which is what `make e2e-compaction` and `make e2e-cache-window`
    measure, and `all_result_jsons` scans eval/runlogs/e2e/ with no exclusion at
    a 14-day window — so a committed 1M run lands at maximum weight.

    The field is FLAT: `usage.betas`, beside `deny_shell`. NOT `usage.usage.betas`
    — the usage envelope carries a nested `usage` key of SDK token counts, and
    reading that one finds nothing forever.

    Non-empty LIST only. `[]` is a normal run (174 of the 175 committed runs
    predate the field; the 175th records `[]`), and a non-list is malformed
    rather than 1M — neither is this check's business to report.
    """
    violations: list[str] = []
    for rel in added:
        log = _read_at_head(head, rel)
        if not isinstance(log, dict):
            continue
        usage = log.get("usage")
        if not isinstance(usage, dict):
            continue
        betas = usage.get("betas")
        if not isinstance(betas, list) or not betas:
            continue
        violations.append(
            f"run log '{rel}' was made with the 1M context window "
            f"(usage.betas = {betas!r}) and must not be committed under "
            "eval/runlogs/e2e/. A 1M window changes the compaction count and the "
            "cache-gap structure, so the run is not comparable to the corpus and "
            "would skew every windowed report at maximum weight. Keep it in "
            f"{QUARANTINE_HINT}."
        )
    return violations


def _in_head_tree(head: str, rel: Path) -> bool:
    """True when ``rel`` (repo-relative) exists in the git tree at ``head``.

    Only reached once `git_added_e2e_runlogs` has already diffed against ``head``
    from this same cwd, so a 128 here is a missing PATH rather than a broken
    checkout -- that case refuses in the selection step above.
    Paths are POSIX-joined because git addresses ``<sha>:<path>`` with forward
    slashes on every platform. Binary mode: only the returncode is read, so the
    child's bytes are never decoded.
    """
    proc = subprocess.run(
        ["git", "cat-file", "-e", f"{head}:{rel.as_posix()}"],
        cwd=REPO_ROOT,
        capture_output=True,
    )
    return proc.returncode == 0


def check_added_runlogs_graded(added: list[Path], head: str) -> list[str]:
    """Blocking gate: every PR-added run log that produced a tree must ship its
    committed ``run-<ts>.ann.json`` in the same PR.

    A treeless run (crashed / skipped before a final tree) is exempt — the
    loader can't grade it and neither can a human, so no annotation is owed.
    Detected by the absence of the ``run-<ts>.final-tree.gedcomx.json`` sibling,
    which is exactly the file the grade loader requires.

    Both siblings resolve from the ``head`` tree, not the working directory: the
    run logs were selected from that tree too, and a sibling present on disk but
    uncommitted must not change the verdict (issue #2469). The two warn-only
    checks below deliberately keep reading the working directory — they never
    block, so the disagreement costs nothing there. Do not "unify" them.
    """
    violations: list[str] = []
    for rel in added:
        stem = rel.name[: -len(".json")]  # run-<ts>
        slug_dir = rel.parent
        tree = slug_dir / f"{stem}.final-tree.gedcomx.json"
        ann = slug_dir / f"{stem}.ann.json"
        if not _in_head_tree(head, tree):
            continue  # treeless run — nothing to grade
        if not _in_head_tree(head, ann):
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
    ``apply_component_derivation``'s own polarity exclusion. This is the *only*
    type/polarity the check skips: the issue's decision is to flag disagreements
    for **every finding type** (``source``, ``fact`` and ``person`` alike), and
    only ``avoid``'s ``matched`` semantics make the link tally meaningless. In
    particular ``fact`` is *not* excluded here — it is excluded from the
    *derivation* (judge.py), but the report still surfaces its disagreements.

    Returns an empty set when the fixture is missing or its JSON is unreadable or
    wrong-shaped — the check then evaluates every finding, erring toward
    surfacing rather than hiding a disagreement."""
    ef = REPO_ROOT / "eval" / "tests" / "e2e" / slug / "expected-findings.json"
    try:
        data = json.loads(ef.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    findings = data.get("findings") if isinstance(data, dict) else None
    if not isinstance(findings, list):
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
    or ``person`` finding keeps whatever ``matched`` the judge wrote even when its
    own ``components`` resolve to a different label, and nothing reports it
    (issue #1721). This surfaces that disagreement, for **every finding type**,
    without widening the derivation.

    Skipped per finding when: it was already derived (``matched_model`` present —
    the stored ``matched`` is the derived value), it is an ``avoid`` finding
    (its ``matched`` is not a link tally), it has no ``matched`` to compare, or
    it carries no ``link`` components (nothing to derive). ``fact`` is *not*
    skipped — it is excluded from the derivation, not from this report. Malformed
    or wrong-shaped logs are skipped, never raised on.
    """
    warnings: list[str] = []
    avoid_by_slug: dict[str, set[str]] = {}
    for rel in added:
        try:
            data = json.loads((REPO_ROOT / rel).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(data, dict):
            continue
        judge_output = data.get("judge_output")
        per_finding = (
            judge_output.get("per_finding") if isinstance(judge_output, dict) else None
        )
        if not isinstance(per_finding, list):
            continue
        slug = rel.parts[3] if len(rel.parts) >= 4 else ""
        if slug not in avoid_by_slug:
            avoid_by_slug[slug] = avoid_finding_ids(slug)
        avoid_ids = avoid_by_slug[slug]
        for entry in per_finding:
            # Short-circuit isinstance first so `in`/`get` never hit a non-dict.
            if not isinstance(entry, dict) or "matched_model" in entry or "matched" not in entry:
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
# Annotation structural validation (blocking): reimplemented mechanical rungs
# from calibrate_judge.load_annotated_runs (rungs 1-8)
# --------------------------------------------------------------------------- #

# Hand-kept in sync with calibrate_judge.ALLOWED_ANN_KEYS. This script cannot
# import calibrate_judge (it pulls in e2e.judge → anthropic, and this script
# runs on a bare python with no harness venv). Same pattern as derive_matched.
_ALLOWED_ANN_KEYS = {"annotator", "per_finding", "proof_quality_score", "notes", "findings_hash"}
_FINDING_LABELS = {"true", "partial", "false"}


def _findings_hash_local(expected_findings_path: Path) -> str:
    """Reimplement ``e2e.provenance.findings_hash`` using only stdlib.

    Hand-kept in sync with ``e2e.provenance.findings_hash`` — the
    normalization is: JSON parse → ``json.dumps(sort_keys=True, indent=2,
    ensure_ascii=False)`` → trailing newline → sha256. This is the same
    contract ``harness.snapshot.hash_file`` fulfils for ``.json`` files.
    """
    import hashlib
    raw = expected_findings_path.read_text(encoding="utf-8")
    parsed = json.loads(raw)
    normalized = json.dumps(parsed, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_e2e_annotations(runlogs_dir: Path, fixtures_dir: Path) -> list[str]:
    """Run mechanical validation (rungs 1-8) over every e2e ``.ann.json``.

    Returns a list of ``::error::`` messages for structural violations.
    Never calls a model; no API key needed. A clean corpus returns ``[]``.
    """
    errors: list[str] = []
    for ann_path in sorted(runlogs_dir.glob("*/run-*.ann.json")):
        rel = ann_path.relative_to(runlogs_dir)

        # 1. parse
        try:
            ann = json.loads(ann_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            errors.append(f"e2e annotation `{rel}`: invalid JSON ({e})")
            continue
        if not isinstance(ann, dict):
            errors.append(f"e2e annotation `{rel}`: expected a JSON object")
            continue

        # 2. structural — known keys + per_finding present
        unknown = set(ann) - _ALLOWED_ANN_KEYS
        if unknown:
            errors.append(
                f"e2e annotation `{rel}`: unknown key(s) {sorted(unknown)} "
                f"(allowed: {sorted(_ALLOWED_ANN_KEYS)})"
            )
            continue
        per_finding = ann.get("per_finding")
        if not isinstance(per_finding, dict) or not per_finding:
            errors.append(f"e2e annotation `{rel}`: 'per_finding' missing or not a non-empty object")
            continue

        # 3. incomplete (inert) — skip, not error
        if any(v is None for v in per_finding.values()):
            continue

        # 4. fixture + expected-findings
        stem = ann_path.name[: -len(".ann.json")]
        slug = ann_path.parent.name
        fixture_dir = fixtures_dir / slug
        ef_path = fixture_dir / "expected-findings.json"
        try:
            expected = json.loads(ef_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
            errors.append(f"e2e annotation `{rel}`: fixture for slug '{slug}' unreadable ({e})")
            continue

        # 5. final-tree sibling
        tree_path = ann_path.parent / f"{stem}.final-tree.gedcomx.json"
        if not tree_path.exists():
            errors.append(f"e2e annotation `{rel}`: {tree_path.name} missing — nothing to grade")
            continue

        # 6. id/key drift
        findings = expected.get("findings") or []
        fixture_ids = {str(f.get("id")) for f in findings if isinstance(f, dict)}
        ann_ids = set(per_finding)
        if ann_ids != fixture_ids:
            errors.append(
                f"e2e annotation `{rel}`: per_finding keys {sorted(ann_ids)} != "
                f"fixture findings {sorted(fixture_ids)} — re-grade or delete"
            )
            continue

        # 7. content drift — findings_hash
        stored_hash = ann.get("findings_hash")
        if stored_hash is not None:
            try:
                current_hash = _findings_hash_local(ef_path)
            except (OSError, json.JSONDecodeError, UnicodeDecodeError) as e:
                errors.append(f"e2e annotation `{rel}`: cannot compute findings_hash ({e})")
                continue
            if stored_hash != current_hash:
                errors.append(
                    f"e2e annotation `{rel}`: findings_hash mismatch — "
                    f"expected-findings.json changed since grading; re-grade or delete"
                )
                continue

        # 8. enum validation
        bad = {fid: v for fid, v in per_finding.items() if v not in _FINDING_LABELS}
        if bad:
            errors.append(f"e2e annotation `{rel}`: per_finding labels {bad} not in {sorted(_FINDING_LABELS)}")
            continue
        pq = ann.get("proof_quality_score")
        if pq not in (1, 2, 3, None):
            errors.append(f"e2e annotation `{rel}`: proof_quality_score {pq!r} not 1/2/3/null")
            continue
        notes = ann.get("notes")
        if notes is not None:
            if not isinstance(notes, dict):
                errors.append(f"e2e annotation `{rel}`: 'notes' must be a {{finding_id: text}} object")
                continue
            note_unknown = set(notes) - ann_ids
            if note_unknown:
                errors.append(f"e2e annotation `{rel}`: notes for unknown finding(s) {sorted(note_unknown)}")
                continue

    return errors


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def main() -> int:
    # The house pattern (`e2e/author.py`). A Windows console defaults to cp1252
    # and dies on the arrows and box glyphs this module prints; the team it is
    # written for is on Windows. Guarded by tests/unit/test_encoding_lint.py.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    # --- Grading gate (blocking) — PR-added run logs with a tree need an ann ---
    try:
        added = git_added_e2e_runlogs()
        # INSIDE this try on purpose. The handler below wraps only the call
        # above today, and a GateUnavailable raised from a later line would
        # propagate as a six-frame traceback -- the failure shape this class
        # exists to eliminate. `or []` is for the three tests that stub the
        # selector above and leave this one real; on the production path
        # `added is not None` already means both shas are set.
        ar_runlogs = (git_ar_e2e_runlogs() or []) if added is not None else []
    except GateUnavailable as exc:
        # Before the warn loops, unavoidably: they take `added`, which does not
        # exist on this path. Nothing is swallowed because nothing has run.
        print(f"::error::{exc}")
        print(f"  - {exc}", file=sys.stderr)
        return 1
    if added is None:
        print("E2E grading gate skipped (no PR context: BASE_SHA/HEAD_SHA unset).")
        return 0
    # Present by construction: git_added_e2e_runlogs() returns None when unset.
    head = os.environ["HEAD_SHA"]

    # --- Unresolved-draft check (warn only) — runs first so its output is
    # --- visible even when the blocking gate below fails the job.
    for w in check_added_runlogs_resolved(added):
        print(f"::warning::{w}")
        print(f"  ! {w}", file=sys.stderr)

    # --- Component-derivation drift (warn only) — matched vs its own components.
    for w in check_matched_vs_components(added):
        print(f"::warning::{w}")
        print(f"  ! {w}", file=sys.stderr)

    # Both gates read the AR set. For the grading gate that closes a real hole:
    # a run promoted out of quarantine arrives as a RENAME, and every run in
    # eval/runlogs/_2491-exploratory-quarantine/ has a final tree and no
    # annotation -- the exact population this gate rejects, arriving by the one
    # route `--diff-filter=A` cannot see. This is NOT the widening #2581
    # forbids: the shared selector is untouched and the two warn loops above
    # still read it, so only this one blocking gate changes what it sees.
    # Same handler shape as the selector above: `_read_at_head` refuses on an
    # unreadable blob, and without this that refusal would leave main() as a
    # traceback rather than the ::error:: a reader can act on.
    try:
        grade_violations = check_added_runlogs_graded(ar_runlogs, head)
        beta_violations = check_added_runlogs_not_1m(ar_runlogs, head)
    except GateUnavailable as exc:
        print(f"::error::{exc}")
        print(f"  - {exc}", file=sys.stderr)
        return 1

    # Both blocking rules report before either returns. A second rule that
    # printed ::error:: without reaching the return would be a green check, and
    # short-circuiting on the first would hide the other on the shape that fires
    # both -- a promoted quarantine run has a tree and no annotation, so an
    # ADDED 1M run trips the grading gate too.
    if grade_violations:
        print(
            "E2E grading gate — PR-added run logs missing their annotation:",
            file=sys.stderr,
        )
        for v in grade_violations:
            print(f"::error::{v}")
            print(f"  - {v}", file=sys.stderr)
    if beta_violations:
        print(
            "E2E 1M-window gate — run logs not comparable to the corpus:",
            file=sys.stderr,
        )
        for v in beta_violations:
            print(f"::error::{v}")
            print(f"  - {v}", file=sys.stderr)
    if grade_violations or beta_violations:
        return 1

    # --- Annotation structural validation (blocking on PR-added/modified, warn corpus) —
    # --- rungs 1-8 from calibrate_judge.load_annotated_runs, reimplemented
    # --- stdlib-only (#2487 PR B).
    fixtures_dir = REPO_ROOT / "eval" / "tests" / "e2e"
    runlogs_dir = REPO_ROOT / "eval" / "runlogs" / "e2e"
    ann_errors = validate_e2e_annotations(runlogs_dir, fixtures_dir)
    # Scope: PR-touched annotation violations block; pre-existing ones warn.
    # Build the set relative to the repo-relative prefix (not the absolute
    # RUNLOGS_DIR) so they match the `rel` in the error strings, which are
    # relative to `runlogs_dir`.
    e2e_prefix = Path("eval", "runlogs", "e2e")
    touched_ann_rels: set[Path] = set()
    # Every run log the PR added or renamed — its annotation is accountable.
    for p in ar_runlogs:
        ann_path = Path(p).with_name(Path(p).stem + ".ann.json")
        try:
            touched_ann_rels.add(ann_path.relative_to(e2e_prefix))
        except ValueError:
            pass  # not under e2e prefix — skip
    # Also catch .ann.json files that are themselves A/R/M in the diff — a PR
    # that edits an existing annotation or edits expected-findings.json under a
    # graded run must also block, not just warn (#2487 review finding 2).
    try:
        arm_out = subprocess.check_output(
            ["git", "-c", "diff.renames=true", "diff",
             "--name-only", "--diff-filter=ARM",
             os.environ["BASE_SHA"], os.environ["HEAD_SHA"]],
            text=True, encoding="utf-8", cwd=REPO_ROOT,
            stderr=subprocess.DEVNULL,
        )
        for line in arm_out.splitlines():
            line = line.strip()
            if not line:
                continue
            p = Path(line)
            if (
                len(p.parts) >= 4
                and p.parts[:3] == ("eval", "runlogs", "e2e")
                and p.name.endswith(".ann.json")
            ):
                touched_ann_rels.add(p.relative_to(e2e_prefix))
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass  # best-effort widening; the AR set above still covers the core case

    blocking_ann = []
    for e in ann_errors:
        # Check if the error names a PR-touched annotation
        is_pr_touched = any(str(rel) in e for rel in touched_ann_rels)
        if is_pr_touched:
            blocking_ann.append(e)
        else:
            print(f"::warning::{e}")
            print(f"  ! {e}", file=sys.stderr)
    if blocking_ann:
        print("E2E annotation validation — structural violations in PR-added files:", file=sys.stderr)
        for e in blocking_ann:
            print(f"::error::{e}")
            print(f"  - {e}", file=sys.stderr)
        return 1

    # Report the set the gates actually read. A pure quarantine->corpus rename
    # adds nothing, so an `added`-only denominator would read
    # `OK (0 added run log(s) checked)` on a run that checked one file -- the
    # cheerful zero eval/CLAUDE.md's denominator doctrine exists to prevent.
    print(
        f"E2E gates OK ({len(ar_runlogs)} added-or-renamed run log(s) checked; "
        f"{len(added)} of them newly added)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
