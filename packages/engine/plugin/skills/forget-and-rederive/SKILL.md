---
name: forget-and-rederive
description: Set up a practice run by removing information the researcher already has from the project tree, so it must be re-derived from records. Use when the researcher says "forget what you know about X and find it again", "hide his parents and see if you can find them", "I want to test whether you can work this out", "re-derive this from scratch", or seeds a project from a well-documented FamilySearch person specifically to check whether the agent can rediscover a known answer. Do NOT use to correct a wrong fact (use tree_correct), to remove a duplicate person (use merge_tree_persons), or to start a project (use init-project).
allowed-tools: Bash, Read, mcp__genealogy__validate_research_schema
---

**Narration:** read `researcher_profile.narration_guidance` in `research.json` and
apply it as the narration style for this invocation.

# Forget and re-derive

The researcher wants to know whether you can actually *do* the research, not
whether you can read an answer off a tree that already contains it. This skill
removes a chosen slice of the local tree so the question becomes genuine.

## The two halves — both are required

Stripping the local tree is only half the mechanism.

1. **Remove it locally** — `scripts/forget.py`, below.
2. **Do not look it up again.** Live FamilySearch *still has the answer*. If you
   call `person_read`, `person_search`, `person_ancestors`, or the person-match
   tools on the affected people, you will read straight back what was just
   removed and the exercise is worthless.

**For the rest of this project, treat the forgotten information as unknown.**
Recover it the way you would for a real brick wall: search records, read them,
weigh the evidence. If you catch yourself about to fetch the tree entry for a
person whose details were forgotten, stop — that is the one move this exercise
forbids.

Reading records *about* those people is not only allowed, it is the point. The
prohibition is on reading the FamilySearch **tree** for the forgotten facts.

## Steps

### 1. Find out what to forget

Ask the researcher what they want you to re-derive, in their words — "his
parents", "her death date", "who she married". Map that to the tree's own ids by
reading `tree.gedcomx.json` **structurally**: find the person's `id`, and let the
script resolve relatives from the relationships. You do not need to read, quote,
or remember the names and dates you are about to remove — and you are better off
not doing so.

If the researcher hasn't seeded a project yet, run `init-project` first. This
skill edits an existing tree; it does not create one.

### 2. Always dry-run first

```bash
python3 scripts/forget.py --project <project-dir> --forget <selector> --dry-run
```

Selectors (repeat `--forget` for several):

| Selector | Removes |
|---|---|
| `parents-of:<person_id>` | the person's parents, and the links to them |
| `children-of:<person_id>` | the person's children, and the links to them |
| `spouses-of:<person_id>` | the person's spouses, and the couple relationships |
| `birth-of:<person_id>` | that person's birth facts |
| `death-of:<person_id>` | that person's death facts |
| `facts-of:<person_id>:<Type>` | that person's facts of one type (e.g. `Marriage`) |
| `person:<person_id>` | one person, cascading their relationships |
| `fact:<fact_id>` | one specific fact |
| `relationship:<rel_id>` | one specific relationship |

**Show the researcher the dry-run counts and get their agreement before
writing.** This matters more than it looks: removing a *person* also removes
every relationship touching them. Forgetting a father can therefore also cut the
subject's siblings, that father's own parents, and his marriage — the dry-run
reports these as "cascaded", and a surprised researcher is why you check first.
If the cascade is wider than they want, prefer fact-level selectors
(`birth-of:`, `death-of:`, `facts-of:`) which never cascade.

### 3. Apply it

Re-run the same command without `--dry-run`. Then:

- Report what went, using the script's own redacted summary — **counts and kinds
  only**. Do not restate the removed names, dates or places back to the
  researcher: you are about to go looking for them, and repeating them here puts
  them right back in your context.
- Tell the researcher to confirm the gap in the viewer. Seeing the hole is how
  they check you removed what they meant.
- The script writes `.tree-before-forget.gedcomx.json` so they can restore the
  tree. **Never read that file.** It still contains everything that was removed.

### 4. Research it

Proceed exactly as you would for a real question — `/research`, or the relevant
sub-skills. When you reach a conclusion, present the evidence you actually found.
The researcher will compare it against what they know.

## What this does not do

- It does not touch `research.json`. Any assertions or log entries the
  researcher already wrote stay put; if those *state* the answer, say so, because
  the exercise is compromised until they're cleared too.
- It does not prevent tree lookups. Nothing enforces the rule in step 2 — it
  holds because you follow it.
- It does not verify the answer is recoverable from records. Some facts on a
  FamilySearch tree have no supporting record behind them. If the search turns up
  nothing, say the evidence isn't there rather than reaching for a guess — that
  is a legitimate and useful outcome, and reporting it honestly is worth more
  than a lucky hit.
