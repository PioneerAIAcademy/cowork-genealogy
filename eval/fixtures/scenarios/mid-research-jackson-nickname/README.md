# mid-research-jackson-nickname

Tests the skill's ability to handle a **non-derivative nickname** when
searching official records. The subject is Mary Jackson (b. ~1850,
Lancaster County, PA), known to family and community as **"Bitsie"** —
a nickname acquired through life experience, NOT derivable from the
standard formal-to-nickname tables (Mary → Polly / Molly / Mamie etc.,
none of which produce "Bitsie").

## What this scenario encodes

`tree.gedcomx.json` person **I1**:
- name 1: `BirthName` "Mary Jackson" (preferred)
- name 2: `Nickname` "Bitsie Jackson"

Both names are valid `gedcomx_name_type_recommended` types per the
simplified-gedcomx schema. The Nickname is the bridge between what
the user / family calls the subject and what FamilySearch's records
will use (the formal BirthName).

`research.json` is otherwise minimal — just the project + one active
question about locating Mary in the 1880 census.

## What the test under this scenario should verify

When the user asks search-records to find "Bitsie Jackson," the skill
should:

1. Read `tree.gedcomx.json` and see that I1 has both a `BirthName`
   ("Mary Jackson") and a `Nickname` ("Bitsie Jackson")
2. Recognize "Bitsie" doesn't map via any standard nickname-equivalence
   table (per `references/name-search-mechanics.md`) — so the only path
   to the official record is the formal name
3. Issue the `record_search` call using `givenName: "Mary"` (the formal
   BirthName), not "Bitsie"
4. Report the matching record back, explicitly noting that the search
   used the formal name because "Bitsie" is a non-derivative nickname

A skill that searches for "Bitsie" directly will get zero results from
the record_search-jackson-bitsie-no-results fixture — that's the
failure mode this scenario exposes.

## Why this matters

Per Clorinda's review: standard derivative-nickname tables cover
Will/Bill/Billy → William and Polly/Molly → Mary. But community-,
occupation-, and disambiguation-driven nicknames (Bitsie, Tug, Pat)
have no algorithmic mapping. The skill needs to read project state
(tree person names, assertion notes, person profile aliases) to bridge
the colloquial name to the formal one.
