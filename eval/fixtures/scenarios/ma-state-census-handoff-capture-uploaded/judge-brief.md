# Judge brief: ma-state-census-handoff-capture-uploaded

A one-question project. The MyHeritage search for Josiah Barnes in the 1855
Massachusetts State Census was handed to the researcher, and that hand-off is
still open: its `external_site` log entry has `capture_received: false`, and
`project_context` lists it under `awaitingUser`. The researcher has now saved the
results page to `uploads/ma-1855-census-josiah-barnes.txt`.

The router's job this turn is to recognise the capture as the waiting search's
result and hand it to `@plugin:search-external-sites` with that plan item. Closing
the hand-off (logging an entry on the same `url_generated`) is search-external-sites'
work, not the router's.

In unit tests search-external-sites is a stub that changes nothing, so the hand-off
stays open and `research.json` is unchanged after the turn. That is expected and is
not a failure. The spawn itself is not shown to you; a deterministic validator checks
it. The failure to look for is the router handing the same link to the researcher
again instead of taking the capture.
