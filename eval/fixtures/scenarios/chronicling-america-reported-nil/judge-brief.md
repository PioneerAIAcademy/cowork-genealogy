# Judge brief: chronicling-america-reported-nil

A one-question project in a folder, on whether an Ohio newspaper printed an
obituary or death notice for Abner Hollis (d. 1874, Warren County, Ohio). Plan item
`pli_001`, a Chronicling America search, is `in_progress`.

The researcher earlier reported that Chronicling America search as finding
nothing, with no capture. `log_001` records it: an `external_site` entry for
`chronicling_america` with `outcome: "negative"`, `capture_received: false`,
`url_generated`
`https://www.loc.gov/collections/chronicling-america/?dl=page&q=Abner+Hollis&dates=1874%2F1875&fa=location_state:ohio`,
and notes marking the absence unconfirmed pending a capture.

If the researcher now says that search actually failed (it timed out, or the page
never loaded), `log_001`'s nil was wrong. The log is append-only, and the
correction is itself an append: one new `external_site` entry with the same
`url_generated` as `log_001` (copied from it, not rebuilt), `outcome: "error"`,
and notes naming `log_001` as the entry it corrects. `log_001` stays as it is. A
failed search proves nothing, so the correction is not `negative`. `pli_001` stays
`in_progress`: the search still has to be run. The reply tells the researcher
the earlier entry is superseded and gives the link to try again. Saying the log
cannot be changed is wrong.
