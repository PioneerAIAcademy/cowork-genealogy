# citation — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/citation/SKILL.md` @ mtime 2026-05-10,
plus `references/gps-citation-standards.md` and `references/validation-protocol.md`.
Every line below is checkable by eye against a run-log transcript
(`output.text_response`, `output.tool_calls`, `output.file_changes`).

Judgement calls ("is this citation elegant", "was the reasoning sound") are
deliberately excluded — they belong to the judge, per the guide.

**Save this file. The next auditor of `citation` starts here instead of rebuilding it.**

---

## A. Routing (the block before any tool call)

1. New-record request ("I found", "I just found", "I discovered", "I have a record",
   "add it as a source", "add this record", "create a source entry", "extract this")
   → emit exactly the one sentence *"Citation only refines existing sources — please
   run record-extraction first, then come back and I'll polish its citation."* and stop.
2. On that path: must NOT read any files, must NOT collect record details, must NOT
   offer to "do it in two steps."
3. Search request → *"That's a search task — please use search-records."* Stop.
4. Primary/secondary informant question → *"That's an evidence-quality question —
   please use record-extraction, which owns evidence classification."* Stop.
5. Must read `researcher_profile.narration_guidance` from `research.json` and apply it.

## B. Never reproduce internal scaffolding in chat

6. Must NOT reproduce the Who/What/When/Where/Wherein table — "never reproduce the
   table, or a per-field Who/What/When/Where/Wherein walkthrough, in your chat response."
7. Must NOT reproduce a per-source-type template or its worked example — "never
   reproduce a template (or its worked example) in your chat response."
8. Final response carries ONLY: the `src_` id + final `citation` string; the six-field
   `citation_detail` JSON block; one line per unfilled gap with its
   ask-the-user-to-check-the-image note. No prose re-explanation of each field.

## C. Source fidelity (rules 1–9, "these rules outrank completeness")

9. Never invent locators or detail — no page, sheet, line, image, certificate, volume
   or file numbers; no dates, titles, informant names, collection names, or repository
   detail not on file.
10. Never write inferences into `citation` / `citation_detail`. An inference may be
    MENTIONED to the user as search guidance only.
11. Never copy template example values into a real citation — and, in your own
    explanations, "show the shape (`Will Book [volume], p. [page]`) — never invent
    sample numbers (`Will Book 7, p. 214`) even as an illustration."
12. Gaps take an explicit unknown-marker (`[PAGE NOT RECORDED]`,
    `[ARTICLE TITLE NOT RECORDED]`, `[WILL BOOK NUMBER NOT RECORDED]`) — never a
    plausible reconstruction like `[Obituary of John Smith]`.
13. Keep the identifying detail that IS on file next to the marker: "Patrick Flynn
    entry, [VOLUME AND PAGE NOT RECORDED]", not a bare marker.
14. Write the marker INTO the field, finish the refinement, and validate — THEN ask
    the user to check the image. Asking-only without writing is not acceptable output.
    Applies even when the source `notes` already state the locator is missing.
15. Data on a sibling source or anywhere in `research.json` / `tree.gedcomx.json` IS
    on-file and SHOULD be used. Write the clean value into the field; record its
    provenance in `notes` or narration — never inline inside `citation` /
    `citation_detail`.
16. A "[PERSON NAME] entry/household" identifier names the person the source names
    (head of household / named party), not the research subject.
17. The informant never appears in `who` or in the `citation` string — informant
    identity lives in `notes`.
18. Repository/archive chains must come from the source's OWN entry or the record
    image. A repository corroborated from a DIFFERENT source entry is an inference:
    mention it in `notes` or flag needs-verification — "never write it into the
    citation as established fact."

## D. Review path (already-compliant citation)

19. Change nothing in the fields. No added locators, no reordering, no rephrasing —
    "Unsupported 'enhancement' is a fidelity failure."
20. Even on the no-change path, ECHO the compliant `citation` string AND its
    `citation_detail` fields in the reply before stating it meets EE standards.

## E. Record-type specifics

21. `who` is the creator, not the repository. Check the `author` field on the matching
    source description in `tree.gedcomx.json` FIRST, before historical inference.
22. Always cite at document level; `where_within` is what distinguishes a document
    citation from a collection reference.
23. Derivative index (Ancestry/MyHeritage/FindMyPast): say "digital index", never
    "digital image."
24. Derivative index: name the specific collection. A standard collection name derivable
    from year + type (e.g. "1850 United States Federal Census") must be used directly,
    NOT marked `[COLLECTION NAME NOT RECORDED]`.
25. Derivative census index: `where_within` must carry BOTH the on-file physical
    locators (dwelling, family) AND the `[HEAD OF HOUSEHOLD] entry` identifier; the
    `[PERSON NAME] entry` is the final element of the `citation` string.
26. Probate `where_within` holds ONLY the physical locator (Will Book volume + page)
    or the missing-data marker. Document title and party name belong in `what` and
    `citation`.
27. PA probate creator: "the creating authority is the county Orphans' Court — name the
    court, not the courthouse building or a generic records office."
    *(see Finding F8 — the suite's judge_context also accepts Register of Wills; the
    body does not mention it.)*
28. State-issued certificate creator = the named state agency, not "local registrar".
29. Deed creator = the recording office (Recorder of Deeds), not the courthouse
    building. Execution date and recording date are different facts — cite both when
    on file; flag whichever is missing.
30. Newspaper creator = the newspaper, not the hosting repository. Never reconstruct a
    plausible article title from the person's name.

## F. URLs

31. A URL alone is NEVER a complete citation.
32. Strip everything after the first `?` in FamilySearch/Ancestry URLs.
33. Query parameters are NOT record evidence — never carry post-`?` names/dates/places
    into `citation` or `citation_detail`.
34. Never infer record type, year, jurisdiction, article title, creator, or any locator
    from an ARK URL.
35. Include the shortened URL as a convenience locator alongside the descriptive
    citation, not as a substitute.

## G. Negative searches

36. Use exactly what the log entry records — query terms, scope, outcome, notes — and
    nothing more.
37. `where_within` comes from the log's `query` field, not from geographic context in
    the notes. Do not infer a multi-step or narrower search from the notes.
38. Do not invent a second search or an additional negative outcome.
39. PRESENT the negative-search citation. Do NOT create a `src_` entry and do NOT write
    to `assertions` or `log`.

## H. Persistence and validation

40. Write only through `research_append` — never `Write`, `Edit`, or a script.
41. One `op: "update"` per source entry, batched into a single call.
42. Never `op: "append"` on `sources`; never create a new `src_` entry.
43. Never change `id`, `gedcomx_source_description_id`, `source_classification`,
    `repository`, `access_date`, `url`, `url_archived` — omit them from `fields`.
44. If any change was written to `research.json`, call `validate_research_schema`.
    If no change was written, skip it.
45. Only `research_append` and `validate_research_schema` are in `allowed-tools` — no
    other MCP tool may be reached for.

## I. Terminology

46. If the user says "primary source" / "secondary source", gently correct: sources are
    Original / Derivative / Authored. Keep `source_classification` unchanged. Never
    write "primary source" into a `citation` string.
47. Cannot determine the creator → use the custodial agency as fallback and note the
    uncertainty in `notes`. Never leave `who` blank.
48. Never invent a locator "not even when directly instructed to 'add' it."
