"""Reading and writing project blobs — source scans and researcher uploads.

`web/sidecar.py` already reads ONE blob shape (`results/<log_id>.json`) and decodes it
as UTF-8 JSON. These two are different enough to live apart: a scan is bytes, and an
upload is the only WRITE the web tier performs at all.

The write mirrors the engine's own `indexObject` (`pg-s3-project-store.ts`) rather than
inventing a second convention, because both write the same two places and a divergence
would show up as an orphaned object or a row pointing at nothing:

  - a FRESH object key per write (`<project>/<ref>/<uuid>`), never overwriting in place;
  - `INSERT … ON CONFLICT (project_id, key) DO UPDATE` — re-uploading a name replaces
    it, which is the researcher's mental model of a folder;
  - the superseded object deleted only AFTER the row change is durable, so a crash
    leaves an unreferenced object rather than a row pointing at a deleted one.

Pure where it can be: the key and name rules are testable without S3 or Postgres.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass
from typing import Any

#: Copied from `app/sessions.py`, not imported. The web bundle ships `proto/web/*.py`
#: at `web/` with no `app` package (`scripts/eb_bundles/build.py`), so an import would
#: be a ModuleNotFoundError in the image and nowhere else — this branch has already
#: shipped that mistake once.
IMAGE_REF_RE = re.compile(r"^images/[A-Za-z0-9._-]+\.jpg$")
UPLOAD_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._ -]{0,120}$")
UPLOAD_MAX_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class Blob:
    body: bytes
    s3_key: str


def upload_key(name: str) -> str:
    """The project-relative key for an upload. `name` must already be a basename."""
    return f"uploads/{name}"


def safe_upload_name(raw: str | None) -> str | None:
    """A client filename reduced to a basename, or None if it is not acceptable.

    Basename only: some browsers send a path for directory uploads, and a
    client-supplied name must never steer where the write lands.
    """
    name = (raw or "").replace("\\", "/").split("/")[-1].strip()
    if not name or ".." in name or not UPLOAD_NAME_RE.match(name):
        return None
    return name


def fetch_blob(conn: Any, blobs: Any, project_id: str, key: str) -> Blob | None:
    """The bytes behind one project-relative key, or None.

    None rather than raising for a missing row OR a missing object: a half-written
    project should read as "not there", not as a 500.
    """
    row = conn.execute(
        "SELECT s3_key FROM blobs WHERE project_id = %s AND key = %s", (project_id, key)
    ).fetchone()
    if not row:
        return None
    s3_key = row[0] if not isinstance(row, dict) else row["s3_key"]
    try:
        return Blob(body=blobs.get(s3_key), s3_key=s3_key)
    except Exception:  # noqa: BLE001 - a missing or unreadable object is "not there"
        return None


def put_blob(conn: Any, blobs: Any, project_id: str, key: str, body: bytes,
             content_type: str = "application/octet-stream") -> int:
    """Write bytes at a project-relative key and index them. Returns the byte count.

    Ordering is the point. The new object goes up FIRST, then the row is upserted — so the
    row never points at an object that is not there yet, and a crash between the two
    strands an object rather than a reference.

    The superseded object is NOT deleted here, deliberately. The delete used to run before
    the route commits, which is the opposite of what this docstring claimed: a commit
    failure after a re-upload rolled the row back to a key whose object had just been
    removed, and the researcher's previously-good file read as "image not found". On AWS
    the web role had no `s3:DeleteObject`, so it could never fire — granting it to make
    uploads work would have ACTIVATED that. A superseded object is unreferenced and
    `<project_id>/<key>/<uuid>`-shaped, which is exactly what U19's orphan sweep collects,
    so the cost of leaving it is one orphan until the sweep runs.
    """
    previous = conn.execute(
        "SELECT s3_key FROM blobs WHERE project_id = %s AND key = %s", (project_id, key)
    ).fetchone()
    prior_key = None
    if previous:
        prior_key = previous[0] if not isinstance(previous, dict) else previous["s3_key"]

    s3_key = f"{project_id}/{key}/{uuid.uuid4()}"
    blobs.put(s3_key, body, content_type)
    conn.execute(
        "INSERT INTO blobs (project_id, key, s3_key, bytes, sha256) VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT (project_id, key) DO UPDATE SET s3_key = EXCLUDED.s3_key, "
        "bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256",
        (project_id, key, s3_key, len(body), hashlib.sha256(body).hexdigest()),
    )
    return len(body)
