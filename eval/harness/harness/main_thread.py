"""The main thread's model and reasoning effort for both eval harnesses.

Read from the plugin's ``main-thread.json``, the one place they are set for every platform
except Cowork; the hosted planes read the same file through
``apps/server/app/agent/main_thread.py``. Each plugin agent sets its own in its
``agents/<name>.md`` frontmatter. A missing or malformed file raises at import.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple

# harness/main_thread.py -> harness -> eval/harness -> eval -> <repo root>
PLUGIN_DIR = Path(__file__).resolve().parents[3] / "packages" / "engine" / "plugin"
FILE_NAME = "main-thread.json"
#: The SDK's `EffortLevel` values; `tests/unit/test_main_thread.py` keeps the two equal.
EFFORT_LEVELS = ("low", "medium", "high", "xhigh", "max")


class MainThread(NamedTuple):
    model: str
    effort: str


def load_main_thread(plugin_dir: Path = PLUGIN_DIR) -> MainThread:
    path = Path(plugin_dir) / FILE_NAME
    doc = json.loads(path.read_text(encoding="utf-8"))
    model = doc.get("model") if isinstance(doc, dict) else None
    effort = doc.get("effort") if isinstance(doc, dict) else None
    if not isinstance(model, str) or not model.strip():
        raise ValueError(f"{path}: `model` must be a non-empty model id, got {model!r}")
    if effort not in EFFORT_LEVELS:
        raise ValueError(f"{path}: `effort` must be one of {list(EFFORT_LEVELS)}, got {effort!r}")
    return MainThread(model.strip(), effort)


MAIN_THREAD = load_main_thread()
