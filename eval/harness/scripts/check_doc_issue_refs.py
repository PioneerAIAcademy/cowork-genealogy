#!/usr/bin/env python3
"""GH Action (warn-only): flag docs that cite a CLOSED GitHub issue.

An issue number in prose is a copy of state GitHub owns, and nothing keeps the
copy honest. Measured 2026-08-04: the docs in scope cite **130 distinct issue
numbers and 28 of them (22%) are already closed.** That is not a hypothetical
rot — `docs/architecture.md` §9.4 listed #999 as open tracking hours after #999
was closed, and the only thing that caught it was a human reading the row.

This is the answer to "why do the docs need updating on every PR?" They do not.
They need updating when the thing they point at moves, and a lint is what should
say so.

**Warn-only, and it must stay that way until the backlog is cleared.** A blocking
check that fires 28 times on day one gets bypassed, and a bypassed check is worse
than none. Promoting it is tracked separately.

**Network.** Resolving a number needs the GitHub API, which is why this is a CI
step and not a pytest. Every failure path — no `gh`, no auth, rate limit, a fork
PR with a read-only token — exits 0 with a notice. A doc lint must never be the
reason a contributor's PR is red.

Run by .github/workflows/check-runlogs.yml. Stdlib only, like its siblings.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Where prose cites issues. `docs/plan/` is included: a plan naming a closed
# issue is usually a plan whose work shipped, which is exactly the signal
# CLAUDE.md asks for ("a plan is deleted once the work ships").
SCAN_DIRS = ["docs"]
SCAN_FILES = ["CLAUDE.md", "DEVELOPMENT.md", "README.md", "eval/CLAUDE.md", "eval/README.md"]

# `#1234`, but not a markdown heading (`### 1.2`), a colour (`#fff`), or an
# anchor (`](#section)`). Three digits minimum: this repo passed #1000 long ago
# and two-digit matches are overwhelmingly false (`#1` in a numbered list).
ISSUE_RE = re.compile(r"(?<![\w&#])#(\d{3,5})\b")


def scan_targets() -> list[Path]:
    out: list[Path] = []
    for d in SCAN_DIRS:
        out.extend(sorted((REPO_ROOT / d).rglob("*.md")))
    for f in SCAN_FILES:
        p = REPO_ROOT / f
        if p.exists():
            out.append(p)
    return out


# Only a citation in a TRACKING position is a defect when it closes. Citing a
# closed issue as *history* is correct and common — "three subagents were
# deleted on 2026-08-02 (issue #1161)" stays true forever, and ADR-0001,
# ADR-0007, CLAUDE.md and DEVELOPMENT.md all do it deliberately. Flagging those
# would put 99 warnings on the first run, and a lint that noisy is one nobody
# reads. Scoped to the two shapes that assert an issue is still *live*:
#
#   1. a trailing table cell under a column headed Tracking / Issue / Issues /
#      Tracked by — `architecture.md` §9.4's, which is where #999 went stale;
#   2. prose that says so — "tracked as #911", "→ #1285", "carries #911".
#
# Everything else is left alone. That is a deliberate false-NEGATIVE trade: a
# stale history-shaped cite is harmless, a stale tracking-shaped one sends the
# next reader to a closed issue for work that is still undone.
TRACKING_HEADER_RE = re.compile(r"^\s*\|(.+)\|\s*$")
TRACKING_COL_RE = re.compile(r"^\s*(tracking|tracked by|issues?|tracked)\s*$", re.I)
TRACKING_PROSE_RE = re.compile(
    r"(?:tracked (?:as|in|by)|tracking|carries|filed as|gated on|blocked (?:by|on)|→)"
    r"[^.\n]{0,40}$",
    re.I,
)


def _tracking_columns(header: str, divider: str) -> set[int]:
    """Indices of Tracking-ish columns in a markdown table, or empty."""
    if not re.match(r"^\s*\|[\s:|-]+\|\s*$", divider):
        return set()
    cells = [c for c in header.strip().strip("|").split("|")]
    return {i for i, c in enumerate(cells) if TRACKING_COL_RE.match(c.strip().strip("*`"))}


def refs_by_number(paths: list[Path]) -> dict[int, list[tuple[Path, int]]]:
    """{issue number: [(file, line), ...]} for TRACKING-position citations."""
    found: dict[int, list[tuple[Path, int]]] = {}
    for path in paths:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeDecodeError):
            continue
        tracking_cols: set[int] = set()
        for lineno, line in enumerate(lines, 1):
            # Entering a table: remember which columns are tracking columns.
            if TRACKING_HEADER_RE.match(line):
                nxt = lines[lineno] if lineno < len(lines) else ""
                cols = _tracking_columns(line, nxt)
                if cols:
                    tracking_cols = cols
                    continue
            elif line.strip() == "":
                tracking_cols = set()

            hits: list[int] = []
            if tracking_cols and line.lstrip().startswith("|"):
                cells = line.strip().strip("|").split("|")
                for i in tracking_cols:
                    if i < len(cells):
                        hits += [int(m.group(1)) for m in ISSUE_RE.finditer(cells[i])]
            for m in ISSUE_RE.finditer(line):
                if TRACKING_PROSE_RE.search(line[: m.start()]):
                    hits.append(int(m.group(1)))

            for n in set(hits):
                found.setdefault(n, []).append((path, lineno))
    return found


def closed_issues(numbers: list[int]) -> set[int] | None:
    """The subset that GitHub reports as CLOSED. None when we cannot ask.

    One `gh api graphql` call per 100 numbers rather than one `gh issue view`
    each — 130 sequential calls would take minutes and burn rate limit on every
    PR that touches a doc.
    """
    closed: set[int] = set()
    for start in range(0, len(numbers), 100):
        chunk = numbers[start : start + 100]
        fields = "\n".join(
            f'  i{n}: issueOrPullRequest(number: {n}) {{ ... on Issue {{ state }} }}'
            for n in chunk
        )
        query = f"query {{ repository(owner: $owner, name: $name) {{\n{fields}\n}} }}"
        query = query.replace("$owner", '"PioneerAIAcademy"').replace("$name", '"cowork-genealogy"')
        try:
            proc = subprocess.run(
                ["gh", "api", "graphql", "-f", f"query={query}"],
                capture_output=True, text=True, timeout=60,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return None
        # NOT gated on returncode. A number no doc should have cited — a typo, or
        # an issue in another repo — makes GraphQL return an error for that ONE
        # alias while still resolving every other alias in the batch, and `gh`
        # exits non-zero for it. Bailing there would blind the whole run on the
        # strength of a single bad citation, which is the opposite of the job.
        # An auth/network failure yields no parseable body and is caught below.
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError:
            return None
        data = (payload.get("data") or {}).get("repository")
        if not isinstance(data, dict):
            return None
        for n in chunk:
            entry = data.get(f"i{n}") or {}
            if entry.get("state") == "CLOSED":
                closed.add(n)
    return closed


def main() -> int:
    paths = scan_targets()
    refs = refs_by_number(paths)
    if not refs:
        print("check_doc_issue_refs: no issue references found.")
        return 0

    closed = closed_issues(sorted(refs))
    if closed is None:
        # Unauthenticated, offline, rate-limited, or a fork PR's read-only
        # token. Not a finding, and never a failure.
        print("::notice::check_doc_issue_refs: skipped (GitHub API unavailable).")
        return 0

    total_sites = 0
    for number in sorted(closed):
        for path, lineno in refs[number]:
            # `relative_to` RAISES on a path outside the root rather than
            # returning something absolute, so a doc reached by any route other
            # than `scan_targets` (a symlinked worktree, a caller passing its
            # own list) would crash the lint instead of reporting.
            try:
                rel = path.relative_to(REPO_ROOT)
            except ValueError:
                rel = path
            total_sites += 1
            print(
                f"::warning file={rel},line={lineno}::"
                f"cites #{number}, which is CLOSED — update the reference or drop it"
            )

    print(
        f"check_doc_issue_refs: {len(refs)} issues cited, "
        f"{len(closed)} closed across {total_sites} site(s)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
