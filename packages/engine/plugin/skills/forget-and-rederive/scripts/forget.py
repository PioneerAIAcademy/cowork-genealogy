#!/usr/bin/env python3
"""Remove known information from tree.gedcomx.json so the agent must re-derive it.

Why this exists
---------------
A researcher who wants to see whether the agent can really *do* the research
seeds a project from a well-documented FamilySearch person — at which point the
answer is already sitting in the local tree, and "research" degrades to reading
it back. This script removes a chosen slice of that tree so the question becomes
real again.

Two rules shape the whole design:

1. **It selects structurally, never by name.** You say `parents-of:PERSON_ID`,
   not "remove Robert Smith". The script walks the tree's relationships to find
   the ids itself.
2. **It reports counts and kinds, never values.** If this printed the names and
   dates it removed, they would land straight back in the agent's context and
   the exercise would be pointless. The researcher verifies the removal in the
   viewer, where seeing the gap is the point.

Stripping only handles the *local* copy. Live FamilySearch still has the answer,
so the agent must also be told not to look it up — that instruction lives in
SKILL.md, and it is half of the mechanism, not a footnote.

Stdlib only; runs in the Cowork VM with no network. See CLAUDE.md on
encoding="utf-8" — every text read/write here passes it explicitly.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

TREE_FILE = "tree.gedcomx.json"

SELECTOR_HELP = """\
  parents-of:<person_id>    the person's parents, and the parent-child links to them
  children-of:<person_id>   the person's children, and the parent-child links to them
  spouses-of:<person_id>    the person's spouses, and the couple relationships
  birth-of:<person_id>      that person's birth facts
  death-of:<person_id>      that person's death facts
  facts-of:<person_id>:<T>  that person's facts of type T (e.g. Marriage, Residence)
  person:<person_id>        one specific person (cascades their relationships)
  fact:<fact_id>            one specific fact
  relationship:<rel_id>     one specific relationship"""


class ForgetError(Exception):
    """A user-correctable problem: bad selector, unknown id, nothing to remove."""


# ── tree helpers ────────────────────────────────────────────────────────────


def _endpoints(rel: dict[str, Any]) -> tuple[str, ...]:
    """The two person ids a relationship connects, whatever its type."""
    keys = ("parent", "child") if rel.get("type") == "ParentChild" else ("person1", "person2")
    return tuple(str(rel.get(k, "")) for k in keys)


def _persons(tree: dict[str, Any]) -> list[dict[str, Any]]:
    return tree.get("persons") or []


def _relationships(tree: dict[str, Any]) -> list[dict[str, Any]]:
    return tree.get("relationships") or []


def _person_ids(tree: dict[str, Any]) -> set[str]:
    return {str(p.get("id")) for p in _persons(tree)}


def _require_person(tree: dict[str, Any], person_id: str) -> None:
    if person_id not in _person_ids(tree):
        raise ForgetError(
            f"no person {person_id!r} in {TREE_FILE}. Use the tree's own person id "
            f"(the `id` field), not a FamilySearch PID unless they happen to match."
        )


def _relatives(tree: dict[str, Any], person_id: str, kind: str) -> tuple[set[str], set[str]]:
    """(related person ids, relationship ids) for one structural relation.

    kind is "parents", "children" or "spouses". Returns ids only — never names,
    which is the whole point.
    """
    people: set[str] = set()
    rels: set[str] = set()
    for rel in _relationships(tree):
        rid = str(rel.get("id"))
        rtype = rel.get("type")
        if kind in ("parents", "children"):
            if rtype != "ParentChild":
                continue
            parent, child = str(rel.get("parent", "")), str(rel.get("child", ""))
            if kind == "parents" and child == person_id:
                people.add(parent)
                rels.add(rid)
            elif kind == "children" and parent == person_id:
                people.add(child)
                rels.add(rid)
        else:
            if rtype == "ParentChild":
                continue
            p1, p2 = str(rel.get("person1", "")), str(rel.get("person2", ""))
            if person_id in (p1, p2):
                people.add(p2 if p1 == person_id else p1)
                rels.add(rid)
    return people, rels


def _fact_ids_of_type(tree: dict[str, Any], person_id: str, fact_type: str) -> set[str]:
    for p in _persons(tree):
        if str(p.get("id")) != person_id:
            continue
        return {
            str(f.get("id"))
            for f in (p.get("facts") or [])
            if str(f.get("type", "")).lower() == fact_type.lower() and f.get("id")
        }
    return set()


# ── selector parsing ────────────────────────────────────────────────────────


class Targets:
    def __init__(self) -> None:
        self.persons: set[str] = set()
        self.facts: set[str] = set()
        self.relationships: set[str] = set()

    def is_empty(self) -> bool:
        return not (self.persons or self.facts or self.relationships)


def resolve_selectors(tree: dict[str, Any], selectors: list[str]) -> Targets:
    t = Targets()
    for raw in selectors:
        sel = raw.strip()
        if ":" not in sel:
            raise ForgetError(f"selector {raw!r} has no ':'. Valid forms:\n{SELECTOR_HELP}")
        kind, _, rest = sel.partition(":")
        kind = kind.strip().lower()

        if kind in ("parents-of", "children-of", "spouses-of"):
            pid = rest.strip()
            _require_person(tree, pid)
            relation = {"parents-of": "parents", "children-of": "children", "spouses-of": "spouses"}[kind]
            people, rels = _relatives(tree, pid, relation)
            if not people and not rels:
                raise ForgetError(
                    f"{sel!r} matched nothing — {pid} has no {relation} in the tree, "
                    f"so there is nothing to forget."
                )
            t.persons |= people
            t.relationships |= rels

        elif kind in ("birth-of", "death-of"):
            pid = rest.strip()
            _require_person(tree, pid)
            fact_type = "Birth" if kind == "birth-of" else "Death"
            ids = _fact_ids_of_type(tree, pid, fact_type)
            if not ids:
                raise ForgetError(f"{sel!r} matched nothing — {pid} has no {fact_type} fact.")
            t.facts |= ids

        elif kind == "facts-of":
            pid, _, fact_type = rest.partition(":")
            pid, fact_type = pid.strip(), fact_type.strip()
            if not fact_type:
                raise ForgetError(f"{sel!r} needs a fact type: facts-of:<person_id>:<Type>")
            _require_person(tree, pid)
            ids = _fact_ids_of_type(tree, pid, fact_type)
            if not ids:
                raise ForgetError(f"{sel!r} matched nothing — {pid} has no {fact_type} fact.")
            t.facts |= ids

        elif kind == "person":
            pid = rest.strip()
            _require_person(tree, pid)
            t.persons.add(pid)

        elif kind == "fact":
            t.facts.add(rest.strip())

        elif kind == "relationship":
            t.relationships.add(rest.strip())

        else:
            raise ForgetError(f"unknown selector kind {kind!r}. Valid forms:\n{SELECTOR_HELP}")
    return t


# ── the removal ─────────────────────────────────────────────────────────────


def apply(tree: dict[str, Any], t: Targets) -> tuple[dict[str, Any], dict[str, Any]]:
    """Remove the targets, cascading relationships off removed persons.

    Returns (new tree, redacted summary). The summary deliberately carries no
    names, dates or places — only how many of what kind went.
    """
    # A removed person takes every relationship touching them, or the tree is
    # left with links pointing at people who no longer exist.
    cascaded = {
        str(r.get("id"))
        for r in _relationships(tree)
        if set(_endpoints(r)) & t.persons
    }
    dead_rels = t.relationships | cascaded

    kept_persons, removed_persons = [], 0
    for p in _persons(tree):
        if str(p.get("id")) in t.persons:
            removed_persons += 1
        else:
            kept_persons.append(p)

    kept_rels, removed_rels = [], 0
    for r in _relationships(tree):
        if str(r.get("id")) in dead_rels:
            removed_rels += 1
        else:
            kept_rels.append(r)

    # Facts live on persons and on couple relationships alike.
    removed_fact_types: dict[str, int] = {}
    unmatched = set(t.facts)

    def prune_facts(owner: dict[str, Any]) -> None:
        kept = []
        for f in owner.get("facts") or []:
            fid = str(f.get("id"))
            if fid in t.facts:
                ftype = str(f.get("type") or "Unknown")
                removed_fact_types[ftype] = removed_fact_types.get(ftype, 0) + 1
                unmatched.discard(fid)
            else:
                kept.append(f)
        if owner.get("facts") is not None:
            owner["facts"] = kept

    for p in kept_persons:
        prune_facts(p)
    for r in kept_rels:
        prune_facts(r)

    if unmatched:
        raise ForgetError(
            "these fact ids are not in the tree: " + ", ".join(sorted(unmatched))
        )

    new_tree = {**tree, "persons": kept_persons, "relationships": kept_rels}
    summary = {
        "persons_removed": removed_persons,
        "relationships_removed": removed_rels,
        "relationships_cascaded": len(cascaded - t.relationships),
        "facts_removed_by_type": removed_fact_types,
        "persons_remaining": len(kept_persons),
        "relationships_remaining": len(kept_rels),
    }
    return new_tree, summary


def render(summary: dict[str, Any], dry_run: bool) -> str:
    verb = "Would remove" if dry_run else "Removed"
    lines = [f"{verb}:"]
    if summary["persons_removed"]:
        lines.append(f"  - {summary['persons_removed']} person(s)")
    if summary["relationships_removed"]:
        extra = summary["relationships_cascaded"]
        tail = f" ({extra} cascaded from removed persons)" if extra else ""
        lines.append(f"  - {summary['relationships_removed']} relationship(s){tail}")
    for ftype, n in sorted(summary["facts_removed_by_type"].items()):
        lines.append(f"  - {n} {ftype} fact(s)")
    if len(lines) == 1:
        lines.append("  - nothing matched")
    lines += [
        "",
        f"Tree now holds {summary['persons_remaining']} person(s) and "
        f"{summary['relationships_remaining']} relationship(s).",
        "",
        "Values are deliberately not listed — printing them would put the answer "
        "back in context. Check the viewer to confirm the gap is what you wanted.",
    ]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(
        description="Remove known information from a project's tree so it must be re-derived.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Selectors:\n" + SELECTOR_HELP,
    )
    ap.add_argument("--project", required=True, help="Project directory holding tree.gedcomx.json")
    ap.add_argument(
        "--forget",
        action="append",
        required=True,
        metavar="SELECTOR",
        help="What to forget; repeatable. See the selector list below.",
    )
    ap.add_argument("--dry-run", action="store_true", help="Report what would go; write nothing.")
    args = ap.parse_args(argv)

    tree_path = Path(args.project) / TREE_FILE
    if not tree_path.exists():
        print(f"error: {tree_path} does not exist — is --project the project folder?", file=sys.stderr)
        return 2

    try:
        tree = json.loads(tree_path.read_text(encoding="utf-8"))
        targets = resolve_selectors(tree, args.forget)
        if targets.is_empty():
            raise ForgetError("no targets resolved — nothing would be removed.")
        new_tree, summary = apply(tree, targets)
    except ForgetError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except (ValueError, TypeError) as exc:
        print(f"error: {tree_path} is not valid JSON ({exc})", file=sys.stderr)
        return 2

    if not args.dry_run:
        # Dotfile on purpose. This backup still holds the answer, so it must not
        # be somewhere the agent browses or the feedback bundler picks up — both
        # skip dot-prefixed entries. SKILL.md additionally forbids reading it.
        backup = tree_path.parent / ".tree-before-forget.gedcomx.json"
        backup.write_text(json.dumps(tree, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tree_path.write_text(json.dumps(new_tree, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(render(summary, args.dry_run))
    if not args.dry_run:
        print(
            f"\nThe original tree is saved as {backup.name}. Do NOT read it — it still "
            f"contains what was just removed. It is there so the researcher can restore "
            f"the tree, nothing else."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
