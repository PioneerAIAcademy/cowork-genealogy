# Scenario: ma-state-census-capture-txt

A copy of `ma-state-census-handoff-capture-uploaded` (its `research.json`,
`tree.gedcomx.json` and upload are unchanged) for the search-external-sites suite.
The MyHeritage hand-off for `pli_001` is still open, so `project_context` lists it
under `awaitingUser`. The researcher brought the results page back as plain text,
kept as `uploads/ma-1855-census-josiah-barnes.txt`: pasted into the hosted web
app's upload page, or saved into the project folder.

`project_context` lists one upload, `ma-1855-census-josiah-barnes.txt`, with
`hasText: false`. That is a text upload in its own right, not an upload missing its
layer: nothing named `ma-1855-census-josiah-barnes` sits beside it.

Used by `ut_search_external_sites_ul2` (form 2 of the capture forms), which runs
hosted so that `project_context` returns an `uploadUrl`. The point: the agent
reads the upload with `sidecar_read` on the upload's own ref, never sends it to
`image_transcribe` (which refuses text), and closes the hand-off with
`captureFilename` set to the upload's name.

Also used by `ut_search_external_sites_ulf`, its folder-mode twin: no hosted
listing, so `project_context` returns no `uploadUrl`, the capture forms do not
apply, and the agent reads the file with the built-in `Read`, never with
`sidecar_read` or `image_transcribe`.

The original scenario is not edited because the research suite's
`ut_research_up1` uses it, with a judge brief written for the router.

No PII: the subject and his household are the same invented Josiah Barnes.
