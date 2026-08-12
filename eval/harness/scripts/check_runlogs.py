#!/usr/bin/env python3
"""GH Action: enforce the per-PR runlog contract.

Four blocking rules + two warn-only rules per
docs/plan/eval-runlog-versioning.md §C6:

    Rule 1   ≤1 added-or-renamed-into-place v{N}.json per skill.
    Rule 2   latest full-skill run log per touched skill is "active on
             skill-side files" (snapshot matches working tree).
    Rule 2b  (warn-only) the same run log's judge_prompt_hash matches
             eval/harness/judge/prompt.md.
    Rule 3   the same run log's .ann.json has corrections for every
             (test_id, dimension_source, dimension_name) triple. An edited
             annotation gates; a pruned (deleted) one does not.
    Rule 4   no two unit-test files share a `test.id`.
    Rule 5   (warn-only) no OTHER open PR changes a skill eval snapshot this
             PR changes — two PRs on one skill cannot share a paid run.

Run by .github/workflows/check-runlogs.yml. Self-contained — only uses
stdlib + the harness's own `snapshot.py` and `versioning.py` modules. Rule 5
additionally shells out to `gh pr list` (read-only) and reports SKIPPED when
that listing is unavailable.
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

from harness.snapshot import agent_refs_in_text, diff_snapshot_vs_disk, hash_file  # noqa: E402
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

# Match a path inside a skill body or the skill's unit-test dir → owning skill.
# Hoisted out of `main()` so rule 5 keys cross-PR collisions off exactly the
# expression the blocking touched-skill detection keys off, rather than a
# second, parallel notion of which skill a path belongs to.
SKILL_PATH_RE = re.compile(
    r"^(?:packages/engine/plugin/skills|eval/tests/unit)/([^/]+)/"
)

# How many open PRs rule 5 considers. Well above the ~30 this repo carries; the
# cap exists only so a runaway listing cannot stall the job.
OPEN_PR_LIMIT = 200


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
# Adding a unit suite for such a skill later means removing it from this set.
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


def gh_notice(message: str) -> None:
    """Emit a GitHub notice annotation. Informational; never fails the step.

    Used by rule 5 for "this check could not run". A skipped check that printed
    nothing would be indistinguishable in the log from one that ran and found
    nothing, which is the failure mode that makes a check worse than absent.
    """
    print(f"::notice::{message}")


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


def snapshot_skills_for_paths(
    paths: list[str], agent_to_skills: dict[str, set[str]]
) -> set[str]:
    """The skills whose run-log SNAPSHOT the given paths change.

    The single notion of "which skill does this path belong to" in this file,
    shared by the blocking touched-skill detection in `main()` and by rule 5's
    cross-PR collision report. Three path classes, the same three
    `harness.snapshot.build_snapshot` embeds:

      - `packages/engine/plugin/skills/<skill>/**`
      - `eval/tests/unit/<skill>/**`
      - `packages/engine/plugin/agents/<name>.md`, which fans out to every
        skill whose SKILL.md delegates via `@plugin:<name>`

    `eval/runlogs/unit/**` is deliberately NOT a snapshot path: a run log is not
    an input to its own snapshot, so changing one invalidates nothing. `main()`
    adds run-log and annotation paths to its own touched set separately, on
    different (add-vs-delete-asymmetric) rules — that is "new evidence about a
    skill", not snapshot membership, and rule 5 must not inherit it.

    Scenario and MCP-fixture paths are also absent. They are part of a
    snapshot, but they belong to many skills at once and this file holds no
    fixture → skill map to resolve them through.
    """
    skills: set[str] = set()
    agents: set[str] = set()
    for path in paths:
        if RUNLOG_PATH_RE.match(path):
            continue
        m = SKILL_PATH_RE.match(path)
        if m:
            skills.add(m.group(1))
            continue
        m = AGENT_PATH_RE.match(path)
        if m:
            agents.add(m.group(1))
    for agent in sorted(agents):
        skills |= agent_to_skills.get(agent, set())
    return skills


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


# --- Rule 5: another open PR is on the same skill's eval snapshot -----------


def _pr_paths(pr: dict) -> list[str]:
    """Changed paths of one PR as returned by `gh pr list --json files`.

    The GraphQL field is `path`. (REST's `pulls/{n}/files` calls the same thing
    `filename` — the `scope` step in check-runlogs.yml reads that one.) Keying
    on the wrong name yields an empty list for every PR, so rule 5 would report
    "clean" forever with nothing in the log to say otherwise;
    `_files_shape_error` below is the guard against exactly that.
    """
    return [
        f["path"]
        for f in (pr.get("files") or [])
        if isinstance(f, dict) and isinstance(f.get("path"), str) and f["path"]
    ]


def _files_shape_error(prs: list[dict]) -> str | None:
    """A reason the listing's file lists are unreadable, or None.

    Turns the two ways rule 5 could silently pass — the `files` field absent,
    or present under a renamed key — into a SKIPPED notice.
    """
    entries = sum(len(pr.get("files") or []) for pr in prs)
    paths = sum(len(_pr_paths(pr)) for pr in prs)
    if entries == 0:
        return (
            f"`gh pr list --json files` returned {len(prs)} open PR(s) and not one "
            f"file entry — the `files` field did not come back"
        )
    if paths == 0:
        return (
            f"`gh pr list --json files` returned {entries} file entry/entries across "
            f"{len(prs)} open PR(s) but no `path` key on any of them — the field name "
            f"has changed"
        )
    return None


def _list_open_prs(repo: str) -> tuple[list[dict], str | None]:
    """`(prs, error)` for every open PR and its changed paths, in one call.

    `error` is a human-readable reason the listing is unusable; when it is set,
    rule 5 reports SKIPPED instead of clean. Never raises.

    A PR with more than 100 changed files has its file list truncated by the
    GraphQL page size, so rule 5 can under-report on one of those. It cannot
    over-report, which is the right direction for a warn-only check.
    """
    cmd = [
        "gh", "pr", "list",
        "--repo", repo,
        "--state", "open",
        "--limit", str(OPEN_PR_LIMIT),
        "--json", "number,title,isDraft,files",
    ]
    try:
        # encoding= (not bare text=) because PR titles carry em-dashes and smart
        # quotes, and the platform default is cp1252 on the team's Windows boxes.
        proc = subprocess.run(
            cmd, capture_output=True, encoding="utf-8", timeout=120, check=False
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return [], f"could not run `gh pr list` ({exc.__class__.__name__}: {exc})"
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()
        why = tail[-1] if tail else "no stderr"
        return [], f"`gh pr list` exited {proc.returncode}: {why}"
    try:
        prs = json.loads(proc.stdout)
    except ValueError as exc:
        return [], f"`gh pr list` returned unparseable JSON ({exc})"
    if not isinstance(prs, list) or not all(isinstance(p, dict) for p in prs):
        return [], "`gh pr list` returned an unexpected shape (not a list of objects)"
    if not prs:
        # This PR is itself open, so an empty listing means the listing failed
        # to see anything — not that there are no other PRs.
        return [], "`gh pr list` returned no open PRs at all"
    shape_error = _files_shape_error(prs)
    if shape_error:
        return [], shape_error
    return prs, None


def rule5_concurrent_snapshot_prs(
    my_skills: set[str], agent_to_skills: dict[str, set[str]]
) -> None:
    """Rule 5 (warn-only): another open PR changes a skill snapshot this PR changes.

    Two PRs on one skill cannot share a paid eval run. A skill's run log goes
    inactive the moment any file in its snapshot changes, so whichever lands
    second pays its own `make eval-skill SKILL=<skill>` plus a fresh `.ann.json`
    with a correction for every dimension of every test — and if it lands first
    it invalidates the other's run log the same way. `fill-ready`'s Gate 4 tries
    to prevent that at promotion time from the issue's self-reported
    `**Touches:**` line, which is blind to a missing line and to a PR that edits
    more than its issue asked for. This asks the same question from the real
    changed paths, at the point where the code exists to read.

    WARN-ONLY, and it returns no failure count. Two PRs on one skill is
    sometimes the right call — a split the lead asked for, a one-line fix riding
    along with a run already being spent. The value is the author finding out
    before doing the annotation pass twice, not a merge being stopped.

    SKIPPED IS NOT CLEAN. Listing other PRs' files needs a token that can read
    them; when it cannot, this emits a `::notice::` saying the check did not run
    and why, rather than falling through to a silent pass. Reads only — no
    permission beyond the `pull-requests: read` the workflow already holds.

    Exempt skills (`RUNLOG_GATE_EXEMPT_SKILLS`) are still reported. The
    exemption says a skill has no unit suite, which removes the paid-run cost
    but not the collision: two PRs still edit one skill body. The message says
    which case it is.
    """
    if not my_skills:
        print("Rule 5: this PR changes no skill eval snapshot; nothing to compare.")
        return

    repo = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if not repo:
        gh_notice(
            "Rule 5 (concurrent eval-snapshot PRs) SKIPPED: GITHUB_REPOSITORY is "
            "unset, so the open-PR listing has no repo to query. This is a SKIP, "
            "not a clean result — no cross-PR collision check ran."
        )
        return

    prs, error = _list_open_prs(repo)
    if error:
        gh_notice(
            f"Rule 5 (concurrent eval-snapshot PRs) SKIPPED: {error}. A fork PR's "
            f"token, a rate limit, or a missing `gh` all land here. This is a SKIP, "
            f"not a clean result — no cross-PR collision check ran, so check by "
            f"hand whether another open PR touches "
            f"{', '.join('`' + s + '`' for s in sorted(my_skills))}."
        )
        return

    me = os.environ.get("PR_NUMBER", "").strip()
    if not me:
        # Without PR_NUMBER this PR cannot be excluded from the listing and it
        # would collide with itself. Report it rather than emit a bogus warning.
        gh_notice(
            "Rule 5 (concurrent eval-snapshot PRs) SKIPPED: PR_NUMBER is unset, so "
            "this PR cannot be excluded from the open-PR listing and would be "
            "reported as colliding with itself. This is a SKIP, not a clean result."
        )
        return
    others = [pr for pr in prs if str(pr.get("number")) != me]

    # Collisions keyed by shared skill, not by other-PR — the author's question
    # is "who else is on my skill", and a skill with three other PRs on it is one
    # line instead of three (GitHub renders only 10 annotations per step).
    by_skill: dict[str, list[dict]] = {}
    for pr in sorted(others, key=lambda p: p.get("number") or 0):
        for skill in my_skills & snapshot_skills_for_paths(
            _pr_paths(pr), agent_to_skills
        ):
            by_skill.setdefault(skill, []).append(pr)

    if not by_skill:
        print(
            f"Rule 5: no other open PR changes the eval snapshot of "
            f"{', '.join(sorted(my_skills))} "
            f"({len(others)} other open PR(s) checked)."
        )
        return

    for skill, hits in sorted(by_skill.items()):
        refs = ", ".join(
            f"PR #{pr['number']}"
            + (" (draft)" if pr.get("isDraft") else "")
            + f' — "{(pr.get("title") or "").strip()}"'
            for pr in hits
        )
        if skill in RUNLOG_GATE_EXEMPT_SKILLS:
            cost = (
                f"`{skill}` has no unit suite, so no paid run is at stake — but the "
                f"two changes still land on one skill body and will conflict."
            )
        else:
            cost = (
                f"A skill's run log goes inactive the moment any snapshot file "
                f"changes, so these PRs cannot share one paid run: whichever lands "
                f"second needs its own `make eval-skill SKILL={skill}` plus a fresh "
                f".ann.json covering every dimension of every test, and landing it "
                f"first invalidates the other's run log too."
            )
        gh_warning(
            f"skill `{skill}`: this PR changes its eval snapshot, and so does "
            f"{refs}. {cost} Warn-only — two PRs on one skill is sometimes right. "
            f"If it is not, fold the changes together or sequence them with that "
            f"PR's author before the second re-run is paid for."
        )


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

    # Skill bodies, unit tests, and referenced plugin agents — the snapshot path
    # classes. A touched plugin agent surfaces every skill whose SKILL.md
    # references `@plugin:<name>`, because the agent body is part of those
    # skills' run-log snapshots, so editing it outside eval discipline must fail
    # rule 2. Rule 5 reuses this set as-is (before the exemption and
    # deleted-skill filters below), so a collision is reported on exactly the
    # paths that invalidate a run log.
    agent_to_skills = skills_referencing_agents(PLUGIN_SKILLS_DIR)
    snapshot_skills = snapshot_skills_for_paths(touched_paths, agent_to_skills)
    touched_skills: set[str] = set(snapshot_skills)

    for path in touched_paths:
        m = RUNLOG_PATH_RE.match(path)
        if not m:
            continue
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

    # Drop orchestrator skills with no unit suite by design (see
    # RUNLOG_GATE_EXEMPT_SKILLS) so a skill-body edit doesn't hard-fail the
    # per-skill rules with no way to clear them.
    touched_skills -= RUNLOG_GATE_EXEMPT_SKILLS

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

    fails = rule1_max_one_released(touched_releases)

    # Rule 4 runs whenever the PR touches the test corpus at all, and then
    # scans *every* test file rather than only the touched skills — a
    # duplicate is a property of a pair, and the second file of the pair can
    # live in a skill the PR never mentions. Skipping it entirely on PRs that
    # touch no test file keeps the gate quiet on skill/fixture-only changes,
    # which cannot introduce a duplicate id.
    if any(p.startswith("eval/tests/unit/") for p in touched_paths):
        fails += rule4_unique_test_ids(TESTS_UNIT_DIR)

    # Rule 5 runs here — ahead of the RUNLOGS_DIR early return below — because
    # it reads no run log at all. It adds nothing to `fails`.
    rule5_concurrent_snapshot_prs(snapshot_skills, agent_to_skills)

    if not RUNLOGS_DIR.is_dir():
        print(f"No runlogs directory at {RUNLOGS_DIR}; skipping rules 2 + 3.")
        return 1 if fails else 0

    for skill in sorted(touched_skills):
        skill_dir = RUNLOGS_DIR / skill
        if not skill_dir.is_dir():
            gh_error(
                f"skill `{skill}` was touched but has no run logs at "
                f"`eval/runlogs/unit/{skill}/`. Re-run the harness with "
                f"`--skill {skill}` and commit the result before opening this PR.",
            )
            fails += 1
            continue
        latest = latest_full_skill_runlog(skill_dir)
        if latest is None:
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

    if fails:
        print(f"\n{fails} rule violation(s). See annotations above.")
        return 1
    print("All runlog rules satisfied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
