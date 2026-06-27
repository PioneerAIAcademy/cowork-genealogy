---
name: search-images
model: claude-sonnet-4-6
description: Invoke for browsing FamilySearch digitized image volumes
  page-by-page — immediately when the user says "browse the images", "browse
  a volume", "page through", "look through the film/roll", "go through the
  unindexed records", or gives an image group number. Use this skill when a
  record set is digitized but NOT indexed and NOT full-text searchable, so the
  only way in is to open the volume and read images one at a time.
  volume_search finds which image groups cover a place and date range,
  image_search lists the image IDs inside one group, and image_read views a
  page. FamilySearch digitized images only. Exclude indexed name/date/place
  search (use search-records), full-text transcript search (use
  search-full-text), external repositories like Ancestry (use
  search-external-sites), planning what to browse (use research-plan), and
  extracting facts from an image you have already found (use record-extraction).
allowed-tools:
  - volume_search
  - image_search
  - image_read
  - research_log_append
  - research_append
---

# Search Images

## ROUTING — do this FIRST, before anything else

Before reading `research.json`, before reading narration guidance, before any
tool call: read the user's message and check the cases below. If one matches,
say the single-sentence redirect and **return immediately** — do NOT read any
files, do NOT call any tool (not `volume_search`, not `research_log_append`,
nothing), do NOT look for a matching plan item to execute. Just redirect and stop.

- **Names an external site** (Ancestry, MyHeritage, FindMyPast, FindAGrave,
  Newspapers.com, or any non-FamilySearch repository): say "Those images live
  on an external site — please use search-external-sites," and stop. This skill
  covers FamilySearch images only. Browsing or logging an external-site search
  is search-external-sites' job — even if a plan item targets that site, you do
  not execute it here.
- **Indexed name/date/place search** ("search the census index for…"): say
  "That's an indexed search — please use search-records," and stop.
- **Full-text / transcript search** ("find X mentioned as a witness…"): say
  "That's a full-text search — please use search-full-text," and stop.
- **Planning what to browse** ("which volumes/records should I browse next?",
  "help me plan"): say "That's planning — please use research-plan," and stop.
  Deciding what to browse is planning, not browsing — do not start pulling
  volume or collection data to answer it, and do not produce the browsing
  strategy, tier list, or prioritized research plan yourself; that is
  research-plan's job. (This bars *authoring a plan in place of a browse*; it
  does not bar the brief "suggest next steps" close-out after a real browse in
  step 9.)
