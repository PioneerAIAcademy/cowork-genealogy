"""Seed a sandbox's /project with a ready-made sample (Patrick Flynn) so the
viewer renders immediately — handy for demoing the viewer path before the agent
writes any files.
"""
from __future__ import annotations

from pathlib import Path

from ..sandbox.base import PROJECT_DIR, Sandbox

SAMPLE_DIR = Path(__file__).parent / "sample_project"


async def seed_sample_project(sandbox: Sandbox) -> None:
    for f in sorted(SAMPLE_DIR.rglob("*")):
        if f.is_file():
            rel = f.relative_to(SAMPLE_DIR).as_posix()
            await sandbox.write_file(f"{PROJECT_DIR}/{rel}", f.read_bytes())
