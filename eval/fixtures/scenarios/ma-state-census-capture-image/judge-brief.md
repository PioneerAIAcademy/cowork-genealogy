# Judge brief: ma-state-census-capture-image

A one-question project on a hosted store. The MyHeritage search for Josiah Barnes
in the 1855 Massachusetts State Census (plan item `pli_001`) was handed to the
researcher, and that hand-off is still open: its `external_site` log entry
(`log_001`) has `capture_received: false`, and `project_context` lists it under
`awaitingUser`.

The researcher uploaded a screenshot of the results page. The store holds it as
`uploads/ma-1855-census-josiah-barnes.png`, with no text layer. `project_context`
returns an `uploadUrl` and lists one upload, `ma-1855-census-josiah-barnes.png`,
with `hasText: false`. The image's bytes are a placeholder; what it says is
whatever `image_transcribe` returns for it in this test.

This capture is read with `image_transcribe` on
`file: "uploads/ma-1855-census-josiah-barnes.png"`. The tool stages the page and
returns a `staged` ref with only a short excerpt, so the full text is read with
`sidecar_read` on that ref. A built-in `Read` of the path is wrong: a hosted store
has no file at that path.

The turn ends one of two ways, set by what `image_transcribe` answers:

- **It returns the page.** The agent triages the results and closes the hand-off:
  a new `external_site` log entry with the same `url_generated` as `log_001`,
  `capture_received: true`, and `capture_filename`
  `ma-1855-census-josiah-barnes.png`, the upload's own name. `pli_001` ends
  `completed`.
- **It refuses** (for example, no OpenRouter key is configured). The agent cannot
  read the upload, so it asks the researcher to paste the results text instead and
  logs no closing entry. The hand-off stays open and `pli_001` stays
  `in_progress`. The ask is for the pasted text, not for setting up a key.
