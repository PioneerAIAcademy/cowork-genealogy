# Calendar-Based Date Conflicts: Identification and Resolution

## Principle

Under the Genealogical Proof Standard, conflicting evidence must be
acknowledged, analyzed, and resolved. However, not every apparent
date disagreement is a true conflict. Many date discrepancies arise
from records being created under different calendar systems. The
researcher's first task when encountering conflicting dates is to
determine whether the difference reflects a genuine informational
disagreement or simply a calendar-system difference.

If the discrepancy is explained by calendar conversion, the dates
actually corroborate each other rather than conflict. This should be
documented clearly so that future researchers do not waste effort
re-investigating the same apparent contradiction.

---

## The Two Components of "Old Style vs New Style"

### Component 1: The Year-Start Change

Before adoption of the Gregorian calendar, many jurisdictions
(notably England and its colonies) began the civil year on March 25
rather than January 1. This means:

- A date of "15 February 1720" in an English parish register refers
  to what we would call 15 February 1721 in modern reckoning.
- Any date between January 1 and March 24 in a pre-adoption record
  needs one year added to match modern conventions.
- This is ONLY a year issue. The day and month remain the same.

### Component 2: The 11-Day Shift (Julian to Gregorian)

The Julian calendar accumulated an error of approximately one day
every 128 years relative to the solar year. By the time of the
major European transitions:

- In 1582 (Catholic Europe): the gap was 10 days
- In 1700 (Protestant Germany, Denmark/Norway): the gap was 10 days
- In 1752 (Britain and colonies): the gap was 11 days
- In 1918 (Russia): the gap was 13 days
- In 1923 (Greece): the gap was 13 days

When a jurisdiction adopted the Gregorian calendar, it skipped
forward by the appropriate number of days. This affects the DAY
within the month (and sometimes the month itself if the date falls
near a month boundary).

### Why the Distinction Matters

These two corrections are independent:

- The year-start change affects ONLY dates between January 1 and
  March 24. It shifts the year by exactly one.
- The day correction affects ALL dates. It shifts the day by a
  fixed number (depending on century).

In England (1752), both changes were applied simultaneously. But in
other jurisdictions they may have occurred at different times. Some
countries changed the year-start to January 1 well before adopting
the Gregorian day correction (e.g., Scotland changed the year-start
in 1600 but kept the Julian calendar until 1752).

---

## Decision Process: Is This a Real Conflict?

When two sources show different dates for what appears to be the
same event, follow this sequence:

### Step 1: Identify the jurisdiction and date of each record

Determine where each record was created and what calendar system
was in force there at that time. Use the transition table in the
main SKILL.md.

### Step 2: Check if the jurisdictions used different calendars

If Record A is from a Julian-calendar jurisdiction and Record B is
from a Gregorian-calendar jurisdiction (at the time of the event),
a day-offset difference is EXPECTED, not contradictory.

### Step 3: Calculate the expected offset

- Same century, different calendars: apply the day correction for
  that century (10-13 days depending on era)
- One record is pre-March-25 in an OS jurisdiction: apply the
  year-start correction (+1 year)
- Both corrections may apply simultaneously

### Step 4: Compare the actual difference to the expected offset

- If the actual difference matches the expected calendar offset:
  the dates AGREE. Document the conversion and note that the
  apparent conflict is resolved by calendar-system differences.
- If the actual difference does NOT match: a genuine conflict may
  exist. Proceed to full conflict resolution analysis.

### Step 5: Document the resolution

In the assertion's `informant_bias_notes`, record:
- The original date as stated in each source
- The calendar system each source used
- The converted equivalent showing agreement
- A brief statement that the apparent conflict is resolved by
  calendar conversion

---

## Patterns That Signal Calendar Differences (Not True Conflicts)

| Observed Difference | Likely Explanation |
|--------------------|--------------------|
| Exactly 10 days (pre-1700 records) | Julian/Gregorian offset for that era |
| Exactly 11 days (1700-1799 records) | Julian/Gregorian offset for that era |
| Exactly 13 days (1800-1923 records) | Julian/Gregorian offset for that era |
| Exactly 1 year, date is Jan 1 - Mar 24 | Old Style/New Style year-start |
| 11 days + 1 year, date is Jan-Mar | Both corrections combined (common in English records compared to Continental) |
| Day matches but year is off by 1 | Year-start issue only (no day correction needed if comparing within same calendar tradition) |

---

## Common Research Scenarios

### English parish register vs French church record (pre-1752)

England used Julian (OS) while France used Gregorian from 1582.
Differences of 11 days and/or 1 year (for Jan-Mar dates) are
expected and do not indicate conflicting information.

### American colonial records vs Spanish colonial records

English colonies followed England's calendar until 1752. Spanish
colonies used Gregorian from 1582. Same analysis applies as
English vs French.

### Russian Empire records vs Western European records (pre-1918)

Russia kept the Julian calendar until February 1918. Any Russian
record compared to a Western source will show a 12-day offset
(19th century) or 13-day offset (20th century). This is not a
data-entry error or informant confusion.

### Scottish records (1600-1752)

Scotland changed its year-start to January 1 in 1600 but kept the
Julian day reckoning until 1752. So a Scottish record from 1700
starts the year on January 1 (unlike England) but is still 11 days
behind the Gregorian calendar. This creates a hybrid situation
where comparing Scottish to English records requires only the
year-start correction (for Jan-Mar dates), while comparing Scottish
to Continental records requires only the day correction.

---

## When Calendar Conversion Does NOT Explain the Difference

Calendar conversion cannot explain:
- Differences of months (unless near a month boundary with the day
  shift pushing across)
- Differences of multiple years
- Differences in the day that do not match the expected offset for
  the era
- Differences between two records from the SAME jurisdiction at the
  SAME time (both should use the same calendar)

In these cases, the conflict is genuine and requires full analysis:
weighing source reliability, informant proximity, and record
purpose to determine which version is more likely correct and why
the other version exists.
