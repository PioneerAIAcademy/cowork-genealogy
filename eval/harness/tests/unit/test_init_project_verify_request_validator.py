"""The ``verify-request:`` validator in ``validators/test_init_project.py`` (#4791)."""

from __future__ import annotations

import pytest

from validators.test_init_project import test_verify_request_recorded as verify_request


def _run(tag, project):
    verify_request(
        after_state={"research_json": {"project": project}},
        test={"skill": "init-project", "tags": [tag]},
    )


def test_passes_on_the_users_request_and_on_none():
    _run("verify-request:parents", {"verify_request": "I think his parents are wrong; verify his parents."})
    _run("verify-request:none", {})


def test_fails_on_a_missing_or_wrong_request():
    with pytest.raises(AssertionError, match="should hold"):
        _run("verify-request:parents", {})
    with pytest.raises(AssertionError, match="should hold"):
        _run("verify-request:parents", {"verify_request": "Verify his birth date."})
    with pytest.raises(AssertionError, match="no verify request was made"):
        _run("verify-request:none", {"verify_request": "Verify his parents."})


def test_skips_an_untagged_test():
    with pytest.raises(pytest.skip.Exception):
        verify_request(after_state={}, test={"skill": "init-project", "tags": []})
