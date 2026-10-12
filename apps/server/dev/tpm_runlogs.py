#!/usr/bin/env python3
"""U18: token rate per session from committed e2e run logs (stdlib only, no network).

Usage: python3 apps/server/dev/tpm_runlogs.py <repo-root>

Bedrock's settled quota charge is b5-cr below (input + cache write + 5 x output, cache
reads exempt): docs/search-agent-capacity.md, and dev/probe_bedrock_quota.py.

Every e2e run is `/research --autonomous` (eval/harness/e2e/orchestrator.py:1147),
so the whole corpus is autonomous runs.

Tiers (each printed with its n):
  A  main thread, exact     usage.usage / wall clock. usage.usage is the MAIN
                            THREAD's alone (orchestrator.py merge_whole_run_usage
                            docstring), so A is a lower bound on a session.
                            Eligible: usage_source == result_message, resumes == 0,
                            one system:init (single query), wall clock > 0.
  B  whole run, exact       main + subagents[].usage (runs from 2026-10-05 on,
                            PR #3113). For streamed_fallback runs main's three
                            input-side classes come from usage.message_usage main
                            rows (exact) and main OUTPUT is unknown (the stream's
                            output is a start-of-message snapshot).
  C  whole run, ESTIMATE    A's runs on claude-sonnet-4-6 with a recorded
                            total_cost_usd: the cost residual (recorded / c  minus
                            main priced at pricing.py's flat rates) converted to
                            subagent tokens at B's measured subagent class mix;
                            c = recorded / flat-priced whole run on B's
                            result_message runs.
  P  peak 60 s              runs with per-message timestamps: 5-wide timeline
                            (message ids) joined to usage.message_usage in order
                            (distinct assistant message ids == rows, checked),
                            plus the bagley .session.jsonl (main thread only).
                            Output per message is not recorded: each thread's
                            output total is spread evenly over its messages
                            (ESTIMATE for the output column only).
"""
from __future__ import annotations

import glob
import json
import os
import re
import statistics
import sys
from datetime import datetime

CLASSES = ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens")
SHORT = {"input_tokens": "in", "cache_creation_input_tokens": "cw", "cache_read_input_tokens": "cr", "output_tokens": "out"}
# pricing.py flat table (USD / MTok), Sonnet 4.6, 1h cache-write rate.
RATE = {"input_tokens": 3.0, "output_tokens": 15.0, "cache_read_input_tokens": 0.30, "cache_creation_input_tokens": 6.0}
ASSUMPTIONS = [  # (label, burndown, cache reads counted)
    ("b1+cr", 1, True), ("b1-cr", 1, False), ("b5+cr", 5, True), ("b5-cr", 5, False)]
QUOTA = 6_000_000  # published cross-region default, Sonnet 4.6 (2026-10-09)
CONC = (50, 150, 500)


def price(t):
    return sum(t.get(k, 0) * RATE[k] for k in CLASSES) / 1e6


def quota_tokens(t, burndown, count_cr):
    q = t.get("input_tokens", 0) + t.get("cache_creation_input_tokens", 0) + burndown * t.get("output_tokens", 0)
    if count_cr:
        q += t.get("cache_read_input_tokens", 0)
    return q


