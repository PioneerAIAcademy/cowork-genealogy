# Scenario: ma-state-census-capture-returned

`ma-state-census-handoff-open` one step later: the researcher came back with the
MyHeritage record. `log_002` closes the hand-off on the **same** `url_generated`
(`capture_received: true`, no file — the record page's text was pasted into the
session and is kept in the entry's `notes`), its outcome is `positive`, and
`pli_001` is `completed`.

Nothing has been extracted: `sources` and `assertions` are empty, so `log_002` is
a positive entry with no assertion referencing it. It is not a FamilySearch
record, so `extraction_append({ recordIds })` cannot read it; the routing table
sends any other source to `@plugin:record-structurer`, one spawn for the batch.

The point: the router's first hand-off is the record-structurer spawn, not
search-external-sites again (the hand-off is closed), not person-evidence (there
are no assertions to link), and not research-exhaustiveness (the plan item is
done, but its result has not been analysed).

No PII: the subject and his household are the same invented Josiah Barnes.
