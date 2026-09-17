#!/usr/bin/env python3
"""GH Action: warn when a PR buys a paid eval run that queued work could share.

A `make eval-skill` run costs ~$8-12, 45-65 minutes of machine time, and a full
annotation pass over every test in the skill. It is bought by whichever PR first
touches a snapshot input for that skill. Folding a queued fix in BEFORE the run is
free; landing it afterwards buys a second run.

`/merge-issues` answers "how deep is this skill's queue"
(`.claude/skills/merge-issues/slots.py`) -- but only when a human thinks to ask,
and it is a board-grooming pass run twice a week, so the person spending the money
is the one person who never sees it. This fires at PR time instead.

Two instances prompted it (2026-09-15 triage, recorded in issue #2589):

    proof-conclusion  PR #2578 went red on runlogs Rule 2 and owed a re-run.
                      Issue #1603 carries proof-conclusion corrections and names
                      the same agent body. Nothing connected them; three paid
                      proof-conclusion runs landed on 2026-09-15 and #1603 is
                      still open.
    person-evidence   PR #2538 shipped run 4 with ut_person_evidence_012 still
                      failing, and its fix now buys a further run.

WHAT IT DECIDES

    PR changed paths ---> path_to_skills() ---> {skill}  ---.
                                                            >--- intersect ---> warn
    open issue **Touches:** ---> path_to_skills() ---> {skill} -'

Both sides go through the SAME function. Keeping one implementation is the point:
a check whose two halves disagree about which skill a path belongs to reports
collisions that are not there and misses the ones that are.

WARN-ONLY, AND UNCONDITIONALLY SO -- this always exits 0.

There is deliberately NO baseline file and NO count threshold, for the reason the
sibling lint's docstring gives (`check_negative_reciprocity.py`): one issue closes,
another opens, the count holds, and CI stays green. Promotion to blocking is a
separate decision and must not ride along with this.

Every matching issue is listed, sorted by number, with NO CAP. Some skills carry a
deep queue -- 13 open issues name `search-records` -- and a cap hides the one that
mattered. The SHARED-FIXTURE arm is the one exception and reports counts instead:
one scenario is referenced by 21 skills, and listing their issues measured a single
17,328-character annotation. That arm is a softer signal --
a fixture edit does not oblige a run today -- so it points at `/merge-issues` for
the detail rather than drowning the arm that does.

`icebox` issues are counted. #1603, the flagship instance above, is itself icebox;
filtering icebox out would make this check silent on its own motivating case. Work
folded into a run that is already being bought is free regardless of the queue
label.

THE FAILURE MODE THIS SCRIPT IS BUILT AROUND

It is the first check in this workflow that makes a network call, and it must never
red a PR. That makes silence its dangerous state: "no queued work" and "I could not
read the issue list" render identically as a green step with no annotation. So every
failure path -- a non-zero `gh`, no `gh` on PATH, malformed JSON, a 403 from a token
without `issues: read`, a missing BASE_SHA, a git failure -- emits a `::warning::`
saying the queue could not be read, and THEN returns 0.

WHAT IT DOES NOT READ

The ProjectsV2 GraphQL board. That budget is separate from REST's and exhausts fast
(on 2026-09-15 it returned "API rate limit exceeded" on the first board call while
REST sat untouched at 5000/5000), and a per-PR job cannot spend it. Issue state comes
from the REST issues API. `gh issue list` is not used either -- it resolves through
GraphQL.

Run by .github/workflows/check-runlogs.yml. Stdlib only (the workflow installs no
dependencies) plus three sibling modules that are themselves stdlib-only.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
REPO_ROOT = HARNESS_DIR.parents[1]

# See the same block in check_negative_reciprocity.py: CI's `python <script>.py` adds
# HERE to sys.path, the unit tests' `spec_from_file_location` does not.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

# The board skills' shared `**Touches:**` parser. Imported, not copied: issue #2589
# says to copy `TOUCHES_RE` out of `.claude/skills/slot-map/slot_map.py`, but that
# decision was made when slot_map.py was the only parser and was untracked. A
# tracked, tested one landed the same day (`4087feec1`, issue #2612) and it makes no
# board call, so neither reason for the copy applies to it.
#
# The copy would also be WRONG. A first-match `**Touches:**` regex on issue #2589's
# own body returns a path out of a PROSE sentence -- it would record #2589 as holding
# the proof-conclusion agent slot, which it does not touch. 11 of that body's
# occurrences of the string are mentions; one is the live line.
#
# Rooted at REPO_ROOT rather than relative to __file__ so it resolves identically
# under CI's `python eval/harness/scripts/...` and under pytest's rootdir.
_BOARD_LIB = REPO_ROOT / ".claude" / "skills" / "lib"
if str(_BOARD_LIB) not in sys.path:
    sys.path.insert(0, str(_BOARD_LIB))

import check_runlogs  # noqa: E402
import touches  # noqa: E402
from gh_annotations import gh_warning, write_step_summary  # noqa: E402

# How many issues the REST call asks for per page. `--paginate` walks the rest.
PER_PAGE = 100

# Whole-call budget for `gh api --paginate` (3 pages on the live pool). Generous,
# because exceeding it degrades this check; the point is only that a stalled upstream
# cannot hold the `runlogs` job open to the 360-minute Actions cap.
GH_TIMEOUT_SECONDS = 120


def path_to_skills(path: str, agent_map: dict[str, set[str]]) -> set[str]:
    """The skills whose eval snapshot contains `path`.

    `touches.slot_of` answers the INVERSE of `harness.snapshot.build_snapshot`:
    build_snapshot takes a skill and lists its paths, which cannot answer "which
    skill owns this path" without an N-skill scan. `_SLOT` is the existing mirror
    maintained for exactly that inverse question.

    An AGENT body expands to every skill whose SKILL.md delegates to it via
    `@plugin:<name>` -- one agent edit gates several skills, and matching the skill
    directory instead would miss all of them. That expansion is
    `check_runlogs.skills_referencing_agents`, not a second scan.

    Shared fixtures under `eval/fixtures/{scenarios,mcp}/` are absent HERE because a
    fixture belongs to every skill whose tests reference it, so it names no single
    slot -- `touches._SLOT` excludes them for the same reason. They are not ignored:
    `fixture_affected_skills` resolves them through the reference map instead, and
    main() reports them separately. One scenario (`mid-research-flynn`) is referenced
    by 21 skills, which is why the two arms cannot share a warning format.
    """
    slot = touches.slot_of(path)
    if slot is None:
        return set()
    kind, _, name = slot.partition(":")
    if kind == "skill":
        return {name}
    return set(agent_map.get(name, ()))


def affected_skills(paths, agent_map: dict[str, set[str]]) -> set[str]:
    """Every skill whose snapshot this set of paths reaches."""
    out: set[str] = set()
    for path in paths:
        out |= path_to_skills(path, agent_map)
    return out


def fixture_affected_skills(paths, fixture_map) -> set[str]:
    """Skills reached because the PR changed a SHARED FIXTURE they reference.

    A fixture is in `build_snapshot`, so changing one leaves those skills' run logs
    stale — but it names no single slot, and `check_runlogs.py`'s own fixture arm is
    warn-only for a reason worth repeating here: ~20 of ~25 skills' latest run logs
    are already stale on main from prior fixture drift, so a fixture edit does not
    today oblige anyone to buy a run. Reported separately from the direct arm and in
    softer words, rather than dropped — "this PR buys no paid run" is the wrong thing
    to print on the PR shape that could oblige the most.

    `fixture_map` is `check_runlogs.skills_referencing_fixtures(TESTS_UNIT_DIR)`,
    keyed `(kind, name)` — the same resolver the gate uses, so the two agree about
    which tests reference what.
    """
    out: set[str] = set()
    for path in paths:
        m = check_runlogs.FIXTURE_PATH_RE.match(path)
        if m:
            out |= fixture_map.get((m.group(1), m.group(2)), set())
    return out


def issue_skills(body, agent_map: dict[str, set[str]], fixture_map=None) -> set[str]:
    """The slots an issue's `**Touches:**` line claims, as skill names.

    `paths_from_touches` returns `(kind, path)` TUPLES, not strings -- passing the
    tuple straight to `slot_of` raises AttributeError, which the caller's blanket
    failure path would then turn into a permanently warn-degraded check. Hence the
    explicit unpack.

    An issue with no `**Touches:**` line yields the empty set and is never counted
    as holding a slot: it is unverified, and guessing its paths from the title would
    put work on a queue its author never claimed (rule from issue #2589).
    """
    paths = [path for _kind, path in touches.paths_from_touches(body)]
    out: set[str] = set()
    for path in paths:
        out |= path_to_skills(path, agent_map)
    if fixture_map:
        out |= fixture_affected_skills(paths, fixture_map)
    return out


def _repo_slug() -> str | None:
    """`owner/name` for the REST call, from Actions' env or the git remote."""
    slug = os.environ.get("GITHUB_REPOSITORY")
    if slug:
        return slug
    try:
        url = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=str(REPO_ROOT),
        ).stdout.strip()
    except OSError:
        return None
    if not url:
        return None
    url = url.removesuffix(".git")
    parts = [p for p in url.replace(":", "/").split("/") if p]
    return "/".join(parts[-2:]) if len(parts) >= 2 else None


