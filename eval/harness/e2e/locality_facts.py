"""Which locality facts did later agents use, and does a new guide still carry them?

    uv run python -m e2e.locality_facts mine [--out facts.json]
    uv run python -m e2e.locality_facts fixtures <facts.json> <out-dir> <key> [<key> ...]
    uv run python -m e2e.locality_facts check <facts.json> <research.json> [<research.json> ...]
    uv run python -m e2e.locality_facts compare <facts.json> <baseline-runs-dir> <new-runs-dir>

`mine` reads the committed e2e corpus (`eval/runlogs/e2e/*/run-*.final-research.json`): for each
saved locality guide, the facts a plan item's rationale in the same run shares with that locality
entry. A fact is an atom a later step can act on, matched exactly:

- ``collection`` — a FamilySearch collection id (6 to 8 digits);
- ``url`` — a URL;
- ``year`` — a year in a rationale sentence about registration or a record start, which the
  locality also gives;
- ``name`` — a named institution or index (an Archive, Library, Society, Office, Court, Registry,
  Diocese, Index, Bureau, Museum ...), two to six capitalised words.

`fixtures` writes one single-ask fixture per chosen place (a facts.json key) into <out-dir>: the
e2e fixture's own starting project and one message asking for that place's guide, so
`e2e.run_single_ask --fixtures-root <out-dir>` regenerates the guides on the current code.

`check` reads new research.json files (one per place, from one-turn locality-guide runs) and
reports, per place, how many of the mined facts the new localities entry carries anywhere in it.
Prose and rows are both searched, so the check works before and after a guide moves into rows.
Exact matching on purpose: no judge, no paraphrase credit, repeatable after every change.
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
CORPUS = REPO_ROOT / "eval" / "runlogs" / "e2e"

COLLECTION = re.compile(r"(?<![\d.])(\d{6,8})(?![\d.])")
URL = re.compile(r"https?://[^\s)\]\"'<>,;]+")
YEAR = re.compile(r"\b(1[5-9]\d\d|20[0-2]\d)\b")
YEAR_CONTEXT = re.compile(r"regist|began|begin|start|statewide|civil|from|kept|earliest|onward|since", re.I)
INSTITUTION = re.compile(
    r"\b((?:[A-Z][\w'’.-]+|of|the|and|de|du|des|für|für|y|da|do|dos)(?:\s+(?:[A-Z][\w'’.-]+|of|the|and|de|du|des|für|y|da|do|dos)){1,6})"
)
INSTITUTION_WORD = re.compile(
    r"\b(Archives?|Archiv|Arquivo|Archivo|Archief|Arkiv|Library|Bibliothek|Society|Office|Court|Registry|"
    r"Register|Registrar|Diocese|Bureau|Museum|Department|Index|Indexes|Commission|Courthouse|Kirchenbuch\w*|"
    r"Landesarchiv|Staatsarchiv|Recorder|Clerk|Probate|Surrogate|Cathedral|Parish|Matricula|Archion)\b"
)
GENERIC = re.compile(r"^(FamilySearch|FamilySearch Library|FamilySearch Catalog|FamilySearch Wiki|Family History Library|The|National Archives)$")


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.;!?])\s+|\n+", text) if s.strip()]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


# Fields code writes (the catalog fill, the staged survey): a fact found only there was not kept
# by the agent, so `check` reports it apart.
CODE_WRITTEN = ("collections", "catalog", "pages_read", "volume_summary")


def locality_text(loc: dict[str, Any], agent_only: bool = False) -> str:
    """Every string a localities entry carries, prose and rows alike; with `agent_only`, none from
    the fields code writes."""
    out: list[str] = []

    def walk(v: Any) -> None:
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            out.append(str(v))
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    skip = {"id", "created", "updated", "source", *(CODE_WRITTEN if agent_only else ())}
    walk({k: v for k, v in loc.items() if k not in skip})
    return "\n".join(out)


def facts_shared(rationale: str, loc_text: str) -> set[tuple[str, str]]:
    """The facts `rationale` shares with a locality entry's text."""
    facts: set[tuple[str, str]] = set()
    lt = loc_text
    ltl = lt.lower()
    for cid in COLLECTION.findall(rationale):
        if re.search(rf"(?<!\d){cid}(?!\d)", lt):
            facts.add(("collection", cid))
    for url in URL.findall(rationale):
        u = url.rstrip(".")
        if u.lower() in ltl:
            facts.add(("url", u))
    for sent in _sentences(rationale):
        if YEAR_CONTEXT.search(sent):
            for y in YEAR.findall(sent):
                if re.search(rf"\b{y}\b", lt):
                    facts.add(("year", y))
        for m in INSTITUTION.findall(sent):
            name = m.strip(" .,'’").strip()
            name = re.sub(r"^(?:of|the|and)\s+", "", name, flags=re.I)
            if not INSTITUTION_WORD.search(name) or GENERIC.match(name) or len(name) < 8:
                continue
            if _norm(name) in _norm(lt):
                facts.add(("name", name))
    return facts


