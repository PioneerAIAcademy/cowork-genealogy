# Shorten: search-familysearch-wiki

**Bucket:** A (dead-mechanics removal)
**Primary owner:** developer (read-only search wrapper; the one genealogy-craft
line — "no facts beyond chunk_text" — gets a genealogist sign-off)
**Current size:** 142 lines → **Target:** ~70–75 lines (~50% reduction)
**Tool migration:** n/a — this skill was always a read-only search wrapper
(calls `wiki_search`); it never wrote `research.json`/`tree.gedcomx.json`, so
there are no "dead mechanics a new tool now owns." The redundancy here is
**self-narration of the file-writing dance and a duplicated inline template.**
**Still needed as a skill?** **Yes.** It carries four passing negative/routing
tests (Wikipedia, locality-guide, historical-context ×2) and the
"don't answer from training knowledge" rule that the *Summary faithful* rubric
dim grades. A bare tool call gives you neither.

## TL;DR
This file is the 142-line cousin of the 65-line `search-wikipedia` — same shape
(call one read-only tool, fill a markdown template, save), but it carries ~70
lines of extra prose: a step-by-step narration of the write/edit/read-back
dance, the summary structure inlined twice (steps 4–5 *and* the full Example),
and a `Re-invocation behavior` boilerplate block. The skill already **has** a
`templates/wiki-search-summary.md` it never references — point at it the way
`search-wikipedia` points at its template, then delete the inline copies. Keep
exactly two pieces of judgment: the "search first, never answer from training
knowledge / every sentence traceable to `chunk_text`" faithfulness rule, and
the empty-results stop-and-don't-save rule.

