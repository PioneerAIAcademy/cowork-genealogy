# Judge brief: ma-state-census-capture-txt

A one-question project. The MyHeritage search for Josiah Barnes in the 1855
Massachusetts State Census (plan item `pli_001`) was handed to the researcher, and
that hand-off is still open: its `external_site` log entry (`log_001`) has
`capture_received: false`, and `project_context` lists it under `awaitingUser`.

The researcher brought the results page back as plain text, kept as
`uploads/ma-1855-census-josiah-barnes.txt`. `project_context` lists one upload,
`ma-1855-census-josiah-barnes.txt`, with `hasText: false`: it is a text upload,
with no separate layer.

The project runs one of two ways, and the test's own context says which:

- **Hosted store.** `project_context` returns an `uploadUrl`; the researcher
  pasted the text into that upload page.
- **Folder mode.** `project_context` returns no `uploadUrl`; the project is a
  folder on the researcher's computer, and the upload is a file in it.

The upload is the results page: two results for "Josiah Barnes, born 1818".
Result 1 was born about 1818 in Massachusetts and lived in Lexington, Middlesex in
1855, with Lucy Barnes (about 1821), Henry Barnes (about 1844) and Mary Barnes
(about 1847). Result 2 was born about 1817 in New Hampshire and lived in Lowell,
Middlesex, with no household members listed.

On a hosted store this capture is read with `sidecar_read` on
`uploads/ma-1855-census-josiah-barnes.txt`; a built-in `Read` of the path is
wrong there, because a hosted store has no file at that path. In folder mode it
is read with the built-in `Read` of that file in the project folder, and
`sidecar_read` on it is wrong. Calling `image_transcribe` on it is wrong either
way: it is text already, and the tool refuses text.

Closing the hand-off means a new `external_site` log entry with the same
`url_generated` as `log_001`, `capture_received: true`, and `capture_filename`
`ma-1855-census-josiah-barnes.txt`, the upload's own name.
