"""Config-selected provider. LocalProvider for the POC; E2BProvider when
SANDBOX_PROVIDER=e2b and an E2B_API_KEY is present.
"""
from __future__ import annotations

import logging

from ..config import get_settings
from .base import SandboxProvider
from .local import LocalProvider


def make_provider() -> SandboxProvider:
    settings = get_settings()
    if settings.sandbox_provider == "e2b":
        from .e2b import E2BProvider

        return E2BProvider(api_key=settings.e2b_api_key, template=settings.e2b_template)
    provider = LocalProvider(settings.sandboxes_dir)
    # Reap WS servers an earlier control plane left behind. They are launched
    # with `start_new_session=True`, so a crash or a `kill -9` orphans them
    # rather than killing them, and nothing else ever looks for them again --
    # nine were once found running, one 17 days old. Reaping at construction is
    # the one moment we know no live session depends on them yet.
    orphans = provider.reap_orphans()
    if orphans:
        logging.getLogger(__name__).info(
            "reaped %d orphaned sandbox WS server(s) from a previous run: %s",
            len(orphans), ", ".join(orphans),
        )
    return provider
