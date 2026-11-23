# Run from the repo root: python3 packages/engine/mcp-server/dev/probe-wiki-section-use.py <out.json>
"""Which wiki sections did saved locality guides draw on?

For each e2e locality guide (final-research.json localities[].guide_markdown), fetch the
wiki pages it read (pages_read urls and every wiki url the guide cites), split each page at
its #-### headings, and mark a section "used" when it shares a run of 6 words with the guide.
Writes per-section rows to a JSON file for analysis.
"""
import glob
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = "https://malachi.taild68f1b.ts.net/wiki"
WIKI = "https://www.familysearch.org/en/wiki/"
OUT = sys.argv[1]
N = 6

guides = []
for f in sorted(glob.glob("eval/runlogs/e2e/*/run-*.final-research.json")):
    d = json.load(open(f, encoding="utf-8"))
    for loc in d.get("localities") or []:
        g = loc.get("guide_markdown")
        if not isinstance(g, str) or len(g) < 2000:
            continue
        urls = {p["url"] for p in (loc.get("pages_read") or []) if p.get("url")}
        urls |= {u.rstrip(".,;") for u in re.findall(r"https://www\.familysearch\.org/en/wiki/[^\s)\]\"'>]+", g)}
        urls = {u.split("#")[0] for u in urls if u.startswith(WIKI)}
        guides.append({"file": f, "place": loc.get("for_place") or loc.get("place"), "guide": g, "urls": sorted(urls)})

all_urls = sorted({u for g in guides for u in g["urls"]})
print(f"{len(guides)} guides, {len(all_urls)} pages", file=sys.stderr)


def fetch(url):
    import subprocess
    slug = urllib.parse.unquote(url[len(WIKI):])
    target = f"{BASE}/page/{urllib.parse.quote(slug, safe=',()_')}"
    try:
        out = subprocess.run(["curl", "-s", "-m", "60", "-A", "genealogy-mcp-server/0.0.1", target],
                             capture_output=True, text=True, encoding="utf-8", timeout=90).stdout
        body = json.loads(out)
        return url, body.get("content") if isinstance(body.get("content"), str) else None
    except Exception:
        return url, None


with ThreadPoolExecutor(8) as ex:
    pages = dict(ex.map(fetch, all_urls))
print(f"fetched {sum(1 for v in pages.values() if v)} of {len(pages)}", file=sys.stderr)

HEADING = re.compile(r"^(#{1,3})[ \t]+(\S.*?)[ \t]*$")


def sections(text):
    out, cur, head = [], [], None
    for line in text.split("\n"):
        m = HEADING.match(line)
        if m:
            if cur:
                out.append((head, "\n".join(cur)))
            cur, head = [line], (None if len(m.group(1)) == 1 else re.sub(r"[*_\[\]]", "", m.group(2)).strip())
        else:
            cur.append(line)
    if cur:
        out.append((head, "\n".join(cur)))
    return out


def words(text):
    text = re.sub(r"\]\([^)]*\)", "]", text)
    return re.findall(r"[a-z0-9]+", text.lower())


def grams(ws):
    return {" ".join(ws[i : i + N]) for i in range(len(ws) - N + 1)}


rows = []
for g in guides:
    gg = grams(words(g["guide"]))
    for url in g["urls"]:
        text = pages.get(url)
        if not text:
            continue
        for i, (head, body) in enumerate(sections(text)):
            ws = words(body)
            pos = [j / max(1, len(ws)) for j in range(len(ws) - N + 1) if " ".join(ws[j : j + N]) in gg]
            rows.append({"guide": g["file"], "url": url, "order": i, "heading": head, "chars": len(body), "shared": len(pos), "pos": pos})
json.dump(rows, open(OUT, "w", encoding="utf-8"))
print(f"{len(rows)} section rows", file=sys.stderr)
