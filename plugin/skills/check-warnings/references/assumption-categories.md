# Assumption Categories for Warning Detection

Genealogical reasoning relies on assumptions. Not all assumptions
carry equal weight. The BCG standards identify three categories that
determine how much trust to place in unproven premises. For warning
detection, these categories define what should and should not trigger
an alert.

## Fundamental Assumptions

These are physical, biological, and temporal laws that cannot be
violated under any circumstances. They require no evidence to
support them — they are axiomatic.

Examples:
- People cannot perform actions after their death
- People cannot perform actions before their birth
- Travel between locations requires time consistent with available
  transportation technology of the era
- A person cannot be in two geographically distant places at the
  same moment
- Biological conception requires a living mother and father

**Warning implication:** Any data that violates a fundamental
assumption is CERTAINLY wrong. Either the data contains an error
(wrong date, wrong place) or records from two different individuals
have been incorrectly merged into one profile. These always produce
Critical or High severity warnings.

## Valid Assumptions

These are expectations about normal human biology and behavior that
hold true in the vast majority of cases but can be contradicted by
documented evidence. They are reasonable defaults that should be
assumed true until proven otherwise.

Examples:
- Mothers conceive children between approximately ages 12 and 49
- Personal behavior follows coherent life patterns (people generally
  live in one place at a time, hold consistent occupations, maintain
  family units)
- People generally observed the legal, moral, and social standards
  of their time and place
- Parent-child age differences typically fall between 15 and 50 years
- Siblings are typically born at least 9 months apart (to the same
  mother)
- Children's birthplaces generally match where their parents resided

**Warning implication:** Data that violates valid assumptions is
PROBABLY wrong, but exceptions exist. A 50-year-old mother is
extremely rare but documented. A 13-year-old bride is unusual by
modern standards but occurred in some historical contexts. These
produce Medium or High warnings, and the report should note that
documented exceptions are possible.

**Key principle:** Genealogists should seek evidence to invalidate
valid assumptions. If no contradicting evidence is found, the
assumption is incorporated into reasoning. If a warning fires on
a valid assumption, the researcher should check whether the source
evidence is strong enough to override the default expectation.

## Unsound Assumptions

These are premises that MIGHT be true but CANNOT be accepted without
supporting evidence. They are common mental shortcuts that
researchers take — often unconsciously — that lead to errors.

Examples:
- A man's widow was the mother of all his children
- Migrants followed the most popular route to their destination
- A bride's surname is the same as her parents' surname
- A child listed in a household is the biological child of the
  household head
- The informant on a death record had accurate knowledge of the
  deceased's birth details
- If two people share a surname and lived in the same area, they
  must be related

**Warning implication:** Do NOT generate warnings based on unsound
assumptions. The absence of evidence for these premises is not a
problem — it is the normal state. Unsound assumptions require
positive evidence before they can be accepted; their violation is
not a signal of error.

## Applying the Framework

When evaluating whether a condition should trigger a warning:

1. Identify which assumption category the check relies on
2. If fundamental: always warn (Critical/High)
3. If valid: warn but note that documented exceptions exist (Medium/High)
4. If unsound: do NOT warn — the condition requires evidence to
   establish, not evidence to disprove

This prevents false positives from flooding the researcher with
noise while ensuring genuine impossibilities are always surfaced.
