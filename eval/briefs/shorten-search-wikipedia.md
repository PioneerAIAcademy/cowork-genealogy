# Shorten: search-wikipedia

**Bucket:** A (dead-mechanics removal) — but effectively **already done**
**Primary owner:** developer (read-only search wrapper; no genealogy craft)
**Current size:** 65 lines → **Target:** ~65 lines (≈0% — it is the target)
**Tool migration:** n/a — always a read-only wrapper (calls `wikipedia_search`);
never wrote `research.json`/`tree.gedcomx.json`, so there are no dead mechanics.
**Still needed as a skill?** **Yes — and it is the reference.** It carries the
slug-normalization regression tests, two routing negatives, and the
out-of-scope decline. More importantly, the whole *shorten* cycle uses it as
the north-star shape every other tool-backed skill should converge toward.

## TL;DR
**This is the reference minimal skill — the shape the others should move
toward. Do not bloat it, and don't invent cuts to hit a number.** At 65 lines
it is already at target: one read-only tool call, fill a `templates/` file,
save with a slug rule, brief confirmation. The CUT section below is near-empty
on purpose — the only *optional* trim is the `Re-invocation behavior` block
(lines 52–64), and even that is low-yield and arguably worth keeping as the
canonical example of how that block should read when it is kept. Everything
else is load-bearing or is the exemplar prose other skills copy.

## Why this skill is (already) at target
The skill maps 1:1 onto the cut/keep rule with almost nothing left to remove:
- It **does not** inline the tool's input schema — it just says "call
  `wikipedia_search` with the topic as the `query` parameter" (one param,
  one mention). Compare search-familysearch-wiki, which inlines fenced markdown
  blocks; this skill points at `templates/wiki-summary.md` instead.
- It **does not** restate the rubric — the rubric has two dims (Template
  fidelity, Slug correctness) and the body covers each in one place.
- It **does not** narrate tool mechanics — it states the verbatim-copy rule and
  the slug rule, both of which are *inputs the skill supplies*, not work the
  tool does.
- The only boilerplate is `Re-invocation behavior` — and it is the one block
  whose removal is debatable (see CUT).

The triage is explicit: "Reference minimal skill — the target shape. Do not
bloat." This brief exists to **document why that shape works**, so the teams
copy it rather than re-deriving it.

## The floor: what the unit tests actually grade
- **Deterministic validators** (`eval/harness/validators/test_search_wikipedia.py`):
  - `test_only_wikipedia_search_called` — positive tests call **only**
    `wikipedia_search`, no other MCP tool.
  - `test_wikipedia_search_called_exactly_once` — **exactly one** call (no
    query-refinement loop; this is a real constraint search-familysearch-wiki
    does *not* have a validator for).
  - `test_wrote_one_markdown_file` — positive tests produce **exactly one** new
    `.md` file.
  - `test_slug_*` (tag-gated regressions) — `albert-einstein`,
    `schuylkill-county-pennsylvania`, `great-famine-ireland`, `o-brien-surname`
    (apostrophe→hyphen, ` (surname)`→`-surname`). These are why the worked slug
    examples in lines 42–46 are **load-bearing, not decoration.**
  - Plus the **universal** `test_ownership_table` — search-wikipedia is named in
    the validator docstring as the canonical *read-only* skill (absent from the
    ownership table → any write fails).
- **Rubric dims** (`eval/tests/unit/search-wikipedia/rubric.md`):
  1. *Template fidelity* — called the tool, confirmed saving, **no fabricated
     facts**, and a *brief* confirmation that does **not** restate article
     content (brevity is rewarded, not penalized).
  2. *Slug correctness* — filename is the slugified article title.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests:**
  - `negative-out-of-scope` (`ut_search_wikipedia_008`) — "write a Python CSV
    parser" → **no skill fires**; decline, don't coerce into a Wikipedia lookup.
    Protected by the `## Scope guard` section.
  - `negative-historical-context-boundary` (`ut_search_wikipedia_007`) —
    migration patterns → route to **historical-context**, don't fire.
    Protected by the description's "Do NOT use when…" clause.
