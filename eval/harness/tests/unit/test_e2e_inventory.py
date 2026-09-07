"""Unit test for e2e.inventory -- the branch-scope caveat (issue #1444).

`inventory.py` has no `--since`/`describe_window()` call to inherit the
caveat through (it prints raw counts, no window concept), so it prints
`branch_scope_note()` directly -- this is the one test that would catch a
regression dropping that line.
"""

from __future__ import annotations

from e2e import inventory


def test_main_prints_the_branch_scope_caveat(capsys):
    inventory.main()
    out = capsys.readouterr().out
    assert "make e2e-branch-only" in out
