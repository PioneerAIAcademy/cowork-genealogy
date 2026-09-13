#!/usr/bin/env python3
"""Send one turn message to the proto ``turns`` queue.

Talks to elasticmq's SQS query API over ``urllib`` -- no boto3, so it runs from the
apps/server venv with no new dependency. Prints the MessageId.

    uv run python proto/enqueue.py --behaviour ok
    uv run python proto/enqueue.py --behaviour sleep --seconds 60 --turn-id t1

``smoke.py`` imports ``send_turn`` / ``purge_queue`` from here.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse, urlunparse
from urllib.request import Request, urlopen

DEFAULT_ENDPOINT = os.environ.get("SQS_ENDPOINT", "http://localhost:9324")
DEFAULT_QUEUE = os.environ.get("QUEUE_NAME", "turns")
BEHAVIOURS = ("ok", "sleep", "fail", "crash")


class SqsError(RuntimeError):
    pass


def sqs_call(endpoint: str, action: str, params: dict[str, str]) -> str:
    """One SQS query-API call (form-encoded POST); returns the XML response body."""
    data = urlencode({"Action": action, "Version": "2012-11-05", **params}).encode("utf-8")
    req = Request(
        endpoint.rstrip("/") + "/",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        raise SqsError(f"SQS {action} failed: HTTP {exc.code}: {detail[:400]}") from exc
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
