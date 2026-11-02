# William W Sloan — a wife named Maria on an 1891 Toronto marriage of a son Thomas John Sloane

**Source PID:** `LHG6-L26`
**William W Sloan is deceased.** (FamilySearch ToS requires
all committed e2e fixtures to be about deceased persons.) Born 22 July 1832 in Ontario, son of Thomas Sloan and Margaret Williamson, who came from Scotland; died 25 December 1921 in Toronto and buried at Blyth Union Cemetery, Huron County. The tree carries a Deceased Physician File (AMA) source. His wife in the tree is Agnes McCaa (born 1839). Their children include a Thomas (born 1859, died 1861), Andrew McCaa (1860), Thomas (1865), Alice Grace (1865), William W (1869) and Henry Cole (1876), all born in Huron County.

## Research question

> Besides Agnes McCaa, did William W Sloan (born 22 July 1832 in Ontario, died 25 December 1921 in Toronto, buried at Blyth, Huron County) have another wife, and if so, who was she?

## What was removed from the starting tree

**Nothing.** This is a *record-hint* fixture, a different genre from the
strip-based fixtures: the expected answer never appeared in the
FamilySearch tree. The starting tree is the live snapshot as-is
(captured 2026-10-20, PID `LHG6-L26` with relatives). Nothing was
stripped (`"genre": "record-hint"` in `fixture.json`):
`starting-tree.gedcomx.json` is the snapshot as-is (written by
`strip --none`), and `unstripped-tree.gedcomx.json` is committed
identical to it so `snapshot --check` can audit upstream drift.
`validate` enforces the equality and skips the presence mirror
(the record-hint genre in `docs/specs/e2e-test-spec.md`).

## Expected difficulty

medium — see "Notes for reviewers" below for the reviewer's read on
match strength.

## Notes for reviewers

**Resolved: the hint is a false match (identity: different).** The drafted
Maria finding has been replaced with a `polarity: "avoid"` guard plus a required
documented-negative-conclusion finding. William W Sloan (`LHG6-L26`) did **not**
have a wife named Maria; the evidence supports rejecting the 1891 Toronto
marriage that generated the hint as a match for him, though the groom's identity
remains unresolved.

This fixture comes from a hint batch (`filtered-list-samples-4.csv` row 4,
`hint-samples.csv` row 129, flags `adds_spouse`, confidence 3) in which roughly
half the hint records are false matches. The hint is the 4 February 1891 Toronto
marriage of Thomas John Sloane, aged 30, to Maggie A Mahaffey
(`ark:/61903/1:1:FMV5-LZ2`, "Canada, Ontario, Marriages, 1869-1927"), which
indexes the groom's parents as William and Maria Sloane. The index gives no
birthplace or residence for anyone.

What decided it:

- The only wife documented for William W Sloan in the records reviewed is
  **Agnes McCaa**, married 4 March 1859 (indexed "Agnes McAn",
  `ark:/61903/1:1:Q2CB-C9MN`). Agnes lived with him through the 1911 and 1921
  censuses and is buried beside him at Blyth; "Maria" appears on no record
  reviewed for him, and the searches below found no record establishing a second
  wife named Maria.
- His children are documented 1859–1876, all in Huron County, with **no son
  Thomas John born 1861**. The 1860/61 births are Andrew McCaa Sloan (1860) and
  Thomas Sloan (1859–1861); a second son Thomas was born 1865. Neither Thomas is
  "Thomas John", and neither was born about 1861.
- The **1891 census** (`ark:/61903/1:1:MWL7-5DR`) places William W Sloan as a
  married man in Blyth, Huron East, Ontario — the same year the hint groom
  married in Toronto, and in Huron, not Toronto.

What was searched and came up empty: a search of "Canada, Ontario, Marriages,
1869-1927" and the Canada census collections for a wife named Maria for William
W Sloan, or for a son Thomas John born about 1861, returned nothing tying either
to the tree subject. A record search for a "William Sloan + Maria" couple
returned only unrelated families — among them a **distinct** William Sloan
(b. 28 December 1818, Ireland) and Maria J. Sloan in Victoria County, Ontario
(1901 census, via a son Robert J Sloan, b. 1860). That couple shows a different
William+Maria Sloan family existed, but it has **not** been conclusively
identified as the 1891 groom's parents; the groom's own identity is left open.

The evidence rejects the hint as a match for William W Sloan without
conclusively identifying the 1891 groom. **Index/record text only — no register
image was read or calibrated**, so this is not an image-basis resolution; the
identity verdict is "different". Retrieval was tool-assisted (MCP `record_read`,
`record_search`, `person_read` against live FamilySearch); the identity
judgement is the genealogist's.
