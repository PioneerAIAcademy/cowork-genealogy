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
    root = logging.getLogger("workbench")
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    _configured = True


log = logging.getLogger("workbench")
