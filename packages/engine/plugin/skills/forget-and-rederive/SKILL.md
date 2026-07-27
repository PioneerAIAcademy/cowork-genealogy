---
name: forget-and-rederive
description: Set up a practice run by removing information the researcher already has from the project tree, so it must be re-derived from records. Use when the researcher says "forget what you know about X and find it again", "hide his parents and see if you can find them", "I want to test whether you can work this out", "re-derive this from scratch", or seeds a project from a well-documented FamilySearch person specifically to check whether the agent can rediscover a known answer. Do NOT use to correct a wrong fact (use tree_correct), to remove a duplicate person (use merge_tree_persons), or to start a project (use init-project).
allowed-tools:
  - project_context
  - tree_forget
---

**Narration:** read `researcher_profile.narration_guidance` in `research.json` and
apply it as the narration style for this invocation.

# Forget and re-derive

The researcher wants to know whether you can actually *do* the research, not
whether you can read an answer off a tree that already contains it. This skill
removes a chosen slice of the local tree so the question becomes genuine.

## The two halves — both are required

Stripping the local tree is only half the mechanism.

1. **Remove it locally** — the `tree_forget` tool, below.
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
parents", "her death date", "who she married".

Map that to the tree's own ids with `project_context({ projectPath })`, which
returns each tree person's `id` and preferred name. That is all you need: the
selectors below take ids, and `tree_forget` walks the relationships itself to
resolve parents, children and spouses.

**Do not read `tree.gedcomx.json`.** You do not need the names and dates you are
about to remove, and you are better off not having them in context.

If the researcher hasn't seeded a project yet, run `init-project` first. This
skill edits an existing tree; it does not create one.

### 2. Always dry-run first

```
tree_forget({ projectPath, forget: [ … ], dryRun: true })
```

Each entry in `forget` is `{ selector, … }`:

| Selector | Fields | Removes |
|---|---|---|
| `parents-of` | `personId` | the person's parents, and the links to them |
| `children-of` | `personId` | the person's children, and the links to them |
| `spouses-of` | `personId` | the person's spouses, and the couple relationships |
| `birth-of` | `personId` | that person's birth facts |
| `death-of` | `personId` | that person's death facts |
| `facts-of` | `personId`, `factType` | that person's facts of one type (e.g. `Marriage`) |
| `person` | `personId` | one person, cascading their relationships |
| `fact` | `factId` | one specific fact |
| `relationship` | `relationshipId` | one specific relationship |

**Show the researcher the dry-run counts and get their agreement before
writing.** This matters more than it looks: removing a *person* also removes
every relationship touching them. Forgetting a father can therefore also cut the
subject's siblings, that father's own parents, and his marriage — the dry run
reports these as `relationshipsCascaded`, and a surprised researcher is why you
check first. If the cascade is wider than they want, prefer fact-level selectors
(`birth-of`, `death-of`, `facts-of`) which never cascade.

### 3. Apply it

Re-run the same call without `dryRun`. Then:

- Report what went, using the tool's own redacted summary — **counts and kinds
  only**. Do not restate the removed names, dates or places back to the
  researcher: you are about to go looking for them, and repeating them here puts
  them right back in your context.
- Tell the researcher to confirm the gap in the viewer. Seeing the hole is how
  they check you removed what they meant.
- The tool writes `.tree-before-forget.gedcomx.json` so they can restore the
  tree. **Never read that file.** It still contains everything that was removed.

If the call comes back `{ ok: false, errors }`, nothing was written. Two errors
are worth reading carefully rather than routing around:

- **"matched nothing"** — the target is already gone. Read it as "this was
  already forgotten," not as a problem to fix.
- **A validation error naming `research.json` paths** — the researcher has
  assertions, person-evidence entries or a timeline that still reference a person
  you are about to remove. `tree_forget` does not touch `research.json`, so tell
  them what is blocking it and let them choose: clear those entries, or forget a
  narrower slice with a fact-level selector. Say plainly that entries which
  *state* the answer compromise the exercise anyway.

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

## Re-invocation behavior

**Writes** `tree.gedcomx.json` only — `tree_forget` removes the persons,
relationships, and facts named by the selectors, plus everything that cascades
from them. It writes nothing to `research.json`, the `log`, or the `results/`
sidecars. It also writes the restore file `.tree-before-forget.gedcomx.json` next
to the tree. `dryRun` writes neither file.

**On re-invocation,** forgetting is additive: a second call strips a further
slice from the already-stripped tree. Dry-run first every time regardless — the
cascade depends on the tree's *current* shape, so the second call's blast radius
is not the first one's.

**The restore file is written once and never overwritten,** so it always holds
the tree as it was before the *first* forget. A second forget does not disturb
it; restoring it undoes every slice at once.
