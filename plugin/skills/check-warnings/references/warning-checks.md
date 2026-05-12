# Warning Checks Reference

Complete catalog of conditions checked by the check-warnings skill,
organized by the assumption category they rely on and their severity.

## Checks Based on Fundamental Assumptions

These checks detect violations of physical/temporal laws. Failures
are always errors or identity confusion — no exceptions.

### Death before birth (Critical)
- Condition: death date precedes birth date
- Cause: data entry error, or records from two people merged
- Action: verify both dates against source documents

### Events after death (Critical)
- Condition: any recorded event (marriage, census appearance, land
  purchase, etc.) has a date after the person's death date
- Cause: the most common cause is records from a same-name
  individual being attributed to a deceased person
- Action: check person_evidence links; likely identity split needed

### Event in the future (Critical)
- Condition: any date is after the current year
- Cause: data entry error (typo in year)
- Action: correct the date

### Impossible travel (High)
- Condition: consecutive events place the person in locations that
  could not be reached in the intervening time given the era's
  transportation
- Guidelines for travel time by era:
  - Pre-1830: overland ~20-30 miles/day by horse; ocean crossings
    take weeks to months
  - 1830-1870: rail available in some regions (~30-50 mph where
    lines exist); otherwise horse/foot
  - 1870-1920: extensive rail networks; transcontinental US ~5-7
    days; transatlantic ~7-10 days
  - Post-1920: automobile common; air travel emerging
- Cause: records from two different individuals merged, or an
  incorrect date/location
- Action: build a timeline and identify the impossible transition

### Acting before birth (High)
- Condition: any event is dated before the person's birth
- Cause: wrong birth date, wrong event attribution, or identity
  confusion
- Action: verify birth date and event ownership

## Checks Based on Valid Assumptions

These checks detect biologically or socially improbable conditions.
Exceptions are rare but documented.

### Marriage before age 12 (High)
- Condition: marriage date minus birth date < 12 years
- Historical context: child marriages occurred but are extremely
  rare before age 12 in any documented culture
- Cause: usually a wrong birth date, wrong marriage date, or
  identity confusion (parent's marriage attributed to child)

### Death after age 120 (High)
- Condition: death date minus birth date > 120 years
- Context: no verified human lifespan exceeds ~122 years
- Cause: wrong birth date, wrong death date, or two people merged

### Child born to mother outside age 12-49 (High)
- Condition: child's birth date minus mother's birth date < 12
  or > 49
- Context: conception outside this range is biologically near-
  impossible (pre-modern medicine) or extremely rare
- Cause: wrong mother assignment, wrong dates, or identity confusion

### Parent under 12 at child's birth (High)
- Condition: child's birth date minus parent's birth date < 12
- This is a subset of the above but applies to fathers as well
- Cause: almost always wrong person linkage

### Marriage after death (High)
- Condition: marriage date is after either spouse's death date
- Cause: wrong death date, wrong marriage date, or records from a
  same-name person (e.g., a son with the same name marrying)

### Jurisdiction did not exist (High)
- Condition: an event is recorded in a county, parish, or town that
  had not yet been created at the stated date
- Example: birth in "West Virginia" before 1863, or in a county
  formed in 1850 for an event dated 1830
- Context: records often use later jurisdiction names retroactively,
  which is not an error per se — but it signals the data needs
  verification against original records
- Cause: retroactive labeling, transcription from a later index, or
  incorrect date

### Children born too close together (Medium)
- Condition: two children with the same mother born less than 9
  months apart
- Context: could indicate twins (legitimate), but in non-twin
  situations it is biologically impossible for the same mother
- Cause: twins, incorrect date, or two different mothers conflated
  into one person

### Parent-child age gap outside 15-50 years (Medium)
- Condition: child's birth minus parent's birth < 15 or > 50
- Context: fathers occasionally sire children past 50, but gaps
  over 60 are extremely rare; gaps under 15 are biologically
  near-impossible
- Cause: wrong parent assignment, wrong dates, generational skip

### Children's birthplaces inconsistent with residence (Medium)
- Condition: children's birthplaces do not match parents' known
  locations and no evidence of relocation exists
- Context: families do relocate, and a change in children's
  birthplaces may simply indicate a move — but without
  corroborating evidence of that move, it warrants investigation
- Cause: identity confusion (children from different families
  merged), or undocumented relocation

### Sibling age gap over 20 years (Low)
- Condition: oldest and youngest siblings differ by more than 20
  years
- Context: large families spanning 20+ years of childbearing are
  documented; also common in blended families
- Cause: often legitimate but may indicate blended family or
  records from different family units merged

### Birth before parents' marriage (Low)
- Condition: child born more than 9 months before parents' recorded
  marriage date
- Context: extremely common in historical records — premarital
  conception, delayed marriage recording, or the child is from a
  prior relationship
- Cause: usually not an error; note but don't escalate

### Unusually long life (Low)
- Condition: person lived past 100 years
- Context: rare but well-documented in modern records; less
  reliable in pre-civil-registration eras where birth dates are
  estimated
- Cause: often an overestimated age or estimated birth date;
  verify source quality

## What NOT to Check (Unsound Assumptions)

Do NOT generate warnings for:
- Widow not proven to be mother of all children
- No evidence of the migration route taken
- Bride's surname not matching any known family
- Household members assumed to be biological children
- Informant knowledge assumed to be accurate
- Same-surname neighbors assumed to be related

These require positive evidence to establish. Their absence is
not a warning condition.
