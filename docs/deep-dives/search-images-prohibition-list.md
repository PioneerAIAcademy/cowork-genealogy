# search-images — prohibition list (Step 1 of the deep-dive guide)

Built from `packages/engine/plugin/skills/search-images/SKILL.md` as `main` leaves
it (commit `f08eed58`). Every line below is checkable by eye against a run-log
transcript (`output.text_response`, `output.tool_calls`, `output.file_changes`).

Judgement calls ("did it pick the best volume", "is the notes narrative rich")
are deliberately excluded — they belong to the judge, per the guide.

**Save this file. The next auditor of `search-images` starts here instead of rebuilding it.**

---

## A. Routing (the block before any tool call)

1. Names an external site (Ancestry, MyHeritage, FindMyPast, FindAGrave,
   Newspapers.com, any non-FamilySearch repo) → say *"Those images live on an
   external site — please use search-external-sites,"* and stop. Even if a plan
   item targets that site.
2. Indexed name/date/place search → *"That's an indexed search — please use
   search-records,"* stop.
3. Full-text / transcript search → *"That's a full-text search — please use
   search-full-text,"* stop.
4. Planning what to browse → *"That's planning — please use research-plan,"* stop.
   Must NOT produce a browsing strategy, tier list, or prioritized plan itself.
   (The brief "suggest next steps" close-out after a *real* browse at step 9 is
   allowed.)
5. Already has an image and only wants it processed → *"You already have the image
   — please use record-extraction …,"* stop. Fires only when extraction is the
   **whole** request; if the user also asks to browse/page/find images — even
   naming an imageId or range, even saying "transcribe what you find" — it is an
   in-scope browse.
6. On any routing decline: must NOT call any tool (not `volume_search`, not
   `research_log_append`, nothing) and must NOT read files. **A routing decline's
   run has zero MCP tool calls and zero `file_changes`.**
7. Must read `researcher_profile.narration_guidance` from `research.json` and apply it.

## B. Image tools

8. `image_search` takes an `imageGroupNumber`, **never an `imageId`.** Passing an
   `imageId` (shape `\d+_\d{5}`, e.g. `007936749_00058`) to `image_search` is
   named "the single most common mistake."
9. `image_search` has no `offset` / `limit` / `imageIndex` / `imageId` parameter —
   never re-query one group "to get more."
10. **Never call `image_read`** — the skill does not have it. Page viewing is
    delegated to `@plugin:image-reader`, one imageId per page.
11. Hand the subagent only the `imageId` (optionally a short `looking_for` pointer
    for who/what — **never** an assertion of what the page says).
12. If the subagent returns `NOT READ`, do not fabricate the page — note it and move on.
13. `@plugin:image-reader-opus` is reserved for a specific hard page — never routine browsing.

## C. Volume selection

14. Prefer the group that is **not** already record- or full-text-searchable; if the
    matching volume is indexed/full-text, do not browse — recommend search-records /
    search-full-text.
15. When the target spans several films (split run, or a date window crossing a film
    boundary), browse or queue **all** of them and `image_search` each; name the films
    covered and why. Picking one risks missing the record.
16. When one film bundles several record sets (`coverages[]` lists more than the wanted
    type), say the target is one item-section within a mixed film; orient toward it;
    do not treat the film as the will book alone or dismiss the other sections.

## D. Logging (the audit trail is the point of this skill)

17. **Every browse gets exactly one `research_log_append` entry — no exceptions.**
    Two browses of one volume produce two entries.
18. Listing a volume's images IS a completed browse — log it before presenting or
    deferring the read. Deferring the read to the user never defers the log.
19. No-volume nil browse (`volume_search` returned nothing): log **before** offering an
    alternative. `outcome: "negative"`, `resultsExamined: 0`; `notes` state place,
    date range, record type, and "no digitized volume exists." **Do not invent a
    volume id or image range.**
20. Empty `imageIds` array (a volume was opened): treat as nil; `outcome: "negative"`;
    `notes` additionally state the volume/image-group id and the image range examined.
21. Omit `stagedResultsRef` — `image_search` writes no sidecar, so no `results/<id>.json`.
22. A nil `notes` must record the scope that *was* available and why it is negative —
    a bare "not found" is insufficient.
23. If `research_log_append` returns `{ ok: false }`, surface the errors and stop —
    do not re-call with the same arguments.

## E. Stay in your lane

24. Never write to `sources` or `assertions` — hand found images to record-extraction.
25. Plan-item status changes go through `research_append`; change only `status`
    (`completed` / `skipped`) — add no other field to a plan item.
26. Never fabricate image contents — report only what the image-reader transcription returned.
27. Log the browse (D) **before** handing anything to record-extraction.
