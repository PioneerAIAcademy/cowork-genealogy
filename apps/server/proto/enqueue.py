#!/usr/bin/env python3
"""Send one turn message to the proto ``turns`` queue, and the SQS client the proto
tiers share.

Every call is a form-encoded POST on the SQS query protocol (which AWS says "will
continue to be supported"), over ``urllib`` and signed SigV4 with botocore: elasticmq
locally, real SQS on AWS. botocore supplies the credentials and the signature only --
no boto3, no JSON protocol. Credentials and region: ``configure`` (U7,
docs/plan/familysearch-handoff.md). Prints the MessageId.

    make proto-send ARGS="--behaviour ok"
    make proto-send ARGS="--behaviour sleep --seconds 60 --turn-id t1"

(``make proto-send`` puts the dummy ``GENEALOGY_SQS_*`` pair in front, which elasticmq
ignores; a bare ``uv run python proto/enqueue.py`` signs with whatever your AWS default
chain resolves.) ``smoke.py`` imports ``send_turn`` / ``purge_queue`` from here.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import uuid
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

import botocore.auth
import botocore.awsrequest
import botocore.credentials
import botocore.exceptions
import botocore.session

DEFAULT_ENDPOINT = os.environ.get("SQS_ENDPOINT", "http://localhost:9324")
DEFAULT_QUEUE = os.environ.get("QUEUE_NAME", "turns")
BEHAVIOURS = ("ok", "sleep", "fail", "crash")

ACCESS_KEY_VAR = "GENEALOGY_SQS_ACCESS_KEY"
SECRET_KEY_VAR = "GENEALOGY_SQS_SECRET_KEY"
REGION_VAR = "GENEALOGY_SQS_REGION"
STATIC_MODE = "static keys"
FALLBACK_REGION = "us-east-1"
FORM = "application/x-www-form-urlencoded"
REDACTED = "[redacted]"

_SQS_HOST = re.compile(r"^sqs(-fips)?\.([a-z0-9-]+)\.amazonaws\.com(\.cn)?$")
_VPCE_HOST = re.compile(r"^vpce-[^.]+\.sqs\.([a-z0-9-]+)\.vpce\.amazonaws\.com$")
_LEGACY_HOST = re.compile(r"^([a-z0-9-]+)\.queue\.amazonaws\.com$")
_DUALSTACK_HOST = re.compile(r"^sqs\.([a-z0-9-]+)\.api\.aws$")
_AWS_SUFFIXES = (".amazonaws.com", ".amazonaws.com.cn", ".api.aws")
_SIGNATURE = re.compile(r"Signature=[0-9A-Fa-f]*")
_TOKEN_ECHO = re.compile(r"(?i)(x-amz-security-token\s*[:=]\s*)[^\s'\"&<]+")


class SqsError(RuntimeError):
    pass


class SqsConfigError(SqsError):
    """The SQS configuration is wrong: a half key pair, or a region that cannot be
    settled. Names the variables, never a value."""


@dataclass(frozen=True)
class SqsAuth:
    mode: str
    region: str | None
    credentials: Any = field(repr=False, compare=False)
    method: str | None
    queue_region: str | None = None


_STATE: SqsAuth | None = None
_LOCK = threading.Lock()


def _chain_mode(method: str | None) -> str:
    return f"default chain ({method or 'none found'})"


def _resolve_chain() -> tuple[Any, str | None]:
    """botocore's default chain, with IMDS pinned to one 1 s attempt per request (session
    instance variables outrank the AWS_METADATA_SERVICE_* env vars)."""
    session = botocore.session.Session()
    session.set_config_variable("metadata_service_timeout", 1)
    session.set_config_variable("metadata_service_num_attempts", 1)
    try:
        creds = session.get_credentials()
    except botocore.exceptions.BotoCoreError:
        creds = None
    return creds, (creds.method if creds is not None else None)


def configure(env: Mapping[str, str], queue_url: str | None) -> SqsAuth:
    """Settle credentials and region and install them for every later ``sqs_call``.

    ``env`` is read for the ``GENEALOGY_SQS_*`` variables only; the default chain reads
    ``os.environ`` itself, as botocore always does. Both keys set: static keys, no chain.
    Neither: the default chain, and ``default chain (none found)`` is not a refusal (the
    chain is retried on the next call). One: ``SqsConfigError``."""
    global _STATE
    access = env.get(ACCESS_KEY_VAR) or ""
    secret = env.get(SECRET_KEY_VAR) or ""
    if bool(access) != bool(secret):
        missing, present = (SECRET_KEY_VAR, ACCESS_KEY_VAR) if access else (ACCESS_KEY_VAR, SECRET_KEY_VAR)
        raise SqsConfigError(
            f"{present} is set but {missing} is not: set both for static keys, or neither "
            "for the default AWS credential chain"
        )
    override = env.get(REGION_VAR) or None
    queue_region = region_for(queue_url, override) if queue_url else None
    if access:
        auth = SqsAuth(STATIC_MODE, override, botocore.credentials.Credentials(access, secret),
                       "static", queue_region)
    else:
        creds, method = _resolve_chain()
        auth = SqsAuth(_chain_mode(method), override, creds, method, queue_region)
    with _LOCK:
        _STATE = auth
    return auth


def reset() -> None:
    """Forget the installed configuration (tests)."""
    global _STATE
    with _LOCK:
        _STATE = None


def _aws_region_from_host(host: str) -> str | None:
    for pattern, group in ((_SQS_HOST, 2), (_VPCE_HOST, 1), (_LEGACY_HOST, 1), (_DUALSTACK_HOST, 1)):
        m = pattern.match(host)
        if m:
            return m.group(group)
    if host == "queue.amazonaws.com":
        return "us-east-1"
    return None


def region_for(endpoint: str, override: str | None) -> str:
    """The signing region for ``endpoint``: parsed from an AWS SQS host, else
    ``GENEALOGY_SQS_REGION``, else us-east-1 for a non-AWS host (elasticmq ignores it).
    An override that contradicts the host, or an AWS host this cannot parse with no
    override, is an ``SqsConfigError``."""
    host = (urlparse(endpoint if "://" in endpoint else "//" + endpoint).hostname or "").lower()
    derived = _aws_region_from_host(host)
    if derived is not None:
        if override and override != derived:
            raise SqsConfigError(
                f"{REGION_VAR}={override} contradicts the queue host {host}, which is in {derived}"
            )
        return derived
    if override:
        return override
    if host == "amazonaws.com" or host.endswith(_AWS_SUFFIXES):
        raise SqsConfigError(f"cannot tell the SQS region from the host {host}; set {REGION_VAR}")
    return FALLBACK_REGION


def describe(auth: SqsAuth) -> str:
    region = auth.queue_region or auth.region or FALLBACK_REGION
    return f"sqs credentials: {auth.mode}; region {region}"


def _current() -> SqsAuth:
    """The installed configuration; configured from ``os.environ`` on first use, and a
    chain that found nothing is resolved again (it may since have credentials)."""
    global _STATE
    with _LOCK:
        auth = _STATE
    if auth is None:
        return configure(os.environ, None)
    if auth.credentials is None:
        with _LOCK:
            if _STATE is not None and _STATE.credentials is None:
                creds, method = _resolve_chain()
                _STATE = SqsAuth(_chain_mode(method), _STATE.region, creds, method, _STATE.queue_region)
            auth = _STATE if _STATE is not None else auth
    return auth


def _frozen(auth: SqsAuth, action: str) -> Any:
    if auth.credentials is None:
        raise SqsError(f"SQS {action} failed: no AWS credentials ({auth.mode})")
    try:
        frozen = auth.credentials.get_frozen_credentials()
    except botocore.exceptions.BotoCoreError as exc:
        raise SqsError(f"SQS {action} failed: no AWS credentials ({auth.mode}): {type(exc).__name__}") from None
    if not frozen.access_key or not frozen.secret_key:
        raise SqsError(f"SQS {action} failed: no AWS credentials ({auth.mode})")
    return frozen


def credentials_ready(timeout: float | None = None) -> bool:
    """True when ``sqs_call`` would have credentials to sign with now, resolving or
    refreshing them if needed. ``timeout`` bounds that (an IMDS refresh); past it, False.
    Never raises."""

    def resolve() -> bool:
        try:
            _frozen(_current(), "credentials")
            return True
        except Exception:  # noqa: BLE001 - a bool by contract
            return False

    if timeout is None:
        return resolve()
    result: list[bool] = []
    worker = threading.Thread(target=lambda: result.append(resolve()), name="sqs-credentials", daemon=True)
    worker.start()
    worker.join(timeout)
    return bool(result and result[0])


def prewarm() -> str | None:
    """Freeze the installed credentials once (an IMDS role's first fetch); returns the
    chain method, or None. Never raises."""
    try:
        with _LOCK:
            auth = _STATE
        if auth is None or auth.credentials is None:
            return None
        _frozen(auth, "prewarm")
        return auth.method
    except Exception:  # noqa: BLE001 - start-up goes on; sqs_call reports the failure
        return None


def _signed_host(url: str) -> str:
    """The Host the signature covers: the hostname, with ``:port`` only when the port is
    not the scheme's default (botocore and AWS both drop :443 / :80)."""
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if ":" in host:
        host = f"[{host}]"
    port = parsed.port
    if port is None or (parsed.scheme, port) in (("https", 443), ("http", 80)):
        return host
    return f"{host}:{port}"


def sign(url: str, body: bytes, creds: Any, region: str, *, service: str = "sqs") -> dict[str, str]:
    """SigV4 headers for a form-encoded POST of exactly ``body`` to ``url``."""
    host = _signed_host(url)
    req = botocore.awsrequest.AWSRequest(
        method="POST", url=url, data=body, headers={"Content-Type": FORM, "Host": host},
    )
    botocore.auth.SigV4Auth(creds, service, region).add_auth(req)
    headers = {
        "Content-Type": FORM,
        "Host": host,
        "X-Amz-Date": req.headers["X-Amz-Date"],
        "Authorization": req.headers["Authorization"],
    }
    if getattr(creds, "token", None):
        headers["X-Amz-Security-Token"] = req.headers["X-Amz-Security-Token"]
    return headers


def _redact(text: str, frozen: Any) -> str:
    """No secret, access key, session token or signature survives into an error: AWS's
    SignatureDoesNotMatch body echoes the canonical request, token included."""
    for secret in (getattr(frozen, "secret_key", None), getattr(frozen, "token", None),
                   getattr(frozen, "access_key", None)):
        if secret:
            text = text.replace(secret, REDACTED)
    return _TOKEN_ECHO.sub(r"\1" + REDACTED, _SIGNATURE.sub(REDACTED, text))


def _first(root: ET.Element, tag: str) -> str | None:
    for el in root.iter():
        if el.tag == tag or el.tag.endswith("}" + tag):
            return (el.text or "").strip()
    return None


def _http_error(action: str, status: int, detail: str, frozen: Any) -> SqsError:
    try:
        root = ET.fromstring(detail)
    except ET.ParseError:
        root = None
    code = _first(root, "Code") if root is not None else None
    if code:
        message = _redact(_first(root, "Message") or "", frozen).strip()
        first = message.splitlines()[0] if message else ""
        return SqsError(f"SQS {action} failed: HTTP {status} {_redact(code, frozen)}: {first}")
    return SqsError(f"SQS {action} failed: HTTP {status}: {_redact(detail, frozen)[:400]}")


def sqs_call(endpoint: str, action: str, params: dict[str, str], *, timeout: float = 30) -> str:
    """One SQS query-API call (form-encoded POST, SigV4-signed); returns the XML response
    body. ``timeout`` bounds the HTTP call; the worker's shutdown release passes a short one.
    Every failure is an ``SqsError``."""
    body = urlencode({"Action": action, "Version": "2012-11-05", **params}).encode("utf-8")
    url = endpoint.rstrip("/") + "/"
    auth = _current()
    frozen = _frozen(auth, action)
    headers = sign(url, body, frozen, region_for(endpoint, auth.region))
    req = Request(url, data=body, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise _http_error(action, exc.code, detail, frozen) from None
    except URLError as exc:
        raise SqsError(f"SQS {action} failed: cannot reach {endpoint}: {exc.reason}") from exc


def xml_text(doc: str, tag: str) -> str:
    """Text of the first element named ``tag`` in any namespace."""
    root = ET.fromstring(doc)
    for el in root.iter():
        if el.tag == tag or el.tag.endswith("}" + tag):
            return (el.text or "").strip()
    raise SqsError(f"no <{tag}> in SQS response: {doc[:400]}")


def queue_url(endpoint: str, queue: str) -> str:
    """Resolve the queue URL, re-rooted on ``endpoint``.

    elasticmq builds queue URLs from its ``node-address``, which may name the
    in-network host (``elasticmq:9324``); only the path matters to the server.
    """
    resolved = urlparse(xml_text(sqs_call(endpoint, "GetQueueUrl", {"QueueName": queue}), "QueueUrl"))
    base = urlparse(endpoint)
    return urlunparse((base.scheme, base.netloc, resolved.path, "", "", ""))


def send_turn(
    *,
    endpoint: str = DEFAULT_ENDPOINT,
    queue: str = DEFAULT_QUEUE,
    turn_id: str | None = None,
    session_id: str | None = None,
    project_id: str = "proj-smoke",
    behaviour: str = "ok",
    seconds: float = 0,
) -> dict:
    """Enqueue one turn; returns the message fields plus ``message_id``."""
    if behaviour not in BEHAVIOURS:
        raise ValueError(f"behaviour must be one of {BEHAVIOURS}, not {behaviour!r}")
    short = uuid.uuid4().hex[:8]
    message = {
        "turn_id": turn_id or f"turn-{short}",
        "session_id": session_id or f"sess-{short}",
        "project_id": project_id,
        "behaviour": behaviour,
        "seconds": seconds,
        "enqueued_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    doc = sqs_call(
        endpoint,
        "SendMessage",
        {"QueueUrl": queue_url(endpoint, queue), "MessageBody": json.dumps(message)},
    )
    return {"message_id": xml_text(doc, "MessageId"), **message}


def purge_queue(*, endpoint: str = DEFAULT_ENDPOINT, queue: str = DEFAULT_QUEUE) -> None:
    sqs_call(endpoint, "PurgeQueue", {"QueueUrl": queue_url(endpoint, queue)})


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--turn-id", default=None)
    p.add_argument("--session-id", default=None)
    p.add_argument("--project-id", default="proj-smoke")
    p.add_argument("--behaviour", choices=BEHAVIOURS, default="ok")
    p.add_argument("--seconds", type=float, default=0, help="for --behaviour sleep")
    p.add_argument("--endpoint", default=DEFAULT_ENDPOINT, help="elasticmq base URL ($SQS_ENDPOINT)")
    p.add_argument("--queue", default=DEFAULT_QUEUE, help="queue name ($QUEUE_NAME)")
    args = p.parse_args(argv)
    try:
        result = send_turn(
            endpoint=args.endpoint,
            queue=args.queue,
            turn_id=args.turn_id,
            session_id=args.session_id,
            project_id=args.project_id,
            behaviour=args.behaviour,
            seconds=args.seconds,
        )
    except SqsError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(result["message_id"])
    print(f"turn_id={result['turn_id']} session_id={result['session_id']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
