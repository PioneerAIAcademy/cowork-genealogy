# Search Images Rubric

Grading dimensions for search-images unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments).

search-images browses FamilySearch digitized image volumes page-by-page when a record set is digitized but not indexed and not full-text searchable. The workflow is volume_search (find the image group) → image_search (list the image IDs) → image_read (view a page), and every browse is logged via research_log_append.

## Volume selection

Did the skill identify the right image group to browse, and recognize when image browsing is (or is not) the right tool?

This dimension grades the volume the skill *actually targeted*. When the user supplies an `imageGroupNumber` directly, the skill may call `image_search` without `volume_search` — that is correct, not a gap.

- **pass:** The skill either (a) called `volume_search` with the place/date the prompt supplies and picked the image group whose coverage matches, preferring an unindexed/non-full-text volume; or (b) used the `imageGroupNumber` the user gave directly. When `volume_search` shows the target is already record- or full-text-searchable, noting that a faster path (search-records / search-full-text) exists is a pass, not a miss.
- **partial:** The skill found a plausible volume but mis-scoped `volume_search` (wrong place/date), or browsed a clearly searchable volume without noting the faster indexed/full-text path.
- **fail:** The skill browsed an unrelated volume, invented an `imageGroupNumber`, or could not identify a volume to browse when the prompt supplied a clear place and record type.

## Browse execution

Did the skill list the volume's images and set up the browse, reporting only what it actually had?

Critical harness limitation: in the eval harness `image_read` **cannot return real image content** — there are no viewable pages to read. A complete browse in this environment therefore consists of *navigation*: calling `image_search` for the chosen group and working with the returned image IDs (presenting them, proposing which to view, and logging the browse). **Judges MUST NOT score partial or fail on the grounds that the skill did not view image pages, did not "page through" the whole volume, did not recover record contents, or "abandoned the browse" — none of that is possible once `image_read` returns nothing. Treat list-the-group-plus-log as a complete browse.** The page-by-page viewing path is exercised in live/Cowork testing, not in unit tests.

If `volume_search` reveals the target volume is already record- or full-text-searchable, the correct execution is to **not browse** — recommend search-records / search-full-text instead. In that case there is correctly no `image_search` call; score this dimension on the soundness of that decision, and do not treat the absence of `image_search` as a failure to execute.

- **pass:** The skill called `image_search` for the chosen group and worked with the returned image IDs — presenting them and/or proposing a page or range to examine — without fabricating the contents of any image. For an empty `imageIds` array it reports the volume as having no images rather than inventing pages. Stopping after listing because `image_read` returns no content is a pass, not an abandonment. **Declining to browse an indexed volume and steering to search-records / search-full-text is also a pass** — no `image_search` is expected there.
- **partial:** The skill listed the images but dumped the entire raw ID list with no orientation, or claimed to have read specific pages it could not have viewed.
- **fail:** The skill fabricated the contents of an image, reported a specific record it could not have read, invented `image_search` parameters (`offset`/`imageId`/etc.) in noisy trial-and-error, or skipped `image_search` entirely and answered from assumption.

## Browse audit trail

Did the skill log the browse with enough detail to support an exhaustiveness claim? "Browsed a volume" is different from "browsed Schuylkill probate group 007936749 (412 images, unindexed), images 40–75 examined, target not found."

The deterministic validators already check that a log entry *exists* and has the right shape (`test_positive_appends_browse_log_entry`, `test_negative_result_log_shape`). This dimension is therefore not about presence — grade the **quality of the `notes` narrative**: does it carry the scope a future exhaustiveness audit needs, without re-deriving it? Which scope applies depends on how far the browse got, so do not penalize a no-volume nil browse for lacking an image range it could not have.

- **pass:** Any of: (a) a positive browse whose `notes` name the volume/image group, place, record type, and the images examined; (b) a nil browse logged `outcome: "negative"` whose `notes` carry the scope that *was* available plus why it is negative — for a **no-volume** result, the place/date/record type searched and "no digitized volume exists" (there is correctly no volume id or image range to cite); for an **empty-group or target-not-found** result, additionally the volume/image-group id and the image range examined; or (c) the skill correctly declined to browse an indexed/searchable volume and recommended search-records / search-full-text — no browse occurred, so there is correctly nothing to log.
- **partial:** A log entry was written but its `notes` omit scope that *was* available (e.g. a volume was opened but no image range or volume id is recorded), or a nil browse whose `notes` say only "not found" without the place/date/record type searched.
- **fail:** No log entry was written for the browse; a nil browse was declared with no record of what was searched; or the `notes` fabricate scope that did not happen (e.g. an image range for a volume never opened) — each leaves the GPS audit trail untrustworthy.
