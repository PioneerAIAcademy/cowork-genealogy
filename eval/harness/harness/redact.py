"""Credential redaction and scanning for run-log capture.

Stdlib-only (imports only ``re``) so it is safe to import from the e2e
orchestrator, which runs in the harness venv. The CI gate scripts keep their
documented import-free posture and instead carry a byte-identical copy of
``CREDENTIAL_PATTERN_SPECS`` plus ``scan_for_credentials``; a drift test
(``test_check_e2e_fixtures.py``) fails CI if the two copies diverge, so this
module stays the single source of truth for the patterns.

Why this exists: during an e2e run the agent's built-in ``Read`` can reach a
host credential file (``~/.familysearch-mcp/config.json`` or ``tokens.json``)
and the harness captures the cat-style output verbatim into a tool call's
``response_summary``. A public run log then carries live credentials
(hannah-earnest-children run 2026-09-28, redacted in commit 31083d624). This
scrubs them at capture time; the gate scanner is the backstop.

Doctrine (mirrors ``_redact_living`` in apps/server/app/feedback.py): this is a
privacy filter, not a validator. ``redact_secrets`` must NEVER be the reason a
run fails to persist, so it never raises and returns its input unchanged on any
error.

The captured credential lands INSIDE a stringified JSON dump, so the inner
quotes arrive escaped in the persisted file (``\\"accessToken\\": \\"...\\"``)
but unescaped in the in-memory string the redactor sees. Every field pattern's
opening/closing quotes are therefore ``\\?"`` (optional backslash), matching
both forms. The ``(?!\\[REDACTED)`` lookahead makes redaction idempotent and,
critically, keeps the scanner from re-flagging an already-redacted placeholder.
"""

import re

# (label, kind, pattern) — the ONE source of truth. kind is "value" (the whole
# match is the secret) or "field" (a JSON key whose quoted value, group 4, is
# the secret). Duplicated verbatim into check_e2e_fixtures.py; a drift test
# asserts the two lists are byte-identical.
CREDENTIAL_PATTERN_SPECS = [
    ("OPENROUTER-KEY", "value", r"sk-or-v1-[A-Za-z0-9_\-]+"),
    ("ANTHROPIC-KEY", "value", r"sk-ant-[A-Za-z0-9_\-]+"),
    ("FS-ACCESS-TOKEN", "field", r'(\\*")(accessToken|access_token)(\\*"\s*:\s*\\*")(?!\[REDACTED)([^"\\]+)'),
    ("FS-REFRESH-TOKEN", "field", r'(\\*")(refreshToken|refresh_token)(\\*"\s*:\s*\\*")(?!\[REDACTED)([^"\\]+)'),
    ("OPENROUTER-KEY", "field", r'(\\*")(openRouterApiKey|openrouter_api_key)(\\*"\s*:\s*\\*")(?!\[REDACTED)([^"\\]+)'),
]

_COMPILED = [(label, kind, re.compile(pat)) for label, kind, pat in CREDENTIAL_PATTERN_SPECS]


def redact_secrets(text):
    """Return ``text`` with any credential values replaced by a
    ``[REDACTED-<LABEL>]`` placeholder. Best-effort: never raises, returns the
    input unchanged on any error or non-str input."""
    if not isinstance(text, str):
        return text
    try:
        out = text
        for label, kind, pat in _COMPILED:
            placeholder = f"[REDACTED-{label}]"
            if kind == "value":
                out = pat.sub(placeholder, out)
            else:  # field: keep the key + separator (groups 1-3), drop the value (group 4)
                out = pat.sub(lambda m, p=placeholder: m.group(1) + m.group(2) + m.group(3) + p, out)
        return out
    except Exception:  # noqa: BLE001 — a privacy filter must never fail the run
        return text


def scan_for_credentials(text):
    """Return the sorted, de-duplicated labels of any credential patterns that
    match ``text`` (never the values). Empty list means clean. Best-effort:
    never raises."""
    if not isinstance(text, str):
        return []
    hits = []
    try:
        for label, kind, pat in _COMPILED:
            if pat.search(text):
                hits.append(label)
    except Exception:  # noqa: BLE001
        pass
    return sorted(set(hits))
