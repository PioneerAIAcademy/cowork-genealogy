"""Web feedback intake — bundles the in-sandbox transcript + /project files.
Filled in M5 (ports the Electron feedback.ts logic, repointed at the sandbox FS).
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/feedback", tags=["feedback"])
