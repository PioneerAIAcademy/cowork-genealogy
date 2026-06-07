"""End-to-end test that runs the full harness against the search-wikipedia seed.

Makes real Anthropic API calls (skill execution + judge). Marked `e2e` so it
can be deselected with `-m 'not e2e'` in normal test runs.

Auth requirements:
- ANTHROPIC_API_KEY must be set (env or eval/.env). Subscription auth alone
  is not enough because the judge layer uses the Anthropic SDK directly.

This test is the contract the rest of the harness has to satisfy: a passing
run must produce a schema-valid run log with validators + judge dimensions.
"""

import json
import os
from pathlib import Path

import pytest

from harness.auth import resolve_auth, AuthError
from harness.loader import load_test
from harness.orchestrator import HARNESS_VERSION, OrchestratorPaths, run_one_test
from harness.runlog import build_run_log, validate_run_log, write_run_log
from harness.skill_runner import DEFAULT_MODEL, get_observed_skill_keys
from harness.snapshot import build_snapshot, hash_file
from harness.versioning import now_utc_filename_timestamp


REPO_ROOT = Path(__file__).resolve().parents[4]
SEED_TEST = REPO_ROOT / "eval/tests/unit/search-wikipedia/simple-topic-lookup.json"


def _have_anthropic_key() -> bool:
    if os.environ.get("ANTHROPIC_API_KEY"):
        return True
    env_file = REPO_ROOT / "eval/.env"
    if env_file.exists():
        from dotenv import dotenv_values
        return bool(dotenv_values(env_file).get("ANTHROPIC_API_KEY"))
    return False


pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        not _have_anthropic_key(),
        reason="ANTHROPIC_API_KEY not set; skip e2e run",
    ),
]


def test_search_wikipedia_runs_end_to_end(tmp_path):
    """Drive the full pipeline against the search-wikipedia seed and assert
    the run log is schema-valid and structurally complete."""
    spec = load_test(SEED_TEST)
    assert spec.id == "ut_search_wikipedia_001"

    auth = resolve_auth()

    paths = OrchestratorPaths(
        scenarios_dir=REPO_ROOT / "eval/fixtures/scenarios",
        fixtures_dir=REPO_ROOT / "eval/fixtures/mcp",
        skills_dir=REPO_ROOT / "packages/engine/plugin/skills",
        tests_dir=REPO_ROOT / "eval/tests/unit",
        validators_dir=REPO_ROOT / "eval/harness/validators",
        runlogs_root=tmp_path,
    )

    timestamp = now_utc_filename_timestamp()
    entry = run_one_test(spec, auth=auth, paths=paths, timestamp=timestamp)

    # run_one_test returns a per-test entry. Wrap it in the run-log
    # envelope (same shape run_tests.py produces in production) before
    # validating against the schema.
    log = build_run_log(
        skill=spec.skill,
        version=1,
        released=False,
        releasable=False,
        invocation="test",
        timestamp=timestamp,
        harness_version=HARNESS_VERSION,
        model=DEFAULT_MODEL,
        judge_prompt_hash=hash_file(
            "eval/harness/judge/prompt.md",
            REPO_ROOT / "eval/harness/judge/prompt.md",
        ),
        snapshot=build_snapshot(skill=spec.skill, repo_root=REPO_ROOT),
        tests=[entry],
    )

    # Verify the Skill tool input key against the live SDK. We support
    # both "skill" and "name" as fallbacks, but the e2e run will tell us
    # which one Claude actually uses on the pinned SDK version. If
    # skills_invoked is populated AND the observed-keys set is empty,
    # something's wrong with our hook plumbing. If neither "skill" nor
    # "name" is in the set after a real run, the SDK changed the contract
    # and we need to update the hook.
    observed = get_observed_skill_keys()
    if log["tests"][0]["runs"][0]["output"]["skills_invoked"]:
        assert observed, "skills_invoked populated but no key recorded — hook bug"
        assert observed.issubset({"skill", "name"}), (
            f"unexpected Skill tool_input keys: {observed}; SDK may have changed"
        )
        print(f"Observed Skill tool input keys: {observed}")

    # Schema validation is the strictest contract.
    validate_run_log(log)

    # Per-test entry outcome must be one of the known terminal values.
    test_entry = log["tests"][0]
    assert test_entry["outcome"] in {
        "pass", "partial", "fail", "aborted", "xfail", "xpass"
    }

    # We get exactly one run in v1 (N=1).
    assert len(test_entry["runs"]) == 1
    run0 = test_entry["runs"][0]

    # If the run didn't abort, we should have:
    #  - some text output OR file creation
    #  - validators that ran
    if run0["outcome"] != "aborted":
        out = run0["output"]
        assert out["text_response"] or out["files_created"], (
            "skill produced neither text nor a file; check fixture wiring"
        )
        # Validators run unconditionally on non-aborted runs.
        assert "results" in run0["validators"]
        # Judge ran iff validators passed.
        if run0["validators"]["passed"]:
            assert run0["judge"]["skipped"] is False
            # search-wikipedia has no rubric.md, so the judge emits only
            # the 3 required base dimensions (Correctness, Completeness,
            # Tool Arguments). judge_context entries are prompt context,
            # not separate dimensions.
            assert len(run0["judge"]["dimensions"]) >= 3

    # Persist the run log on disk so we can inspect it post-test.
    written = write_run_log(
        log,
        runlogs_root=tmp_path,
        filename=f"scratch_{timestamp}.json",
    )
    assert written.exists()
    print(f"\nRun log written to: {written}")
    print(f"Outcome: {test_entry['outcome']}")
    if run0["outcome"] != "aborted" and not run0["validators"]["passed"]:
        print("Validator failures:")
        for r in run0["validators"]["results"]:
            if not r["passed"]:
                print(f"  - {r['name']}: {r['error']}")
