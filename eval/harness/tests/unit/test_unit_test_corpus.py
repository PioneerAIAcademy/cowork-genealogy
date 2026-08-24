"""Every committed unit-test file validates against unit-test.schema.json.

Nothing checked this on a pull request. The schema binds in two places and
neither fires on a PR: `harness/loader.py` validates at harness load time, which
costs money to reach, and `eval/app` generates Zod types from the schema, which a
hand-edited file bypasses entirely. `check_runlogs.py` rule 4 reads every test
file but checks only `test.id` uniqueness. So a hand-edited file could sit broken
in `main` until the next paid eval run tripped over it.

It also silently degraded a check that already shipped: by design,
`check_negative_reciprocity.py` skips any test file it cannot parse or that has
no `test.skill`, because a lint that cannot run is worse than one that
under-reports. A malformed test is therefore absent from the routing graph and
the reciprocity report under-reports without saying so.

**This calls `load_test` rather than validating independently.** That function is
the thing whose semantics matter, so the check cannot drift from it. The
alternative — vendoring a stdlib validator so this could run without
dependencies — was rejected: the schema uses `allOf`, `if`/`then`, `const` and
three `oneOf` branches, and a subset validator passes on files it does not
understand, which is the shape CLAUDE.md's "a new lint must be proven to fail"
exists to stop. `jsonschema` is already a declared harness dependency, and
`eval-harness-tests.yml` already runs `uv sync --frozen` + pytest on any PR
touching `^eval/tests/`, so this gate fires on exactly the right PRs at no extra
CI cost and needed no workflow edit.
"""

from pathlib import Path

from harness.loader import InvalidTestError, load_test

REPO_ROOT = Path(__file__).resolve().parents[4]
CORPUS = REPO_ROOT / "eval/tests/unit"

# A floor, not an equality. 400 files measured 2026-08-21; the corpus grows with
# every mined test, so pinning the exact number would fail every PR that adds
# one. The floor exists because without it a mistyped path makes this test pass
# over zero files — the silent-success mode that is worse than no check.
MIN_EXPECTED_FILES = 300


def test_the_corpus_glob_actually_matches_files():
    paths = sorted(CORPUS.rglob("*.json"))
    assert len(paths) > MIN_EXPECTED_FILES, (
        f"corpus glob matched only {len(paths)} files under {CORPUS} — the path "
        "is wrong, not the corpus. Every assertion below would pass vacuously."
    )


def test_every_committed_unit_test_validates_against_the_schema():
    """`rglob`, not `*/*.json`: the harness's own discovery is
    `root.rglob("*.json")`, so a nested JSON file is already a would-be test and
    a shallower glob would leave it unchecked.

    Every failure is collected and asserted once. Raising on the first file would
    make a multi-file fix an N-round game, one CI run per file.
    """
    failures: list[str] = []
    for path in sorted(CORPUS.rglob("*.json")):
        try:
            load_test(path)
        except InvalidTestError as exc:
            failures.append(f"{path.relative_to(REPO_ROOT)}: {exc}")

    assert not failures, (
        "unit-test files that fail unit-test.schema.json:\n  " + "\n  ".join(failures)
    )