- **Already has an image and only wants it processed** ("I found X on image
  007936749_00058 — add it as a source / extract the assertions / pull out the
  facts"): say "You already have the image — please use record-extraction to add
  it as a source and pull out the facts," and stop. The user is past browsing; do
  NOT call `image_read`, do NOT hunt for the page, do NOT look for workarounds if
  a tool seems unavailable. Extraction is record-extraction's job — hand it off
  and stop. **Scope check:** this fires only when extraction is the *whole*
  request. If the user also asks to browse, page through, or find images — even
  while naming an image ID or a range, and even if they say "transcribe what you
  find" — that is an in-scope browse: proceed to the steps below, and hand any
  found image to record-extraction at step 8. The word "transcribe" alone does
  not route away; "I already have this one image, just extract it" does.

Otherwise (browse a specific FamilySearch digitized volume image-by-image) →
proceed to the steps below.

---

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Browses FamilySearch's digitized document images when a record set has no
usable index. Many collections are scanned but never indexed and never
full-text transcribed — the only way to find a record is to open the
volume and page through the images. This skill is the image-browse
counterpart to search-records (indexed search) and search-full-text
(transcript search).

## When image browsing is the right tool

Browse images when the target volume is **digitized but not searchable**:
`volume_search` reports `recordSearchablePercent: 0` (or very low) and
`fulltextSearchable: false`. If the collection is indexed, use
search-records; if it is full-text transcribed, use search-full-text. Both
are faster than reading pages one by one — browse only when neither covers
the record.

## MCP tools

This skill chains three search tools plus the research-log writer:

| MCP tool | Purpose |
|----------|---------|
| `volume_search` | Find digitized volumes (image groups) covering a `standardPlace` and year range; returns coverage metadata (`imageGroupNumber`, `imageCount`, `recordSearchablePercent`, `fulltextSearchable`) |
| `image_search` | List every image ID inside ONE image group, given its `imageGroupNumber` |
| `image_read` | View a single image, given an `imageId` from `image_search` |

`image_search` returns image IDs only — there are no in-volume filters yet,
so it lists the **whole** volume and you page through it with `image_read`.

**The two image tools take DIFFERENT inputs — do not confuse them:**

| Tool | The ONE argument it takes | Example |
|------|---------------------------|---------|
| `image_search` | `imageGroupNumber` (a volume id) | `image_search({ imageGroupNumber: "007936749" })` |
| `image_read` | `imageId` (one image from the list) | `image_read({ imageId: "007936749_00058" })` |

- An **`imageId`** (e.g. `007936749_00058`) goes ONLY to `image_read`. Never
  call `image_search({ imageId })` — that is the single most common mistake;
  to view a page you want `image_read`.
- `image_search` returns the entire volume in one call. It has **no**
  `offset`, `limit`, `imageIndex`, or `imageId` parameter — never re-call it
  with paging or index arguments to "get more."
- If `image_read` returns no viewable content, note that and move on to log
  the browse — do **not** loop trying alternate parameters.

## Steps

### 1. Identify the browse target

Read `research.json` `plans[]` for the next `status: "planned"` item that
targets an unindexed/browse-only collection, or take the user's ad-hoc
request. Note the place and date range that scope the search.

### 2. Find the volume with `volume_search`

Call `volume_search({ standardPlace, ... })` to discover which image groups
cover the place and period. Pick the group whose coverage (place, date
range, record type) matches the target, preferring the one that is
**not** already record- or full-text-searchable (browsing a searchable
volume wastes effort — route those to search-records / search-full-text).

```
volume_search({ standardPlace: "Schuylkill, Pennsylvania, United States" })
```

If `volume_search` returns no volumes, that is a normal, expected result —
the record set is simply not digitized for that place and period. It is **not**
a sign the tool is broken or unauthenticated: an empty volume list is data, not
an error. This is a completed nil browse: you searched and found nothing, which
is itself a GPS-relevant event.

**Log it before you do anything else.** The reflex here is to skip straight to
"want me to try search-records / search-external-sites instead?" — but a nil
browse that suggests an alternative *without logging* leaves no audit trail and
is the most common way this skill fails. So, in order: (1) call
`research_log_append` to record the negative browse (step 6 — `outcome:
"negative"`, place/date/record type searched, "no digitized volume exists"),
**then** (2) suggest an alternative repository. Do not offer the alternative
until the log entry is written, and never ask the user to troubleshoot the tools
just because the list came back empty.

### 3. List the images with `image_search`

Pass the chosen group's `imageGroupNumber` (a split natural-group name like
`007621224_005_M99P-2TQ` or a bare number like `007936749`) to
`image_search`:

```
image_search({ imageGroupNumber: "007936749" })
// → { imageIds: ["007936749_00001", "007936749_00002", ...] }
```

An empty `imageIds` array means the group has no images yet — treat it as a
nil result (step 6). A large volume returns hundreds of IDs; do not dump the
full list to the user.

### 4. Browse with `image_read`

Pass an `imageId` to `image_read` to view a page. Browsing is manual: open a
likely page, read it, and step forward or back through the sequence (the
trailing 5-digit number is page order). For an indexed-but-image-only volume
with a register or table of contents, read that first to jump to the right
range instead of reading every page.

### 5. Triage what you find

For each page examined, judge whether the target record appears and whether
the place and approximate date are consistent. Present the promising images
to the user with the image ID and what each shows; let the user confirm
which to examine in detail. Never fabricate the contents of an image you did
not read.

### 6. Log the browse