def mine() -> dict[str, Any]:
    places: dict[str, Any] = {}
    for f in sorted(glob.glob(str(CORPUS / "*" / "run-*.final-research.json"))):
        research = json.loads(Path(f).read_text(encoding="utf-8"))
        locs = [l for l in research.get("localities") or [] if isinstance(l, dict)]
        items = [it for p in research.get("plans") or [] for it in (p.get("items") or []) if isinstance(it, dict)]
        rationale = "\n".join(str(it.get("rationale") or "") for it in items)
        if not locs or not rationale.strip():
            continue
        fixture = Path(f).parent.name
        for loc in locs:
            guide = loc.get("guide_markdown")
            if not isinstance(guide, str) or len(guide) < 1500:
                continue
            facts = facts_shared(rationale, locality_text(loc))
            if not facts:
                continue
            key = f"{fixture}::{loc.get('for_place') or loc.get('place')}"
            entry = places.setdefault(
                key,
                {
                    "fixture": fixture,
                    "place": loc.get("for_place") or loc.get("place"),
                    "standard_place": loc.get("place"),
                    "time_period": loc.get("time_period"),
                    "runs": [],
                    "facts": {},
                },
            )
            entry["runs"].append(Path(f).name)
            for kind, value in facts:
                entry["facts"].setdefault(f"{kind}:{value}", 0)
                entry["facts"][f"{kind}:{value}"] += 1
    return places


def write_fixtures(facts_doc: dict[str, Any], out: Path, keys: list[str]) -> list[str]:
    """One single-ask fixture per key, named after its e2e fixture."""
    import shutil

    written = []
    for key in keys:
        entry = facts_doc[key]
        src = REPO_ROOT / "eval" / "tests" / "e2e" / entry["fixture"]
        dst = out / entry["fixture"]
        if dst.exists() and entry["fixture"] in written:
            raise SystemExit(f"two places from {entry['fixture']}: pick one per e2e fixture")
        dst.mkdir(parents=True, exist_ok=True)
        for name in ("starting-research.json", "starting-tree.gedcomx.json"):
            shutil.copy(src / name, dst / name)
        period = f", for {entry['time_period']}" if entry.get("time_period") else ""
        fixture = {
            "id": entry["fixture"],
            "message": f"Please write a locality guide for {entry['place']}{period}, and save it to the project.",
            "expected_owner": "locality-guide",
            "expected_save": {"section": "localities"},
            "required_tools": ["locality_survey"],
            "caps": {"wall_clock_seconds": 1200, "tool_calls": 80, "max_turns": 80, "max_cost_usd": 4.0},
        }
        (dst / "fixture.json").write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(entry["fixture"])
    return written


def check(facts_doc: dict[str, Any], research_paths: list[Path]) -> list[dict[str, Any]]:
    """Per place in `facts_doc` that a research.json covers: the mined facts its new entry carries."""
    reports = []
    for path in research_paths:
        doc = json.loads(path.read_text(encoding="utf-8"))
        # A single-ask run log carries its final research.json and its fixture id.
        research = doc.get("final_research") or {} if "final_research" in doc else doc
        fixture = doc.get("test_id") or path.parent.name
        locs = [l for l in research.get("localities") or [] if isinstance(l, dict)]
        text = "\n".join(locality_text(l, agent_only=True) for l in locs)
        anywhere = "\n".join(locality_text(l) for l in locs)

        def found(kind: str, value: str, hay: str) -> bool:
            if kind in ("collection", "year"):
                return bool(re.search(rf"(?<!\d){re.escape(value)}(?!\d)", hay))
            return _norm(value) in _norm(hay)

        for key, entry in facts_doc.items():
            if entry["fixture"] != fixture:
                continue
            have, missing, code_only = [], [], []
            for fact in entry["facts"]:
                kind, value = fact.split(":", 1)
                if found(kind, value, text):
                    have.append(fact)
                else:
                    missing.append(fact)
                    if found(kind, value, anywhere):
                        code_only.append(fact)
            reports.append({
                "place": key, "facts": len(entry["facts"]), "kept": len(have), "missing": missing,
                "code_only": code_only,
                "by_kind": {k: [sum(1 for f in have if f.startswith(k + ":")), sum(1 for f in entry["facts"] if f.startswith(k + ":"))]
                            for k in ("collection", "url", "year", "name")},
                "strong": [sum(1 for f in have if entry["facts"][f] >= 2), sum(1 for n in entry["facts"].values() if n >= 2)],
            })
    return reports


KINDS = ("collection", "url", "year", "name")


