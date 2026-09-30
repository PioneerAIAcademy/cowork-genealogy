"""Reading a sidecar result body out of the prototype's blob store.

`results/<log_id>.json` is an S3 object indexed in the `blobs` table. The web tier
returned 404 for every one of them, and the viewer reads 404 as "this log has no
sidecar" -- so search results silently showed nothing instead of erring, which is
the worst of the three possible behaviours.

Pure here, so the lookup and shaping are testable without S3 or Postgres.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# `log_id` arrives from the URL. Anything outside this alphabet could walk out of
# `results/` -- a reader asking for `../..` must get a rejection, not a blob.
_LOG_ID_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


@dataclass(frozen=True)
class SidecarBlob:
    raw: str
    mtime: float


def sidecar_key(log_id: str) -> str:
    """The project-relative key for a log's sidecar.

    Raises ValueError for anything that is not a plain id, rather than building a
    key and letting the store decide -- the store's own traversal rules are not this
    module's to assume.
    """
    if not log_id or not _LOG_ID_RE.match(log_id) or log_id in {".", ".."}:
        raise ValueError(f"not a log id: {log_id!r}")
    return f"results/{log_id}.json"


def sidecar_payload(blob: SidecarBlob | None) -> dict[str, Any] | None:
    """What the viewer's `SidecarRead` expects, or None when there is no sidecar.

    `mtime` stays a NUMBER: the viewer keeps the last one and refetches when it
    grows, and a string would compare lexically and stop refreshing after the tenth
    update.
    """
    if blob is None:
        return None
    return {"raw": blob.raw, "mtime": float(blob.mtime)}


def fetch_sidecar(conn: Any, s3: Any, bucket: str, project_id: str, log_id: str) -> SidecarBlob | None:
    """The blob for one log's sidecar, or None.

    Two steps because the body is not in Postgres: the `blobs` row carries the S3 key
    and the size, and S3 carries the bytes. A row with no object behind it returns
    None rather than raising -- a half-written project should show "no sidecar", not
    a 500.
    """
    key = sidecar_key(log_id)
    row = conn.execute(
        "SELECT s3_key, created_at FROM blobs WHERE project_id = %s AND key = %s",
        (project_id, key),
    ).fetchone()
    if not row:
        return None
    s3_key = row[0] if not isinstance(row, dict) else row["s3_key"]
    created = row[1] if not isinstance(row, dict) else row["created_at"]
    try:
        obj = s3.get_object(Bucket=bucket, Key=s3_key)
        raw = obj["Body"].read().decode("utf-8")
    except Exception:  # noqa: BLE001 - a missing or unreadable object is "no sidecar"
        return None
    mtime = created.timestamp() if hasattr(created, "timestamp") else float(created or 0)
    return SidecarBlob(raw=raw, mtime=mtime)
