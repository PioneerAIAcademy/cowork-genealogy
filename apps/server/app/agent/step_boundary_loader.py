"""Loads the plugin's ``hooks/step_boundary.py`` as a library, for both hosted planes.

The web app (``real_agent``) and the prototype worker (``proto.worker.options``) each
build a ``StepGate`` per turn from it. It lives here, not in ``proto``, because imports
go from ``proto`` to ``app`` and never back.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path


def _default_plugin_dir() -> Path:
    """Where the plugin is. ``ENGINE_PLUGIN_DIR`` in a deployed image (the worker's
    predeploy hook puts it at ``/opt/genealogy/plugin``, the E2B image at
    ``/opt/genealogy-agent/plugin``); the checkout otherwise."""
    env = os.environ.get("ENGINE_PLUGIN_DIR")
    if env:
        return Path(env)
    # step_boundary_loader.py -> agent -> app -> server -> apps -> <repo root>
    return Path(__file__).resolve().parents[4] / "packages" / "engine" / "plugin"


def load_step_boundary(path: Path | None = None):
    """Import the plugin's step boundary. Raises if it is missing.

    A checkout always has the file and every image ships the plugin, so one without it
    is broken in a way that must be LOUD: the alternative is a turn that silently
    enforces no boundary, which looks exactly like the feature working.
    """
    target = Path(path) if path is not None else _default_plugin_dir() / "hooks" / "step_boundary.py"
    spec = importlib.util.spec_from_file_location("_genealogy_step_boundary", target)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load the step boundary at {target}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
