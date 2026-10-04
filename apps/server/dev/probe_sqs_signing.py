#!/usr/bin/env python3
"""U7 probe: does real SQS accept proto/enqueue.py's SigV4 signature?

elasticmq accepts unsigned and garbage-signed requests, so compose cannot answer this.
Run against an AWS account with the default credential chain (an SSO profile is the
same shape as an instance profile: temporary keys plus a session token):

    cd apps/server && AWS_PROFILE=<profile> uv run python dev/probe_sqs_signing.py
    cd apps/server && AWS_PROFILE=<profile> uv run python dev/probe_sqs_signing.py --read-only

Always: ListQueues with the real signature (expects 200), then two controls that must
fail at authentication, not authorization -- a reversed secret and a wrong region scope
(both ``SignatureDoesNotMatch``) -- and a check that no credential reaches the error text.
Without ``--read-only``: a throwaway ``u7-sigv4-check-*`` queue is created, sent to by
``send_turn`` and by the web tier's ``SqsQueue.send``, drained, and deleted (in a
``finally``). Needs sqs:CreateQueue, GetQueueUrl, SendMessage, ReceiveMessage,
DeleteMessage, DeleteQueue on ``u7-*``. Static-key mode is not covered: it carries no
session token, so it needs a long-term IAM user key.

Measured 2026-10-01 (botocore 1.43.106): an SSO operator role, ``--read-only`` in
us-east-1 and us-west-2, 10/10; an SSO admin role, the full round trip in us-east-1, 12/12.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import os
import re
import sys
import uuid
from pathlib import Path

PROTO = Path(__file__).resolve().parents[1] / "proto"
sys.path.insert(0, str(PROTO))
import enqueue  # noqa: E402

ACCOUNT = re.compile(r"\b\d{12}\b")


def mask(text: str) -> str:
    return ACCOUNT.sub("<acct>", text)


class Probe:
    def __init__(self) -> None:
        self.results: list[bool] = []

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        self.results.append(ok)
        print(f"[{'PASS' if ok else 'FAIL'}] {label}{(': ' + mask(detail)[:300]) if detail else ''}")


def attempt(endpoint: str, action: str, params: dict[str, str]) -> tuple[bool, str]:
    try:
        return True, enqueue.sqs_call(endpoint, action, params)
    except enqueue.SqsError as exc:
        return False, str(exc)


def controls(p: Probe, endpoint: str, region: str) -> None:
    ok, text = attempt(endpoint, "ListQueues", {"QueueNamePrefix": "u7-"})
    p.check("ListQueues with the real signature answers 200", ok, "" if ok else text)

    frozen = enqueue._frozen(enqueue._current(), "probe")
    real_frozen = enqueue._frozen
    enqueue._frozen = lambda auth, action: frozen._replace(secret_key=frozen.secret_key[::-1])
    try:
        ok, text = attempt(endpoint, "ListQueues", {"QueueNamePrefix": "u7-"})
    finally:
        enqueue._frozen = real_frozen
    p.check("a reversed secret is refused at authentication", not ok and "SignatureDoesNotMatch" in text, text)
    leaked = [name for name, value in (("access key", frozen.access_key), ("secret", frozen.secret_key),
                                       ("reversed secret", frozen.secret_key[::-1]), ("token", frozen.token))
              if value and value in text]
    p.check("that refusal carries no credential", not leaked, f"leaked={leaked}")

    wrong = "eu-west-1" if region != "eu-west-1" else "us-east-1"
    real_region_for = enqueue.region_for
    enqueue.region_for = lambda endpoint, override: wrong
    try:
        ok, text = attempt(endpoint, "ListQueues", {})
    finally:
        enqueue.region_for = real_region_for
    p.check(f"a {wrong} scope is refused at authentication", not ok and "SignatureDoesNotMatch" in text, text)


def round_trip(p: Probe, endpoint: str, region: str) -> None:
    name = f"u7-sigv4-check-{uuid.uuid4().hex[:8]}"
    qurl = None
    try:
        ok, doc = attempt(endpoint, "CreateQueue", {"QueueName": name})
        p.check("CreateQueue", ok, doc if not ok else "")
        if not ok:
            return
        qurl = enqueue.xml_text(doc, "QueueUrl")
        p.check("the signing region is derived from the queue host", enqueue.region_for(qurl, None) == region, qurl)
        p.check("GetQueueUrl (queue_url)", enqueue.queue_url(endpoint, name) == qurl)
        sent = enqueue.send_turn(endpoint=endpoint, queue=name, behaviour="ok", project_id="proj-u7-probe")
        p.check("SendMessage (send_turn)", bool(sent["message_id"]))

        import web.app as webapp

        mid = asyncio.run(webapp.SqsQueue(qurl).send({"turn_id": "t-web", "session_id": "s-web"}))
        p.check("SendMessage (the web tier's SqsQueue.send)", bool(mid))

        want, got = {sent["turn_id"], "t-web"}, set()
        for _ in range(6):
            doc = enqueue.sqs_call(endpoint, "ReceiveMessage",
                                   {"QueueUrl": qurl, "MaxNumberOfMessages": "10", "WaitTimeSeconds": "2"})
            got |= {json.loads(html.unescape(b)).get("turn_id") for b in re.findall(r"<Body>(.*?)</Body>", doc, re.S)}
            for handle in re.findall(r"<ReceiptHandle>(.*?)</ReceiptHandle>", doc, re.S):
                enqueue.sqs_call(endpoint, "DeleteMessage", {"QueueUrl": qurl, "ReceiptHandle": html.unescape(handle)})
            if want <= got:
                break
        p.check("ReceiveMessage and DeleteMessage drain both bodies", want <= got, f"turn_ids={sorted(got)}")
    except enqueue.SqsError as exc:
        p.check("no unexpected SqsError", False, str(exc))
    finally:
        if qurl:
            ok, text = attempt(endpoint, "DeleteQueue", {"QueueUrl": qurl})
            p.check("DeleteQueue (cleanup)", ok, "" if ok else f"{qurl} LEFT BEHIND: {text}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--region", action="append", help="repeatable; default us-east-1")
    ap.add_argument("--read-only", action="store_true", help="ListQueues and the controls only")
    args = ap.parse_args(argv)
    for var in (enqueue.ACCESS_KEY_VAR, enqueue.SECRET_KEY_VAR, enqueue.REGION_VAR):
        os.environ.pop(var, None)
    p = Probe()
    for region in args.region or ["us-east-1"]:
        endpoint = f"https://sqs.{region}.amazonaws.com"
        enqueue.reset()
        auth = enqueue.configure(os.environ, endpoint + "/")
        print(f"\n== {region}: {enqueue.describe(auth)}")
        token = auth.credentials is not None and bool(auth.credentials.get_frozen_credentials().token)
        p.check("the chain resolved temporary credentials (session token)", token, f"method={auth.method}")
        if auth.credentials is None:
            continue
        controls(p, endpoint, region)
        if not args.read_only:
            round_trip(p, endpoint, region)
    print(f"\n{sum(p.results)}/{len(p.results)} checks passed")
    return 0 if all(p.results) else 1


if __name__ == "__main__":
    sys.exit(main())
