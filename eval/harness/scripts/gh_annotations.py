"""Shared GitHub Actions output for the warn-only lint scripts.

The three warn-only lints in this directory (`check_tool_coverage.py`,
`check_rubric_tool_drift.py`, `check_negative_reciprocity.py`) between them emit
around 186 `::warning::` annotations on a full corpus run. **GitHub renders at
most 10 annotations per step**, so the author of the PR that tripped one sees a
truncated list and no indication of what was cut — the signal these lints exist
to produce is mostly invisible at the point it would be acted on.

`$GITHUB_STEP_SUMMARY` has no such cap. Every warning is appended there as well
as printed, so the job summary carries the complete list while the annotations
stay as the inline pointer to the first few.

This changes **nothing about what any lint decides**: they stay warn-only and
still exit 0. `gh_warning` prints exactly the annotation line it always did;
the summary is a second sink for the same text.

Not in the harness package (`eval/harness/harness/`) on purpose: the CI job runs
these with a bare `python eval/harness/scripts/<script>.py`, no `uv sync` and no
`PYTHONPATH`, so a sibling module in this directory is the only import that
resolves. Stdlib only, for the same reason.
"""

from __future__ import annotations

import os
from pathlib import Path

# Every warning emitted this process, in order. Module-level because each lint
# runs as its own process and its own step — there is one summary section per
# run, and no lint needs to interleave two.
_warnings: list[tuple[str | None, str]] = []


def gh_warning(message: str, *, file: str | None = None) -> None:
    """Emit a GitHub warning annotation (visible on the PR; non-blocking).

    Also records the warning for `write_step_summary`, which is what makes it
    survive GitHub's 10-annotations-per-step render cap.
    """
    prefix = f"::warning file={file}::" if file else "::warning::"
    print(f"{prefix}{message}")
    _warnings.append((file, message))


def recorded_warnings() -> list[tuple[str | None, str]]:
    """Everything `gh_warning` has emitted this process. For tests."""
    return list(_warnings)


def reset() -> None:
    """Drop the recorded warnings. For tests that run a lint's main() twice."""
    _warnings.clear()


def write_step_summary(title: str, *, footer: str = "") -> None:
    """Append this lint's full warning list to `$GITHUB_STEP_SUMMARY`.

    A no-op outside Actions (the variable is unset locally), so a developer
    running the script by hand sees the same stdout they always did.

    Never raises. This is diagnostic output on a lint that has already decided
    it is not going to fail the build; a write error here must not become the
    thing that reddens a PR. The annotations and stdout have already been
    printed by the time this runs, so a swallowed error loses the uncapped copy
    and nothing else.
    """
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return

    n = len(_warnings)
    lines = [f"### {title}", ""]
    if not _warnings:
        lines.append("No warnings.")
    else:
        lines.append(
            f"{n} warning(s). GitHub renders at most 10 annotations per step, "
            "so this is the complete list."
        )
        lines.append("")
        for file, message in _warnings:
            where = f"`{file}` — " if file else ""
            lines.append(f"- {where}{message}")
    if footer:
        lines.extend(["", footer])
    lines.append("")

    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    except OSError as e:  # pragma: no cover - defensive, see docstring
        print(f"::notice::could not write the step summary: {e}")


def summary_path() -> Path | None:
    """The `$GITHUB_STEP_SUMMARY` file, or None outside Actions. For tests."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    return Path(path) if path else None
