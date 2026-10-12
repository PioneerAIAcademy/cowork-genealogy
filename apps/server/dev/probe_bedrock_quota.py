#!/usr/bin/env python3
"""U18 probe: how Bedrock charges Claude calls against the tokens-per-minute quota.

Five Converse calls, each alone in its own UTC minute with an idle minute between, then
the per-minute ``AWS/Bedrock`` metrics for that model id read back from CloudWatch:

    O  ~1,200 output tokens                 -> the output burndown multiplier
    M  maxTokens 8,000, a 4-token reply     -> whether the reservation shows in the metric
    W  a ~8.8k-token system prompt written to the cache
    R  the same prompt read from the cache  -> whether cache reads count
    U  the same text with no cache point    -> the uncached baseline

    python3 dev/probe_bedrock_quota.py --profile <profile> --out <file.jsonl>

Uses the AWS CLI. Pick a model id nobody else in the account calls (a ``global.*``
profile no one uses), or other traffic lands in the same minutes. About $0.05.

``EstimatedTPMQuotaUsage`` is AWS's own estimator. This probe shows how that metric
counts in a given account; it cannot show throttle enforcement, which AWS decides on the
reservation (input + max_tokens) at request start. That needs the load run's throttle arms.

Measured 2026-10-09 (U18, n=1 per arm, ``global.anthropic.claude-sonnet-4-6``, the test
account): O 26 in + 1,203 out -> 6,041; M 14 + 4 -> 34; W 13 + 8,814 written + 4 -> 8,847;
R 13 + 8,814 read + 4 -> 33; U 8,829 + 4 -> 8,849. So the metric is
input + cache write + 5 x output, cache reads exempt, max_tokens absent.
"""

from __future__ import annotations

import argparse
import datetime
import json
import subprocess
import sys
import time
from pathlib import Path

BIG = " ".join(f"Line {i}: the parish register records a baptism, a marriage and a burial in the same week."
               for i in range(400))
NONCE = "u18-quota-probe"
METRICS = ("EstimatedTPMQuotaUsage", "InputTokenCount", "CacheWriteInputTokenCount",
           "CacheReadInputTokenCount", "OutputTokenCount", "Invocations")


def _user(text: str) -> str:
    return json.dumps([{"role": "user", "content": [{"text": text}]}])


def _arms() -> list[tuple[str, list[str]]]:
    ok = _user("Reply with the single word ok.")
    cached = json.dumps([{"text": f"{NONCE} {BIG}"}, {"cachePoint": {"type": "default"}}])
    return [
        ("O_output", ["--messages", _user("Write the integers from 1 to 600 separated by single spaces, nothing else."),
                      "--inference-config", json.dumps({"maxTokens": 2000})]),
        ("M_maxtokens", ["--messages", ok, "--inference-config", json.dumps({"maxTokens": 8000})]),
        ("W_cachewrite", ["--system", cached, "--messages", ok, "--inference-config", json.dumps({"maxTokens": 5})]),
        ("R_cacheread", ["--system", cached, "--messages", ok, "--inference-config", json.dumps({"maxTokens": 5})]),
        ("U_uncached", ["--system", json.dumps([{"text": f"uncached {NONCE} {BIG}"}]), "--messages", ok,
                        "--inference-config", json.dumps({"maxTokens": 5})]),
    ]


def _aws(args: argparse.Namespace, *rest: str) -> subprocess.CompletedProcess:
    return subprocess.run(["aws", "--profile", args.profile, "--region", args.region, *rest, "--output", "json"],
                          capture_output=True, text=True, encoding="utf-8")


def _minute(iso: str) -> str:
    return datetime.datetime.fromisoformat(iso).strftime("%Y-%m-%dT%H:%M")


def run_calls(args: argparse.Namespace) -> list[dict]:
    records = []
    with args.out.open("w", encoding="utf-8") as f:
        for name, extra in _arms():
            time.sleep(60 - (time.time() % 60) + 2)
            start = datetime.datetime.now(datetime.timezone.utc).isoformat()
            r = _aws(args, "bedrock-runtime", "converse", "--model-id", args.model, *extra)
            rec = {"arm": name, "start": start, "rc": r.returncode}
            if r.returncode == 0:
                body = json.loads(r.stdout)
                rec["usage"] = body.get("usage")
            else:
                rec["err"] = r.stderr[-500:]
            f.write(json.dumps(rec) + "\n")
            print(json.dumps(rec), flush=True)
            records.append(rec)
            time.sleep(60)
    return records


