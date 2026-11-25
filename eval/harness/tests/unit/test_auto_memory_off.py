"""`env_for_sdk` keeps Claude Code's auto-memory off on the pinned CLI.

Auto-memory writes a researcher's remark to a memory file under the session's
`~/.claude`, outside the project, unreviewed, and loads it into later sessions
(issue #4778). `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` removes it; if a CLI upgrade
renamed, dropped or re-polarised the variable, every dict assertion in the repo
would still pass.

The CLI's first request goes to a local listener that answers 400, so no model
is called. The preset system prompt carries the `# Memory` block, so the
capture shows whether the variable bound. It must be the PRESET: with no
`system_prompt` the request carries ~136 characters and no block either way,
which is what made an earlier capture report that this could not be tested
(issue #4778, "review-ready, 2026-11-23"). Re-measured 2026-11-23 on CLI
2.1.308 / SDK 0.2.172: unset 6345 chars with the block, `"1"` 4167 without.

`test_the_cli_carries_a_memory_block_by_default` is the positive control, so
the real test cannot pass vacuously. `test_a_falsy_value_forces_memory_on`
pins the polarity: on this variable `"0"` is not a weaker `"1"`, it is
`forced_on`, and it is the value of the `CLAUDE_CODE_FORK_SUBAGENT` line
directly above it in all three env builders.
"""

from __future__ import annotations

from tests.unit.cli_capture import capture_request_bodies

from harness.auth import AuthConfig, env_for_sdk

_MEMORY_BLOCK = "# Memory"
VAR = "CLAUDE_CODE_DISABLE_AUTO_MEMORY"


def _system_prompt(tmp_path, extra_env: dict[str, str]) -> str:
    # The PRESET: with no system_prompt the request carries ~136 characters and
    # no memory block in any arm, which is what made an earlier capture report
    # that this could not be tested at all.
    bodies = capture_request_bodies(
        tmp_path, extra_env, system_prompt={"type": "preset", "preset": "claude_code"}
    )
    for body in bodies:
        field = body.get("system")
        if field is None:
            continue
        text = (
            "\n".join(b.get("text", "") for b in field if isinstance(b, dict))
            if isinstance(field, list)
            else str(field)
        )
        if text:
            return text
    raise AssertionError(f"no request carried a system prompt ({len(bodies)} captured)")


def test_the_cli_carries_a_memory_block_by_default(tmp_path):
    # The SDK merges os.environ first, then options.env, so an operator or CI job
    # that exports the variable to protect its own home would fail this arm with
    # a message about the CLI. "" is neither truthy nor falsy to the CLI's
    # reader, so it lands on `unset` -- the default this arm is about.
    assert _MEMORY_BLOCK in _system_prompt(tmp_path, {VAR: ""}), (
        "the CLI no longer injects a memory block by default, so the test below "
        "passes vacuously"
    )


def test_env_for_sdk_turns_auto_memory_off(tmp_path):
    env = env_for_sdk(AuthConfig(skill_runner_mode="subscription", api_key=None, detail=""))
    assert _MEMORY_BLOCK not in _system_prompt(tmp_path, env)


def test_a_falsy_value_forces_memory_on(tmp_path):
    """`"0"` is not a weaker `"1"` — the CLI reads it as `forced_on`.

    It is the value of the `CLAUDE_CODE_FORK_SUBAGENT` line directly above this
    variable in all three env builders, so copying the neighbour is the one way
    this goes wrong, and every dict assertion would stay green.
    """
    assert _MEMORY_BLOCK in _system_prompt(tmp_path, {VAR: "0"})
