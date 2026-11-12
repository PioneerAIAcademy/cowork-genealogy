# Scenario: ma-state-census-capture-image

A copy of `ma-state-census-handoff-capture-uploaded` (its `research.json` and
`tree.gedcomx.json` are unchanged) whose capture arrived as an image with no text
layer. The MyHeritage hand-off for `pli_001` is still open, so `project_context`
lists it under `awaitingUser`. The researcher uploaded a screenshot of the results
page on the hosted web app, which stored it as
`uploads/ma-1855-census-josiah-barnes.png` and wrote no text layer for it.

The PNG is the smallest valid one, a single white pixel: the unit harness never
sends an upload's bytes anywhere, because `image_transcribe` is served from
fixtures. `project_context` lists one upload, `ma-1855-census-josiah-barnes.png`,
with `hasText: false`.

Used by two tests, both hosted so that `project_context` returns an `uploadUrl`:

- `ut_search_external_sites_ul3` (form 3 of the capture forms):
  `image_transcribe` answers from `image-transcribe-upload-barnes-census`, the
  same results page as the original scenario's text upload. The agent transcribes
  the upload, reads the staged page with `sidecar_read`, and closes the hand-off
  with `captureFilename` set to the PNG's name.
- `ut_search_external_sites_ulr`: `image_transcribe` refuses
  (`image-transcribe-upload-no-key`, production's no-OpenRouter-key error). The
  agent asks the researcher to paste the results text and logs no closing entry,
  so the hand-off stays open.

The original scenario is not edited because the research suite's
`ut_research_up1` uses it.

No PII: the subject and his household are the same invented Josiah Barnes.
