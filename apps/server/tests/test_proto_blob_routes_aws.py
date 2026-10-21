"""The blob routes reach the bucket the way that works on AWS.

Blocker 5 of the #3262 self-review. The three routes each built their own client via
`_s3_client`, which returned None unless `GENEALOGY_S3_ENDPOINT` was set — and the
handoff says to leave that unset on AWS, where the regional endpoint is correct and the
instance profile signs (`docs/plan/familysearch-handoff.md`, step 15). So on every
deployed tier the sidecar and image routes 404'd, the viewer read that as "no scan", and
uploads 503'd. It also passed `""` for the key pair, which overrides the instance role
rather than falling through to the default chain.

The route tests all stub the lookup, which is why this survived. These assert the thing a
stub cannot: that there is ONE way to reach the bucket, and it is the shared facade.
"""

from __future__ import annotations

import re
from pathlib import Path

PROTO = Path(__file__).resolve().parents[1] / "proto"
APP = (PROTO / "web" / "app.py").read_text(encoding="utf-8")


def test_the_routes_do_not_build_their_own_s3_client():
    """`_s3_client` is gone and nothing replaced it. A second builder is a second place
    to get the AWS case wrong, which is exactly what happened."""
    assert "def _s3_client" not in APP, "a per-route S3 client is back"
    # botocore/boto3 reached directly from the web app, outside blobstore.py.
    direct = [ln for ln in APP.splitlines()
              if re.search(r"\b(botocore|boto3)\b", ln) and not ln.lstrip().startswith("#")]
    assert direct == [], f"app.py builds a client outside blobstore.py:\n  " + "\n  ".join(direct)


def test_every_blob_route_reads_the_shared_facade():
    """Each of the three reads `app.state.blobs`, the object `blobstore.from_env` built —
    the same one the feedback route already used. Fails before the fix: they read
    `_s3_client()`."""
    uses = APP.count("request.app.state.blobs")
    assert uses >= 4, (
        f"only {uses} site(s) read the shared facade; expected the three blob routes "
        "plus feedback"
    )


def test_a_missing_store_is_404_on_a_read_and_503_on_a_write():
    """The semantic that was nearly lost. A scan reads as ABSENT (404) rather than
    unimplemented; an upload says the store is UNAVAILABLE (503). Pinned here because the
    first draft of this fix made all three 503."""
    body = APP
    # The two GETs sit before the upload POST in the file; check each guard's status.
    guards = re.findall(
        r"blobs = request\.app\.state\.blobs\s*\n\s*if blobs is None:\s*\n"
        r"(?:\s*#[^\n]*\n)*\s*raise HTTPException\(status_code=(\d+)",
        body,
    )
    # sidecar GET, image GET, upload POST, feedback POST — in file order. The two reads
    # answer "absent", the two writes answer "unavailable".
    assert guards == ["404", "404", "503", "503"], \
        f"guard statuses are {guards}, expected 404/404/503/503"


def test_the_helpers_take_the_facade_not_a_bucket_name():
    """`fetch_blob`, `put_blob` and `fetch_sidecar` no longer take a raw client plus a
    bucket string: one object knows how to reach the bucket."""
    for mod, fn in (("project_blobs.py", "fetch_blob"), ("project_blobs.py", "put_blob"),
                    ("sidecar.py", "fetch_sidecar")):
        src = (PROTO / "web" / mod).read_text(encoding="utf-8")
        sig = re.search(rf"def {fn}\(([^)]*)\)", src, re.S)
        assert sig, f"{fn} not found in {mod}"
        assert "bucket" not in sig.group(1), f"{fn} still takes a bucket name: {sig.group(1)}"


def test_no_client_side_delete_of_a_superseded_object():
    """Deleting it ran BEFORE the route's commit, so a commit failure stranded the row on
    a removed object and a good file read as "image not found". The web role has no
    DeleteObject on AWS; granting it to make uploads work would have activated that. U19's
    orphan sweep collects the unreferenced object instead."""
    src = (PROTO / "web" / "project_blobs.py").read_text(encoding="utf-8")
    assert "delete_object" not in src and ".delete(" not in src, \
        "put_blob deletes the superseded object again"
