"""FamilySearch image proxy (browser can't fetch FS directly). Filled in M5."""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/api/image", tags=["image"])
