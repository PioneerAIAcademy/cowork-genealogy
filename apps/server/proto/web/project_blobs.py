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
  - no write path here removes an S3 object: a superseded or dropped one is left
    unreferenced, and U19's orphan sweep on the tools tier collects it (the web role has
    no `s3:DeleteObject` on AWS).

Pure where it can be: the key and name rules are testable without S3 or Postgres.
"""

from __future__ import annotations

import bisect
import hashlib
import os
import re
import uuid
from dataclasses import dataclass
from typing import Any

#: The image rule, upload limit and filename cleaner are copied from `app/sessions.py`,
#: not imported. The web bundle ships `proto/web/*.py` at `web/` with no `app` package
#: (`scripts/eb_bundles/build.py`), so an import would be a ModuleNotFoundError in the
#: image and nowhere else — this branch has already shipped that mistake once.
IMAGE_REF_RE = re.compile(r"^images/[A-Za-z0-9._-]+\.jpg$")
UPLOAD_MAX_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class Blob:
    body: bytes
    s3_key: str


def upload_key(name: str) -> str:
    """The project-relative key for an upload. `name` must already be a basename."""
    return f"uploads/{name}"


def text_key(name: str) -> str:
    """Where an upload's text layer lives: `uploads/<name>.txt`, the name `project_context`
    reads as the text layer (`project-context.ts`, `projectUploads`)."""
    return upload_key(name) + ".txt"


@dataclass(frozen=True)
class Sniffed:
    """What the first bytes declare. `refused` names the format when the upload must be
    turned away."""

    content_type: str
    refused: str | None = None


_HEIF_BRANDS = frozenset({b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"})


def sniff(head: bytes) -> Sniffed:
    """The content type the first bytes declare, never the client's. TIFF and HEIC/HEIF are
    refused. Anything unrecognised is stored as `application/octet-stream`."""
    if head.startswith(b"%PDF-"):
        return Sniffed("application/pdf")
    if head.startswith(b"\xff\xd8\xff"):
        return Sniffed("image/jpeg")
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return Sniffed("image/png")
    if head.startswith((b"GIF87a", b"GIF89a")):
        return Sniffed("image/gif")
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return Sniffed("image/webp")
    if head.startswith((b"II*\x00", b"MM\x00*")):
        return Sniffed("image/tiff", refused="TIFF")
    if head[4:8] == b"ftyp" and head[8:12] in _HEIF_BRANDS:
        return Sniffed("image/heic", refused="HEIC")
    return Sniffed("application/octet-stream")


_OBJ_HEADER_RE = re.compile(rb"(?<![0-9])(\d{1,10})\s{1,16}\d{1,5}\s{1,16}obj\b")
_PAGE_RE = re.compile(rb"/Type\s*/Page\b")


def pdf_page_count(body: bytes) -> int:
    """Page objects in a raw PDF, by distinct object number, so an incrementally saved
    single page (each revision repeats `5 0 obj ... /Type /Page`) counts once.

    A heuristic with no PDF parser, so no new dependency on the web tier. It UNDERCOUNTS a
    PDF whose page objects sit in compressed object streams, so a multi-page scan saved
    that way can be admitted; it never counts a single page as two.
    """
    headers = [(m.start(), m.group(1)) for m in _OBJ_HEADER_RE.finditer(body)]
    starts = [start for start, _ in headers]
    pages: set[bytes] = set()
    for m in _PAGE_RE.finditer(body):
        i = bisect.bisect_right(starts, m.start()) - 1
        pages.add(headers[i][1] if i >= 0 else b"@%d" % m.start())
    return len(pages)


# Copied from app/sessions.py's _clean_upload_name (see the note at the top of this file).
# Keep the two in step.
def safe_upload_name(raw: str | None) -> str | None:
    """Clean a client basename to ASCII, replacing unsupported characters with underscores.

    Refuse empty names, dotfiles, double dots and names without letters or digits.
    Cap at 120 characters, preserving extensions up to 20 characters. Basename first
    keeps a client-supplied path from steering where the write lands.
    """
    name = (raw or "").replace("\\", "/").split("/")[-1].strip()
    if not name or name.startswith(".") or ".." in name:
        return None
    name = re.sub(r"[^A-Za-z0-9._ -]", "_", name)
    if len(name) > 120:
        stem, ext = os.path.splitext(name)
        if len(ext) <= 20:
            name = stem[:120 - len(ext)].rstrip(" .") + ext
        else:
            name = name[:120].rstrip(" .")
    if re.search(r"[A-Za-z0-9]", name) is None:
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
    s3_key = f"{project_id}/{key}/{uuid.uuid4()}"
    blobs.put(s3_key, body, content_type)
    conn.execute(
        # `created_at` is refreshed, matching the engine's own upsert on this table
        # (`indexObject`, pg-s3-project-store.ts: "created_at = EXCLUDED.created_at").
        # It is the only timestamp `blobs` has, and `fetch_sidecar` hands it to the
        # viewer AS the mtime -- so leaving it would show a re-uploaded sidecar with
        # the time of the write it replaced.
        "INSERT INTO blobs (project_id, key, s3_key, bytes, sha256) VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT (project_id, key) DO UPDATE SET s3_key = EXCLUDED.s3_key, "
        "bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256, created_at = now()",
        (project_id, key, s3_key, len(body), hashlib.sha256(body).hexdigest()),
    )
    return len(body)


def delete_blob(conn: Any, project_id: str, key: str) -> bool:
    """Drop the index row for a project-relative key. True when a row went.

    The row only. The object it pointed at is left unreferenced for U19's orphan sweep,
    as `put_blob` leaves a superseded one: the web role has no `s3:DeleteObject`, and
    removing the object before the caller commits would strand the row on nothing.
    """
    cur = conn.execute("DELETE FROM blobs WHERE project_id = %s AND key = %s", (project_id, key))
    return bool(getattr(cur, "rowcount", 0))
