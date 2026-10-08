"""U7 probe: proto/enqueue.py signing as an EC2 instance profile, from Docker.

Runs ON an EC2 instance whose instance profile allows sqs:CreateQueue, GetQueueUrl,
SendMessage, ReceiveMessage, DeleteQueue on ``u7-*`` (plus AmazonSSMManagedInstanceCore
to drive it over SSM), inside ``python:3.12-slim`` with apps/server/uv.lock's botocore,
with enqueue.py and this file mounted at /w:

    docker run --rm [--network host] -v /opt/u7:/w <image> python /w/probe_sqs_instance_profile.py <label>

Prints one ``U7PROBE {json}`` line: IMDSv2 refresh latency (token PUT + role GET +
credentials GET, 20 samples), the cold chain resolution time, credentials_ready(0.5), and
a signed CreateQueue/SendMessage/ReceiveMessage/DeleteQueue round trip.

Measured 2026-10-01 (botocore 1.43.106, AL2023 t3.micro, us-east-1, IMDSv2 required, n=1):
  hop limit 1, --network host: default chain (iam-role); refresh median 2.9 ms, max
      16.5 ms; cold configure 23 ms; round trip ok.
  hop limit 1, bridge: token PUT times out; default chain (none found) after 1015 ms;
      credentials_ready(0.5) False in 506 ms; CreateQueue -> SqsError "no AWS credentials".
  hop limit 2, bridge: default chain (iam-role); refresh median 3.0 ms, max 15.9 ms;
      round trip ok.
"""

from __future__ import annotations

import html
import json
import os
import re
import statistics
import sys
import time
import urllib.request
import uuid

sys.path.insert(0, "/w")
IMDS = "http://169.254.169.254"


def imds_refresh_once() -> float:
    """What a botocore instance-profile refresh does: token PUT, role GET, creds GET."""
    t = time.perf_counter()
    put = urllib.request.Request(f"{IMDS}/latest/api/token", method="PUT",
                                 headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"})
    tok = urllib.request.urlopen(put, timeout=2).read().decode("utf-8")
    h = {"X-aws-ec2-metadata-token": tok}
    base = f"{IMDS}/latest/meta-data/iam/security-credentials/"
    role = urllib.request.urlopen(urllib.request.Request(base, headers=h), timeout=2).read().decode("utf-8").strip()
    urllib.request.urlopen(urllib.request.Request(base + role, headers=h), timeout=2).read()
    return time.perf_counter() - t


def main() -> None:
    out: dict = {"label": sys.argv[1]}
    try:
        samples = [imds_refresh_once() for _ in range(20)]
        out["imds_refresh_ms"] = {"median": round(statistics.median(samples) * 1000, 2),
                                  "max": round(max(samples) * 1000, 2), "n": len(samples)}
    except Exception as exc:  # noqa: BLE001 - the probe reports, never raises
        out["imds_raw_error"] = f"{type(exc).__name__}: {exc}"

    import enqueue

    t = time.perf_counter()
    auth = enqueue.configure(os.environ, None)
    out["configure_cold_ms"] = round((time.perf_counter() - t) * 1000, 1)
    out["describe"] = enqueue.describe(auth)
    t = time.perf_counter()
    out["credentials_ready_0.5"] = enqueue.credentials_ready(0.5)
    out["credentials_ready_ms"] = round((time.perf_counter() - t) * 1000, 1)

    ep = "https://sqs.us-east-1.amazonaws.com"
    name = f"u7-ec2-{sys.argv[1]}-{uuid.uuid4().hex[:6]}"
    qurl = None
    try:
        qurl = enqueue.xml_text(enqueue.sqs_call(ep, "CreateQueue", {"QueueName": name}), "QueueUrl")
        t = time.perf_counter()
        sent = enqueue.send_turn(endpoint=ep, queue=name, behaviour="ok")
        out["send_turn_ms"] = round((time.perf_counter() - t) * 1000, 1)
        got: set = set()
        for _ in range(6):
            doc = enqueue.sqs_call(ep, "ReceiveMessage", {"QueueUrl": qurl, "WaitTimeSeconds": "2"})
            got |= {json.loads(html.unescape(m)).get("turn_id") for m in re.findall(r"<Body>(.*?)</Body>", doc, re.S)}
            if sent["turn_id"] in got:
                break
        out["round_trip"] = sent["turn_id"] in got
    except enqueue.SqsError as exc:
        out["sqs_error"] = re.sub(r"\d{12}", "<acct>", str(exc))[:300]
    finally:
        if qurl:
            try:
                enqueue.sqs_call(ep, "DeleteQueue", {"QueueUrl": qurl})
                out["queue_deleted"] = True
            except enqueue.SqsError as exc:
                out["queue_deleted"] = f"FAILED: {exc}"
    print("U7PROBE " + json.dumps(out), flush=True)


if __name__ == "__main__":
    main()
