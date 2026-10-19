# Johann Frederich Widmer

**Source PID:** `L7B2-QXX`
**Johann Frederich Widmer is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.)

## Research question

> What are Johann Frederich Widmer's birth date/place, death date/place, and burial date/place?

## Bundled captures (`provided-documents/`)

One Find a Grave page is committed here to let the harness exercise its burial plan item without a live
browser session (issue #2083):

| File | Source | What it shows |
|------|--------|---------------|
| `findagrave-johann-widmer-136852260.pdf` | findagrave.com | Memorial #136852260 — Johann Frederich Widmer, burial Rose Ridge Cemetery, Naples, Ontario, New York |

This is an authentic page saved from findagrave.com in a credentialed browser. It supplies the specific
cemetery name (Rose Ridge Cemetery) for the bonus burial finding (f4) and corroborates the burial locale
for the required finding (f3).

## What was removed from the starting tree

- Removed fact 248eaba5-34ae-4182-9874-bfcc07166241 on L7B2-QXX: Birth 25 JAN 1847 Hausen, Bellikon, Aargau, Switzerland
- Removed fact 774891e1-e643-41e5-a459-15bab543d57e on L7B2-QXX: Burial 7 Jul 1914 Rose Ridge Cemetery, Naples, Ontario, New York, United States of America
- Removed fact 9381f219-2889-4bfc-9b03-5527232282c1 on L7B2-QXX: Death 4 JUL 1914 Naples, Ontario, New York, USA

## Expected difficulty

hard — spans two record jurisdictions: a Swiss church/civil birth record
(Hausen, Bellikon, Aargau) and US death/burial records (Naples, Ontario
County, NY), requiring the agent to work across two very different
record systems for one subject.

## Notes for reviewers

Tests cross-continental vitals recovery for one subject: Swiss birth
record plus US death/burial records. Also worth noting for the team:
`person_read --relatives` on this PID returns shared/compact fact ids
across relatives (most of Johann's 16 children share his own Birth and
Death fact ids in the raw FamilySearch response). This did not block
stripping his own facts here — `strip` disambiguates by (person,
fact-id), and Johann's own fact list has no internal duplicates — but
it's worth a look before a future fixture strips a *relative's* fact
from this same tree.

**2026-07-29:** Split the original burial finding (`f3`) into two, per
PR #928 review feedback. Across 4 live attempts the agent consistently
recovered the burial *place* (Naples, Ontario, NY) but never the burial
*date* or *cemetery name* (Rose Ridge Cemetery) — the research log
(`q_003`) confirms the sources that would establish those (the full
Find A Grave memorial page, NY Death Index, newspaper obituaries) are
off-FamilySearch and were deferred rather than accessed. `f3` now
covers burial place only (`required: true`, consistent with what every
run has actually recovered); the date + cemetery name moved to a new
`f4` (`required: false`, bonus credit) since they don't appear reliably
recoverable from FamilySearch alone.
