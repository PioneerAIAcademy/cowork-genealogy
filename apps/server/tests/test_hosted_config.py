"""The sandbox's ~/.familysearch-mcp/config.json body (issue #290).

The engine's wiki and population tools fall back to compiled-in defaults that
today name one developer's tailnet host. `hosted_config` is the only way an
operator redirects hosted traffic at a real deployment — without it, changing
those URLs means rebuilding and re-releasing the engine. These tests pin the
two properties that make it usable: an unset override must leave the document
alone (so the engine's fallback still applies), and a set one must reach the
sandbox under the camelCase key the engine actually reads.

The second half covers `merge_config`, which runs on every connect so a changed
override reaches sandboxes provisioned under the old one. It has to merge rather
than overwrite because the control plane is not the only writer of this file —
`configure_openrouter` writes it from inside the VM.
"""

from __future__ import annotations

import json

import pytest

from app.fs_oauth import CONFIG_PATH, hosted_config, merge_config, read_config


class FakeSandbox:
    """The two filesystem calls `merge_config` uses, and nothing else.

    `read_file` returns `bytes | None` (None for a missing path) — the contract
    both LocalProvider and E2BProvider implement.
    """

    def __init__(self, files: dict[str, bytes] | None = None):
        self.files = dict(files or {})

    async def read_file(self, path: str) -> bytes | None:
        return self.files.get(path)

    async def write_file(self, path: str, data: bytes) -> None:
        self.files[path] = data

    def config(self) -> dict:
        return json.loads(self.files[CONFIG_PATH].decode("utf-8"))


def test_marks_the_sandbox_hosted_with_no_overrides_configured():
    assert hosted_config(None) == {"hosted": True}


def test_omits_each_override_when_unset_rather_than_writing_the_key_empty():
    """Writing the key with a falsy value is what breaks the fallback.

    `getWikiApiUrl()` does `config.wikiApiUrl?.trim() || DEFAULT_WIKI_API_URL`,
    which falls back on absent, null AND empty. `place-population.ts` uses
    `config.popStatsUrl ?? DEFAULT_POP_STATS_URL`, which falls back on absent
    and null but NOT on "" — nullish coalescing passes an empty string straight
    through, so `popStatsUrl: ""` becomes the base URL and every request goes
    to a relative path. Writing nothing at all is the one shape correct for
    both engines.
    """
    config = hosted_config("sk-or-key")
    assert "wikiApiUrl" not in config
    assert "popStatsUrl" not in config
    assert config["openRouterApiKey"] == "sk-or-key"


def test_threads_both_service_urls_under_the_keys_the_engine_reads():
    config = hosted_config(
        None,
        wiki_api_url="https://wiki.example.org",
        pop_stats_url="https://pop.example.org",
    )
    # camelCase on purpose: this file is an API/wire surface, not a persisted
    # project document (CLAUDE.md, "Identifier casing").
    assert config == {
        "hosted": True,
        "wikiApiUrl": "https://wiki.example.org",
        "popStatsUrl": "https://pop.example.org",
    }


def test_one_override_set_does_not_imply_the_other():
    config = hosted_config(None, wiki_api_url="https://wiki.example.org")
    assert config["wikiApiUrl"] == "https://wiki.example.org"
    assert "popStatsUrl" not in config


def test_empty_string_is_treated_as_unset():
    """`WIKI_API_URL=` in an env file arrives as "", not None.

    This is the case that actually bites: `popStatsUrl: ""` survives the
    engine's `??` and silently becomes the base URL.
    """
    assert hosted_config(None, wiki_api_url="", pop_stats_url="") == {"hosted": True}


# ── merge_config: the control plane is not the only writer ────────────────


@pytest.mark.asyncio
async def test_a_connect_refresh_keeps_the_key_the_agent_set_itself():
    """The reason this merges instead of overwriting.

    `configure_openrouter` writes `openRouterApiKey` into this same file from
    inside the VM. Sandboxes are persistent and every connect re-provisions, so
    a wholesale write would silently drop the user's own key on the next
    reconnect — and the failure surfaces much later, as image_transcribe
    claiming no key is configured.
    """
    sandbox = FakeSandbox({
        CONFIG_PATH: json.dumps({
            "hosted": True,
            "openRouterApiKey": "sk-or-set-from-inside-the-vm",
            "openRouterModel": "some/other-model",
        }).encode(),
    })

    await merge_config(sandbox, hosted_config(None, wiki_api_url="https://wiki.example.org"))

    assert sandbox.config() == {
        "hosted": True,
        "openRouterApiKey": "sk-or-set-from-inside-the-vm",
        "openRouterModel": "some/other-model",
        "wikiApiUrl": "https://wiki.example.org",
    }


@pytest.mark.asyncio
async def test_an_operator_value_wins_over_whatever_the_sandbox_has():
    """A rotated credential must reach a sandbox provisioned under the old one.

    Same call `agent_secrets.write_secrets` makes for the Anthropic key, and the
    whole point of running this on connect rather than only at create.
    """
    sandbox = FakeSandbox({
        CONFIG_PATH: json.dumps({
            "hosted": True,
            "openRouterApiKey": "sk-or-STALE",
            "wikiApiUrl": "https://wiki.old",
        }).encode(),
    })

    await merge_config(sandbox, hosted_config("sk-or-ROTATED", wiki_api_url="https://wiki.new"))

    assert sandbox.config()["openRouterApiKey"] == "sk-or-ROTATED"
    assert sandbox.config()["wikiApiUrl"] == "https://wiki.new"


@pytest.mark.asyncio
async def test_an_unset_override_does_not_erase_the_sandbox_value():
    """Omission means "no opinion", not "clear it".

    `hosted_config` leaves an unconfigured override out of the document
    entirely, so the merge has no key to overlay and whatever is on disk
    survives.
    """
    sandbox = FakeSandbox({
        CONFIG_PATH: json.dumps({"hosted": True, "popStatsUrl": "https://pop.chosen"}).encode(),
    })

    await merge_config(sandbox, hosted_config(None))

    assert sandbox.config()["popStatsUrl"] == "https://pop.chosen"


@pytest.mark.asyncio
async def test_a_fresh_sandbox_has_no_config_to_merge_with():
    sandbox = FakeSandbox()
    await merge_config(sandbox, hosted_config(None, pop_stats_url="https://pop.example.org"))
    assert sandbox.config() == {"hosted": True, "popStatsUrl": "https://pop.example.org"}


@pytest.mark.parametrize(
    "body",
    [b"", b"not json at all", b"[1, 2, 3]", b'"a string"', b"\xff\xfe\x00broken"],
    ids=["empty", "not-json", "json-array", "json-string", "undecodable"],
)
@pytest.mark.asyncio
async def test_an_unreadable_config_never_blocks_provisioning(body):
    """Reads as "nothing configured yet" rather than raising.

    This runs on the connect path, so an exception here would make a corrupt
    config file lock the user out of a session the control plane is about to
    overwrite anyway.
    """
    sandbox = FakeSandbox({CONFIG_PATH: body})
    assert await read_config(sandbox) == {}

    await merge_config(sandbox, hosted_config(None))
    assert sandbox.config() == {"hosted": True}
