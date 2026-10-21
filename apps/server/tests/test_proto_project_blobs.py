"""`proto/web/project_blobs.py` — source scans out, researcher uploads in.

Two of phase 2's acceptance clauses rest on these: "a census page opens from the feed"
and "a PDF attached mid-run reaches the project". Both answered 501 until now.

The write is the part worth testing hard. It mirrors the engine's own `indexObject`
(fresh object key, upsert the row, delete the superseded object AFTER the row is
durable), and the failure modes are quiet: an orphaned object, or a row pointing at an
object that is not there. Neither raises on the next read — they just return nothing,
which is what the viewer renders as "no scan".
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SERVER = next(q for q in Path(__file__).resolve().parents if (q / "proto/web/app.py").is_file())
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(SERVER / "proto"))

from web.project_blobs import (  # noqa: E402
    IMAGE_REF_RE,
    fetch_blob,
    put_blob,
    safe_upload_name,
    upload_key,
)


class FakeS3:
    """The `S3Blobs` facade's surface, not a raw client. Both helpers take the shared
    facade now so one object knows how to reach the bucket -- the raw client they used
    to build keyed on GENEALOGY_S3_ENDPOINT and so was None on every AWS tier.

    No `delete`: the facade has none. A superseded object is left to U19's orphan sweep,
    because deleting it here ran before the route's commit.
    """

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = data
        self.content_types[key] = content_type

    def get(self, key: str) -> bytes:
        return self.objects[key]  # KeyError when absent, as botocore raises


class FakeConn:
    """Just enough psycopg: one `blobs` table keyed (project_id, key)."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], tuple[str, int, str]] = {}

    def execute(self, sql: str, params: tuple):  # noqa: ANN201
        if sql.startswith("SELECT s3_key FROM blobs"):
            row = self.rows.get((params[0], params[1]))
            return type("C", (), {"fetchone": staticmethod(lambda: (row[0],) if row else None)})()
        if sql.startswith("INSERT INTO blobs"):
            project_id, key, s3_key, nbytes, sha = params
            self.rows[(project_id, key)] = (s3_key, nbytes, sha)
            return type("C", (), {"fetchone": staticmethod(lambda: None)})()
        raise AssertionError(f"unexpected SQL: {sql[:60]}")


def test_a_stored_scan_comes_back_as_bytes():
    """The clause: a census page opens from the feed. Bytes, not UTF-8 — `fetch_sidecar`
    decodes and an image must not."""
    s3, conn = FakeS3(), FakeConn()
    put_blob(conn, s3, "p1", "images/a.jpg", b"\xff\xd8\xff\xe0 jpeg bytes")
    blob = fetch_blob(conn, s3, "p1", "images/a.jpg")
    assert blob is not None and blob.body == b"\xff\xd8\xff\xe0 jpeg bytes"


def test_a_missing_scan_is_none_not_an_error():
    """404 is a real state here: most projects hold no scans."""
    assert fetch_blob(FakeConn(), FakeS3(), "p1", "images/none.jpg") is None


def test_a_row_pointing_at_a_vanished_object_is_none_not_a_500():
    """A half-written project should read as 'not there'."""
    s3, conn = FakeS3(), FakeConn()
    put_blob(conn, s3, "p1", "images/a.jpg", b"x")
    s3.objects.clear()
    assert fetch_blob(conn, s3, "p1", "images/a.jpg") is None


def test_an_upload_writes_bytes_and_indexes_them():
    s3, conn = FakeS3(), FakeConn()
    n = put_blob(conn, s3, "p1", upload_key("deed.pdf"), b"%PDF-1.4 hello")
    assert n == 14
    s3_key, nbytes, sha = conn.rows[("p1", "uploads/deed.pdf")]
    assert nbytes == 14 and len(sha) == 64, "bytes and sha256 are NOT NULL columns"
    assert s3.objects[s3_key] == b"%PDF-1.4 hello"


def test_reuploading_a_name_replaces_the_row_and_leaves_the_old_object_to_the_sweep():
    """Upsert, mirroring the engine's `indexObject`: the researcher's mental model is a
    folder, so the ROW must point at the new bytes.

    The superseded OBJECT is deliberately NOT deleted here any more. The delete ran before
    the route commits, so a commit failure after a re-upload rolled the row back to a key
    whose object had just been removed and a good file read as "image not found". On AWS
    the web role has no DeleteObject at all; granting it to make uploads work would have
    activated exactly that. The object is unreferenced and `<project>/<key>/<uuid>`-shaped,
    which is what U19's orphan sweep collects.
    """
    s3, conn = FakeS3(), FakeConn()
    put_blob(conn, s3, "p1", upload_key("a.pdf"), b"first")
    first_key = conn.rows[("p1", "uploads/a.pdf")][0]
    put_blob(conn, s3, "p1", upload_key("a.pdf"), b"second")
    second_key = conn.rows[("p1", "uploads/a.pdf")][0]

    assert second_key != first_key, "a fresh object key per write, never overwrite in place"
    assert first_key in s3.objects, "the superseded object must survive for the sweep to collect"
    assert fetch_blob(conn, s3, "p1", upload_key("a.pdf")).body == b"second"


def test_the_object_is_written_before_the_row_points_at_it():
    """Ordering is the whole design. If the row landed first, a crash between the two
    would leave a reference to an object that does not exist — and the next read returns
    None, so it reads as 'no scan' forever rather than erring."""
    s3, conn = FakeS3(), FakeConn()
    order: list[str] = []
    real_put, real_exec = s3.put, conn.execute
    s3.put = lambda *a, **kw: (order.append("object"), real_put(*a, **kw))[1]  # type: ignore[assignment]
    conn.execute = lambda sql, params: (  # type: ignore[assignment]
        order.append("row") if sql.startswith("INSERT") else None,
        real_exec(sql, params),
    )[1]
    put_blob(conn, s3, "p1", "images/a.jpg", b"x")
    assert order == ["object", "row"]


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("deed.pdf", "deed.pdf"),
        ("C:\\Users\\me\\deed.pdf", "deed.pdf"),      # a browser directory upload
        ("/etc/passwd", "passwd"),
        ("sub/dir/scan 2.jpg", "scan 2.jpg"),         # spaces are allowed
        # Reduced to its basename, and `passwd` is a perfectly safe name to write at
        # `uploads/passwd`. The BASENAME REDUCTION is the defence here, not the `..`
        # check — which is why the reduction happens first. Matches the alpha exactly.
        ("../../etc/passwd", "passwd"),
        ("..", None),                                 # nothing left but the traversal
        ("a/../../b.pdf", "b.pdf"),
        ("", None),
        (None, None),
        (".hidden", None),                            # must start alphanumeric
        ("x" * 200, None),                            # over the length bound
    ],
)
def test_a_client_filename_cannot_steer_the_write(raw, expected):
    """Basename only. Some browsers send a path for directory uploads, and a
    client-supplied name must never decide where bytes land."""
    assert safe_upload_name(raw) == expected


def test_the_image_reference_shape_is_pinned():
    assert IMAGE_REF_RE.match("images/abc-1.jpg")
    assert not IMAGE_REF_RE.match("images/abc.png")
    assert not IMAGE_REF_RE.match("uploads/abc.jpg")
    assert not IMAGE_REF_RE.match("images/../secret.jpg")