def read_metrics(args: argparse.Namespace, records: list[dict]) -> dict[str, dict[str, float]]:
    first = datetime.datetime.fromisoformat(records[0]["start"]) - datetime.timedelta(minutes=2)
    last = datetime.datetime.fromisoformat(records[-1]["start"]) + datetime.timedelta(minutes=3)
    by_minute: dict[str, dict[str, float]] = {}
    for metric in METRICS:
        r = _aws(args, "cloudwatch", "get-metric-statistics", "--namespace", "AWS/Bedrock", "--metric-name", metric,
                 "--dimensions", f"Name=ModelId,Value={args.model}", "--start-time", first.isoformat(),
                 "--end-time", last.isoformat(), "--period", "60", "--statistics", "Sum")
        if r.returncode != 0:
            sys.exit(f"get-metric-statistics {metric}: {r.stderr[-300:]}")
        for point in json.loads(r.stdout)["Datapoints"]:
            stamp = point["Timestamp"].astimezone(datetime.timezone.utc) if isinstance(point["Timestamp"], datetime.datetime) \
                else datetime.datetime.fromisoformat(point["Timestamp"]).astimezone(datetime.timezone.utc)
            by_minute.setdefault(stamp.strftime("%Y-%m-%dT%H:%M"), {})[metric] = point["Sum"]
    return by_minute


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--profile", required=True)
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--model", default="global.anthropic.claude-sonnet-4-6")
    ap.add_argument("--out", type=Path, required=True, help="JSONL of this run's calls; overwritten")
    ap.add_argument("--read-only", action="store_true", help="skip the calls; read back the minutes already in --out")
    ap.add_argument("--wait-s", type=int, default=600, help="how long to wait for CloudWatch to publish")
    args = ap.parse_args()

    if args.read_only:
        records = [json.loads(line) for line in args.out.read_text(encoding="utf-8").splitlines() if line.strip()]
    else:
        records = run_calls(args)
    if not records or any(r["rc"] != 0 for r in records):
        print("a call failed; no verdict", file=sys.stderr)
        return 1

    deadline = time.time() + args.wait_s
    while True:
        by_minute = read_metrics(args, records)
        if all("EstimatedTPMQuotaUsage" in by_minute.get(_minute(r["start"]), {}) for r in records):
            break
        if time.time() > deadline:
            print("CloudWatch has not published every minute yet; re-run with --read-only", file=sys.stderr)
            return 1
        time.sleep(60)

    print(f"\n{'arm':<13}{'in':>7}{'write':>7}{'read':>7}{'out':>7}{'metric':>9}  in+write+5*out")
    for r in records:
        u, m = r["usage"], by_minute[_minute(r["start"])]
        if m.get("Invocations", 0) != 1:
            print(f"{r['arm']}: {m.get('Invocations')} invocations in its minute; other traffic, no verdict", file=sys.stderr)
            return 1
        settled = u["inputTokens"] + u["cacheWriteInputTokens"] + 5 * u["outputTokens"]
        print(f"{r['arm']:<13}{u['inputTokens']:>7}{u['cacheWriteInputTokens']:>7}{u['cacheReadInputTokens']:>7}"
              f"{u['outputTokens']:>7}{m['EstimatedTPMQuotaUsage']:>9.0f}  {settled}")
    o = next(r for r in records if r["arm"] == "O_output")
    om = by_minute[_minute(o["start"])]
    burndown = (om["EstimatedTPMQuotaUsage"] - o["usage"]["inputTokens"]) / o["usage"]["outputTokens"]
    rm = by_minute[_minute(next(r for r in records if r["arm"] == "R_cacheread")["start"])]
    print(f"\noutput burndown in the metric: {burndown:.2f}")
    print(f"cache reads in the metric: {'exempt' if rm['EstimatedTPMQuotaUsage'] < 1000 else 'COUNTED'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
