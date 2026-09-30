"""Serving sidecar bodies from the prototype web tier.

The endpoint returned 404 with "not served by the prototype web tier", and the
viewer treats 404 as "this log has no sidecar" -- so every search result silently
showed nothing rather than erring. The bodies exist: `results/<log_id>.json` is an S3
blob indexed in the `blobs` table.

The lookup and shaping are pure so they can be tested without S3 or Postgres; only
the two fetch callables are injected.
"""

import pytest

from proto.web.sidecar import SidecarBlob, sidecar_payload, sidecar_key


def test_the_key_is_the_project_relative_results_path():
    assert sidecar_key("log_042") == "results/log_042.json"


def test_a_log_id_cannot_escape_the_results_directory():
    """`log_id` arrives from the URL. Without this a caller could read any blob in
    the project by asking for ../ -- or any other project's, depending on the store."""
    for bad in ("../secrets", "a/b", "..", "log_1/../../x", ""):
        with pytest.raises(ValueError):
            sidecar_key(bad)


def test_payload_carries_the_raw_body_and_an_mtime():
    blob = SidecarBlob(raw='{"log_id": "log_1"}', mtime=1700000000.0)
    assert sidecar_payload(blob) == {"raw": '{"log_id": "log_1"}', "mtime": 1700000000.0}


def test_a_missing_blob_is_none_not_an_error():
    """The viewer reads 404 as 'no sidecar for this log', which is a real and common
    state -- not every log entry has one."""
    assert sidecar_payload(None) is None


def test_mtime_is_a_number_the_viewer_can_compare():
    # The viewer keeps `lastMtime` and refetches when it grows; a string would
    # compare lexically and stop refreshing after the tenth update.
    out = sidecar_payload(SidecarBlob(raw="{}", mtime=1.5))
    assert isinstance(out["mtime"], (int, float))


# --- the fetch half, with both stores faked ---

class _Cur:
    def __init__(self, row): self._row = row
    def fetchone(self): return self._row


class _Conn:
    def __init__(self, row): self._row = row; self.sql = None
    def execute(self, sql, params): self.sql = (sql, params); return _Cur(self._row)


class _Body:
    def __init__(self, data): self._d = data
    def read(self): return self._d


class _S3:
    def __init__(self, data=None, boom=False): self._d = data; self._boom = boom
    def get_object(self, Bucket, Key):  # noqa: N803 - boto3's own signature
        if self._boom: raise RuntimeError("no such key")
        return {"Body": _Body(self._d)}


from datetime import datetime, timezone  # noqa: E402

from proto.web.sidecar import fetch_sidecar  # noqa: E402

T0 = datetime(2026, 9, 29, 12, 0, tzinfo=timezone.utc)


def test_fetch_returns_the_object_body_and_the_rows_timestamp():
    conn = _Conn(("s3/abc", T0))
    blob = fetch_sidecar(conn, _S3(b'{"log_id":"log_1"}'), "projects", "proj_1", "log_1")
    assert blob.raw == '{"log_id":"log_1"}'
    assert blob.mtime == T0.timestamp()


def test_fetch_asks_for_the_right_key():
    conn = _Conn(("s3/abc", T0))
    fetch_sidecar(conn, _S3(b"{}"), "projects", "proj_1", "log_7")
    assert conn.sql[1] == ("proj_1", "results/log_7.json")


def test_no_row_means_no_sidecar():
    assert fetch_sidecar(_Conn(None), _S3(b"{}"), "projects", "proj_1", "log_1") is None


def test_a_row_whose_object_is_gone_is_no_sidecar_not_a_crash():
    """A half-written project must show "no sidecar", not a 500."""
    assert fetch_sidecar(_Conn(("s3/gone", T0)), _S3(boom=True), "projects", "proj_1", "log_1") is None


def test_a_bad_log_id_never_reaches_the_database():
    conn = _Conn(("s3/abc", T0))
    with pytest.raises(ValueError):
        fetch_sidecar(conn, _S3(b"{}"), "projects", "proj_1", "../etc/passwd")
    assert conn.sql is None, "the traversal attempt must be refused BEFORE any query"
