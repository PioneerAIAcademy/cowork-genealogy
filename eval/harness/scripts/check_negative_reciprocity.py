#!/usr/bin/env python3
"""GH Action: warn when a negative routing test has no reciprocal.

Skill routing is a graph, but a negative test only ever pins one direction
of an edge. A test in skill A's directory asserting "this request belongs to
B" proves A does not over-trigger; it says nothing about whether B still
triggers for the requests that *are* B's. So a description edit that fixes
routing one way can silently break it the other way, and nothing reds.

That is not hypothetical. After DO-NOT clauses were added to separate
`search-familysearch-wiki` from `locality-guide`, Pennsylvania Quaker
questions started routing to the wrong skill. It was caught by hand. The fix
was a reciprocal negative test in the other skill's directory, pinning the
pair from both sides — and nothing required it.

This builds the directed edge graph and diffs it against its own transpose.

  edge  A -> B   iff  a negative test whose `test.skill` is A names B in
                      `negative.correct_skill`
  flagged        iff  B has a test suite directory and no negative test in
                      it names A

The rule being enforced already exists, in docs/specs/unit-test-spec.md § 6
"Boundary testing pattern": "For each confusable pair, create tests from both
directions." This is enforcement for written doctrine, not new doctrine.

Edge-definition rules, stated because each one is a place a reimplementation
would silently diverge:

- The source is `test.skill`, which is schema-required and is what the
  harness itself treats as authoritative (harness/loader.py). The reciprocal
  lookup runs against the same map, keyed the same way -- NOT against a
  directory listing. Keying the two halves differently mis-reports the moment
  one test's `skill` disagrees with its parent directory, and it makes that
  divergence look deliberate. It is a corpus bug; this script reports the edge
  from the field and does not try to reconcile the two.
- `correct_skill: ["x", "y"]` is TWO edges (either destination is acceptable,
  so both pairs want pinning). `correct_skill: []` -- no skill should fire,
  an out-of-scope user message -- is ZERO edges and can have no reciprocal.
- A skill naming ITSELF is ZERO edges. Four tests do this deliberately, to
  say "this skill handling it is also acceptable" on a routing-flaky
  negative. A -> A has no reciprocal to write, and admitting it would both
  inflate the edge total and trivially satisfy its own check.
- An `expected_outcome: "xfail"` negative still declares its edge, and is
  still accepted as a reciprocal for the reverse one. That is arguably wrong
  -- an xfail asserts the routing is known-broken, so it pins nothing -- but
  it masks nothing today: both xfail negatives in the corpus
  (proof-conclusion -> question-selection and -> record-extraction) are
  themselves reported as one-directional. Recorded rather than fixed because
  narrowing what counts as a reciprocal is a semantic change to the rule this
  script only enforces.
- An edge whose target has no `eval/tests/unit/<target>/` directory is
  SKIPPED, not flagged. A reciprocal cannot be written into a suite that does
  not exist. Today `forget-and-rederive` is the only skill without one
  (`research` gained a suite in #1494), but a future one must not be asked
  for a test that has nowhere to live.
- Malformed JSON, or a test missing `test.skill`, contributes nothing rather
  than raising: a lint that cannot run is worse than one that under-reports.
  This is no longer a blind spot. `tests/unit/test_unit_test_corpus.py` runs
  every committed file under `eval/tests/unit/` through `loader.load_test` on
  any PR touching that tree, so a file this script silently skips fails there
  instead -- for a schema violation and for unparseable JSON alike. What is
  skipped here is therefore already reported, by name, somewhere that blocks.

WARN-ONLY, AND UNCONDITIONALLY SO -- this always exits 0.

There is deliberately NO baseline file and NO count threshold. Both were
considered and rejected when this shipped (2026-08-06):

- A baseline/allowlist would tax the behaviour we want to encourage. Every
  future description-widening PR that adds one negative test would also have
  to add the reciprocal in the *other* skill's directory -- a second skill
  touched, so a second `make eval-skill` run plus a genealogist annotation,
  indefinitely.
- A count threshold ("the number can only go down") is silently wrong:
  remove one edge, add another, the count is unchanged and CI stays green.
  If this is ever promoted to blocking it must compare the edge SET, and
  that promotion should wait until someone has triaged which of the
  currently-unbacked edges are deliberate one-directional near-misses. The
  sibling lint's docstring makes the same point about its own hits: the list
  needs triaging, not suppressing, before anyone makes it blocking.

So nothing here is frozen; the count can rise and this still exits 0. What
it buys is that the debt is visible on every PR instead of being rediscovered
by hand.

Warnings carry no `file=` annotation, unlike every sibling lint. The offence
is the ABSENCE of a file in the target skill's directory -- there is nothing
to point at, and annotating the source-side test would mark a file that is
perfectly correct. The source test ids are named in the message text instead,
so the edge stays traceable.

Run by .github/workflows/check-runlogs.yml. Self-contained: stdlib only
(the workflow installs no dependencies).
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
HARNESS_DIR = HERE.parent
REPO_ROOT = HARNESS_DIR.parents[1]

# See the same block in check_tool_coverage.py: CI's `python <script>.py` adds
# HERE to sys.path, the unit tests' `spec_from_file_location` does not.
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from gh_annotations import gh_warning, write_step_summary  # noqa: E402

TESTS_DIR = REPO_ROOT / "eval" / "tests" / "unit"

# Quoted rather than cited by line number: the line moves on the next edit
# above it, and a stale `unit-test-spec.md:NNN` in a warning is worse than no
# pointer at all. The section heading and the sentence both survive.
RULE_CITATION = (
    'docs/specs/unit-test-spec.md § 6 "Boundary testing pattern": '
    '"For each confusable pair, create tests from both directions."'
)


def suite_skills(tests_dir: Path) -> set[str]:
    """Skills that have a unit test suite directory — the set a reciprocal
    test could actually be written into."""
    if not tests_dir.is_dir():
        return set()
    return {d.name for d in tests_dir.iterdir() if d.is_dir()}


def routing_edges(tests_dir: Path) -> dict[tuple[str, str], list[str]]:
    """Directed routing edges -> the negative test ids that declared each.

    `{(source, target): [test_id, ...]}`. Provenance is kept, not just the
    edge set, so a warning about a missing reciprocal can name the test on
    the other side of the pair — the reader's starting point for writing it.
    """
    edges: dict[tuple[str, str], list[str]] = defaultdict(list)
    if not tests_dir.is_dir():
        return {}
    for path in sorted(tests_dir.glob("*/*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, UnicodeDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        test = data.get("test")
        if not isinstance(test, dict) or test.get("type") != "negative":
            continue
        # `test.skill` only — deliberately NOT falling back to the parent
        # directory. A directory fallback would source this half of the pair
        # differently from the reciprocal lookup below, which is the exact
        # split that makes a divergent test look deliberate instead of broken.
        # A test with no `skill` is a schema violation (the field is required)
        # and contributes nothing rather than a directory-keyed guess.
        source = test.get("skill")
        if not isinstance(source, str) or not source:
            continue
        negative = data.get("negative")
        if not isinstance(negative, dict):
            continue
        targets = negative.get("correct_skill")
        if not isinstance(targets, list):
            continue
        label = test.get("id") or path.name
        for target in targets:
            # `correct_skill: []` lands here as zero iterations — an
            # out-of-scope message has no destination and so no reciprocal.
            if not isinstance(target, str) or not target:
                continue
            # A skill naming ITSELF is not a routing edge. Four tests do this
            # deliberately: `citation` accepts `["record-extraction",
            # "citation"]` and `convert-dates` accepts `["convert-dates"]`,
            # both meaning "this skill handling it is also acceptable" on a
            # routing-flaky negative. There is no reciprocal to write for
            # A -> A, and counting it would inflate the edge total while
            # trivially satisfying its own reciprocity check.
            if target == source:
                continue
            edges[(source, target)].append(str(label))
    return dict(edges)


def asymmetric_edges(tests_dir: Path) -> list[tuple[str, str, list[str]]]:
    """Edges with no reciprocal, as sorted `(source, target, test_ids)`.

    Both halves key on the same map (see the module docstring): an edge
    `A -> B` is backed iff `A` appears among `B`'s own declared targets.
    """
    edges = routing_edges(tests_dir)
    skills = suite_skills(tests_dir)

    outbound: dict[str, set[str]] = defaultdict(set)
    for source, target in edges:
        outbound[source].add(target)

    flagged: list[tuple[str, str, list[str]]] = []
    for (source, target), test_ids in edges.items():
        if target not in skills:
            continue  # no suite to write the reciprocal into
        if source in outbound[target]:
            continue  # pinned from both sides
        flagged.append((source, target, sorted(test_ids)))
    return sorted(flagged)


def skipped_edges(tests_dir: Path) -> list[tuple[str, str]]:
    """Edges whose target has no suite directory — reported as a count so
    the exemption stays visible rather than silently swallowing an edge."""
    skills = suite_skills(tests_dir)
    return sorted({(s, t) for s, t in routing_edges(tests_dir) if t not in skills})


def main(tests_dir: Path = TESTS_DIR) -> int:
    if not tests_dir.is_dir():
        print(f"No unit test corpus at {tests_dir}; nothing to check.")
        return 0

    edges = routing_edges(tests_dir)
    flagged = asymmetric_edges(tests_dir)
    skipped = skipped_edges(tests_dir)

    for source, target, test_ids in flagged:
        gh_warning(
            f"negative routing edge `{source} -> {target}` is one-directional: "
            f"no negative test declares `test.skill: {target}` with `{source}` "
            f"in its `negative.correct_skill`, so the pair is pinned from one "
            f"side only. A description edit that fixes routing one way can "
            f"break it the other way without reddening anything. Write the "
            f"reciprocal under `eval/tests/unit/{target}/`. Declared by: "
            f"{', '.join(test_ids)}. Rule: {RULE_CITATION}"
        )

    print(
        f"\nNegative routing edges: {len(edges)} across "
        f"{len({s for s, _ in edges})} skill(s)."
    )
    if skipped:
        print(
            f"Skipped {len(skipped)} edge(s) whose target has no test suite "
            f"directory (a reciprocal has nowhere to live): "
            f"{', '.join(f'{s} -> {t}' for s, t in skipped)}."
        )
    if flagged:
        print(
            f"{len(flagged)} of them have no reciprocal. Warnings above. "
            f"Warn-only — this does not block the build, and there is "
            f"deliberately no baseline file and no count threshold (see this "
            f"script's docstring)."
        )
    else:
        print("Every routing edge is pinned from both directions.")

    write_step_summary(
        "Negative routing reciprocity (warn-only)",
        footer=(
            "Warn-only: this check does not block the build, and there is "
            "deliberately no baseline file and no count threshold (see the "
            "script's docstring). Unlike its sibling lints these warnings carry "
            "no `file=` annotation — the offence is the ABSENCE of a file in the "
            "target skill's directory."
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
