"""FamilySearch image proxy. The browser can't fetch FS image bytes directly
(no token, Imperva/CSP), so the control plane proxies them: fetch via the
engine's image_read (Bearer token + BROWSER_USER_AGENT) and stream the bytes
back.

POC posture: scaffolded. The mock agent surfaces no real FS images, and no FS
token is provisioned, so this returns 501 with guidance. When wired, it will
resolve the session's sandbox token and proxy the bytes.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .auth import get_current_user
from .models import User

router = APIRouter(prefix="/api/image", tags=["image"])


@router.get("/{image_id}")
async def proxy_image(image_id: str, user: User = Depends(get_current_user)):
    raise HTTPException(
        status_code=501,
        detail=(
            "Image proxy not enabled for the POC. When wired: read the session's "
            "FamilySearch token, call the engine image_read for image_id, and "
            "stream image/jpeg back to the browser."
        ),
    )