## Why this skill is shortenable
The triage calls it "A(light) — already lean-ish; trim to the search-wikipedia
pattern." The bulk is not load-bearing:
- **It narrates mechanics the model does anyway.** Step 6 ("Read the file back.
  Confirm it ends with a `## Sources` section… If not, Edit to append it now"),
  and the two-phase "write summary, then Edit-append Sources" split, are
  process choreography. The *rubric* even tells the judge it cannot see file
  contents and will pass on a mention of appending sources — so the elaborate
  read-back-and-verify loop buys no graded credit.
- **It inlines the template twice** (the fenced block in step 4–5 and again in
  the Example) while a real `templates/wiki-search-summary.md` sits unused.
  `search-wikipedia` solves this in one line: "Read the template at
  `templates/wiki-summary.md` … fill it in." This file should do the same.
- **The same faithfulness rule is stated 4–5 times** (step "Always search
  first," the "Paraphrase only what chunk_text states" bullet, "Do not upgrade
  or strengthen," "Do not combine separate facts," the Example). State it once.
- **`Re-invocation behavior` (lines 130–142)** is boilerplate the judge never
  grades — same block `search-wikipedia` carries and is itself a CUT candidate.

## The floor: what the unit tests actually grade
- **Deterministic validators:** there is **no** `test_search_familysearch_wiki.py`
  — this skill rides only the **universal** validators
  (`eval/harness/validators/test_universal.py`). The load-bearing one is
  `test_ownership_table` / `test_tree_ownership_table`: search-familysearch-wiki
  is **absent from the ownership tables → read-only**, so any write to
  `research.json`/`tree.gedcomx.json` fails. (Nothing in SKILL.md tells it to
  write those, so this is satisfied by silence — don't add prose that implies
  otherwise.) No allowlist-count validator exists for this skill (unlike
  search-wikipedia's "exactly one call"), so the call-count discipline is
  graded only softly by base **Tool Arguments**.
- **Rubric dims** (`eval/tests/unit/search-familysearch-wiki/rubric.md`):
  1. *File saved correctly* — slug-normalized `.md` filename.
  2. *Sources cited correctly* — a `## Sources` bullet per result, real URLs;
     **grading note:** judge can't see file contents, passes on a *mention* of
     appending sources or a visible Edit call.
  3. *Summary faithful to wiki content* — every claim traceable to a
     `chunk_text`; no fabricated dates/repositories/guidance. **This is the one
     genealogy-craft dim and the reason the faithfulness rule stays.**
  4. *No-result handling (negative path)* — empty results → tell the user, write
     no file.
- **Base dims:** Correctness, Completeness, Tool Arguments.
- **Negative/boundary tests (4, all routing):**
  - `negative-wikipedia` (`ut_search_wiki_004`) → must route to
    **search-wikipedia**, not call `wiki_search` on a near query.
  - `negative-locality-guide` (`ut_search_wiki_005`) → must route to
    **locality-guide** ("what records exist and where held").
  - `historical-routing` (`ut_search_wiki_015`) → migration patterns → must
    **not** call `wiki_search`; route to **historical-context**.
  - These map to the description's "Do NOT use when…" clause + the body's
    "for general-encyclopedia topics use search-wikipedia."
- **Key test files:** `find-italian-birth-records` (happy path),
  `empty-results` (no-result negative path), `census/church/death/land/
  marriage/military/probate/immigration-records` + `german-ancestors` /
  `irish-immigration` (how-to happy paths), `negative-wikipedia`,
  `negative-locality-guide`, `historical-routing`.

## CUT — safe to remove
- **[lines 130–142] "Re-invocation behavior"** — boilerplate ("Writes: …",
  "On repeat invocation: overwrites…", "Do not duplicate…"). Graded by nothing;
  the overwrite-in-place behavior is the natural default. Highest-value CUT.
- **[lines 111–128] "## Example"** — a full second copy of the summary +
  Sources structure plus a worked Italian-birth-records walkthrough. Once the
  body points at the template and states the slug rule, the Example is pure
  duplication. (If the teams want one anchor, keep a *single* one-line
  input→filename example, not the 18-line block.)
- **[lines 54–60 + 96–100] the two inlined fenced markdown blocks** — the
  `# FamilySearch Wiki: <topic>` summary block and the `## Sources` block.
  Replace both with "Read and fill `templates/wiki-search-summary.md`" — the
  template already encodes exactly this structure (incl. the citation-format
  comment). This is the single biggest structural win and the move that makes
  it match `search-wikipedia`.
- **[line 106 "Read the file back…"]** — the read-back-and-verify loop. The
  rubric explicitly does not require it (passes on a *mention* of appending
  sources). Keep "append the Sources section," drop the verify dance.

## KEEP — load-bearing judgment (do NOT cut)
- **"Always search first / never answer from training knowledge / every
  sentence traceable to `chunk_text`"** — protects rubric dim 3 (*Summary
  faithful*) and base Correctness. This is the skill's one piece of real
  genealogy craft. Compress its 4–5 restatements into **one** crisp rule, but
  do not lose it.
- **Empty-results → tell the user, save no file** — protects rubric dim 4
  (*No-result handling*), exercised directly by `empty-results.json`. One line.
- **Routing boundaries** (description's "Do NOT use when…" + one body line:
  "general-encyclopedia topics → search-wikipedia; records-availability survey
  → locality-guide; narrative history/migration → historical-context") —
  protects the four negative tests. The `description:` frontmatter already
  carries the activation/exclusion language those tests grade; the body needs
  only a one-line echo, not a paragraph.
- **Sources section = one bullet per result, real URLs, exact
  `page_title`/`section_heading`/`source_url`** — protects rubric dim 2. Keep
  as one bullet; drop "do not omit any / do not paraphrase or abbreviate" prose
  padding.
- **Slug rule** (lowercase + hyphens) — protects rubric dim 1.

## TIGHTEN — keep the point, cut the words
- Collapse lines 37–41 + the bullets at 64–79 into one faithfulness sentence:
  *"Synthesize the summary only from the returned `chunk_text` — every sentence
  must trace to a specific chunk; don't add dates, repositories, or tips that
  aren't verbatim in the chunks, and don't strengthen the source's wording."*
- Collapse the "Plain prose only — no tables/lists/sub-headers/emojis/URLs/
  invented nav paths" sub-bullets (80–88) to a single line: *"Plain prose
  paragraphs only; no lists, sub-headers, or URLs in the body (URLs go in
  Sources)."* The forbidden-format list is the kind of detail the model honors
  from one mention.
- Replace the step-4/5 inline blocks with one line each pointing at the
  template and naming the slug rule.

## Suggested target structure (~70–75 lines)
1. Frontmatter — **unchanged** (the `description:` does the routing work the
   negative tests grade; don't touch it).
2. Narration line (unchanged).
3. 2-sentence purpose (FS Wiki = genealogy *methods*; for encyclopedia topics
   use search-wikipedia).
4. "What to do":
   - Search first; never answer from training knowledge.
   - Call `wiki_search` with the user's question as `query`.
   - Empty results → tell the user, write no file, stop.
   - Read+fill `templates/wiki-search-summary.md`; summary faithful to
     `chunk_text` only (the one tightened rule); one Sources bullet per result
     with real URLs; save as `<topic-slug>.md` (slug rule, one line).
   - Tell the user the filename. Keep it brief.
5. One-line routing boundary (search-wikipedia / locality-guide /
   historical-context).
6. (Optional) one one-line example. No `Re-invocation behavior` block.

## Verify
```
cd eval/harness && uv run python run_tests.py --skill search-familysearch-wiki
```
Watch: all four rubric dims + base dims pass on the how-to happy paths;
`empty-results` still writes no file; the three routing negatives still route
(don't call `wiki_search`). Confirm the universal ownership validators stay
green (they will, as long as nothing implies a `research.json`/tree write).
Re-run is forced anyway because editing the SKILL.md flips prior run logs
inactive (snapshot model).

## Owner notes
Mostly a **developer** cut — deleting choreography, boilerplate, and a
duplicated inline template in favor of the real `templates/` file, exactly the
`search-wikipedia` shape. The one line needing **genealogist** sign-off is the
compressed faithfulness rule (rubric dim 3): confirm the single tightened
sentence still forbids fact-fabrication and source-strengthening before
deleting the four restatements. Note the unreferenced
`templates/wiki-search-summary.md` already exists — this brief *adopts* it
rather than adding a file, so no new artifact is created.
