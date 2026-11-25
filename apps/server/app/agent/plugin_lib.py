"""The plugin's library modules, loaded by both hosted planes.

``step_boundary.py`` ships in the plugin (``packages/engine/plugin/hooks/``) and is not a
registered hook: it is loaded as a LIBRARY, the way the harnesses' ``context_policy.py``
loads ``guard_project_files.py``. The prototype worker enforces the step boundary from it,
and both planes read its ``awaiting_hand_offs`` (the Python mirror of the engine's
``awaitingUserHandOffs``) to post each new external-site link to the chat (issue #4660).
One loader for both, here, because the worker already imports from ``app.agent``.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path


def default_plugin_dir() -> Path:
    """Where the plugin is. ``ENGINE_PLUGIN_DIR`` in the deployed images (the worker's
    predeploy hook puts it at ``/opt/genealogy/plugin``); the checkout otherwise. Read the
    same way ``real_agent._PLUGIN_DIR`` and ``worker.py`` read it, so they cannot point at
    different copies."""
    env = os.environ.get("ENGINE_PLUGIN_DIR")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[4] / "packages" / "engine" / "plugin"


def load_step_boundary(path: Path | None = None):
    """Import the plugin's step boundary. Raises if it is missing.

    A checkout always has the file and every image ships the plugin, so one without it is
    broken in a way that must be LOUD -- the alternative is a turn that silently enforces
    no boundary, which looks exactly like the feature working.
    """
    target = Path(path) if path is not None else default_plugin_dir() / "hooks" / "step_boundary.py"
    spec = importlib.util.spec_from_file_location("_genealogy_step_boundary", target)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load the step boundary at {target}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