def pct(vals, p):
    v = sorted(vals)
    if not v:
        return float("nan")
    k = (len(v) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def dist(vals):
    return f"n={len(vals)} median={pct(vals, .5):>11,.0f} p90={pct(vals, .9):>11,.0f} max={max(vals) if vals else float('nan'):>11,.0f}"


def ts(s):
    return datetime.strptime(s.replace("Z", "+0000"), "%Y-%m-%dT%H:%M:%S.%f%z").timestamp()


def peak60(events, key):
    """events: sorted list of (t_seconds, dict). Max sum of key(dict) over any [t, t+60)."""
    best = 0.0
    j = 0
    run = 0.0
    vals = [key(e[1]) for e in events]
    for i in range(len(events)):
        while j < len(events) and events[j][0] < events[i][0] + 60.0:
            run += vals[j]
            j += 1
        best = max(best, run)
        run -= vals[i]
    return best


def tok(d):
    return {k: int(d.get(k) or 0) for k in CLASSES}


def add(a, b):
    return {k: a.get(k, 0) + b.get(k, 0) for k in CLASSES}


def main(root):
    paths = [p for p in sorted(glob.glob(os.path.join(root, "eval/runlogs/e2e/*/run-*.json")))
             if re.search(r"run-[0-9_-]+\.json$", p)]
    runs = []
    for p in paths:
        with open(p, encoding="utf-8") as f:
            runs.append((os.path.relpath(p, root), json.load(f)))
    print(f"run logs read: {len(runs)} (eval/runlogs/e2e/*/run-<ts>.json; all are /research --autonomous)")

    # ---------- Tier A ----------
    A = []
    excl = {"streamed_fallback": 0, "resumed_or_multiquery": 0, "no_tokens": 0}
    for rel, d in runs:
        u = d.get("usage") or {}
        tl = u.get("timeline") or []
        inits = sum(1 for r in tl if len(r) > 1 and r[1] == "system:init")
        if u.get("usage_source") == "streamed_fallback" or ("num_turns" not in u and u.get("usage_source") != "result_message"):
            excl["streamed_fallback"] += 1
            continue
        if (u.get("resumes") or 0) > 0 or inits > 1:
            excl["resumed_or_multiquery"] += 1
            continue
        t = tok(u.get("usage") or {})
        wc = u.get("wall_clock_seconds") or 0
        if sum(t.values()) <= 0 or wc <= 0:
            excl["no_tokens"] += 1
            continue
        A.append({"rel": rel, "d": d, "u": u, "main": t, "wc": wc, "model": u.get("agent_model"),
                  "cost": u.get("total_cost_usd")})
    print(f"\n== Tier A: main thread only, exact tokens / wall clock (lower bound) ==")
    print(f"eligible {len(A)}; excluded {excl}")
    print(f"captured_at range {min(r['d'].get('captured_at','') for r in A)} .. {max(r['d'].get('captured_at','') for r in A)}")
    wcs = [r["wc"] / 60 for r in A]
    print(f"wall clock min: median {pct(wcs,.5):.1f} p90 {pct(wcs,.9):.1f} max {max(wcs):.1f}")
    for k in CLASSES:
        print(f"  {SHORT[k]:>4} tok/min  {dist([r['main'][k] / (r['wc']/60) for r in A])}")
    print(f"  all4 tok/min  {dist([sum(r['main'].values()) / (r['wc']/60) for r in A])}")
    for lab, b, cr in ASSUMPTIONS:
        print(f"  quota {lab} {dist([quota_tokens(r['main'], b, cr) / (r['wc']/60) for r in A])}")

    # ---------- Tier B ----------
    B = []
    for rel, d in runs:
        u = d.get("usage") or {}
        subs = d.get("subagents") or []
        if not subs or not all(isinstance(s.get("usage"), dict) for s in subs):
            continue
        sub = {k: 0 for k in CLASSES}
        for s in subs:
            sub = add(sub, tok(s["usage"]))
        mu = u.get("message_usage") or []
        if u.get("usage_source") == "result_message":
            main_t = tok(u.get("usage") or {})
            out_known = True
        else:
            main_t = {"input_tokens": sum(r[1] for r in mu if r[0] == "main"),
                      "cache_read_input_tokens": sum(r[2] for r in mu if r[0] == "main"),
                      "cache_creation_input_tokens": sum(r[3] for r in mu if r[0] == "main"),
                      "output_tokens": 0}
            out_known = False
        B.append({"rel": rel, "d": d, "u": u, "main": main_t, "sub": sub, "whole": add(main_t, sub),
                  "wc": u.get("wall_clock_seconds"), "out_known": out_known, "cost": u.get("total_cost_usd"),
                  "nsubs": len(subs)})
    print(f"\n== Tier B: whole run (main + subagents[].usage), exact; n={len(B)} ==")
    for r in B:
        m = r["wc"] / 60
        w = r["whole"]
        print(f"  {r['rel']}  stop={r['d'].get('stop_reason')} src={r['u'].get('usage_source')} wall={m:.1f} min subagents={r['nsubs']}")
        print(f"     tokens whole: " + " ".join(f"{SHORT[k]}={w[k]:,}" for k in CLASSES) + ("" if r["out_known"] else "  (main output UNKNOWN; out = subagents only)"))
        print(f"     tok/min whole: " + " ".join(f"{SHORT[k]}={w[k]/m:,.0f}" for k in CLASSES) + f"  all4={sum(w.values())/m:,.0f}")
        ratio = sum(w[k] for k in CLASSES[:3]) / max(1, sum(r['main'][k] for k in CLASSES[:3]))
        print(f"     whole/main input-side ratio = {ratio:.2f}; " + " ".join(f"{lab}={quota_tokens(w,b,cr)/m:,.0f}" for lab, b, cr in ASSUMPTIONS))
    submix_tot = {k: sum(r["sub"][k] for r in B) for k in CLASSES}
    subtok = sum(submix_tot.values())
    submix = {k: submix_tot[k] / subtok for k in CLASSES}
    sub_usd_per_tok = price(submix_tot) / subtok
    print("  subagent class mix (pooled over B): " + " ".join(f"{SHORT[k]}={submix[k]:.4f}" for k in CLASSES) + f"; flat-priced ${sub_usd_per_tok*1e6:.3f}/MTok")
    calib = [r["cost"] / price(r["whole"]) for r in B if r["out_known"] and r["cost"]]
    c = statistics.median(calib) if calib else 1.0
    print(f"  calibration recorded/flat-priced whole run: {[round(x,3) for x in calib]} -> c={c:.3f} (n={len(calib)})")

    # ---------- Tier C ----------
    C = []
    for r in A:
        if r["model"] != "claude-sonnet-4-6" or not isinstance(r["cost"], (int, float)) or not r["d"].get("subagents"):
            continue
        resid = r["cost"] / c - price(r["main"])
        if resid < 0:
            resid = 0.0
        ntok = resid / sub_usd_per_tok
        sub = {k: ntok * submix[k] for k in CLASSES}
        C.append({**r, "whole": add(r["main"], sub), "ratio": (sum(r['main'].values()) + ntok) / sum(r['main'].values())})
    print(f"\n== Tier C: whole run ESTIMATE (cost residual -> subagent tokens), sonnet-4-6 runs with recorded cost and >=1 subagent ==")
    if C:
        print(f"n={len(C)}; whole/main token ratio {dist([x['ratio']*1000 for x in C])} (x1000)")
        for k in CLASSES:
            print(f"  {SHORT[k]:>4} tok/min  {dist([x['whole'][k] / (x['wc']/60) for x in C])}")
        print(f"  all4 tok/min  {dist([sum(x['whole'].values()) / (x['wc']/60) for x in C])}")
        for lab, b, cr in ASSUMPTIONS:
            print(f"  quota {lab} {dist([quota_tokens(x['whole'], b, cr) / (x['wc']/60) for x in C])}")

    # ---------- Tier P: peaks ----------
    print(f"\n== Tier P: peak 60-second sliding window (per-message timestamps) ==")
    P = []
    for r in B:
        u = r["u"]
        tl = u.get("timeline") or []
        if not tl or len(tl[0]) < 5:
            continue
        first = {}
        for row in tl:
            if row[1] == "assistant" and row[4] and row[4] not in first:
                first[row[4]] = ts(row[3])
        mu = u["message_usage"]
        if len(first) != len(mu):
            print(f"  SKIP {r['rel']}: {len(first)} message ids vs {len(mu)} message_usage rows")
            continue
        times = list(first.values())
        t0 = ts(next(row[3] for row in tl if row[3]))
        nmain = sum(1 for x in mu if x[0] == "main")
        nsub = len(mu) - nmain
        out_main = (r["main"]["output_tokens"] / nmain) if (nmain and r["out_known"]) else 0.0
        out_sub = r["sub"]["output_tokens"] / nsub if nsub else 0.0
        ev = []
        for tm, row in zip(times, mu):
            ev.append((tm - t0, {"input_tokens": row[1], "cache_read_input_tokens": row[2], "cache_creation_input_tokens": row[3],
                                 "output_tokens": out_main if row[0] == "main" else out_sub, "thread": row[0]}))
        ev.sort(key=lambda e: e[0])
        cov = sum(x[2] + x[3] + x[1] for x in mu) / sum(r["whole"][k] for k in CLASSES[:3])
        P.append({"rel": r["rel"], "ev": ev, "wc": r["wc"], "scope": f"main+sub (stream covers {cov:.0%} of whole-run input-side tokens)", "out_known": r["out_known"]})
    # bagley prototype: session.jsonl, main thread only
    for sj in sorted(glob.glob(os.path.join(root, "eval/runlogs/e2e/*/run-*.session.jsonl"))):
        req = {}
        order = []
        t0 = None
        with open(sj, encoding="utf-8") as f:
            for line in f:
                d = json.loads(line)
                if t0 is None and d.get("timestamp"):
                    t0 = ts(d["timestamp"])
                if d.get("type") != "assistant" or d.get("isSidechain"):
                    continue
                rid = d.get("requestId")
                us = (d.get("message") or {}).get("usage") or {}
                if rid not in req:
                    req[rid] = {"t": ts(d["timestamp"]), **tok(us)}
                    order.append(rid)
                else:
                    req[rid]["output_tokens"] = max(req[rid]["output_tokens"], int(us.get("output_tokens") or 0))
        ev = sorted(((req[k]["t"] - t0, {c2: req[k][c2] for c2 in CLASSES}) for k in order), key=lambda e: e[0])
        span = ev[-1][0] if ev else 0
        tot = {k: sum(e[1][k] for e in ev) for k in CLASSES}
        print(f"  session.jsonl {os.path.relpath(sj, root)}: {len(order)} main-thread requests, span {span/60:.1f} min; totals " + " ".join(f"{SHORT[k]}={tot[k]:,}" for k in CLASSES))
        P.append({"rel": os.path.relpath(sj, root), "ev": ev, "wc": span, "scope": "main thread only (no subagent usage in this run)", "out_known": True})
    peaks = {lab: [] for lab, _, _ in ASSUMPTIONS}
    means = {lab: [] for lab, _, _ in ASSUMPTIONS}
    for x in P:
        ev = x["ev"]
        span_min = x["wc"] / 60
        print(f"  {x['rel']}  [{x['scope']}]  wall {span_min:.1f} min, {len(ev)} messages")
        line = []
        for k in CLASSES:
            pk = peak60(ev, lambda e, k=k: e[k])
            mean = sum(e[1][k] for e in ev) / span_min
            line.append(f"{SHORT[k]} peak={pk:,.0f} mean={mean:,.0f}")
        print("     " + "; ".join(line) + ("" if x["out_known"] else "  (main output unknown -> out excludes main)"))
        for lab, b, cr in ASSUMPTIONS:
            pk = peak60(ev, lambda e, b=b, cr=cr: quota_tokens(e, b, cr))
            mean = sum(quota_tokens(e[1], b, cr) for e in ev) / span_min
            peaks[lab].append(pk)
            means[lab].append(mean)
            # first 1,800 s only (U26 cap)
            ev18 = [e for e in ev if e[0] < 1800]
            m18 = sum(quota_tokens(e[1], b, cr) for e in ev18) / 30.0
            print(f"     quota {lab}: peak60={pk:>11,.0f}  mean={mean:>11,.0f}  peak/mean={pk/mean if mean else 0:.1f}x  mean over first 1,800 s={m18:>11,.0f}")

    # ---------- concurrency ----------
    print(f"\n== Concurrent sessions vs a {QUOTA/1e6:g}M TPM quota ==")
    print("Sessions' peak minutes do not align, so N x (median session mean) is a floor on the")
    print("aggregate and N x (session peak-60s) a ceiling; the true aggregate peak lies between.")
    src_mean = C if C else A
    tier = "C (whole-run estimate)" if C else "A"
    for lab, b, cr in ASSUMPTIONS:
        mvals = [quota_tokens(x["whole"] if "whole" in x else x["main"], b, cr) / (x["wc"]/60) for x in src_mean]
        med = pct(mvals, .5)
        p90 = pct(mvals, .9)
        pkmed = pct([v for v in peaks[lab]], .5) if peaks[lab] else float("nan")
        pkmax = max(peaks[lab]) if peaks[lab] else float("nan")
        print(f"  {lab}: per-session mean median {med:,.0f} p90 {p90:,.0f} [tier {tier}, n={len(mvals)}]; peak60 median {pkmed:,.0f} max {pkmax:,.0f} [tier P, n={len(peaks[lab])}]")
        for n in CONC:
            print(f"       N={n:>3}: floor {n*med/1e6:7.2f}M  (p90-mean {n*p90/1e6:7.2f}M)  ceiling {n*pkmed/1e6:8.2f}M (peak median)  {n*pkmax/1e6:8.2f}M (peak max)")
        print(f"       sessions fitting in {QUOTA/1e6:g}M: {QUOTA/med:6.1f} at median mean, {QUOTA/p90:6.1f} at p90 mean, {QUOTA/pkmed:6.1f} at median peak60, {QUOTA/pkmax:6.1f} at max peak60")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
