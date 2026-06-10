# Assumption Categories for Warning Detection

Genealogical reasoning relies on assumptions. Not all assumptions
carry equal weight. The BCG standards identify three categories that
determine how much trust to place in unproven premises. For warning
detection, these categories define what should and should not trigger
an alert. The `person_warnings` tool's `severity` field reflects
this framework: `error` for fundamental violations, `warning` for
valid violations, and no emission at all for unsound conditions.

## Fundamental Assumptions

These are physical, biological, and temporal laws that cannot be
violated under any circumstances. They require no evidence to
support them — they are axiomatic.

Examples relevant to the tool's checks:
- People cannot perform actions after their death
- People cannot perform actions before their birth
- A man cannot father a child long after his own death (gestation
  is finite)
- A woman cannot give birth meaningfully after her own death
- A burial event cannot precede a death event
- A christening event cannot precede a birth event
- A recorded lifespan cannot exceed plausible biological limits
  (~120 years)

**Tool emission:** `severity: "error"`. Always investigate — these
almost always indicate data errors or two distinct individuals
incorrectly merged into one profile.

## Valid Assumptions

These are expectations about normal human biology and behavior that
hold true in the vast majority of cases but can be contradicted by
documented evidence. They are reasonable defaults that should be
assumed true until proven otherwise.

Examples relevant to the tool's checks:
- Mothers conceive children between approximately ages 12 and 55
- Fathers conceive children between approximately ages 14 and the
  late decades
- Marriage occurs between approximately ages 14 and 90
- A person has a small number of valid birth and death records;
  multiple distinct ones usually mean conflated data
- A person has roughly one biological mother and one biological
  father
- A person's recorded surnames usually agree with each other
- A family's children are born within a reasonable span (under
  ~40 years between oldest and youngest)

**Tool emission:** `severity: "warning"`. Note and recommend
verification. A 55-year-old mother is rare but documented; a
13-year-old bride is unusual by modern standards but occurred in
some historical contexts.

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

**Tool emission:** none. The tool does NOT emit warnings based on
unsound assumptions. The absence of evidence for these premises is
not a problem — it is the normal state. Unsound assumptions
require positive evidence before they can be accepted; their
violation is not a signal of error.

## Applying the Framework

When the `person_warnings` tool emits a warning:

1. Look at `severity`:
   - `"error"` → fundamental violation → always investigate;
     almost always indicates a data error or identity confusion.
   - `"warning"` → valid violation → note and verify; document
     the exception if the source evidence supports the unusual
     condition.

2. Look at the `issueType` tag for the specific condition. See
   `warning-checks.md` for the full catalog of tags the tool emits.

3. Do NOT manufacture additional warnings from unsound assumptions
   the tool deliberately skips.
