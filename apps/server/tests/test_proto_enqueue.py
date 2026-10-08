"""Offline tests for U7: proto/enqueue.py's SigV4-signed SQS query client.

Two oracles, neither of them the code under test:

- AWS's published SigV4 test-suite vector (``post-x-www-form-urlencoded``), and two SQS
  SendMessage vectors hard-coded from botocore;
- ``verify_sigv4`` below, a stdlib re-derivation of the signature from the bytes a
  capture server actually RECEIVED. It never calls botocore, so a wire test cannot pass
  just because the signer agrees with itself; ``test_the_verifier_itself_rejects_tampering``
  shows it can fail.

elasticmq accepts unsigned and garbage-signed requests, so the compose stack proves the
request path and nothing about the signature: that is these tests' job. The conftest
fixture clears every AWS_* / GENEALOGY_SQS_* variable, points the shared files at
/nonexistent, turns IMDS off and resets both module copies before each test.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler
from typing import Any
from urllib.parse import urlencode, urlparse

import botocore.auth
import botocore.exceptions
import botocore.session
import pytest
from botocore.credentials import Credentials

from _sigv4 import Capture, QuietServer, verify_sigv4
from proto import enqueue

AK = "AKIDEXAMPLE"
SK = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"
# The AWS SigV4 test suite's session token (post-sts-token).
SUITE_TOKEN = (
    "AQoDYXdzEPT//////////wEXAMPLEtc764bNrC9SAPBSM22wDOk4x4HIZ8j4FZTwdQWLWsKWHGBuFqwAeMicRXmxfpSPfIeoIYRqTflfKD8YUuwthAx7mSEI/"
    "qkPpKPi/kMcGdQrmGdeehM4IC1NtBmUpp2wUE8phUZampKsburEDy0KPkyQDYwT7WZ0wq5VSXDvp75YU9HFvlRd8Tx6q6fE8YQcHNVXAkiY9q6d+xo0rKwT38x"
    "Vqr7ZD0u0iPPkUL64lIZbqBAz+scqKmlzm8FDrypNC9Yjc8fPOLn9FX9KSYvKTr4rvx3iSIlTJabIQwj2ICCR/oLxBA=="
)
SQS_URL = "https://sqs.us-east-1.amazonaws.com/"
SEND_BODY = urlencode({
    "Action": "SendMessage",
    "Version": "2012-11-05",
    "QueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/turns",
    "MessageBody": '{"turn_id": "t1"}',
}).encode("utf-8")
VECTOR2_SIG = "23d2766a0bf50211d2fdb23c893d5c11d1a879da60d0348f2f24e1954a9625e7"
VECTOR3_SIG = "ede027ff442fccb0f52d83aa60d25019f00a313bcafc550f69a643692a07d47b"
STATIC_ENV = {"GENEALOGY_SQS_ACCESS_KEY": "AKIATESTKEY", "GENEALOGY_SQS_SECRET_KEY": "SECRETVALUE"}


@pytest.fixture
def freeze(monkeypatch):
    def at(dt: datetime) -> None:
        monkeypatch.setattr(botocore.auth, "get_current_datetime", lambda remove_tzinfo=True: dt)
    return at


def _sig(headers: dict[str, str]) -> str:
    return headers["Authorization"].rsplit("Signature=", 1)[1]


@pytest.fixture
def capture():
    server = Capture()
    yield server
    server.close()


def _verify_captured(req: dict[str, Any], secret: str, region: str = "us-east-1") -> bool:
    return verify_sigv4(req["method"], req["path"], req["headers"], req["body"], secret, region, "sqs")


# ── signing: known-answer vectors ──────────────────────────────────────────────────


def test_signer_matches_aws_suite_post_x_www_form_urlencoded(freeze):
    """AWS's published SigV4 test suite, post-x-www-form-urlencoded: an oracle nobody here
    computed."""
    freeze(datetime(2015, 8, 30, 12, 36, 0))
    headers = enqueue.sign("https://example.amazonaws.com/", b"Param1=value1", Credentials(AK, SK),
                           "us-east-1", service="service")
    assert _sig(headers) == "ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a"
    assert "SignedHeaders=content-type;host;x-amz-date," in headers["Authorization"]
    assert verify_sigv4("POST", "/", headers, b"Param1=value1", SK, "us-east-1", "service")


def test_sqs_sendmessage_vector_static(freeze):
    """SendMessage of ``SEND_BODY`` at 2026-10-01T12:00:00Z with the AWS suite key.
    Regenerate: botocore 1.43.106 ``SigV4Auth(Credentials(AK, SK), "sqs", "us-east-1")``
    over an ``AWSRequest`` POST of those bytes with Content-Type and Host only."""
    freeze(datetime(2026, 10, 1, 12, 0, 0))
    assert hashlib.sha256(SEND_BODY).hexdigest().startswith("0c67abc3")
    headers = enqueue.sign(SQS_URL, SEND_BODY, Credentials(AK, SK), "us-east-1")
    assert headers["Authorization"] == (
        f"AWS4-HMAC-SHA256 Credential={AK}/20261001/us-east-1/sqs/aws4_request, "
        f"SignedHeaders=content-type;host;x-amz-date, Signature={VECTOR2_SIG}"
    )
    assert headers["X-Amz-Date"] == "20261001T120000Z"
    assert "X-Amz-Security-Token" not in headers
    assert verify_sigv4("POST", "/", headers, SEND_BODY, SK, "us-east-1", "sqs")


def test_sqs_sendmessage_vector_session_token(freeze):
    """The same request with the suite STS token: the token is signed and sent."""
    freeze(datetime(2026, 10, 1, 12, 0, 0))
    headers = enqueue.sign(SQS_URL, SEND_BODY, Credentials(AK, SK, SUITE_TOKEN), "us-east-1")
    assert "SignedHeaders=content-type;host;x-amz-date;x-amz-security-token," in headers["Authorization"]
    assert _sig(headers) == VECTOR3_SIG
    assert headers["X-Amz-Security-Token"] == SUITE_TOKEN
    assert verify_sigv4("POST", "/", headers, SEND_BODY, SK, "us-east-1", "sqs")


def test_signed_host_strips_only_the_default_port(freeze):
    freeze(datetime(2026, 10, 1, 12, 0, 0))
    for url in ("https://sqs.us-east-1.amazonaws.com:443/", "https://sqs.us-east-1.amazonaws.com"):
        headers = enqueue.sign(url, SEND_BODY, Credentials(AK, SK), "us-east-1")
        assert headers["Host"] == "sqs.us-east-1.amazonaws.com"
        assert _sig(headers) == VECTOR2_SIG, url
    assert enqueue._signed_host("http://elasticmq:9324") == "elasticmq:9324"
    assert enqueue._signed_host("https://h:8443/") == "h:8443"
    assert enqueue._signed_host("http://h:80/") == "h"
    headers = enqueue.sign("http://elasticmq:9324/", SEND_BODY, Credentials(AK, SK), "us-east-1")
    assert headers["Host"] == "elasticmq:9324"
    assert verify_sigv4("POST", "/", headers, SEND_BODY, SK, "us-east-1", "sqs")


# ── the wire ───────────────────────────────────────────────────────────────────────


def test_sqs_call_sends_exactly_what_it_signed(capture, monkeypatch):
    enqueue.configure(STATIC_ENV, None)
    doc = enqueue.sqs_call(capture.url, "SendMessage", {"QueueUrl": capture.url + "/000000000000/turns",
                                                       "MessageBody": '{"turn_id": "t"}'})
    assert enqueue.xml_text(doc, "MessageId") == "m1"
    [req] = capture.requests
    assert req["path"] == "/"
    assert _verify_captured(req, "SECRETVALUE"), req["headers"]
    received = {k.lower(): v for k, v in req["headers"]}
    assert "Credential=AKIATESTKEY/" in received["authorization"]
    stamp = datetime.strptime(received["x-amz-date"], "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
    assert abs(datetime.now(timezone.utc) - stamp) < timedelta(minutes=5)

    # The Host urllib sends is the Host that was signed, also when the URL names :443.
    sent: list[Any] = []

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"<R><MessageId>m2</MessageId></R>"

    monkeypatch.setattr(enqueue, "urlopen", lambda req, timeout: sent.append(req) or _Resp())
    enqueue.sqs_call("https://sqs.us-east-1.amazonaws.com:443", "SendMessage", {"MessageBody": "x"})
    [request] = sent
    assert request.get_header("Host") == "sqs.us-east-1.amazonaws.com"
    assert request.full_url == "https://sqs.us-east-1.amazonaws.com:443/"
    assert verify_sigv4("POST", "/", request.header_items(), request.data, "SECRETVALUE", "us-east-1", "sqs")


def test_the_verifier_itself_rejects_tampering(freeze):
    freeze(datetime(2026, 10, 1, 12, 0, 0))
    plain = enqueue.sign(SQS_URL, SEND_BODY, Credentials(AK, SK), "us-east-1")
    token = enqueue.sign(SQS_URL, SEND_BODY, Credentials(AK, SK, SUITE_TOKEN), "us-east-1")
    assert verify_sigv4("POST", "/", plain, SEND_BODY, SK, "us-east-1", "sqs")
    flipped = bytes([SEND_BODY[0] ^ 1]) + SEND_BODY[1:]
    assert not verify_sigv4("POST", "/", plain, flipped, SK, "us-east-1", "sqs")
    assert not verify_sigv4("POST", "/", plain, SEND_BODY, SK, "us-west-2", "sqs")
    assert not verify_sigv4("POST", "/", plain, SEND_BODY, SK + "x", "us-east-1", "sqs")
    dropped = dict(token, Authorization=token["Authorization"].replace(";x-amz-security-token", ""))
    assert not verify_sigv4("POST", "/", dropped, SEND_BODY, SK, "us-east-1", "sqs")
    # Legitimate variants: header names re-cased, and a URL that spelled the default port.
    assert verify_sigv4("POST", "/", {k.upper(): v for k, v in token.items()}, SEND_BODY, SK, "us-east-1", "sqs")
    port = enqueue.sign("https://sqs.us-east-1.amazonaws.com:443/", SEND_BODY, Credentials(AK, SK), "us-east-1")
    assert verify_sigv4("POST", "/", port, SEND_BODY, SK, "us-east-1", "sqs")


# ── credentials and IMDS ───────────────────────────────────────────────────────────


class FakeImds:
    """IMDSv2: PUT a token, then GET the role and its credentials with it. Serves the
    credential sets in order, one per credentials GET; ``delay`` sleeps on every request."""

    def __init__(self, creds: list[tuple[str, str, str]], *, delay: float = 0.0) -> None:
        self.creds = list(creds)
        self.served = 0
        self.problems: list[str] = []
        imds = self

        class Handler(BaseHTTPRequestHandler):
            def _send(self, status: int, text: str) -> None:
                data = text.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_PUT(self) -> None:  # noqa: N802
                time.sleep(delay)
                if not self.headers.get("x-aws-ec2-metadata-token-ttl-seconds"):
                    imds.problems.append("PUT without a ttl")
                self._send(200, "imds-session-token")

            def do_GET(self) -> None:  # noqa: N802
                time.sleep(delay)
                if self.headers.get("x-aws-ec2-metadata-token") != "imds-session-token":
                    imds.problems.append(f"GET {self.path} without the IMDSv2 token")
                path = self.path.rstrip("/")
                for prefix in ("/latest/meta-data/iam/security-credentials-extended",
                               "/latest/meta-data/iam/security-credentials"):
                    if path == prefix:
                        return self._send(200, "proto-role")
                    if path == prefix + "/proto-role":
                        ak, sk, tok = imds.creds[min(imds.served, len(imds.creds) - 1)]
                        imds.served += 1
                        expiry = datetime.now(timezone.utc) + timedelta(hours=6)
                        return self._send(200, json.dumps({
                            "Code": "Success", "Type": "AWS-HMAC", "AccessKeyId": ak,
                            "SecretAccessKey": sk, "Token": tok,
                            "Expiration": expiry.strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "LastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        }))
                self._send(404, "not found")

            def log_message(self, *args: Any) -> None:
                pass

        self.server = QuietServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}/"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def _use_imds(monkeypatch, imds: FakeImds) -> None:
    monkeypatch.delenv("AWS_EC2_METADATA_DISABLED", raising=False)
    monkeypatch.setenv("AWS_EC2_METADATA_SERVICE_ENDPOINT", imds.url)


def test_imds_role_credentials_are_signed_with_the_token_and_refresh(capture, monkeypatch):
    imds = FakeImds([("AK1", "SK1", "TOKEN-1"), ("AK2", "SK2", "TOKEN-2")])
    try:
        _use_imds(monkeypatch, imds)
        auth = enqueue.configure({}, capture.url + "/000000000000/turns")
        assert auth.mode == "default chain (iam-role)" and auth.method == "iam-role"
        enqueue.sqs_call(capture.url, "SendMessage", {"MessageBody": "one"})
        # Five minutes before the 6 h expiry: inside botocore's mandatory refresh window.
        real_now = datetime.now(timezone.utc)
        auth.credentials._time_fetcher = lambda: real_now + timedelta(hours=6, minutes=-5)
        enqueue.sqs_call(capture.url, "SendMessage", {"MessageBody": "two"})
    finally:
        imds.close()
    assert imds.problems == []
    first, second = capture.requests
    for req, (ak, sk, tok) in ((first, ("AK1", "SK1", "TOKEN-1")), (second, ("AK2", "SK2", "TOKEN-2"))):
        received = {k.lower(): v for k, v in req["headers"]}
        assert f"Credential={ak}/" in received["authorization"]
        assert received["x-amz-security-token"] == tok
        assert _verify_captured(req, sk)


def test_imds_is_bounded(monkeypatch):
    imds = FakeImds([("AK1", "SK1", "T")], delay=3.0)
    try:
        _use_imds(monkeypatch, imds)
        monkeypatch.setenv("AWS_METADATA_SERVICE_TIMEOUT", "5")
        started = time.monotonic()
        auth = enqueue.configure({}, None)
        elapsed = time.monotonic() - started
    finally:
        imds.close()
    assert auth.mode == "default chain (none found)" and auth.credentials is None
    assert elapsed < 4, f"IMDS took {elapsed:.1f} s"


def test_no_credentials_is_an_sqs_error_and_the_chain_is_retried(capture, monkeypatch):
    auth = enqueue.configure({}, None)
    assert auth.mode == "default chain (none found)"
    with pytest.raises(enqueue.SqsError, match=r"no AWS credentials \(default chain \(none found\)\)") as exc:
        enqueue.sqs_call(capture.url, "SendMessage", {"MessageBody": "x"})
    assert not isinstance(exc.value, botocore.exceptions.BotoCoreError)
    assert capture.requests == []
    assert enqueue.credentials_ready() is False
    # The chain is resolved again on the next call: credentials that appear are used.
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIALATER")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "later-secret")
    enqueue.sqs_call(capture.url, "SendMessage", {"MessageBody": "x"})
    [req] = capture.requests
    assert "Credential=AKIALATER/" in dict((k.lower(), v) for k, v in req["headers"])["authorization"]
    assert _verify_captured(req, "later-secret")
    assert enqueue._STATE.method == "env" and enqueue._STATE.mode == "default chain (env)"


def test_a_failing_refresh_is_an_sqs_error(monkeypatch):
    class Broken:
        method = "iam-role"

        def get_frozen_credentials(self):
            raise botocore.exceptions.CredentialRetrievalError(provider="iam-role", error_msg="boom")

    enqueue._STATE = enqueue.SqsAuth("default chain (iam-role)", None, Broken(), "iam-role")
    with pytest.raises(enqueue.SqsError, match="no AWS credentials"):
        enqueue.sqs_call("http://127.0.0.1:9", "SendMessage", {})
    assert enqueue.credentials_ready() is False


def test_credentials_ready_is_bounded_and_never_raises(monkeypatch):
    gate = threading.Event()

    class Slow:
        method = "iam-role"

        def get_frozen_credentials(self):
            gate.wait(5)
            return Credentials("A", "S").get_frozen_credentials()

    enqueue._STATE = enqueue.SqsAuth("default chain (iam-role)", None, Slow(), "iam-role")
    started = time.monotonic()
    assert enqueue.credentials_ready(0.2) is False
    assert time.monotonic() - started < 1
    gate.set()
    assert enqueue.credentials_ready(2) is True
    enqueue.reset()
    assert enqueue.credentials_ready() is False  # chain, none found
    enqueue.configure(STATIC_ENV, None)
    assert enqueue.credentials_ready() is True and enqueue.prewarm() == "static"
    monkeypatch.setattr(enqueue, "_current", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    assert enqueue.credentials_ready() is False


# ── config and region ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(("access", "secret", "aws_env", "expect"), [
    ("AKIAPAIR", "pair-secret", False, "static keys"),
    (None, None, True, "default chain (env)"),
    (None, None, False, "default chain (none found)"),
    ("", "", False, "default chain (none found)"),
    ("AKIAHALF", None, False, "GENEALOGY_SQS_SECRET_KEY"),
    (None, "half-secret", False, "GENEALOGY_SQS_ACCESS_KEY"),
    ("", "half-secret", False, "GENEALOGY_SQS_ACCESS_KEY"),
    ("AKIAHALF", "", False, "GENEALOGY_SQS_SECRET_KEY"),
])
def test_credential_mode_matrix(monkeypatch, access, secret, aws_env, expect):
    env = {}
    if access is not None:
        env["GENEALOGY_SQS_ACCESS_KEY"] = access
    if secret is not None:
        env["GENEALOGY_SQS_SECRET_KEY"] = secret
    if aws_env:
        # botocore's EnvProvider reads os.environ, never the mapping configure is handed.
        monkeypatch.setenv("AWS_ACCESS_KEY_ID", "AKIAENV")
        monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "env-secret")
    if expect == "static keys":
        monkeypatch.setattr(botocore.session, "Session", lambda *a, **k: pytest.fail("built a botocore Session"))
    if expect.startswith("GENEALOGY_"):
        with pytest.raises(enqueue.SqsConfigError) as exc:
            enqueue.configure(env, "http://elasticmq:9324/000000000000/turns")
        text = str(exc.value)
        assert f"{expect} is not" in text
        for value in (access, secret):
            if value:
                assert value not in text
        assert enqueue._STATE is None
        return
    auth = enqueue.configure(env, "http://elasticmq:9324/000000000000/turns")
    assert auth.mode == expect
    assert enqueue._STATE is auth


def test_region_resolution():
    rf = enqueue.region_for
    assert rf("https://sqs.eu-west-1.amazonaws.com/123/q", None) == "eu-west-1"
    assert rf("https://sqs-fips.us-east-1.amazonaws.com", None) == "us-east-1"
    assert rf("https://sqs.cn-north-1.amazonaws.com.cn/1/q", None) == "cn-north-1"
    assert rf("https://vpce-0abc-123.sqs.us-west-2.vpce.amazonaws.com/1/q", None) == "us-west-2"
    assert rf("https://queue.amazonaws.com/1/q", None) == "us-east-1"
    assert rf("https://ap-south-1.queue.amazonaws.com/1/q", None) == "ap-south-1"
    assert rf("https://sqs.eu-central-1.api.aws/1/q", None) == "eu-central-1"
    assert rf("https://SQS.EU-WEST-1.AMAZONAWS.COM:443/1/q", None) == "eu-west-1"
    assert rf("http://elasticmq:9324/000000000000/turns", None) == "us-east-1"
    assert rf("https://example.us-west-2.com/1/q", None) == "us-east-1", "not an AWS host"
    assert rf("http://elasticmq:9324", "eu-west-2") == "eu-west-2", "the override wins off AWS"
    assert rf("https://sqs.us-west-2.amazonaws.com", "us-west-2") == "us-west-2"
    with pytest.raises(enqueue.SqsConfigError) as exc:
        rf("https://sqs.us-west-2.amazonaws.com/1/q", "us-east-1")
    assert "us-east-1" in str(exc.value) and "us-west-2" in str(exc.value)
    # An AWS host this cannot parse needs the override, rather than a guessed us-east-1.
    with pytest.raises(enqueue.SqsConfigError, match="GENEALOGY_SQS_REGION"):
        rf("https://vpce-0abc.sqs.vpce.amazonaws.com/1/q", None)
    assert rf("https://vpce-0abc.sqs.vpce.amazonaws.com/1/q", "eu-west-1") == "eu-west-1"
    # configure cross-checks the override against the QUEUE_URL host.
    with pytest.raises(enqueue.SqsConfigError):
        enqueue.configure({**STATIC_ENV, "GENEALOGY_SQS_REGION": "us-east-1"},
                          "https://sqs.us-west-2.amazonaws.com/1/q")
    auth = enqueue.configure({**STATIC_ENV, "GENEALOGY_SQS_REGION": "us-west-2"},
                             "https://sqs.us-west-2.amazonaws.com/1/q")
    assert enqueue.describe(auth) == "sqs credentials: static keys; region us-west-2"


def test_sqs_call_signs_for_the_endpoint_region(monkeypatch):
    sent: list[Any] = []

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b"<R/>"

    monkeypatch.setattr(enqueue, "urlopen", lambda req, timeout: sent.append(req) or _Resp())
    enqueue.configure(STATIC_ENV, None)
    enqueue.sqs_call("https://sqs.eu-west-1.amazonaws.com", "SendMessage", {})
    [request] = sent
    assert "/eu-west-1/sqs/aws4_request" in request.get_header("Authorization")
    assert verify_sigv4("POST", "/", request.header_items(), request.data, "SECRETVALUE", "eu-west-1", "sqs")


def test_describe_never_leaks():
    auth = enqueue.configure(STATIC_ENV, "http://elasticmq:9324/000000000000/turns")
    assert enqueue.describe(auth) == "sqs credentials: static keys; region us-east-1"
    for text in (enqueue.describe(auth), repr(auth), str(auth)):
        assert "AKIATESTKEY" not in text and "SECRETVALUE" not in text
    # botocore's Credentials repr happens to be opaque; its frozen namedtuple's is not.
    frozen = auth.credentials.get_frozen_credentials()
    assert "SECRETVALUE" in repr(frozen)
    held = enqueue.SqsAuth(enqueue.STATIC_MODE, None, frozen, "static")
    assert "SECRETVALUE" not in repr(held) and "credentials=" not in repr(held)


# ── errors ─────────────────────────────────────────────────────────────────────────


def test_aws_error_is_coded_and_redacted(capture):
    enqueue.configure({"GENEALOGY_SQS_ACCESS_KEY": "AKIAERRORTESTKEY0001", "GENEALOGY_SQS_SECRET_KEY": "ERRSECRETERRSECRETERRSECRET"}, None)
    capture.status = 403
    capture.reply = (
        '<ErrorResponse xmlns="http://queue.amazonaws.com/doc/2012-11-05/"><Error><Type>Sender</Type>'
        "<Code>SignatureDoesNotMatch</Code><Message>Signature=abc123 for AKIAERRORTESTKEY0001 with ERRSECRETERRSECRETERRSECRET; "
        "x-amz-security-token:TOK123TOK123TOK123TOK\n\nThe Canonical String was 'POST\n/'</Message></Error>"
        "</ErrorResponse>"
    )
    with pytest.raises(enqueue.SqsError) as exc:
        enqueue.sqs_call(capture.url, "SendMessage", {"MessageBody": "x"})
    text = str(exc.value)
    assert text.startswith("SQS SendMessage failed: HTTP 403 SignatureDoesNotMatch: ")
    assert "Canonical" not in text, "the first line of the Message only"
    for secret in ("TOK123TOK123TOK123TOK", "ERRSECRETERRSECRETERRSECRET", "AKIAERRORTESTKEY0001", "Signature=", "abc123"):
        assert secret not in text, secret

    # A session token is redacted wherever it appears.
    enqueue._STATE = enqueue.SqsAuth("default chain (iam-role)", None, Credentials("AKIAERRORTESTKEY0001", "ERRSECRETERRSECRETERRSECRET", "TOK123TOK123TOK123TOK"),
                                     "iam-role")
    capture.reply = ("<ErrorResponse><Error><Code>InvalidClientTokenId</Code>"
                     "<Message>token TOK123TOK123TOK123TOK is invalid</Message></Error></ErrorResponse>")
    with pytest.raises(enqueue.SqsError) as exc:
        enqueue.sqs_call(capture.url, "SendMessage", {})
    assert "TOK123TOK123TOK123TOK" not in str(exc.value) and "InvalidClientTokenId" in str(exc.value)

    # Not XML at all (a proxy's HTML 502): the redacted first 400 characters, still an SqsError.
    capture.status = 502
    capture.reply = "<html><body>Bad Gateway for AKIAERRORTESTKEY0001 " + "x" * 600 + "</body></html>"
    with pytest.raises(enqueue.SqsError) as exc:
        enqueue.sqs_call(capture.url, "SendMessage", {})
    text = str(exc.value)
    assert text.startswith("SQS SendMessage failed: HTTP 502: <html>")
    assert "AKIAERRORTESTKEY0001" not in text and len(text) < 450


def test_compose_dummy_credentials_do_not_mangle_the_error(capture):
    """Compose signs with the one-character dummy pair ``x``; redacting it would turn
    NonExistentQueue into NonE[redacted]istentQueue."""
    enqueue.configure({"GENEALOGY_SQS_ACCESS_KEY": "x", "GENEALOGY_SQS_SECRET_KEY": "x"}, None)
    capture.status = 400
    capture.reply = ("<ErrorResponse><Error><Code>AWS.SimpleQueueService.NonExistentQueue</Code>"
                     "<Message>The specified queue does not exist for this wsdl version.</Message>"
                     "</Error></ErrorResponse>")
    with pytest.raises(enqueue.SqsError) as exc:
        enqueue.sqs_call(capture.url, "GetQueueUrl", {"QueueName": "turns-dlq"})
    assert str(exc.value) == ("SQS GetQueueUrl failed: HTTP 400 AWS.SimpleQueueService.NonExistentQueue: "
                              "The specified queue does not exist for this wsdl version.")


def test_an_unreachable_endpoint_is_an_sqs_error():
    enqueue.configure(STATIC_ENV, None)
    with pytest.raises(enqueue.SqsError, match="cannot reach"):
        enqueue.sqs_call("http://127.0.0.1:9", "SendMessage", {}, timeout=2)


def test_send_turn_and_queue_url_go_through_the_signed_call(capture):
    """queue_url, send_turn and purge_queue are unchanged: each reaches sqs_call, so each
    request is signed."""
    enqueue.configure(STATIC_ENV, None)
    capture.reply = ("<GetQueueUrlResponse><GetQueueUrlResult><QueueUrl>http://elasticmq:9324/000000000000/turns"
                     "</QueueUrl><MessageId>m9</MessageId></GetQueueUrlResult></GetQueueUrlResponse>")
    result = enqueue.send_turn(endpoint=capture.url, queue="turns", behaviour="ok")
    assert result["message_id"] == "m9"
    assert len(capture.requests) == 2
    assert all(_verify_captured(req, "SECRETVALUE") for req in capture.requests)
    parsed = urlparse(capture.url)
    sent = dict(kv.split("=", 1) for kv in capture.requests[1]["body"].decode("utf-8").split("&"))
    assert sent["Action"] == "SendMessage"
    assert parsed.port and str(parsed.port) in sent["QueueUrl"]
