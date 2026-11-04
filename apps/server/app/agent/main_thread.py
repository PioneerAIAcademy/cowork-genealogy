"""The main thread's model and reasoning effort, read from the plugin's ``main-thread.json``.

That file is the one place they are set for every platform except Cowork: the alpha's
sandbox runner and control plane and the beta worker read it here, and the unit and e2e
harnesses read it through ``eval/harness/harness/main_thread.py``. Each plugin agent sets
its own in its ``agents/<name>.md`` frontmatter. A missing or malformed file raises: it
ships inside the plugin, so its absence is a broken install, not a setting to default.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple

FILE_NAME = "main-thread.json"

try:
    from typing import get_args as _get_args

    from claude_agent_sdk import EffortLevel as _EffortLevel
    EFFORT_LEVELS: tuple[str, ...] = tuple(_get_args(_EffortLevel))
except Exception:  # noqa: BLE001 - the control plane and mock mode run without the SDK
    EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")


class MainThread(NamedTuple):
    model: str
    effort: str


def load_main_thread(plugin_dir: str | Path) -> MainThread:
    path = Path(plugin_dir) / FILE_NAME
    doc = json.loads(path.read_text(encoding="utf-8"))
    model = doc.get("model") if isinstance(doc, dict) else None
    effort = doc.get("effort") if isinstance(doc, dict) else None
    if not isinstance(model, str) or not model.strip():
        raise ValueError(f"{path}: `model` must be a non-empty model id, got {model!r}")
    if effort not in EFFORT_LEVELS:
        raise ValueError(f"{path}: `effort` must be one of {list(EFFORT_LEVELS)}, got {effort!r}")
    return MainThread(model.strip(), effort)
