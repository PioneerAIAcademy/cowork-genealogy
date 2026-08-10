"""The sandbox's ~/.familysearch-mcp/config.json body (issue #290).

The engine's wiki and population tools fall back to compiled-in defaults that
today name one developer's tailnet host. `hosted_config` is the only way an
operator redirects hosted traffic at a real deployment — without it, changing
those URLs means rebuilding and re-releasing the engine. These tests pin the
two properties that make it usable: an unset override must leave the document
alone (so the engine's fallback still applies), and a set one must reach the
sandbox under the camelCase key the engine actually reads.
"""

from __future__ import annotations

from app.fs_oauth import hosted_config


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