- **Key test files:** `simple-topic-lookup`, `general-topic-us-census`,
  `historical-event-great-famine`, `person-lookup-einstein`,
  `single-word-kirchenbuch`, `title-with-numbers-naturalization`,
  `slug-normalization-obrien`, `negative-out-of-scope`,
  `negative-historical-context-boundary`.

## CUT — safe to remove
**Near-empty by design — do not manufacture cuts.**
- **[lines 52–64] "Re-invocation behavior"** — the only genuinely optional
  block. It's boilerplate the judge doesn't grade (overwrite-in-place is the
  natural default). Removing it saves ~13 lines and gets the file to ~52.
  **Caveat:** this skill is the model others copy; if the teams decide a kept
  `Re-invocation` block should look a certain way, this is the cleanest
  exemplar of it. Treat removal as optional, not required — and if removed
  here, remove it from search-familysearch-wiki too so the exemplar and its
  cousin stay consistent.

That's the entire CUT list. Everything below is KEEP.

## KEEP — load-bearing judgment (do NOT cut)
- **`## Scope guard` (lines 11–19)** — protects `negative-out-of-scope`
  (decline non-genealogy requests; don't coerce into a Wikipedia lookup). A
  named, passing negative test fails loudly if this is cut.
- **Verbatim-copy rule (lines 28–31)** — "Use the exact values… Do not
  paraphrase, summarize, truncate, or editorialize the extract. Copy it
  verbatim." Protects rubric dim 1 (*Template fidelity* — no fabrication).
- **"You must actually write the file" (lines 35–36) + brief-confirmation rule
  (47–50)** — protect `test_wrote_one_markdown_file` and rubric dim 1's
  "brief confirmation, don't restate article content."
- **Slug rule + the three worked examples (lines 37–46)** — directly protect
  the four `test_slug_*` regression validators. The examples are *the
  specification* the validators assert against; they stay.
- **Template pointer (lines 29–30, `templates/wiki-summary.md`)** — the
  indirection that keeps this skill from inlining structure. The pattern other
  skills should imitate.
- **`description:` frontmatter** — carries the activation + "Do NOT use when…"
  exclusions that the two routing negatives grade. Untouchable.

## TIGHTEN — keep the point, cut the words
Essentially nothing. The file already states each rule once. Resist any
"helpful" expansion: adding a second example, a Sources-format block, or a
read-back-and-verify step would push it toward the 142-line
search-familysearch-wiki shape this cycle is trying to *undo*.

## Suggested target structure (~52–65 lines)
Keep the current structure verbatim; it is the template:
1. Frontmatter (description does the routing work).
2. `## Scope guard` (one paragraph).
3. `## What to do` (6 numbered steps: call tool → template → verbatim fill →
   write with slug rule + examples → brief confirmation).
4. `## Re-invocation behavior` — keep, or drop for ~52 lines (optional; keep it
   in sync with search-familysearch-wiki either way).

## Verify
```
cd eval/harness && uv run python run_tests.py --skill search-wikipedia
```
Watch: all four `test_slug_*` regressions green; `test_only_wikipedia_search_called`
and `test_wikipedia_search_called_exactly_once` green; the out-of-scope and
historical-context negatives still decline/route; both rubric dims pass. If you
edit the file at all (even to drop the boilerplate block), the snapshot model
forces a re-run — that's expected.

## Owner notes
Pure **developer** territory — no genealogy judgment at stake. The job here is
**preservation, not reduction**: this brief's primary purpose is to certify the
shape and tell the teams to use it as the north star. The one allowable edit
(drop `Re-invocation behavior`) is optional and low-value; do not chase a
brittle minimum on the reference skill — a lean, *legible* exemplar is worth
more than the last 13 lines.
