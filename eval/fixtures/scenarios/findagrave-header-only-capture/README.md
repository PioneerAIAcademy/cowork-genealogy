# Scenario: findagrave-header-only-capture

A one-question project on a hosted store. The Find a Grave memorial search for
Abner Hollis (d. 1874, Warren County, Ohio), plan item `pli_001`, was handed to the
researcher, and that hand-off is still open: `log_001` is an `external_site` entry
with `outcome: "partial"` and `capture_received: false`, so `project_context` lists
it under `awaitingUser`.

The researcher ran the search, which found nothing, and uploaded the results page
as `uploads/findagrave-search-abner-hollis-1874.pdf`. **Find a Grave prints a
search with no results as its site header alone**, so the PDF shows the logo and a
divider line and nothing else. No text layer was stored for it, so a hosted
`project_context` lists it with `hasText: false` and `readWith: "image_transcribe"`.
The PDF is a minimal hand-written placeholder; the harness serves the read from
`image-transcribe-upload-findagrave-header-only`.

From feedback issue #4745 (folded into #4657): three byte-identical header-only
captures were logged `error` as "unusable", and the researcher was asked to
recapture them, although the pages had fully loaded. A header-only Find a Grave
capture is a captured nil.

Used by `ut_search_external_sites_fgh`, hosted through
`project-list-hosted-hollis-findagrave`.

No PII: Abner Hollis is invented.