def _per_place(facts_doc: dict[str, Any], runs_dir: Path) -> dict[str, dict[str, float]]:
    """Per place: the median over its runs of each kind's facts kept in what the agent wrote."""
    from statistics import median

    out: dict[str, dict[str, float]] = {}
    for key, entry in facts_doc.items():
        runs = sorted((runs_dir / entry["fixture"]).glob("run-*.json"))
        reports = [r for path in runs for r in check({key: entry}, [path])]
        if reports:
            out[key] = {k: median(r["by_kind"][k][0] for r in reports) for k in KINDS}
            out[key]["runs"] = len(reports)
    return out


def compare(facts_doc: dict[str, Any], base_dir: Path, new_dir: Path) -> bool:
    """Sum over the places both sides ran of each kind's per-place median; the new side passes when
    no kind is more than one fact below the baseline."""
    base, new = _per_place(facts_doc, base_dir), _per_place(facts_doc, new_dir)
    short = [
        f"{side}: {key} ({runs.get(key, {}).get('runs', 0)} runs)"
        for side, runs in (("baseline", base), ("new", new))
        for key in facts_doc
        if runs.get(key, {}).get("runs", 0) < 2
    ]
    if short:
        print("FAIL: every place needs at least two runs on each side:\n  " + "\n  ".join(short))
        return False
    places = sorted(facts_doc)
    ok = True
    print(f"{len(places)} places on both sides")
    for k in KINDS:
        b = sum(base[p][k] for p in places)
        n = sum(new[p][k] for p in places)
        total = sum(sum(1 for f in facts_doc[p]["facts"] if f.startswith(k + ":")) for p in places)
        good = n >= b - 1
        ok &= good
        print(f"  {k:10} baseline {b:5.1f}  new {n:5.1f}  of {total}  {'ok' if good else 'BELOW'}")
    for p in places:
        drops = [k for k in KINDS if new[p][k] < base[p][k]]
        if drops:
            print(f"    {p}: " + ", ".join(f"{k} {base[p][k]:g}->{new[p][k]:g}" for k in drops))
    print("PASS" if ok else "FAIL")
    return ok


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(prog="e2e.locality_facts")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("mine")
    m.add_argument("--out", type=Path)
    fx = sub.add_parser("fixtures")
    fx.add_argument("facts", type=Path)
    fx.add_argument("out", type=Path)
    fx.add_argument("keys", nargs="+")
    cm = sub.add_parser("compare")
    cm.add_argument("facts", type=Path)
    cm.add_argument("baseline", type=Path)
    cm.add_argument("new", type=Path)
    c = sub.add_parser("check")
    c.add_argument("facts", type=Path)
    c.add_argument("research", type=Path, nargs="+")
    args = ap.parse_args(argv)
    if args.cmd == "mine":
        places = mine()
        if args.out:
            args.out.write_text(json.dumps(places, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        total = sum(len(e["facts"]) for e in places.values())
        print(f"{len(places)} places, {total} facts")
        for key, e in sorted(places.items(), key=lambda kv: -len(kv[1]["facts"]))[:40]:
            kinds = {}
            for f in e["facts"]:
                kinds[f.split(":")[0]] = kinds.get(f.split(":")[0], 0) + 1
            print(f"  {len(e['facts']):3} {kinds}  {key} | {e['time_period']}")
        return 0
    if args.cmd == "compare":
        return 0 if compare(json.loads(args.facts.read_text(encoding="utf-8")), args.baseline, args.new) else 1
    if args.cmd == "fixtures":
        print(write_fixtures(json.loads(args.facts.read_text(encoding="utf-8")), args.out, args.keys))
        return 0
    reports = check(json.loads(args.facts.read_text(encoding="utf-8")), args.research)
    kept = sum(r["kept"] for r in reports)
    total = sum(r["facts"] for r in reports)
    for r in reports:
        print(f"{r['kept']:3}/{r['facts']:<3} {r['place']}")
        for miss in r["missing"]:
            print(f"        missing {miss}" + ("  (only in a code-written field)" if miss in r["code_only"] else ""))
    print(f"\nkept {kept} of {total} facts in what the agent wrote" + (f" ({100 * kept / total:.0f}%)" if total else ""))
    code = sum(len(r["code_only"]) for r in reports)
    print(f"  + {code} more only in code-written fields ({', '.join(CODE_WRITTEN)})")
    for k in ("collection", "url", "year", "name"):
        a = sum(r["by_kind"][k][0] for r in reports)
        b = sum(r["by_kind"][k][1] for r in reports)
        print(f"  {k:10} {a}/{b}" + (f" ({100 * a / b:.0f}%)" if b else ""))
    a = sum(r["strong"][0] for r in reports)
    b = sum(r["strong"][1] for r in reports)
    print(f"  used in 2+ runs: {a}/{b}" + (f" ({100 * a / b:.0f}%)" if b else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
