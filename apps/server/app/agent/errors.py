"""What a paying user reads when the agent boundary fails.

Issue #1126: every error path here wrapped the raw exception and `ChatPane`
rendered it, so an operator-key 401 reached two alpha testers as *"Failed to
authenticate. API Error: 401 API key is invalid."* Both read it as a
FamilySearch problem and went off debugging the wrong credential. The
misdirection is the cost, not the wording.

**There is no user-fault branch, by construction.** The only credential the SDK
holds at this boundary is the control plane's own ``ANTHROPIC_API_KEY``. A
FamilySearch token expiry never reaches these handlers — it is raised inside the
MCP server and comes back as a *tool result*, which the model reads and acts on.
So an SDK auth failure here is always operator-side, and a "was it the user's
fault?" branch could never fire. (Ruling: lead, 2026-08-14. Recorded in
``docs/specs/hosted-web-workbench-spec.md`` §7 so it is not re-added.)

**Never claim anyone was notified.** No sink alerts an operator today (#1623),
so "the administrator has been notified" would be a lie told to the one person
who cannot check.

Kept apart from ``real_agent`` on purpose: ``runner.py`` needs these too, has no
``_log`` of its own, and its **stdout is the JSON-lines wire protocol** — a bare
``print`` there is swallowed by the pump's ``except json.JSONDecodeError:
continue``. ``runner`` also defers importing ``real_agent`` until
``AGENT_MODE=real``, so the helper cannot live there without dragging the SDK
import into the mock path.
"""

from __future__ import annotations

import sys

# The two things a user can usefully be told. Neither names a credential, and
# neither promises that anyone was told.
MISCONFIGURED = (
    "This service is misconfigured. Nothing you did caused this — "
    "please report it."
)
UNEXPECTED = (
    "The agent stopped unexpectedly. Nothing you did caused this — "
    "please try again, and report it if it keeps happening."
)

# HTTP statuses that mean "our key is bad", not "your request was".
_AUTH_STATUSES = frozenset({401, 403})

# The SDK's `AssistantMessageError` literals (claude_agent_sdk/types.py:1005)
# that indicate an operator credential/billing problem rather than a transient
# fault. `rate_limit` and `server_error` are deliberately absent: they are worth
# retrying, so they get the default "try again" wording.
_AUTH_ERROR_KINDS = frozenset({"authentication_failed", "billing_error"})

# Fallback markers, used ONLY when no status and no error kind is available.
# The one text-bearing channel is `CLIJSONDecodeError`, which formats
# f"Failed to decode JSON: {line[:100]}..." and so can carry a plain-text auth
# line straight off CLI stdout — plausibly what the tester saw.
#
# Deliberately NOT matched against `ProcessError`: the SDK builds the only one
# as f"Command failed with exit code {returncode}" with a hardcoded
# stderr="Check stderr output for details" (subprocess_cli.py), and CLI stderr
# never enters the SDK at all — `options.stderr` is unset by `build_options`,
# so the auth text goes to /tmp/agent.log. There is no 401 in that exception to
# match on.
_AUTH_TEXT_MARKERS = ("401", "403", "api key", "authentication_error",
                      "invalid x-api-key", "credit balance")


def classify(
    exc: BaseException | None = None,
    status: int | None = None,
    error_kind: str | None = None,
) -> str:
    """The user-facing sentence for a failure at the agent boundary.

    Precedence is strongest-signal-first: an HTTP status, then the SDK's own
    error literal, then — only when neither exists — the exception's text.

    The default is `UNEXPECTED`, not `MISCONFIGURED`. Returning the
    misconfiguration line for *every* failure would report an unrelated
    `MessageParseError` or a `/project` OSError as a misconfiguration, which is
    the same class of misdirection this module exists to stop.
    """
    if status is not None:
        return MISCONFIGURED if status in _AUTH_STATUSES else UNEXPECTED
    if error_kind is not None:
        return MISCONFIGURED if error_kind in _AUTH_ERROR_KINDS else UNEXPECTED
    if exc is not None:
        text = str(exc).lower()
        if any(marker in text for marker in _AUTH_TEXT_MARKERS):
            return MISCONFIGURED
    return UNEXPECTED


def operator_log(
    where: str,
    classification: str,
    *,
    exc: BaseException | None = None,
    status: int | None = None,
    error_kind: str | None = None,
    detail: str | None = None,
) -> str:
    """The line an operator needs, carrying everything the user no longer sees.

    Classifying the user's copy only helps if the raw text survives somewhere.
    This is that somewhere — it is the sole record of what actually failed.
    """
    parts = [f"[operator] {where}: {classification!r}"]
    if status is not None:
        parts.append(f"status={status}")
    if error_kind is not None:
        parts.append(f"error_kind={error_kind}")
    if exc is not None:
        parts.append(f"{type(exc).__name__}: {exc}")
    if detail:
        parts.append(detail)
    return " | ".join(parts)


def log_operator(where: str, classification: str, **kw) -> None:
    """Write `operator_log` to STDERR.

    stderr, not stdout, in every process that imports this: the runner's stdout
    is the JSON-lines protocol and a stray line there desynchronizes the pump.
    Lands in /tmp/agent.log.
    """
    print(operator_log(where, classification, **kw), file=sys.stderr, flush=True)
