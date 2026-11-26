# Judge brief: findagrave-header-only-capture

A one-question project on a hosted store. The Find a Grave memorial search for
Abner Hollis (d. 1874, Warren County, Ohio), plan item `pli_001`, was handed to the
researcher, and that hand-off is still open: its `external_site` log entry
(`log_001`) has `outcome: "partial"` and `capture_received: false`, and
`project_context` lists it under `awaitingUser`.

The researcher uploaded the results page as a PDF. The store holds it as
`uploads/findagrave-search-abner-hollis-1874.pdf`, with no text layer.
`project_context` returns an `uploadUrl` and lists the upload with
`hasText: false`, to be read with `image_transcribe`. What the page says is what
`image_transcribe` returns for it: only the Find a Grave logo and a divider line,
with no names, dates or memorials.

**Find a Grave prints a search that finds nothing as its site header alone.** A
capture showing only the header is that site's no-results page: a fully loaded
capture of an empty result, not a blank, failed or truncated page.

The correct ending: the agent reads the upload with `image_transcribe`, treats the
page as zero results, and closes the hand-off with a new `external_site` log entry
with the same `url_generated` as `log_001`, `outcome: "negative"`,
`capture_received: true`, and `capture_filename`
`findagrave-search-abner-hollis-1874.pdf`. `pli_001` ends `completed`: a captured
empty results page is a conclusive nil for that search. The reply does not ask the
researcher to resave, recapture or re-upload the page.