def fetch_open_issues(runner=subprocess.run) -> tuple[list[dict], str | None]:
    """`(issues, error)`. Never raises; `error` is a human sentence when set.

    REST, not GraphQL -- see the module docstring on the ProjectsV2 budget.

    `--slurp` does NOT flatten: it returns one array PER PAGE, so the live pool comes
    back as `[list:100, list:100, list:20]` and a bare `json.loads` leaves every "row"
    a list, which then fails on `row.get(...)`. Hence the explicit flatten. (The
    `--jq '.[]'` alternative emits newline-delimited JSON, which `json.loads` rejects
    outright.)

    `/issues` returns PULL REQUESTS as well as issues -- 22 of 220 rows on the live
    pool. Every row carrying a `pull_request` key is dropped; without that, every open
    PR reads as queued work.
    """
    slug = _repo_slug()
    if not slug:
        return [], "could not determine the repository (no GITHUB_REPOSITORY, no git remote)"
    try:
        proc = runner(
            [
                "gh",
                "api",
                f"repos/{slug}/issues?state=open&per_page={PER_PAGE}",
                "--paginate",
                "--slurp",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=GH_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        # NOT an OSError, so it needs its own arm.
        return [], f"gh did not respond within {GH_TIMEOUT_SECONDS}s"
    except OSError as e:  # gh not installed
        return [], f"could not run gh ({e})"
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()
        return [], f"gh exited {proc.returncode}: {detail[-1] if detail else 'no stderr'}"
    try:
        pages = json.loads(proc.stdout or "[]")
    except (json.JSONDecodeError, ValueError) as e:
        return [], f"could not parse the gh response as JSON ({e})"
    if not isinstance(pages, list):
        return [], f"unexpected gh response shape: {type(pages).__name__}"

    rows: list[dict] = []
    for page in pages:
        # --slurp gives a list of pages; a single-page/no-slurp response is a flat
        # list of rows. Accept both rather than depending on which one gh returns.
        for row in page if isinstance(page, list) else [page]:
            if isinstance(row, dict) and "pull_request" not in row:
                rows.append(row)
    return rows, None


def queued_by_skill(issues, skills: set[str], agent_map, fixture_map=None) -> dict[str, list[tuple[int, str]]]:
    """`{skill: [(number, title), ...]}`, sorted, for the skills this PR reaches."""
    out: dict[str, list[tuple[int, str]]] = {}
    for issue in issues:
        number = issue.get("number")
        if not isinstance(number, int):
            continue
        title = issue.get("title") or ""
        # `body` is null on an issue opened with no description -- `or ""` upstream
        # in paths_from_touches, but the None must not reach it as a surprise.
        for skill in issue_skills(issue.get("body"), agent_map, fixture_map) & skills:
            out.setdefault(skill, []).append((number, str(title)))
    return {k: sorted(v) for k, v in out.items()}


def _run() -> None:
    """The whole decision. Wrapped by main(), which is what guarantees exit 0."""
    agent_map = check_runlogs.skills_referencing_agents(check_runlogs.PLUGIN_SKILLS_DIR)

    try:
        paths = check_runlogs.git_diff_touched_paths()
    except (KeyError, OSError, subprocess.SubprocessError) as e:
        gh_warning(
            f"could not read this PR's changed paths ({e}), so nothing was checked "
            f"about queued eval-slot work. This check made NO claim either way — "
            f"do not read the absence of a warning below as 'no queued work'. {_BY_HAND}"
        )
        return

    skills = affected_skills(paths, agent_map)
    fixture_map = check_runlogs.skills_referencing_fixtures(check_runlogs.TESTS_UNIT_DIR)
    fixture_skills = fixture_affected_skills(paths, fixture_map) - skills

    if not skills and not fixture_skills:
        print(
            f"This PR touches no eval snapshot input ({len(paths)} changed path(s)); "
            f"it buys no paid run, so there is no slot to share. No issue lookup made."
        )
        return

    if skills:
        print(f"Snapshot inputs touched for: {', '.join(sorted(skills))}.")
    if fixture_skills:
        print(
            f"Shared fixtures touched, which are in the snapshot of: "
            f"{', '.join(sorted(fixture_skills))}."
        )

    issues, error = fetch_open_issues()
    if error:
        gh_warning(
            f"could not read the open issue list ({error}), so the eval-slot queue "
            f"for {', '.join(sorted(skills | fixture_skills))} was NOT checked. This "
            f"check made no claim — do not read the absence of a warning as 'no "
            f"queued work'. {_BY_HAND}"
        )
        return

    queued = queued_by_skill(issues, skills | fixture_skills, agent_map, fixture_map)

    for skill in sorted(skills):
        rows = queued.get(skill, [])
        if not rows:
            print(f"  {skill}: no open issue names a path in its snapshot.")
            continue
        gh_warning(
            f"this PR touches `{skill}`'s eval snapshot, so it buys a paid run "
            f"(~$8-12, 45-65 min, plus a full annotation pass over every test in "
            f"the skill). {len(rows)} open issue(s) name a path in the same "
            f"snapshot and could ride along for free — landing them afterwards buys "
            f"another run: {_listed(rows)}. Folding one in is a judgement call, not "
            f"a requirement; this is warn-only."
        )

    # The fixture arm is ONE annotation and carries COUNTS, not the issue lists.
    #
    # Both halves are measured. One scenario (`mid-research-flynn`) is referenced by
    # 21 skills: one-warning-per-skill buries the direct arm under 21 annotations,
    # and listing the issues measured a single 17,328-character annotation. Counts
    # stay readable and still say where to look.
    #
    # The direct arm above keeps the full uncapped list, which is what #2589 asked
    # for. The asymmetry is deliberate: a directly-touched skill IS buying a run, a
    # fixture-touched one is not (check_runlogs.py's fixture arm is warn-only,
    # because most run logs are already stale from prior fixture drift).
    fixture_rows = {s: queued[s] for s in sorted(fixture_skills) if queued.get(s)}
    if fixture_rows:
        counts = ", ".join(f"{s} ({len(rows)})" for s, rows in fixture_rows.items())
        gh_warning(
            f"this PR changes a shared fixture, which is embedded in the run-log "
            f"snapshot of {len(fixture_skills)} skill(s) — so it leaves their latest "
            f"run logs stale, though nothing here obliges a re-run today "
            f"(check_runlogs.py's fixture arm is warn-only for the same reason). "
            f"{len(fixture_rows)} of them have open issues naming a path in the same "
            f"snapshot, which would be free to fold into whichever run is bought "
            f"next — open-issue counts, not the lists, because listing them measured "
            f"a 17,328-character annotation: {counts}. Run `/merge-issues` for the "
            f"issue numbers themselves. Warn-only."
        )

    print(
        f"\nChecked {len(issues)} open issue(s) against "
        f"{len(skills)} directly-touched and {len(fixture_skills)} fixture-touched "
        f"skill(s)."
    )


def main() -> int:
    """Warn-only, and unconditionally so — this returns 0 on every path.

    The blanket `except Exception` is the thing that makes that docstring true rather
    than aspirational. This step sits in a REQUIRED workflow with no
    `continue-on-error`, so any escaping exception — a shape from the issues API
    nobody anticipated, or a corpus scan raising — would red a PR that has nothing
    wrong with it, over a diagnostic. The traceback is printed, so the failure is
    loud; it just is not fatal.

    The module-level imports are OUTSIDE this guard, so a missing sibling module
    still exits 1. That is deliberate — a `check_slot_queue.py` that cannot import
    `touches` is not a degraded check, it is a broken deployment — but it is the one
    hole in "always exits 0", so do not read that line as covering import time.
    """
    # The house pattern: a Windows console defaults to cp1252 and dies on the
    # em-dashes this module prints; the team it is written for is on Windows.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    try:
        _run()
    except Exception as e:  # noqa: BLE001 - see the docstring; never fatal
        import traceback

        traceback.print_exc()
        gh_warning(
            f"crashed ({type(e).__name__}: {e}), so nothing was checked about queued "
            f"eval-slot work — traceback in the step log. This check made NO claim "
            f"either way. {_BY_HAND}"
        )
    write_step_summary(_SUMMARY_TITLE, footer=_SUMMARY_FOOTER)
    return 0


_BY_HAND = (
    "Run `/merge-issues` (or `.claude/skills/merge-issues/slots.py`) by hand before "
    "buying a paid run."
)


def _listed(rows) -> str:
    return ", ".join(f"#{n} ({t})" for n, t in rows)


_SUMMARY_TITLE = "Eval-slot queue for the skills this PR touches (warn-only)"
_SUMMARY_FOOTER = (
    "Warn-only: this check never blocks the build, and there is deliberately no "
    "baseline file and no count threshold (see the script's docstring). It reads the "
    "REST issues API, never the ProjectsV2 board. An issue with no `**Touches:**` "
    "line is unverified and is never counted."
)


if __name__ == "__main__":
    sys.exit(main())
