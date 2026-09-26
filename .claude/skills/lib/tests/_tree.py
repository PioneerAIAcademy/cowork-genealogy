"""A tmp checkout for `touches.slot_of` to read.

`slot_of` names a skill's paths `agent:<x>` once `skills/<x>/` is gone from disk and
`agents/<x>.md` exists, and slots.py scans the live skills for `@plugin:`. Against the
real checkout, a fixture naming a live skill flips the day that skill is converted to
an agent (`citation` already was, in PR #2861), reddening a PR that never touched these
tests. So
each test module here pins `touches.REPO_ROOT` to a tmp tree via `pin_repo_root`. It
holds no agents, which is what keeps every skill path on `skill:<x>`; tests that need
an agent or a `@plugin:` reference add it with `make_tree`, under zz-* names no live
checkout has.

Not a conftest.py: eval/harness's pytest run collects this directory beside its own
suites, and an autouse fixture registered from here reached those too.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import touches  # noqa: E402

LIVE_SKILLS = ("citation", "timeline", "research", "proof-conclusion",
               "person-evidence", "research-exhaustiveness")


def make_tree(root, skills=(), agents=(), plugin_refs=None):
    """A minimal checkout: `skills/<s>/SKILL.md` (carrying `@plugin:<a>` for each a in
    plugin_refs[s]) and `agents/<a>.md`."""
    plugin = root / "packages" / "engine" / "plugin"
    for s in skills:
        d = plugin / "skills" / s
        d.mkdir(parents=True, exist_ok=True)
        refs = " ".join(f"@plugin:{a}" for a in (plugin_refs or {}).get(s, ()))
        (d / "SKILL.md").write_text(f"# {s}\n{refs}\n", encoding="utf-8")
    (plugin / "agents").mkdir(parents=True, exist_ok=True)
    for a in agents:
        (plugin / "agents" / f"{a}.md").write_text(f"# {a}\n", encoding="utf-8")
    return root


def pin_repo_root(tmp_path, monkeypatch):
    root = make_tree(tmp_path / "slot-repo", skills=LIVE_SKILLS)
    monkeypatch.setattr(touches, "REPO_ROOT", str(root))
    return root
