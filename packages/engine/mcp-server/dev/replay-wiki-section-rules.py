# Run from the repo root: python3 packages/engine/mcp-server/dev/replay-wiki-section-rules.py <rows.json from probe-wiki-section-use.py>
# Replays the old and new locality_survey heading rules over the measured sections.
import collections
import glob
import json
import re
import sys

rows = json.load(open(sys.argv[1], encoding="utf-8"))
pr = collections.defaultdict(set)
for f in sorted(glob.glob("eval/runlogs/e2e/*/run-*.final-research.json")):
    d = json.load(open(f, encoding="utf-8"))
    for loc in d.get("localities") or []:
        for p in loc.get("pages_read") or []:
            if p.get("url"):
                pr[f].add(p["url"])
OLD_SKIP = re.compile(r"\b(references?|sources?|footnotes?|notes|see also|contents|navigation|categories|populated places|cities and towns|towns and villages|communities|how to (research|use|find|search)|research strategy|wiki articles|help us|contributors?)\b", re.I)
OLD_REC = re.compile(r"\b(vital|civil registration|births?|marriages?|deaths?|church|parish|religio|census|probate|wills?|court|land|propert|deeds?|military|cemeter|burial|newspaper|obituar|immigra|emigra|naturali|passenger|tax|record|archive|librar|online|getting started|research tips|jurisdiction|boundar|history)\b", re.I)
NEW_SKIP = re.compile(r"^(?:[a-z]|counties|parishes|counties and parishes|townships|step \d+\b.*|key words|general word list|numbers|dates and time|alphabetical order|accent marks|abbreviations|variant forms of words|spelling|information in the records|familysearch centers|additional resources|research helps|research guides)$|\b(?:references?|sources?|footnotes?|notes|see also|contents|navigation|categories|populated places|cities and towns|towns and villages|communities|how to (?:research|use|find|search)|research strategy|wiki articles|help us|contributors?|language (?:helps|characteristics))\b", re.I)
NEW_REC = re.compile(r"\b(?:vital|civil registration|births?\b|marriages?\b|deaths?\b|church|parish|religio|census|probate|wills?\b|court|land|propert|deeds?\b|military|cemeter|burial|newspaper|obituar|immigra|emigra|naturali|passenger|tax|record|archive|online|getting started|research tips|jurisdiction|boundar|history)", re.I)


def rank(h, new):
    if h is None:
        return 2 if new else 3
    skip, rec = (NEW_SKIP, NEW_REC) if new else (OLD_SKIP, OLD_REC)
    h = h.strip()
    if skip.search(h):
        return -1
    return 2 if rec.search(h) else 1


by = collections.defaultdict(list)
for r in rows:
    if r["url"] in pr[r["guide"]]:
        by[r["guide"]].append(r)


def replay(new, budget=28000, cap=6000):
    used_total = kept = 0
    for secs in by.values():
        pages = sorted({s["url"] for s in secs})
        ss = [dict(s, page=pages.index(s["url"]), rank=rank(s["heading"], new)) for s in secs]
        left = budget
        for s in sorted([x for x in ss if x["rank"] >= 0], key=lambda x: (-x["rank"], x["page"], x["order"])):
            if left < 600:
                break
            room = min(left, cap) if new else left
            take = min(s["chars"], room)
            s["kept"] = take
            left -= take
        for s in ss:
            if s["shared"] >= 2:
                used_total += s["chars"]
                kept += s.get("kept", 0)
    return len(by), used_total, kept


for new in (False, True):
    n, u, k = replay(new)
    print("new" if new else "old", f"guides={n} used chars kept: {100 * k / u:.1f}% ({k}/{u})")


def replay_sections(new, budget=28000, cap=6000, opening_rank=None):
    used = kept = 0
    for secs in by.values():
        pages = sorted({s["url"] for s in secs})
        ss = [dict(s, page=pages.index(s["url"]), rank=rank(s["heading"], new)) for s in secs]
        if opening_rank is not None:
            for s in ss:
                if s["heading"] is None:
                    s["rank"] = opening_rank
        left = budget
        for s in sorted([x for x in ss if x["rank"] >= 0], key=lambda x: (-x["rank"], x["page"], x["order"])):
            if left < 600:
                break
            room = min(left, cap) if cap else left
            take = min(s["chars"], room)
            s["kept"] = take
            left -= take
        for s in ss:
            if s["shared"] >= 2:
                used += 1
                kept += 1 if s.get("kept", 0) > 0 else 0
    return used, kept


def replay_grams(new, budget=28000, cap=6000, opening_rank=None):
    total = kept = 0
    for secs in by.values():
        pages = sorted({s["url"] for s in secs})
        ss = [dict(s, page=pages.index(s["url"]), rank=rank(s["heading"], new)) for s in secs]
        if opening_rank is not None:
            for s in ss:
                if s["heading"] is None:
                    s["rank"] = opening_rank
        left = budget
        for s in sorted([x for x in ss if x["rank"] >= 0], key=lambda x: (-x["rank"], x["page"], x["order"])):
            if left < 600:
                break
            room = min(left, cap) if cap else left
            take = min(s["chars"], room)
            s["kept"] = take
            left -= take
        for s in ss:
            frac = s.get("kept", 0) / max(1, s["chars"])
            total += len(s["pos"])
            kept += sum(1 for p in s["pos"] if p < frac)
    return total, kept


print()
for label, new, cap, op in [
    ("old rules", False, None, None),
    ("new lists, cap 6k, opening = record", True, 6000, None),
    ("new lists, cap 10k, opening = record", True, 10000, None),
    ("new lists, no cap, opening = record", True, None, None),
    ("new lists, no cap, opening first", True, None, 3),
]:
    t, k = replay_grams(new, cap=cap, opening_rank=op)
    print(f"{label:40} matched phrases kept: {100 * k / t:.1f}% ({k}/{t})")

for label, new, cap, op in [
    ("old rules", False, None, None),
    ("new lists, no cap, opening first", True, None, 3),
    ("new lists, cap 6k, opening first", True, 6000, 3),
    ("new lists, cap 6k, opening = record", True, 6000, None),
    ("new lists, no cap, opening = record", True, None, None),
]:
    u, k = replay_sections(new, cap=cap, opening_rank=op)
    print(f"{label:40} used sections kept: {100 * k / u:.1f}% ({k}/{u})")
