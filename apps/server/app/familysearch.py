"""Per-user FamilySearch OAuth (web redirect) + token injection into the
sandbox (spec §5.2). Token storage uses **option (a)**: the control plane writes
{HOME}/.familysearch-mcp/tokens.json inside the sandbox, which the existing MCP
server reads unchanged.

POC posture: the real OAuth redirect (PKCE + token exchange against FamilySearch)
is scaffolded but needs a registered redirect URI + dev key (not provisioned).
A **dev-connect** writes a mock token so the connect/status UX works offline.
The real flow reuses the engine's PKCE/exchange/refresh — only the localhost
callback is dropped.
"""
from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from .auth import get_current_user
from .config import get_settings
from .db import get_session
from .models import Project, User
from .sandbox import SandboxProvider
from .sandbox.base import HOME_DIR
from .sessions import _owned, get_provider

router = APIRouter(prefix="/familysearch", tags=["familysearch"])

TOKENS_PATH = f"{HOME_DIR}/.familysearch-mcp/tokens.json"


class StatusOut(BaseModel):
    connected: bool
    mock: bool


@router.get("/status", response_model=StatusOut)
async def status(
    sessionId: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> StatusOut:
    project = _owned(session, user, sessionId)
    sandbox = await provider.get(project.sandbox_id)
    raw = await sandbox.read_file(TOKENS_PATH)
    connected = raw is not None
    mock = False
    if connected:
        try:
            mock = bool(json.loads(raw.decode()).get("mock"))
        except json.JSONDecodeError:
            connected = False
    return StatusOut(connected=connected, mock=mock)


@router.post("/dev-connect", response_model=StatusOut)
async def dev_connect(
    sessionId: str,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    provider: SandboxProvider = Depends(get_provider),
) -> StatusOut:
    """Write a mock FamilySearch token into the sandbox. Disabled once a real
    FamilySearch client is configured (then /login is the only path)."""
    if get_settings().familysearch_configured:
        raise HTTPException(status_code=403, detail="Use real FamilySearch sign-in")
    project = _owned(session, user, sessionId)
    sandbox = await provider.resume(project.sandbox_id)
    token = {
        "accessToken": "mock-fs-access-token",
        "refreshToken": "mock-fs-refresh-token",
        "expiresAt": int((time.time() + 3600) * 1000),
        "mock": True,
    }
    await sandbox.write_file(TOKENS_PATH, json.dumps(token, indent=2).encode())
    return StatusOut(connected=True, mock=True)


@router.get("/login")
def login(sessionId: str) -> dict:
    s = get_settings()
    if not s.familysearch_configured:
        raise HTTPException(
            status_code=501,
            detail=(
                "FamilySearch web OAuth not configured. Register "
                f"{s.public_url}/familysearch/callback on the FS dev key and set "
                "the client id. Until then use dev-connect (mock)."
            ),
        )
    # TODO: build the FS authorization URL (PKCE) and redirect; the callback
    # exchanges the code (reuse engine auth/refresh.ts logic), then writes the
    # real token to TOKENS_PATH inside the user's sandbox.
    raise HTTPException(status_code=501, detail="FamilySearch OAuth not yet wired")
