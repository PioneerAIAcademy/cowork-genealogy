"""sqsd shim: the piece of Elastic Beanstalk's worker tier that docker-compose lacks.

Long-polls the ``turns`` queue for up to HTTP_CONNECTIONS messages, POSTs each body
to WORKER_URL with real sqsd's headers, keeps that many POSTs in flight on a thread
pool, and acts on every outcome through ``decide.py``:

  2xx                         -> DeleteMessage
  connection-level failure    -> [read timeout only: kill + start WORKER_CONTAINER]
                                 then ChangeMessageVisibility(0)
  any other non-2xx           -> ChangeMessageVisibility(backoff), doubling per
                                 receive count from BACKOFF_BASE_S to BACKOFF_MAX_S

Every decision is one JSON line on stdout; read them with
``docker compose logs shim``. Runs as its own compose service with the docker
socket mounted so a worker kill never takes the shim down with it.

Stopping (SIGTERM/SIGINT) is graceful, and has to be: an exit while a long poll
is in flight leaves that poll open server-side, and the queue hands the next
message to it -- invisible for the whole visibility timeout (probed 2026-09-11 with
``docker compose restart shim`` + an immediate send). So a signal only sets a flag;
the in-flight ``ReceiveMessage`` returns on its own (<= WAIT_TIME_S), anything it
delivered goes straight back with ``ChangeMessageVisibility(0)``, in-flight POSTs
get the rest of STOP_GRACE_S to finish, then the process exits. A POST still
running at the deadline is abandoned: its message reappears after the visibility
timeout and the worker's claim path treats the redelivery as a resume.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from datetime import datetime, timezone
from urllib.parse import urlparse

import boto3
import docker
import docker.errors
import requests

from decide import READ_TIMEOUT, decide

QUEUE_URL = os.environ["QUEUE_URL"]
WORKER_URL = os.environ.get("WORKER_URL", "http://worker:8080/turn")
WORKER_CONTAINER = os.environ.get("WORKER_CONTAINER", "proto-worker")
HTTP_CONNECTIONS = int(os.environ.get("HTTP_CONNECTIONS", "2"))
READ_TIMEOUT_S = float(os.environ.get("READ_TIMEOUT_S", "1800"))  # the step ceiling
CONNECT_TIMEOUT_S = float(os.environ.get("CONNECT_TIMEOUT_S", "5"))
BACKOFF_BASE_S = int(os.environ.get("BACKOFF_BASE_S", "5"))
BACKOFF_MAX_S = int(os.environ.get("BACKOFF_MAX_S", "300"))
# Pause before making a connection-failed message visible again, so a worker that
# is restarting is not hammered with a refused-connection loop in the meantime.
REQUEUE_PAUSE_S = float(os.environ.get("REQUEUE_PAUSE_S", "1"))
WAIT_TIME_S = 20  # SQS long-poll maximum
# Budget between the stop signal and exit; docker-compose.yml's stop_grace_period
# must be at least this, and it must exceed WAIT_TIME_S so the poll can return.
STOP_GRACE_S = float(os.environ.get("STOP_GRACE_S", "30"))
STOP_MARGIN_S = 2.0  # exit this long before compose would SIGKILL

_parsed = urlparse(QUEUE_URL)
SQS_ENDPOINT_URL = os.environ.get("SQS_ENDPOINT_URL") or f"{_parsed.scheme}://{_parsed.netloc}"
QUEUE_NAME = _parsed.path.rstrip("/").rsplit("/", 1)[-1]

_stdout_lock = threading.Lock()
_docker_lock = threading.Lock()


def log(**fields: object) -> None:
    line = json.dumps(fields, separators=(",", ":"), default=str)
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def sqs_client():
    # elasticmq accepts any credentials; the defaults keep the compose file short.
    return boto3.client(
        "sqs",
        endpoint_url=SQS_ENDPOINT_URL,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "elasticmq"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "x"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "x"),
    )


def iso_utc(epoch_ms: str | None) -> str:
    if epoch_ms:
        dt = datetime.fromtimestamp(int(epoch_ms) / 1000, tz=timezone.utc)
    else:
        dt = datetime.now(tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def classify_connection_error(exc: requests.exceptions.ConnectionError) -> str:
    text = str(exc)
    if "Connection refused" in text:
        return "connection_refused"
    if "Connection reset" in text or "RemoteDisconnected" in text or "Connection aborted" in text:
        return "connection_reset"
    return "connection_error"


def kill_worker() -> bool:
    """Kill WORKER_CONTAINER over the docker socket, then start it again.

    ``docker kill`` counts as a manual stop, so ``restart: unless-stopped`` does
    not bring the container back on its own (probed 2026-09-11: status=exited,
    RestartCount unchanged); the explicit start is what gives the redelivered
    message a worker to POST to. Returns True when the kill itself succeeded.
    """
    with _docker_lock:
        try:
            client = docker.from_env(version="auto")
            container = client.containers.get(WORKER_CONTAINER)
        except Exception as exc:  # socket not mounted, container missing, ...
            log(ev="kill_error", container=WORKER_CONTAINER, error=f"{type(exc).__name__}: {exc}")
            return False
        killed = False
        try:
            container.kill()
            killed = True
        except docker.errors.APIError as exc:  # e.g. 409: already exited under another thread's kill
            log(ev="kill_error", container=WORKER_CONTAINER, error=f"{type(exc).__name__}: {exc}")
        try:
            container.start()  # 304 when it is already running again -- not an error
        except docker.errors.APIError as exc:
            log(ev="start_error", container=WORKER_CONTAINER, error=f"{type(exc).__name__}: {exc}")
        return killed


def turn_id_of(body: str) -> str | None:
    try:
        parsed = json.loads(body)
    except ValueError:
        return None
    return parsed.get("turn_id") if isinstance(parsed, dict) else None


def handle(sqs, msg: dict) -> None:
    msgid = msg["MessageId"]
    receipt = msg["ReceiptHandle"]
    attrs = msg.get("Attributes", {})
    receive_count = int(attrs.get("ApproximateReceiveCount", "1"))
    body = msg["Body"]
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "aws-sqsd-shim/0.1",
        "X-Aws-Sqsd-Msgid": msgid,
        "X-Aws-Sqsd-Queue": QUEUE_NAME,
        "X-Aws-Sqsd-First-Received-At": iso_utc(attrs.get("ApproximateFirstReceiveTimestamp")),
        "X-Aws-Sqsd-Receive-Count": str(receive_count),
        # sqsd 3.0.5 also sends these two (measured on Beanstalk 2026-09-11); it did
        # not forward message attributes as X-Aws-Sqsd-Attr-* headers (n=1).
        "X-Aws-Sqsd-Sent-At": iso_utc(str(int(time.time() * 1000))),
        "X-Aws-Sqsd-Path": urlparse(WORKER_URL).path or "/",
    }

    status: int | None = None
    error: str | None = None
    t0 = time.monotonic()
    try:
        resp = requests.post(
            WORKER_URL,
            data=body.encode("utf-8"),
            headers=headers,
            timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
        )
        status = resp.status_code
    except requests.exceptions.ReadTimeout:
        error = READ_TIMEOUT
    except requests.exceptions.ConnectTimeout:
        error = "connect_timeout"
    except requests.exceptions.ConnectionError as exc:
        error = classify_connection_error(exc)
    except requests.exceptions.RequestException as exc:
        error = f"request_error:{type(exc).__name__}"
    elapsed_ms = int((time.monotonic() - t0) * 1000)

    decision = decide(
        status, error, receive_count, backoff_base_s=BACKOFF_BASE_S, backoff_max_s=BACKOFF_MAX_S
    )
    killed = False
    if decision.action == "delete":
        sqs.delete_message(QueueUrl=QUEUE_URL, ReceiptHandle=receipt)
    elif decision.action == "requeue":
        if decision.kill_worker:
            killed = kill_worker()
        time.sleep(REQUEUE_PAUSE_S)
        sqs.change_message_visibility(QueueUrl=QUEUE_URL, ReceiptHandle=receipt, VisibilityTimeout=0)
    else:
        sqs.change_message_visibility(
            QueueUrl=QUEUE_URL, ReceiptHandle=receipt, VisibilityTimeout=decision.backoff_s
        )

    line: dict[str, object] = {
        "ev": "post",
        "msgid": msgid,
        "turn_id": turn_id_of(body),
        "receive_count": receive_count,
    }
    if error is None:
        line["status"] = status
    else:
        line["error"] = error
    line.update(
        elapsed_ms=elapsed_ms,
        action=decision.action,
        backoff_s=decision.backoff_s,
        killed_worker=killed,
    )
    log(**line)


def handle_safely(sqs, msg: dict) -> None:
    try:
        handle(sqs, msg)
    except Exception as exc:  # a thread must never die silently
        log(ev="error", msgid=msg.get("MessageId"), error=f"{type(exc).__name__}: {exc}")
        # An exception between the POST and the delete would otherwise leave the
        # message invisible for the whole visibility timeout — the same stranding
        # the SIGTERM drain exists to prevent, and worse when the turn actually
        # completed and only the delete failed: it re-runs 35 minutes later.
        # Hand it straight back instead; the redelivery is the retry.
        requeue_on_stop(sqs, msg, reason="error")


def docker_status() -> str:
    try:
        docker.from_env(version="auto").ping()
        return "ok"
    except Exception as exc:
        return f"unavailable: {type(exc).__name__}: {exc}"


def requeue_on_stop(sqs, msg: dict, reason: str = "stop") -> None:
    """Hand a message straight back to the queue: one the last poll delivered after
    the stop signal (`reason="stop"`), or one whose handler raised before it could
    decide (`reason="error"`). Either way the redelivery is the retry."""
    try:
        sqs.change_message_visibility(QueueUrl=QUEUE_URL, ReceiptHandle=msg["ReceiptHandle"], VisibilityTimeout=0)
        log(ev="requeue_on_stop", msgid=msg["MessageId"], reason=reason)
    except Exception as exc:  # it reappears after the visibility timeout regardless
        log(ev="error", msgid=msg.get("MessageId"), error=f"{type(exc).__name__}: {exc}")


def main() -> None:
    stopping = threading.Event()
    stop_info: dict[str, float] = {}

    def _on_signal(signum, _frame):
        # Flag only. No logging here: the handler runs on the main thread, which
        # may be inside log() holding _stdout_lock. The loop logs `stop` itself.
        if not stopping.is_set():
            stop_info["signal"] = signum
            stop_info["at"] = time.monotonic()
        stopping.set()

    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    sqs = sqs_client()
    log(
        ev="start",
        queue_url=QUEUE_URL,
        worker_url=WORKER_URL,
        worker_container=WORKER_CONTAINER,
        http_connections=HTTP_CONNECTIONS,
        read_timeout_s=READ_TIMEOUT_S,
        backoff_base_s=BACKOFF_BASE_S,
        backoff_max_s=BACKOFF_MAX_S,
        stop_grace_s=STOP_GRACE_S,
        docker=docker_status(),
    )

    pool = ThreadPoolExecutor(max_workers=HTTP_CONNECTIONS, thread_name_prefix="post")
    in_flight: set[Future] = set()
    requeued = 0
    while not stopping.is_set():
        in_flight = {f for f in in_flight if not f.done()}
        free = HTTP_CONNECTIONS - len(in_flight)
        if free <= 0:
            wait(in_flight, timeout=5, return_when=FIRST_COMPLETED)
            continue
        try:
            resp = sqs.receive_message(
                QueueUrl=QUEUE_URL,
                MaxNumberOfMessages=free,
                WaitTimeSeconds=WAIT_TIME_S,
                AttributeNames=["All"],
            )
        except Exception as exc:
            log(ev="receive_error", error=f"{type(exc).__name__}: {exc}")
            time.sleep(2)
            continue
        for msg in resp.get("Messages", []):
            if stopping.is_set():
                requeue_on_stop(sqs, msg)
                requeued += 1
            else:
                in_flight.add(pool.submit(handle_safely, sqs, msg))

    # Drain: in-flight POSTs get what is left of the grace budget, then we exit
    # without joining the pool (an abandoned POST must not hold the process past
    # compose's SIGKILL).
    pending = {f for f in in_flight if not f.done()}
    deadline = stop_info["at"] + STOP_GRACE_S - STOP_MARGIN_S
    if pending:
        wait(pending, timeout=max(0.0, deadline - time.monotonic()))
    abandoned = sum(1 for f in pending if not f.done())
    log(
        ev="stop",
        signal=int(stop_info["signal"]),
        after_ms=int((time.monotonic() - stop_info["at"]) * 1000),
        requeued=requeued,
        drained=len(pending) - abandoned,
        abandoned=abandoned,
    )
    os._exit(0)


if __name__ == "__main__":
    main()
