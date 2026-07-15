# Elijah Wilkins — death in Kentucky (1870s)

**Source PID:** `97YZ-J3D`
**Elijah Wilkins is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 1814,
died 30 November 1875 (per an Ancestry-only index; see Recalibration),
both in Muhlenberg, Kentucky, United States.

## Research question

> Using Kentucky death certificates, what were the date and place of death of
> Elijah Wilkins of Kentucky, and what information in the certificate confirms
> his identity?

## What was removed from the starting tree

- Removed fact `26697b22-44c6-41b0-ad07-8eb2ff79e6ed` on `97YZ-J3D`: Burial
  December 1875, Gish Cemetery, Bremen, Logan, Kentucky, United States.
- Removed fact `bfb9d146-3053-46a1-876a-5ac5c2db2456` on `97YZ-J3D`: Death
  30 November 1875, Muhlenberg, Kentucky, United States.
- Removed source `QJ45-QWZ`: *Elizah [Elijah] Wilkins in the Kentucky, U.S.,
  Death Records, 1852-1965* — the death record itself.
- Removed source `S7V4-3HS`: *Elijah Wilkins, "Find a Grave Index"* — would
  also have leaked the death/burial date and place.

Everything else is retained: birth (1814, Muhlenberg), residence facts
(1840–1870, Muhlenberg/Spencer), the spouse Sally Wilkins (`K2BS-YMD`,
m. Dec 1834), the parents James Wilkins (`KD7X-7WB`) and Margaret Elizabeth
Jarvis (`2W9K-4M8`), the eight children, and the census/marriage/deed
sources that attest them — all of which anchor the search and support
identity confirmation.

## Expected difficulty

medium — The death record is indexed under name variants (Elizah/Eligie/
Eligah Wilkins), and the same Muhlenberg County tree contains several other
Wilkins relatives with overlapping given names and places. The agent must
confirm identity by matching the record against tree context (age consistent
with an 1814 birth, spouse Sally, parents James Wilkins and Margaret
Elizabeth Jarvis) rather than by name spelling alone.

## Notes for reviewers

The actual Kentucky death certificate content (age, informant, parents as
recorded on the certificate) is not independently verifiable through our
tools — source `QJ45-QWZ` is an Ancestry.com index citation, not a
FamilySearch record ARK, so `record_read` cannot fetch its field-level
content. The "confirms his identity" portion of `expected-findings.json`
(`f2`) is scoped to identity confirmation via cross-referencing tree context
(age, spouse, parents) rather than requiring specific certificate fields —
see the fixture-authoring conversation for the scoping decision.

## Recalibration after the first live validation run (2026-07-14)

A live no-cheat `/research` run confirmed the flagged risk above is real,
and the findings were recalibrated accordingly (taxonomy lane 2 —
test/fixture issue, not an agent failure):

- **No Kentucky death certificate exists for Elijah at all** — statewide
  registration began 1911; he died ~1875. The research question's
  "using Kentucky death certificates" premise is therefore answerable
  only by recognizing this and pivoting; the question text is kept
  verbatim from issue #657 because that recognition is part of what the
  fixture tests.
- The **exact date (30 Nov 1875) exists only in the Ancestry-only index**
  (`QJ45-QWZ`) and is not recoverable through FamilySearch tools
  (`record_read` 404s on it — not an FS ARK).
- What IS recoverable — and what the live agent rigorously produced — is a
  **bounded, probate-derived conclusion**: died Muhlenberg County, most
  likely mid-to-late 1870s, bounded by the 1881 estate settlement and the
  13 Dec 1885 administrator's bond naming son Jesse Wilkins as
  administrator of the intestate estate, with alternative candidates
  ruled out (Probable tier).
- `f1` was loosened from the exact date to the bounded conclusion (exact
  date still matches but is not required); `f2` now accepts any sound
  identity mechanism (administrator-son Jesse linkage and/or age/spouse/
  parent matching), not only the originally-scoped age/spouse/parents
  route.

An alternative design — bundling the Ancestry index capture as
`provided-documents/` to make the exact date recoverable — was considered
and not taken: the bounded-inference version tests honest evidence
handling, which is the more valuable behavior for this suite.
