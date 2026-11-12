# Judge brief: ma-state-census-capture-text-layer

A one-question project on a hosted store. The MyHeritage search for Josiah Barnes
in the 1855 Massachusetts State Census (plan item `pli_001`) was handed to the
researcher, and that hand-off is still open: its `external_site` log entry
(`log_001`) has `capture_received: false`, and `project_context` lists it under
`awaitingUser`.

The researcher saved the results page as a PDF and uploaded it. The store holds
the PDF, `uploads/ma-1855-census-josiah-barnes.pdf`, and its text layer,
`uploads/ma-1855-census-josiah-barnes.pdf.txt`. `project_context` returns an
`uploadUrl` and lists one upload, `ma-1855-census-josiah-barnes.pdf`, with
`hasText: true`.

The text layer is the results page: two results for "Josiah Barnes, born 1818".
Result 1 was born about 1818 in Massachusetts and lived in Lexington, Middlesex in
1855, with Lucy Barnes (about 1821), Henry Barnes (about 1844) and Mary Barnes
(about 1847). Result 2 was born about 1817 in New Hampshire and lived in Lowell,
Middlesex, with no household members listed.

This capture is read with `sidecar_read` on
`uploads/ma-1855-census-josiah-barnes.pdf.txt`. Calling `image_transcribe` on the
PDF is wrong: the text is already there, and a transcription is a paid call. A
built-in `Read` of the path is wrong too: a hosted store has no file at that path.

Closing the hand-off means a new `external_site` log entry with the same
`url_generated` as `log_001`, `capture_received: true`, and `capture_filename`
`ma-1855-census-josiah-barnes.pdf`, the upload's own name. The layer's name
(`ma-1855-census-josiah-barnes.pdf.txt`) is not the capture's filename.
