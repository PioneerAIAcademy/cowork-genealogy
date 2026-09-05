# search-wikipedia — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/search-wikipedia/SKILL.md` and
`templates/wiki-summary.md` as this PR leaves them (branched from `main` at
`fde53f1b`; step 4 gains the transliteration clause here, see rule 15). Every line
below is checkable by eye against a run-log transcript (`output.text_response`,
`output.tool_calls`, `output.files_created`) or against the workspace snapshot the
validators receive (`after_state["files"]`, which holds the saved file's **full
text** — written by `snapshot_files` in `workspace.py`).

Judgement calls ("was this the best article", "is the extract a good summary")
are deliberately excluded — they belong to the judge, per the guide.

This is a small skill: one tool call, one file, one sentence. That is why the list
is 19 lines rather than 40, and why almost every line converts to a validator.

**Save this file. The next auditor of `search-wikipedia` starts here instead of
rebuilding it.**

---

## A. Scope guard (the block before any tool call)

1. Request unrelated to research (programming, math, anything off-topic) →
   decline, explain it is outside the toolkit's scope, and **do not call
   `wikipedia_search`, do not start the workflow**.
2. Narrative genealogical history — **migration patterns**, settlement, chain
   migration, **boundary changes**, or "how did X work" synthesis → decline and
   name **historical-context**.
3. A locality records-availability guide (what records exist for a place, where
   they are held) → decline and name **locality-guide**.
4. The FamilySearch Research Wiki, or "FamilySearch wiki" → decline and name
   **search-familysearch-wiki**.
5. On any decline in 1–4: **zero `wikipedia_search` calls and zero new `.md`
   files.** The body is explicit — "do not call `wikipedia_search`, do not start
   the workflow below". A decline's run has no tool call and no file.
6. Proceed **only** when the user wants general-encyclopedia background on a
   specific topic, person, place, or historical event.

## B. The tool call

7. Exactly one `wikipedia_search` call per invocation. The body says "Call the
   `wikipedia_search` MCP tool with the topic as the `query` parameter" — one
   step, once. No refinement loop, no second lookup.
8. `wikipedia_search` is the only MCP tool this skill may call
   (`allowed-tools:` lists it alone).

## C. The saved file — content

9. The file is the filled `templates/wiki-summary.md`: `# {{title}}`, blank line,
   `{{extract}}`, blank line, `---`, `[Source]({{url}})`. Nothing else.
10. `{{title}}`, `{{extract}}` and `{{url}}` are **the exact values from the tool
    response** — "Do not paraphrase, summarize, truncate, or editorialize the
    extract. **Copy it verbatim.**" A single reworded clause violates this.
11. Unicode and punctuation in the extract survive byte-for-byte — `Kirchenbücher`,
    em dashes, curly quotes, `An Drochshaol`. Verbatim means verbatim.
12. No URL appears in the file that is not the `url` the tool returned. No
    fabricated facts, no added context, no "see also".

## D. The saved file — name and count

13. Exactly one new `.md` file per invocation. Zero means the save step was
    skipped; more than one is noise.
14. The filename is `<title-slug>.md`, and the slug is built **from the article
    title the tool returned** — not from the user's query, and not from the
    user's phrasing. The body says "Build `<title-slug>` from the article title".
15. Slug rule: replace each accented or non-English letter with its ASCII
    equivalent (`ü`→`u`, `ß`→`ss`, `ł`→`l`) — **never** with a hyphen; lowercase
    the title; replace every run of non-alphanumeric characters with a single
    hyphen; trim leading/trailing hyphens. Numbers pass through unchanged.
    Worked examples in the body:
    `"Albert Einstein"` → `albert-einstein`;
    `"Schuylkill County, Pennsylvania"` → `schuylkill-county-pennsylvania`;
    `"O'Brien (surname)"` → `o-brien-surname`;
    `"Württemberg"` → `wurttemberg`; `"Preußen"` → `preussen`.
    (The transliteration clause was added by the #1662 dive — before it, an
    accented title had no defined slug at all. Earlier run logs predate it.)
16. The file lands in the user's **current working folder** — not a subfolder,
    not `results/`.
17. The file is actually written. "**You must actually write the file — do not
    just describe it in your response.**"

## E. The reply

18. **One sentence only**, naming the file — e.g. "Saved the Wikipedia summary to
    `schuylkill-county-pennsylvania.md`." No mid-workflow narration ("Now I'll
    write the filled template…"), and no restating, summarizing or paraphrasing
    of the article content. The article content goes in the file, not the chat.

    The no-narration half of this rule is now **explicit in the body**, in two
    places rather than inferred from "One sentence only": a standalone line at
    the top of `## What to do` ("Do not announce a step before doing it") and a
    clause in step 5 ("it is the only thing you say in this invocation — no
    preamble before the search, the fill, or the write"). It sits in both
    because every observed violation is a `Now I'll …` preamble emitted while
    executing steps 3–4, i.e. before the model reaches step 5.

    `test_reply_does_not_narrate_pending_step`
    (`eval/harness/validators/test_search_wikipedia.py`) is the instrument for
    this rule; the `Reply economy` rubric dimension grades it as well, not
    instead. The validator concatenates every assistant text block, so a
    mid-workflow preamble fails it even when the closing sentence is clean.

## F. State

19. This skill writes no project state. No `research.json` write, no
    `tree.gedcomx.json` write, no `results/` sidecar. Safe to re-invoke.
