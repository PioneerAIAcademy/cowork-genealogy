"""`proto/web/project_blobs.py` — source scans out, researcher uploads in.

Two of phase 2's acceptance clauses rest on these: "a census page opens from the feed"
and "a PDF attached mid-run reaches the project". Both answered 501 until now.

The write is the part worth testing hard. It mirrors the engine's own `indexObject`
(fresh object key, upsert the row, leave the superseded object to U19's orphan sweep),
and the failure modes are quiet: an orphaned object, or a row pointing at an
object that is not there. Neither raises on the next read — they just return nothing,
which is what the viewer renders as "no scan".
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

SERVER = next(q for q in Path(__file__).resolve().parents if (q / "proto/web/app.py").is_file())
sys.path.insert(0, str(SERVER))
sys.path.insert(0, str(SERVER / "proto"))

from web.project_blobs import (  # noqa: E402
    IMAGE_REF_RE,
    delete_blob,
    fetch_blob,
    pdf_page_count,
    put_blob,
    safe_upload_name,
    sniff,
    text_key,
    upload_key,
)


UPLOAD_NAME_CASES = [
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
    (".hidden", None),                            # a dotfile is refused, not renamed
    ("x" * 200, "x" * 120),                       # truncated to the length bound
    ("Ancestry Download - Massachusetts, U.S., Wills and Probate Records.pdf",
     "Ancestry Download - Massachusetts_ U.S._ Wills and Probate Records.pdf"),
    ("Müller.pdf", "M_ller.pdf"),
    (",,,", None),
    ("--", None),
    ("a..pdf", None),
    (",report.pdf", "_report.pdf"),
    ("y" * 150 + ".pdf", "y" * 116 + ".pdf"),
    ("s" * 150 + "." + "e" * 19, "s" * 100 + "." + "e" * 19),
    ("s" * 150 + "." + "e" * 20, "s" * 120),
    ("a" * 115 + ".b" + "c" * 10 + ".pdf", "a" * 115 + ".pdf"),
    ("a" * 119 + "." + "b" * 30, "a" * 119),
    ("_" * 130 + "." + "b" * 25, None),
]


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
        if sql.startswith("DELETE FROM blobs"):
            gone = self.rows.pop((params[0], params[1]), None)
            return type("C", (), {"rowcount": int(gone is not None)})()
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


@pytest.mark.parametrize("raw, expected", UPLOAD_NAME_CASES)
def test_a_client_filename_cannot_steer_the_write(raw, expected):
    """Basename only. Some browsers send a path for directory uploads, and a
    client-supplied name must never decide where bytes land."""
    assert safe_upload_name(raw) == expected


@pytest.mark.parametrize("raw, expected", UPLOAD_NAME_CASES)
def test_alpha_cleans_upload_names_the_same_way(raw, expected):
    from app.sessions import _clean_upload_name

    assert _clean_upload_name(raw) == expected


def test_the_image_reference_shape_is_pinned():
    assert IMAGE_REF_RE.match("images/abc-1.jpg")
    assert not IMAGE_REF_RE.match("images/abc.png")
    assert not IMAGE_REF_RE.match("uploads/abc.jpg")
    assert not IMAGE_REF_RE.match("images/../secret.jpg")


# -- #3987: project uploads ---------------------------------------------------------


def test_the_text_layer_sits_beside_the_upload_under_the_name_project_context_reads():
    assert text_key("deed.pdf") == "uploads/deed.pdf.txt"


@pytest.mark.parametrize(
    ("head", "content_type", "refused"),
    [
        (b"%PDF-1.7\n", "application/pdf", None),
        (b"\xff\xd8\xff\xe0\x00\x10JFIF", "image/jpeg", None),
        (b"\x89PNG\r\n\x1a\n\x00\x00", "image/png", None),
        (b"GIF89a\x01\x00", "image/gif", None),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp", None),
        (b"II*\x00\x08\x00\x00\x00", "image/tiff", "TIFF"),
        (b"MM\x00*\x00\x00\x00\x08", "image/tiff", "TIFF"),
        *[(b"\x00\x00\x00\x18ftyp" + brand + b"\x00\x00", "image/heic", "HEIC")
          for brand in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1")],
        # An MP4 shares the box layout; only the HEIF brands are refused.
        (b"\x00\x00\x00\x18ftypisom\x00\x00", "application/octet-stream", None),
        (b"\x00\x00\x00\x18ftypmp42\x00\x00", "application/octet-stream", None),
        (b"Ada Schuster, b. 1841", "application/octet-stream", None),
        (b"II", "application/octet-stream", None),
        (b"", "application/octet-stream", None),
    ],
)
def test_the_first_bytes_decide_the_type_and_tiff_and_heic_are_refused(head, content_type, refused):
    got = sniff(head)
    assert (got.content_type, got.refused) == (content_type, refused)


@pytest.mark.parametrize(
    ("body", "pages"),
    [
        (b"1 0 obj<</Type /Pages /Kids[2 0 R]>>endobj 2 0 obj<</Type /Page>>endobj", 1),
        (b"1 0 obj<</Type/Pages>>endobj 2 0 obj<</Type/Page>>endobj 3 0 obj\n<</Type\n/Page>>endobj"
         b" 4 0 obj<</Type /Page /Parent 1 0 R>>endobj", 3),
        # An incremental save repeats the page object under the same number: still one page.
        (b"1 0 obj<</Type /Pages>>endobj 5 0 obj<</Type /Page>>endobj %%EOF\n"
         b"5 0 obj<</Type /Page /Annots [6 0 R]>>endobj %%EOF", 1),
        # Pages inside a compressed object stream are invisible: the documented undercount.
        (b"1 0 obj<</Type /ObjStm /N 3>>stream\nx\x9c\x00\x01endstream endobj", 0),
    ],
)
def test_pages_are_counted_by_distinct_object_number(body, pages):
    assert pdf_page_count(b"%PDF-1.4\n" + body) == pages


def test_pdf_page_count_is_linear_on_a_digit_run():
    """A long digit run made the unbounded object-header regex backtrack quadratically,
    and `re` holds the GIL, so the scan froze the event loop for every patron."""
    body = b"%PDF-1.4\n" + b"1" * 50_000
    t = time.perf_counter()
    pdf_page_count(body)
    assert time.perf_counter() - t < 1.0


def test_deleting_an_upload_drops_its_row_and_leaves_the_object_to_the_sweep():
    conn, s3 = FakeConn(), FakeS3()
    put_blob(conn, s3, "proj_1", "uploads/deed.pdf.txt", b"text")
    assert delete_blob(conn, "proj_1", "uploads/deed.pdf.txt") is True
    assert ("proj_1", "uploads/deed.pdf.txt") not in conn.rows
    assert len(s3.objects) == 1  # FakeS3 has no delete: the facade has none either
    assert delete_blob(conn, "proj_1", "uploads/deed.pdf.txt") is False
