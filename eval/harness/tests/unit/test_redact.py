"""Unit tests for harness/redact.py — run-log credential redaction and scanning.

The bug this guards: an e2e agent's Read of ~/.familysearch-mcp/{config,tokens}.json
lands the file contents verbatim in a tool call's response_summary, which is then
persisted to a public run log (hannah-earnest-children, 2026-09-28). The redactor
scrubs it at capture time; the scanner is the gate backstop. All FAKE secrets.
"""

from __future__ import annotations

from harness.redact import (
    CREDENTIAL_PATTERN_SPECS,
    redact_secrets,
    scan_for_credentials,
)


def test_redacts_unescaped_fs_tokens():
    s = '{"accessToken": "p0-FAKEACCESS", "refreshToken": "-1-FAKEREFRESH"}'
    r = redact_secrets(s)
    assert "p0-FAKEACCESS" not in r
    assert "-1-FAKEREFRESH" not in r
    assert "[REDACTED-FS-ACCESS-TOKEN]" in r
    assert "[REDACTED-FS-REFRESH-TOKEN]" in r


def test_redacts_escaped_form_as_captured():
    # The escaped shape a Read cat-output lands in inside a stringified JSON dump.
    s = r'summary: \"openRouterApiKey\": \"sk-or-v1-FAKEKEY123\"'
    r = redact_secrets(s)
    assert "sk-or-v1-FAKEKEY123" not in r
    assert "[REDACTED-OPENROUTER-KEY]" in r


def test_redacts_bare_openrouter_and_anthropic_keys():
    s = "keys: sk-or-v1-FAKE-or_key and sk-ant-FAKE_ant-123"
    r = redact_secrets(s)
    assert "sk-or-v1-FAKE-or_key" not in r  # hyphen/underscore in the key are covered
    assert "sk-ant-FAKE_ant-123" not in r


def test_handles_doubly_escaped_fs_token():
    # A credential nested one extra stringify level lands with TWO backslashes
    # before each quote; the field patterns must still catch it (\\* not \\?).
    s = r'\\"accessToken\\": \\"p0-FAKEDOUBLE\\"'
    assert "FS-ACCESS-TOKEN" in scan_for_credentials(s)
    assert "p0-FAKEDOUBLE" not in redact_secrets(s)


def test_redact_then_scan_is_clean():
    s = '{"accessToken": "p0-X", "openRouterApiKey": "sk-or-v1-Y", "refreshToken": "-Z"}'
    assert scan_for_credentials(s)  # dirty before
    assert scan_for_credentials(redact_secrets(s)) == []  # clean after — the invariant


def test_redaction_is_idempotent():
    once = redact_secrets('{"accessToken": "p0-FAKE"}')
    assert redact_secrets(once) == once


def test_scan_does_not_flag_placeholders():
    # The exact placeholders the manual redaction and the redactor write.
    assert scan_for_credentials('\\"accessToken\\": \\"[REDACTED-FS-ACCESS-TOKEN]\\"') == []
    assert scan_for_credentials('"openRouterApiKey": "[REDACTED-OPENROUTER-KEY]"') == []


def test_scan_ignores_benign_near_misses():
    assert scan_for_credentials("she drank sk-orange-juice; a token of trust") == []


def test_never_raises_on_non_str():
    assert redact_secrets(None) is None
    assert redact_secrets(123) == 123
    assert scan_for_credentials(None) == []
    assert scan_for_credentials(123) == []


def test_specs_present():
    labels = {label for label, _kind, _pat in CREDENTIAL_PATTERN_SPECS}
    assert {"OPENROUTER-KEY", "ANTHROPIC-KEY", "FS-ACCESS-TOKEN", "FS-REFRESH-TOKEN"} <= labels