**Every browse gets a log entry — no exceptions.** Call
`research_log_append` once per browse. The tool assigns the log id and
`performed` timestamp and validates-before-persist; you supply the judgment.
`image_search` does not stage results, so **omit `stagedResultsRef`** (no
sidecar is written, exactly like a nil full-text search):

```
research_log_append({
  projectPath,
  planItemId: "pli_012",          // null for an ad-hoc browse
  tool: "image_search",
  query: {
    imageGroupNumber: "007936749",
    standardPlace: "Schuylkill, Pennsylvania, United States",
    recordType: "Probate Records",
    imagesExamined: "00040-00075"
  },
  outcome: "positive",            // positive / negative / partial / error
  resultsExamined: 36,
  resultsAvailable: 412,          // imageCount for the volume, or null
  notes: "Browsed Schuylkill probate image group 007936749 (412 images, not indexed); read images 40–75; found Thomas Flynn's will on image 00058."
})
```

For a **nil** browse (no volume, empty group, or target not found), set
`outcome: "negative"` and `resultsExamined: 0`. The `notes` field on a
negative entry must record the scope that *was* available so a future
exhaustive-search audit can read it without re-deriving it, and why the search
is being declared negative — a bare "not found" is insufficient. Which scope
fields apply depends on how far the browse got:
- **No volume found** (`volume_search` returned nothing): state the place, date
  range, and record type searched, and that no digitized volume exists for them.
  There is no volume id or image range to cite — do **not** invent one.
- **Empty group or target not found** (a volume was opened): also state the
  volume/image-group id and the image range examined.

**Recovery.** If `research_log_append` returns `{ ok: false, errors }`,
surface the errors to the user and stop — do **not** call it again with the
same arguments. Retrying a rejected write in a loop wastes the turn without
changing the result.

### 7. Update plan item status

If the browse executed a plan item, route the status change through
`research_append` (it validates-before-persist):

```
research_append({
  projectPath, section: "plan_items", op: "update",
  planId: "pl_003", entryId: "pli_012",
  fields: { status: "completed" }   // or "skipped"
})
```

### 8. Pass found records to extraction

**Log the browse (step 6) before you hand anything off.** The extraction
handoff is tempting to jump to the moment you spot the record, but a browse
that ends without a `research_log_append` entry is an incomplete browse — the
audit trail is the point of this skill. The step-6 append must have returned
`ok` before you hand off — rely on that return value; you do not need to
re-read `research.json` to confirm.

For each promising image, invoke record-extraction to add it as a source and
extract assertions — pass the image ID and what you observed. This skill
never writes to `sources` or `assertions`.

### 9. Present results

Summarize the volume browsed, the image range examined, what was found
(with image IDs), the log entry created, and plan progress. Suggest next
steps: more plan items, hand a found image to record-extraction, or — if the
browse was nil — try search-records, search-full-text, or another repository.

## Important rules

- **Browse only unindexed, non-full-text volumes.** If `volume_search`
  shows the volume is record- or full-text-searchable, route to
  search-records / search-full-text — they are faster than reading pages.
- **`image_search` lists the whole group.** There are no in-volume filters;
  narrow by reading a register/index page, not by re-querying.
- **`imageGroupNumber` comes from `volume_search`** (or the user). Pass it
  through verbatim — split natural-group name or bare number.
- **Log every browse, including nil.** The log is the GPS audit trail; a
  negative browse must record whatever scope was available (see step 6's
  nil-browse note contract — place/date/record type always, plus volume id and
  image range only once a volume was actually opened).
- **Do NOT write to `sources` or `assertions`.** Adding a found image as a
  source and extracting its facts is record-extraction's job — hand the
  image off, don't extract here.
- **Do NOT add extra fields to plan items.** Plan items have a fixed schema;
  only `status` may be updated here.
- **Never fabricate image contents.** Report only what you actually read via
  `image_read`.

## Re-invocation behavior

Appends a new `log` entry per browse via `research_log_append` (append-only;
no sidecar, since `image_search` does not stage), and updates the executed
plan item's `status` via `research_append`. Two browses of the same volume
produce two log entries — that is correct; re-running a browse is itself a
logged event. Never writes to `sources` or `assertions`.
