"""The browser client on the prototype web tier (docs/plan/familysearch-handoff.md, U12).

Serves the SSE build of ``apps/web`` (``VITE_SESSION_TRANSPORT=sse vite build``) from
``WEB_DIST_DIR``. Vendored, not imported: the alpha's ``_SpaStaticFiles``
(``apps/server/app/main.py``) is the same cache rule, but ``app.*`` is not in the image
or the bundle (``test_proto_auth.py`` pins that with an AST check).

There is deliberately no ``Mount("/")``. A catch-all at the root changes three kinds of API
answer: a wrong method 405 -> 404, the trailing-slash 307 -> 404, and a POST to an unrouted
path 404 -> 405. This module instead enumerates the top level of the dist: ``/`` serves
``index.html``, each top-level file gets its own GET/HEAD route and each top-level
directory a ``StaticFiles`` mount, so every API status is unchanged by construction. The
SPA routes by hash and asks for ``/assets/...`` absolutely, so it needs no fallback.

  WEB_DIST_DIR unset or empty    no SPA routes (tests, compose without the image's ENV)
  set, relative                  resolved against the tier root (``web/``'s parent), not cwd
  set, missing or no index.html  RuntimeError, so uvicorn never starts a tier serving nothing
  a top-level name taken by the API (``api``, ``auth``, ``callback`` or a route's first
  segment)                       RuntimeError

Cache-Control: every ``*.html`` and every other root file ``no-cache``, so a redeploy's
new asset names are picked up on the next load; ``/assets/*`` is content-hashed by Vite and
is ``public, max-age=31536000, immutable``. Any other directory is ``no-cache``.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

from fastapi import FastAPI
from starlette.responses import FileResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.types import Scope

ENV_VAR = "WEB_DIST_DIR"
NO_CACHE = "no-cache"
IMMUTABLE = "public, max-age=31536000, immutable"
HASHED_DIR = "assets"
RESERVED = frozenset({"api", "auth", "callback"})


class _CachedStaticFiles(StaticFiles):
    def __init__(self, *, directory: Path, cache_control: str) -> None:
        super().__init__(directory=str(directory))
        self.cache_control = cache_control

    async def get_response(self, path: str, scope: Scope) -> Response:
        resp = await super().get_response(path, scope)
        if resp.status_code < 400:
            resp.headers["Cache-Control"] = NO_CACHE if path.endswith(".html") else self.cache_control
        return resp


def dist_dir(tier_root: Path, env: Mapping[str, str] | None = None) -> Path | None:
    """The dist ``WEB_DIST_DIR`` names, or None when it is unset or empty."""
    value = (os.environ if env is None else env).get(ENV_VAR, "").strip()
    if not value:
        return None
    path = Path(value)
    return path if path.is_absolute() else tier_root / path


def _taken(app: FastAPI) -> set[str]:
    """First path segments the app already routes (``/api/...`` -> ``api``)."""
    return {seg for r in app.routes if (seg := getattr(r, "path", "").lstrip("/").split("/", 1)[0])}


def _file_route(path: str, file: Path) -> Route:
    async def serve(_request) -> FileResponse:
        return FileResponse(file, headers={"Cache-Control": NO_CACHE})

    return Route(path, serve, methods=["GET", "HEAD"], include_in_schema=False)


def mount_spa(app: FastAPI, *, tier_root: Path, env: Mapping[str, str] | None = None) -> Path | None:
    """Add the dist's routes to ``app``; call it after every API route exists. Returns the
    dist served, or None when ``WEB_DIST_DIR`` is unset. Raises before adding anything."""
    dist = dist_dir(tier_root, env)
    if dist is None:
        return None
    if not dist.is_dir():
        raise RuntimeError(f"{ENV_VAR}={dist} is not a directory; unset it to serve no SPA")
    index = dist / "index.html"
    if not index.is_file():
        raise RuntimeError(f"{ENV_VAR}={dist} has no index.html")
    entries = sorted(p for p in dist.iterdir() if not p.name.startswith("."))
    clash = sorted(p.name for p in entries if p.name in RESERVED | _taken(app))
    if clash:
        raise RuntimeError(f"{ENV_VAR}={dist}: top-level {clash} collide with API routes")
    routes: list[Route | Mount] = [_file_route("/", index)]
    for entry in entries:
        if entry.is_dir():
            cache = IMMUTABLE if entry.name == HASHED_DIR else NO_CACHE
            routes.append(Mount(f"/{entry.name}", app=_CachedStaticFiles(directory=entry, cache_control=cache),
                                name=f"spa-{entry.name}"))
        elif entry.is_file():
            routes.append(_file_route(f"/{entry.name}", entry))
    app.router.routes.extend(routes)
    return dist
