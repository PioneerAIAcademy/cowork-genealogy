#!/usr/bin/env python3
"""GH Action: enforce the per-PR runlog contract.

Four blocking rules + one warn-only rule per
docs/plan/eval-runlog-versioning.md §C6:

    Rule 1   ≤1 added-or-renamed-into-place v{N}.json per skill.
    Rule 2   latest full-skill run log per touched skill is "active on
             skill-side files" (snapshot matches working tree).
    Rule 2b  (warn-only) the same run log's judge_prompt_hash matches
             eval/harness/judge/prompt.md.
    Rule 2f  (warn-only fixture arm) a changed shared fixture under
             eval/fixtures/{scenarios,mcp}/ marks every skill whose tests
             reference it, and warns when that skill's run log is now stale
             (#1094 — see rule2_fixture_touched for why it only warns).
    Rule 3   the same run log's .ann.json has corrections for every
             (test_id, dimension_source, dimension_name) triple. An edited
             annotation gates; a pruned (deleted) one does not.
    Rule 4   no two unit-test files share a `test.id`.

Run by .github/workflows/check-runlogs.yml. Self-contained — only uses
stdlib + the harness's own `snapshot.py` and `versioning.py` modules.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
sys.path.insert(0, str(HARNESS_DIR))

from harness.snapshot import (  # noqa: E402
    agent_refs_in_text,
    collect_refs,
    diff_snapshot_vs_disk,
    hash_file,
)
from harness.versioning import classify  # noqa: E402


REPO_ROOT = HARNESS_DIR.parents[1]
RUNLOGS_DIR = REPO_ROOT / "eval" / "runlogs" / "unit"
JUDGE_PROMPT_PATH = REPO_ROOT / "eval" / "harness" / "judge" / "prompt.md"
PLUGIN_SKILLS_DIR = REPO_ROOT / "packages" / "engine" / "plugin" / "skills"
TESTS_UNIT_DIR = REPO_ROOT / "eval" / "tests" / "unit"


# Match `eval/runlogs/unit/<skill>/<file>.json`
RUNLOG_PATH_RE = re.compile(r"^eval/runlogs/unit/([^/]+)/([^/]+\.json)$")

# Match `packages/engine/plugin/agents/<name>.md` — a plugin agent prompt.
# An agent edit gates every skill whose SKILL.md references `@plugin:<name>`
# (the agent body is embedded in those skills' run-log snapshots), exactly
# like an edit inside the skill dir itself.
AGENT_PATH_RE = re.compile(r"^packages/engine/plugin/agents/([^/]+)\.md$")

# Match a shared fixture the run-log snapshot embeds:
#   eval/fixtures/scenarios/<name>/<file>  ->  ("scenarios", "<name>")
#   eval/fixtures/mcp/<name>.json          ->  ("mcp", "<name>")
# A fixture edit gates every skill whose tests reference it — see
# skills_referencing_fixtures. The `<name>` here is the reference KEY the
# resolver produces: for scenarios it is the directory name (matching a test's
# `input.scenario`), for mcp it is the bare name with `.json` stripped
# (matching a bare entry in a test's `mcp_fixtures[]`).
FIXTURE_PATH_RE = re.compile(r"^eval/fixtures/(scenarios|mcp)/([^/]+?)(?:/.*|\.json)$")


# Skills exempt from the per-skill runlog rules (2 + 3) — skills that by design
# have no unit suite, so they have no `eval/tests/unit/<skill>/` scaffolding and
# no `eval/runlogs/unit/<skill>/` dir. Without this exemption, any edit to the
# skill body hard-fails with "no run logs" and the `eval-cosmetic-skip` label
# can't clear it — that escape hatch only relaxes rule 2 once a runlog dir
# already exists.
#
# Two reasons a skill lands here:
#   - `research` — an orchestrator, validated by e2e GPS fixtures rather than
#     unit tests.
#   - `forget-and-rederive` — a setup/utility skill, not a research step. It
#     strips a slice of the local tree to stage a practice run, so there is no
#     genealogical output for a judge to grade: its mechanical half is the
#     `tree_forget` MCP tool (unit-tested in the engine; it was a bundled Python
#     script until 2026-07-23) and its other half is a behavioral prohibition
#     (don't re-read the forgotten facts off the tree) that a unit transcript
#     can't observe. Permanent, not a stopgap — confirmed by Dallan 2026-07-18.
#
# The gate consults this set only for skills that still have no
# eval/tests/unit/<skill>/ dir (see the `exempt_suiteless` filter in main), so
# adding a unit suite later auto-arms the gate — you need not also remove the
# skill from this set, though pruning a now-suited entry keeps it tidy.
# Otherwise keep this set minimal: it is the only way to edit a skill body
# without eval discipline, so every addition needs the "no unit suite by design"
# rationale above, not just "the gate is inconvenient right now."
RUNLOG_GATE_EXEMPT_SKILLS = frozenset({"research", "forget-and-rederive"})


def gh_error(message: str, *, file: str | None = None) -> None:
    """Emit a GitHub error annotation (also fails the step)."""
    prefix = f"::error file={file}::" if file else "::error::"
    print(f"{prefix}{message}")


def gh_warning(message: str, *, file: str | None = None) -> None:
    prefix = f"::warning file={file}::" if file else "::warning::"
    print(f"{prefix}{message}")


def git_diff_changes() -> list[tuple[str, str | None]]:
    """Return [(status_letter, path)] for AR-filtered changes in the PR.

    Uses --diff-filter=AR so newly-added files AND renamed-into-place
    files (the candidate → released flow) both count. Rule 1's
    released-runlog counting keys off this view.
    """
    base = os.environ["BASE_SHA"]
    head = os.environ["HEAD_SHA"]
    out = subprocess.check_output(
        ["git", "diff", "--name-status", "--diff-filter=AR", base, head],
        text=True,
    )
    rows: list[tuple[str, str | None]] = []
    for line in out.splitlines():
        parts = line.split("\t")
        if not parts:
            continue
        status = parts[0]
        # "A\t<path>" or "R<score>\t<from>\t<to>"
        if status.startswith("A"):
            rows.append(("A", parts[1]))
        elif status.startswith("R"):
            rows.append(("R", parts[-1]))  # dest path
    return rows


def git_diff_deleted_paths() -> list[str]:
    """Paths the PR DELETED. Used to tell a pruned annotation (housekeeping)
    apart from an edited one (which must still gate rule 3)."""
    base = os.environ["BASE_SHA"]
    head = os.environ["HEAD_SHA"]
    out = subprocess.check_output(
        ["git", "diff", "--name-only", "--diff-filter=D", f"{base}...{head}"],
        text=True,
    )
    return [line for line in out.splitlines() if line]


def git_diff_touched_paths() -> list[str]:
    """Every path the PR ITSELF changed, regardless of status (added,
    modified, deleted, renamed — both sides of a rename).

    The touched-skill detection for rules 2 + 3 keys off this view: a
    *modification* to a SKILL.md, test JSON, or referenced plugin agent
    invalidates the run-log snapshot just as surely as an addition, so the
    AR-only view rule 1 uses would miss it.

    Uses a **three-dot** diff (``base...head`` == ``merge-base(base, head)``
    → ``head``) so the change set is the PR's own commits only — exactly what
    GitHub's "Files changed" tab shows. A two-dot ``base head`` diff would
    additionally surface everything main added since this branch diverged as
    spurious *deletions* (present in base, absent in head), dragging skills the
    PR never touched into `touched_skills` and hard-failing their (stale-vs-main
    but untouched-by-this-PR) run logs on rule 2. Keying off merge-base makes a
    branch that is simply behind main immune to that phantom. Full history is
    fetched in CI (``fetch-depth: 0``), so the merge-base resolves.
    """
    base = os.environ["BASE_SHA"]
    head = os.environ["HEAD_SHA"]
    out = subprocess.check_output(
        ["git", "diff", "--name-status", f"{base}...{head}"],
        text=True,
    )
    paths: list[str] = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        paths.extend(p for p in parts[1:] if p)
    return paths


def skills_referencing_agents(skills_root: Path) -> dict[str, set[str]]:
    """Map each plugin-agent name to the skills whose SKILL.md references
    it via `@plugin:<name>`. One scan over the skill corpus."""
    mapping: dict[str, set[str]] = {}
    if not skills_root.is_dir():
        return mapping
    for skill_md in sorted(skills_root.glob("*/SKILL.md")):
        try:
            text = skill_md.read_text(encoding="utf-8")
        except OSError:
            continue
        for agent in agent_refs_in_text(text):
            mapping.setdefault(agent, set()).add(skill_md.parent.name)
    return mapping


def skills_referencing_fixtures(tests_root: Path) -> dict[tuple[str, str], set[str]]:
    """Map each shared-fixture reference key -> the skills whose unit tests
    reference it, so a changed fixture can mark those skills touched (rule 2).

    The key is ``(kind, name)`` where ``kind`` is ``"scenarios"`` or ``"mcp"`` —
    matching FIXTURE_PATH_RE's first group — so a scenario and an mcp fixture
    that happen to share a bare name never collide.

    Resolution is delegated to ``snapshot.collect_refs``, the single place the
    reference contract lives (``input.scenario`` for scenarios, bare entries in
    ``mcp_fixtures[]`` for mcp fixtures). Keeping one implementation is what
    guarantees the gate resolves fixtures exactly the way the snapshot embedded
    them — the two traps (bare mcp name, scenario-by-directory) can only drift
    if this ever grows a second copy.
    """
    mapping: dict[tuple[str, str], set[str]] = {}
    if not tests_root.is_dir():
        return mapping
    for skill_dir in sorted(tests_root.iterdir()):
        if not skill_dir.is_dir():
            continue
        refs = collect_refs(skill_dir, None)
        for name in refs["scenarios"]:
            mapping.setdefault(("scenarios", name), set()).add(skill_dir.name)
        for name in refs["fixtures"]:
            mapping.setdefault(("mcp", name), set()).add(skill_dir.name)
    return mapping


def rule1_max_one_released(touched_releases: dict[str, list[str]]) -> int:
    """Rule 1: ≤1 added/renamed-into-place v{N}.json per skill."""
    fails = 0
    for skill, files in touched_releases.items():
        if len(files) > 1:
            paths = ", ".join(files)
            gh_error(
                f"skill `{skill}`: {len(files)} released run logs added/renamed in this PR. "
                f"Max is 1. Offending files: {paths}",
            )
            fails += 1
    return fails


def latest_full_skill_runlog(skill_dir: Path) -> tuple[str, dict] | None:
    """Return (filename, parsed_log) for the latest full-skill run log
    in `skill_dir` — preferring released v{N}.json, then candidate
    v{N}_<ts>.json. Scratch runs ignored.
    """
    released: list[tuple[int, str]] = []
    candidates: list[tuple[int, str, str]] = []
    for path in skill_dir.iterdir():
        if not path.is_file():
            continue
        c = classify(path.name)
        if c.kind == "released" and c.version is not None:
            released.append((c.version, path.name))
        elif c.kind == "candidate" and c.version is not None and c.timestamp is not None:
            candidates.append((c.version, c.timestamp, path.name))

    if released:
        released.sort(reverse=True)
        filename = released[0][1]
    elif candidates:
        candidates.sort(reverse=True)
        filename = candidates[0][2]
    else:
        return None
    return filename, json.loads((skill_dir / filename).read_text(encoding="utf-8"))


def resolve_latest_runlog(
    skill_dir: Path,
) -> tuple[str, tuple[str, dict] | None]:
    """Locate a skill's latest full-skill run log, distinguishing the two
    no-target cases the callers report differently.

    Returns ``("ok", (filename, log))``, ``("no_dir", None)`` when the runlog
    directory is absent, or ``("no_runlog", None)`` when the directory holds no
    full-skill run log. Shared by the blocking per-skill loop and the warn-only
    fixture loop so both resolve the run log identically; each caller maps the
    reason to its own error-vs-warning message.
    """
    if not skill_dir.is_dir():
        return "no_dir", None
    latest = latest_full_skill_runlog(skill_dir)
    if latest is None:
        return "no_runlog", None
    return "ok", latest


def rule2_active(skill: str, log: dict, filename: str) -> int:
    """Rule 2 (blocking): latest run log's snapshot matches disk.

    Cosmetic-skip escape hatch: when `COSMETIC_SKIP=1` (set by the workflow
    because a senior applied the `eval-cosmetic-skip` label on this PR), a
    snapshot mismatch is downgraded to a warning instead of a block — the
    prior run log + its already-complete annotations stand without a re-run.
    The bypass can never outlive the commit it was approved for: on a new push
    the workflow sets COSMETIC_SKIP=0 from the event itself, without consulting
    the label, so a senior must re-apply after every push. (Until 2026-07-31
    that was enforced by the workflow deleting the label and re-reading it,
    which silently did nothing on a fork PR's read-only token — see the header
    comment in check-runlogs.yml. The label is still removed, by
    cosmetic-skip-strip.yml, but only so the PR's UI matches; nothing here
    depends on it.) Only rule 2 is relaxed: rules 1 and 3 still run, so an
    unannotated baseline can't be waved through.
    """
    snapshot = log.get("snapshot") or {}
    diffs = diff_snapshot_vs_disk(snapshot, REPO_ROOT)
    if not diffs:
        return 0
    diff_lines = "\n".join(f"  - {p}: {kind}" for p, kind in sorted(diffs.items()))
    if os.environ.get("COSMETIC_SKIP") == "1":
        gh_warning(
            f"skill `{skill}`: latest run log `{filename}` differs from the working "
            f"tree in {len(diffs)} file(s), but the `eval-cosmetic-skip` label "
            f"bypasses rule 2 for this PR — no re-run required. Confirm the change "
            f"is behavior-neutral before approving.\n" + diff_lines,
        )
        return 0
    gh_error(
        f"skill `{skill}`: latest full-skill run log `{filename}` is NOT active — "
        f"{len(diffs)} snapshot file(s) differ from the working tree. Re-run the "
        f"harness (`uv run python eval/harness/run_tests.py --skill {skill}`) so "
        f"the run log reflects the PR-branch state. If the change is purely "
        f"cosmetic (no behavior change), a senior can instead apply the "
        f"`eval-cosmetic-skip` label to this PR.\n" + diff_lines,
    )
    return 1


def rule2_fixture_touched(
    skill: str, log: dict, filename: str, changed_fixture_paths: set[str]
) -> None:
    """Warn-only fixture arm of rule 2 (#1094): a shared fixture this PR
    changed is embedded in `skill`'s latest run-log snapshot, so that run log
    is now stale — but we warn rather than block.

    Warn-only, not blocking, is the lead's settled decision (#1094): ~20 of ~25
    skills' latest run logs are already stale on `main` from prior fixture
    drift, and `mid-research-flynn` alone is referenced by 20 skills, so a
    blocking gate would fire a ~$160-240 / 20-annotation re-run wave on the
    first fixture-only PR and train `eval-cosmetic-skip` misuse on edits that
    are *not* behavior-neutral. Blocking only on *new* staleness (leaving the
    pre-existing baseline as warnings) is the named target end-state; it needs
    a frozen-baseline anchor not yet designed and is deferred to #1242.
    See eval/CLAUDE.md § "GitHub Action rules".

    Attribution is scoped to the fixtures THIS PR changed: only snapshot keys in
    `changed_fixture_paths` are considered, so the warning names the files the
    fixture edit actually invalidated — not the skill's other pre-existing
    snapshot drift (SKILL.md, unrelated fixtures), which is the #1217 baseline
    problem this edit did not cause. Scoping this way also means a skill whose
    snapshot never embedded the changed fixture (e.g. it was added to the tests
    after the run log) produces no diff and no warning — no false positive.
    """
    snapshot = log.get("snapshot") or {}
    diffs = diff_snapshot_vs_disk(snapshot, REPO_ROOT)
    fixture_diffs = {p: kind for p, kind in diffs.items() if p in changed_fixture_paths}
    if not fixture_diffs:
        return
    diff_lines = "\n".join(
        f"  - {p}: {kind}" for p, kind in sorted(fixture_diffs.items())
    )
    gh_warning(
        f"skill `{skill}`: a shared fixture this PR changed is embedded in the "
        f"latest run log `{filename}`, which no longer matches it in "
        f"{len(fixture_diffs)} file(s). Re-run the harness (`uv run python "
        f"eval/harness/run_tests.py --skill {skill}`) and commit the result. "
        f"Warn-only for now — see eval/CLAUDE.md § \"GitHub Action rules\".\n"
        + diff_lines,
    )


def rule2b_judge_prompt(skill: str, log: dict, filename: str) -> None:
    """Rule 2b (warn-only): judge_prompt_hash matches current judge prompt."""
    expected = log.get("judge_prompt_hash") or ""
    actual = hash_file("eval/harness/judge/prompt.md", JUDGE_PROMPT_PATH)
    if expected and actual and expected != actual:
        gh_warning(
            f"skill `{skill}`: latest run log `{filename}` was scored against an "
            f"older judge prompt (hash {expected[:12]}…). Current judge prompt "
            f"hash is {actual[:12]}…. Re-running would likely produce different "
            f"scores — interpret the corrected mean cautiously.",
        )


def rule3_completeness(skill: str, log: dict, filename: str, skill_dir: Path) -> int:
    """Rule 3 (blocking): every dimension has a correction entry in .ann.json."""
    ann_filename = filename.removesuffix(".json") + ".ann.json"
    ann_path = skill_dir / ann_filename
    if not ann_path.exists():
        gh_error(
            f"skill `{skill}`: latest run log `{filename}` has no annotation file "
            f"(`{ann_filename}` missing). Review every dimension before opening "
            f"the PR.",
        )
        return 1
    ann = json.loads(ann_path.read_text(encoding="utf-8"))
    corrections = ann.get("corrections") or []
    # Guard against malformed / hand-written corrections before building the
    # reviewed-set. Annotations must come from the CRUD UI; a hand-edited or
    # stale-tool file can omit the required keys (notably the deprecated
    # `run_index`/`dimension`/`source` shape Claude tends to emit when asked
    # to write a .ann.json directly). Without this guard the set-comprehension
    # below dies with an opaque `KeyError: 'dimension_source'` instead of a
    # reviewable error. See the eval/CLAUDE.md note: never hand-write .ann.json.
    REQUIRED_KEYS = ("test_id", "dimension_source", "dimension_name")
    malformed = [
        c
        for c in corrections
        if not (isinstance(c, dict) and all(k in c for k in REQUIRED_KEYS))
    ]
    if malformed:
        gh_error(
            f"skill `{skill}`: annotation `{ann_filename}` has {len(malformed)} "
            f"of {len(corrections)} correction(s) missing required keys "
            f"{REQUIRED_KEYS} — likely hand-written or in the deprecated "
            f"run_index/dimension/source shape. Annotations must be produced by "
            f"the CRUD UI, not written by hand. Delete the file and re-review "
            f"every dimension in the UI.",
        )
        return 1
    have = {
        (c["test_id"], c["dimension_source"], c["dimension_name"])
        for c in corrections
    }
    missing: list[tuple[str, str, str]] = []
    for t in log.get("tests") or []:
        for d in t.get("outcome_summary", {}).get("aggregated_dimensions") or []:
            key = (t["test_id"], d["source"], d["name"])
            if key not in have:
                missing.append(key)
    if not missing:
        return 0
    sample = ", ".join(f"{tid}/{src}/{name}" for tid, src, name in missing[:5])
    gh_error(
        f"skill `{skill}`: annotation `{ann_filename}` is incomplete — "
        f"{len(missing)} dimension(s) are unreviewed (e.g., {sample}). "
        f"Review every dimension in the CRUD UI before opening the PR.",
    )
    return 1


def _format_path(path: Path) -> str:
    """Repo-relative when possible, absolute otherwise (tests point the scan
    at a tmp dir outside REPO_ROOT)."""
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def rule4_unique_test_ids(tests_root: Path) -> int:
    """Rule 4 (blocking): no two unit-test files share a `test.id`.

    Duplicate ids corrupt grading rather than failing loudly. The harness
    collects every file (`_collect_specs`), so one run log ends up with two
    `tests[]` entries under the same `test_id`; annotations key on
    `(test_id, dimension_source, dimension_name)`, so the second entry's
    corrections silently overwrite the first's — and rule 3 then passes,
    because the lookup finds *a* correction for every dimension. Selection by
    id (`--test ut_x`, and the CRUD UI's readTest) takes the first scan hit,
    so you can also run or edit the wrong one of a pair.
    """
    if not tests_root.is_dir():
        return 0

    by_id: dict[str, list[Path]] = {}
    for path in sorted(tests_root.glob("*/*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue  # malformed files are the loader's problem, not this gate's
        test_id = (data.get("test") or {}).get("id")
        if test_id:
            by_id.setdefault(test_id, []).append(path)

    fails = 0
    for test_id, paths in sorted(by_id.items()):
        if len(paths) < 2:
            continue
        rel = ", ".join(_format_path(p) for p in paths)
        gh_error(
            f"test id `{test_id}` is used by {len(paths)} files: {rel}. "
            f"Test ids must be unique — duplicates make the harness emit two "
            f"run-log entries under one id, and annotations for one silently "
            f"become the other's. Give the new test its own id "
            f"(the CRUD UI's next-id helper picks one per skill).",
            file=_format_path(paths[-1]),
        )
        fails += 1
    return fails


def main() -> int:
    changes = git_diff_changes()

    # Collect (skill -> [filename]) for added/renamed-into-place released
    # files. Rule 1 enforces ≤1 per skill.
    touched_releases: dict[str, list[str]] = {}
    for _, path in changes:
        if path is None:
            continue
        m = RUNLOG_PATH_RE.match(path)
        if not m:
            continue
        skill, filename = m.group(1), m.group(2)
        if classify(filename).kind == "released":
            touched_releases.setdefault(skill, []).append(path)

    # Touched-skill detection for rules 2 + 3 is asymmetric by path class.
    #
    # Skill bodies, tests, and agents use the any-status view: a *modification*
    # invalidates a snapshot just as surely as an addition.
    #
    # Run logs do not. A run log is not an input to its own snapshot, so
    # modifying or deleting one cannot invalidate anything — only *adding* one
    # is new evidence about a skill. Housekeeping that rewrites or prunes
    # committed run logs (scripts/prune_runlogs.py) would otherwise mark every
    # skill touched and hard-fail rule 2 on pre-existing fixture drift it did
    # not cause (19 of 26 skills are already inactive on main; issues #1217,
    # #1094).
    added_runlog_paths = {p for _, p in changes if p is not None}
    deleted_paths = set(git_diff_deleted_paths())
    touched_paths = git_diff_touched_paths()
    touched_skills: set[str] = set()
    touched_agents: set[str] = set()
    touched_fixtures: set[tuple[str, str]] = set()
    touched_fixture_paths: set[str] = set()
    for path in touched_paths:
        m = RUNLOG_PATH_RE.match(path)
        if m:
            # RUNLOG_PATH_RE matches `.ann.json` too (it ends in `.json`), and
            # the two need opposite rules:
            #
            #   run log     — gates only when ADDED. Rewriting or pruning one is
            #                 housekeeping; a run log is not an input to its own
            #                 snapshot, so it cannot invalidate anything.
            #   annotation  — gates unless DELETED. An *edited* .ann.json is a
            #                 grading change and must still face rule 3, or a PR
            #                 could walk an annotation back from complete to
            #                 partial unchallenged. Only its deletion (pruned
            #                 alongside its run log) is housekeeping.
            if path.endswith(".ann.json"):
                if path not in deleted_paths:
                    touched_skills.add(m.group(1))
            elif path in added_runlog_paths:
                touched_skills.add(m.group(1))
            continue
        # Changes to skill files / tests surface their owning skill.
        m = re.match(r"^(?:packages/engine/plugin/skills|eval/tests/unit)/([^/]+)/", path)
        if m:
            touched_skills.add(m.group(1))
            continue
        m = AGENT_PATH_RE.match(path)
        if m:
            touched_agents.add(m.group(1))
            continue
        m = FIXTURE_PATH_RE.match(path)
        if m:
            touched_fixtures.add((m.group(1), m.group(2)))
            touched_fixture_paths.add(path)

    # A touched plugin agent gates every skill whose SKILL.md references
    # `@plugin:<name>` — the agent body is part of those skills' run-log
    # snapshots, so editing it outside eval discipline must fail rule 2.
    if touched_agents:
        referencing = skills_referencing_agents(PLUGIN_SKILLS_DIR)
        for agent in sorted(touched_agents):
            touched_skills |= referencing.get(agent, set())

    # A touched shared fixture gates every skill whose tests reference it — the
    # fixture is embedded in those skills' run-log snapshots, so editing it
    # leaves them stale. This arm is WARN-ONLY (#1094, see rule2_fixture_touched):
    # kept in a set separate from `touched_skills` so it never feeds the
    # blocking rules. A skill already directly touched is gated at full strength,
    # so drop it from here to avoid a duplicate (weaker) annotation.
    fixture_touched_skills: set[str] = set()
    if touched_fixtures:
        fixture_referencing = skills_referencing_fixtures(TESTS_UNIT_DIR)
        for key in sorted(touched_fixtures):
            fixture_touched_skills |= fixture_referencing.get(key, set())
    # Exempt only the orchestrator skills that still have NO unit suite — keyed
    # on directory existence, not name, so adding eval/tests/unit/<skill>/ later
    # auto-arms the gate instead of silently staying exempt until someone also
    # remembers to edit RUNLOG_GATE_EXEMPT_SKILLS (#1094 review). No-op today:
    # neither exempt skill has a unit-test dir. A skill-body edit to such a
    # suiteless skill would otherwise hard-fail the per-skill rules with no way
    # to clear them (it has a plugin dir but no run logs).
    exempt_suiteless = {
        s for s in RUNLOG_GATE_EXEMPT_SKILLS if not (TESTS_UNIT_DIR / s).is_dir()
    }
    fixture_touched_skills -= exempt_suiteless
    fixture_touched_skills -= touched_skills
    touched_skills -= exempt_suiteless

    # Drop DELETED skills: when a PR removes a skill entirely — its skill dir
    # AND its unit-test dir are both absent from the working tree — there is
    # nothing left to re-run, so rules 2 + 3 have no gate target. Historical
    # runlogs under eval/runlogs/unit/<skill>/ may stay behind as history.
    # A skill with EITHER dir still present is still gated (a half-deleted
    # skill is an inconsistent state the gate should surface, not skip).
    touched_skills = {
        s
        for s in touched_skills
        if (PLUGIN_SKILLS_DIR / s).is_dir() or (TESTS_UNIT_DIR / s).is_dir()
    }
    fixture_touched_skills = {
        s
        for s in fixture_touched_skills
        if (PLUGIN_SKILLS_DIR / s).is_dir() or (TESTS_UNIT_DIR / s).is_dir()
    }

    fails = rule1_max_one_released(touched_releases)

    # Rule 4 runs whenever the PR touches the test corpus at all, and then
    # scans *every* test file rather than only the touched skills — a
    # duplicate is a property of a pair, and the second file of the pair can
    # live in a skill the PR never mentions. Skipping it entirely on PRs that
    # touch no test file keeps the gate quiet on skill/fixture-only changes,
    # which cannot introduce a duplicate id.
    if any(p.startswith("eval/tests/unit/") for p in touched_paths):
        fails += rule4_unique_test_ids(TESTS_UNIT_DIR)

    if not RUNLOGS_DIR.is_dir():
        print(f"No runlogs directory at {RUNLOGS_DIR}; skipping rules 2 + 3.")
        return 1 if fails else 0

    for skill in sorted(touched_skills):
        skill_dir = RUNLOGS_DIR / skill
        status, latest = resolve_latest_runlog(skill_dir)
        if status == "no_dir":
            gh_error(
                f"skill `{skill}` was touched but has no run logs at "
                f"`eval/runlogs/unit/{skill}/`. Re-run the harness with "
                f"`--skill {skill}` and commit the result before opening this PR.",
            )
            fails += 1
            continue
        if status == "no_runlog":
            gh_error(
                f"skill `{skill}` was touched but has no full-skill run log. "
                f"Re-run the harness with `--skill {skill}` to produce one.",
            )
            fails += 1
            continue
        filename, log = latest
        fails += rule2_active(skill, log, filename)
        rule2b_judge_prompt(skill, log, filename)
        fails += rule3_completeness(skill, log, filename, skill_dir)

    # Warn-only fixture arm (#1094): a shared fixture this PR changed marks its
    # referencing skills' run logs stale, but only warns — never fails. See
    # rule2_fixture_touched for why blocking is deferred.
    for skill in sorted(fixture_touched_skills):
        skill_dir = RUNLOGS_DIR / skill
        status, latest = resolve_latest_runlog(skill_dir)
        if status == "no_dir":
            gh_warning(
                f"skill `{skill}`: a shared fixture this PR changed is referenced "
                f"by its tests, but it has no run logs at "
                f"`eval/runlogs/unit/{skill}/` to check. Re-run `--skill {skill}`.",
            )
            continue
        if status == "no_runlog":
            gh_warning(
                f"skill `{skill}`: a shared fixture this PR changed is referenced "
                f"by its tests, but it has no full-skill run log to check. "
                f"Re-run `--skill {skill}`.",
            )
            continue
        filename, log = latest
        rule2_fixture_touched(skill, log, filename, touched_fixture_paths)

    if fails:
        print(f"\n{fails} rule violation(s). See annotations above.")
        return 1
    print("All runlog rules satisfied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
