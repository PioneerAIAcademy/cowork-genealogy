"""Structured logging WITHOUT PII — never log research/tree contents or FS
records, only structural facts (session id, sandbox id, counts, durations).
"""
from __future__ import annotations

import logging
import sys

_configured = False


def setup_logging() -> None:
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    # `app` covers every control-plane module that logs through getLogger(__name__).
    # uvicorn configures neither logger, so without this their INFO lines were dropped
    # in production (#3305). Not the root logger: httpx, under both the e2b SDK and the
    # Anthropic proxy, logs every request at INFO.
    for name in ("workbench", "app"):
        logger = logging.getLogger(name)
        logger.setLevel(logging.INFO)
        logger.addHandler(handler)
    _configured = True


log = logging.getLogger("workbench")
