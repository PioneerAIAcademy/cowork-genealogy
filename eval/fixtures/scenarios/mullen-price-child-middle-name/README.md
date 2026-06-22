# Scenario: mullen-price-child-middle-name

A research project for a child named Sarah Ann Mullen Price (b. 1875,
Dodge County, WI). The name is ambiguous: "Mullen" could be a middle
given name honoring her mother's maiden surname, or it could be her
own birth surname if she later married a Price.

## State

- **Subject:** Sarah Ann Mullen Price (`I1`), b. 1875-08-20, Dodge
  County, Wisconsin. Tree data has `given: "Sarah Ann Mullen"` and
  `surname: "Price"` with type `BirthName`, reflecting the working
  hypothesis that Mullen is a middle given name.
- **Parents in tree:** Father James Price (`I2`), Mother Sarah Ann
  Mullen/Price (`I3`, with both BirthName: Mullen and MarriedName: Price).
- **One existing source** (1880 census) but no log entries yet for the
  active plan items.
- **Plan items:**
  - `pli_001` — 1880 census, Dodge County (find Sarah ~age 5 in a
    household to confirm surname) — `in_progress`
  - `pli_002` — 1875 birth record, Dodge County (would name parents
    definitively) — `planned`

## What it exercises

- The skill must use `surname: "Price"` (from the tree's BirthName
  entry) as the primary search parameter, NOT put "Mullen" in the
  surname field.
- The `givenName` should be "Sarah" (or "Sarah Ann" / "Sarah Ann
  Mullen"), keeping "Mullen" as part of the given name, not as a
  `surnameAlt`.
- Tests whether the skill correctly interprets a multi-token given
  name where one token happens to be a family surname used as a
  middle name.
