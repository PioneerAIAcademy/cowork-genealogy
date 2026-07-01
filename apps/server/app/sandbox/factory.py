"""Config-selected provider. LocalProvider for the POC; E2BProvider when
SANDBOX_PROVIDER=e2b and an E2B_API_KEY is present.
"""
from __future__ import annotations

from ..config import get_settings
from .base import SandboxProvider
from .local import LocalProvider


def make_provider() -> SandboxProvider:
    settings = get_settings()
    if settings.sandbox_provider == "e2b":
        from .e2b import E2BProvider

        return E2BProvider(api_key=settings.e2b_api_key, template=settings.e2b_template)
    return LocalProvider(settings.sandboxes_dir)
