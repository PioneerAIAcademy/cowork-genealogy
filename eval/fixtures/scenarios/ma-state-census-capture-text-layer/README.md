# Scenario: ma-state-census-capture-text-layer

A copy of `ma-state-census-handoff-capture-uploaded` (its `research.json` and
`tree.gedcomx.json` are unchanged) whose capture arrived as an upload with a text
layer. The MyHeritage hand-off for `pli_001` is still open, so `project_context`
lists it under `awaitingUser`. The researcher saved the results page as a PDF and
uploaded it on the hosted web app, which stored two files:

- `uploads/ma-1855-census-josiah-barnes.pdf`: the PDF itself, a minimal one-page
  PDF written by hand so the fixture stays small and plain ASCII;
- `uploads/ma-1855-census-josiah-barnes.pdf.txt`: its text layer, the same results
  page as the original scenario's `uploads/ma-1855-census-josiah-barnes.txt`.

`project_context` lists one upload, `ma-1855-census-josiah-barnes.pdf`, with
`hasText: true`: a `.txt` beside an upload of the same name is that upload's
layer, not an upload of its own.

Used by `ut_search_external_sites_ul1` (form 1 of the capture forms), which runs
hosted so that `project_context` returns an `uploadUrl`. The point: the agent
reads the layer with `sidecar_read`, never transcribes the PDF (a paid call for
text it already has), and closes the hand-off with `captureFilename` set to the
PDF's name, never the layer's.

The original scenario is not edited because the research suite's
`ut_research_up1` uses it.

No PII: the subject and his household are the same invented Josiah Barnes.
