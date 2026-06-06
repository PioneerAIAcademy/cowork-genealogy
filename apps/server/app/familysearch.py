"""Per-user FamilySearch OAuth (web redirect) + token store + sandbox injection.
Filled in M4. Reuses the engine's PKCE/token-exchange/refresh logic, minus the
localhost callback server.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/familysearch", tags=["familysearch"])
