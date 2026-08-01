# Census field availability by year

Which fields a census schedule actually collected, so you don't credit a
record with a fact it never recorded.

**Why this matters at search time.** Two different errors come out of not
knowing this:

1. **Overclaiming in the log.** Describing an 1860 household as "head + wife +
   daughter" states a relationship the 1860 schedule has no column for. That is
   an inference presented as a documented fact — the weaker evidence gets
   filed as the stronger kind, and the next reader stops looking for the record
   that would actually settle it.
2. **Mis-triaging a match.** Expecting a field that does not exist for that
   year (parents' birthplaces on an 1870 census, exact birth month on an 1880)
   and reading its absence as a thin or defective record, when the schedule is
   complete as designed.

The rule for both: **state what the schedule recorded; label everything else as
inferred**, and say what it was inferred from (surname, age, listing order).

---

## US federal census

### 1790–1840 — head of household only

Only the **head of household is named**. Everyone else is a tally mark in an
age/sex bracket. You can count people of a given age and sex in the dwelling;
you cannot name them, and you cannot establish that any of them is a specific
person. A pre-1850 census supports "a household headed by X contained a
female aged 10–15" and nothing more.

1840 additionally names and ages Revolutionary War pensioners.

### 1850 — first census naming every free person

Name, age, sex, color, occupation (free males 15+), value of real estate,
**birthplace** (state or country only — never a town), married within the
year, in school within the year, cannot read/write, and the
deaf/blind/insane/pauper/convict columns.

**No relationship column.** Household structure is inferred from surname, age
and listing order.

Enslaved people appear on a **separate slave schedule** that names only the
slaveholder; the enslaved are listed by age, sex and color, unnamed.

### 1860 — as 1850, plus personal-estate value

Same fields as 1850 with the addition of value of personal estate. **Still no
relationship column.** Separate slave schedule again.

### 1870 — first post-emancipation census; still no relationships

Adds: value of real and personal estate, **"father of foreign birth" and
"mother of foreign birth"** — *yes/no flags only, not the parents'
birthplaces*, month of birth if born within the year, month of marriage if
married within the year, and male citizenship 21+.

**Still no relationship column.** 1870 is the last US federal census without
one, and the easiest one to slip on, because the foreign-parentage flags make
it feel like it says more about the family than it does.

### 1880 — the dividing line

First census with:

- **Relationship to head of household** — stated, so a relationship read from
  this column is documented, not inferred.
- **Birthplace of father and birthplace of mother** — actual places, not flags.
- **Marital status** (single / married / widowed / divorced).
- Street name and house number in urban areas.
- Months unemployed during the year; sickness/disability on the census day.

From 1880 on, a stated household relationship is direct evidence of that
relationship. Before 1880, it is always an inference.

### 1890 — effectively lost

Destroyed in a 1921 Commerce Department fire; only a few thousand names
survive. The **1890 veterans schedule** (Union veterans and widows) survives
much more completely for roughly half the alphabet of states and is often the
usable substitute.

### 1900 — the richest single year for dates

Uniquely records **month and year of birth** for every person — the only
federal census to do so. Also: years married, **number of children born to the
mother and number still living**, year of immigration, years in the US,
naturalization status, can read/write/speak English, home owned or rented and
whether mortgaged.

The children-born/children-living pair is the field that most often proves a
missing child existed.

### 1910 — as 1900, minus the birth month

Years of *present* marriage, number of children born/living, year of
immigration, naturalization status, mother tongue, whether a survivor of the
Union or Confederate army or navy, out of work. **No month of birth** — 1900
only.

### 1920 — the naturalization year

Year of immigration, **year of naturalization** (unique to 1920 — the actual
year, not just a status), naturalization status, mother tongue of the person
and of both parents. Drops the children-born counts.

### 1930 — age at first marriage

**Age at first marriage** (column 15, asked of every married person — 1940
asks it too, but only of women and only on the 5% supplementary sample, so
1930 is the year to reach for), year of immigration, naturalization
status, language spoken before coming to the US, veteran status and which war,
home value or monthly rent, and whether the household owned a radio set. No
naturalization year.

### 1940 — the informant is identified

First census to **mark who supplied the information** — a circled X beside the
respondent's name. This is what makes per-fact informant classification
possible for 1940+ and impossible before it. Also: residence on 1 April 1935,
highest grade completed, income, weeks worked.

A 5% **supplementary sample** (two lines per page) adds parents' birthplaces,
mother tongue, veteran status, number of marriages, age at first marriage, and
children ever born for women.

### 1950

Released April 2022. Residence one year prior, weeks worked, income, plus a
sample-line set of additional questions on a subset of persons. Treat the
sample-line fields as present only when the person actually fell on a sample
line.

---

## England & Wales census

The same trap exists here, one census earlier.

### 1841 — no relationships, rounded ages

Name, age, sex, occupation, and **"born in this county? Y/N"** plus separate
flags for Scotland, Ireland and Foreign Parts — no birth parish. **Ages 15 and
over are rounded down to the nearest 5** (a stated "30" means 30–34). **No
relationship column** — household structure is inferred exactly as on a
pre-1880 US census, and the rounded ages make age-based inference weaker still.

### 1851 onward — relationships and exact ages

Adds **relationship to head of household**, **exact age**, **marital
status**, and **birth parish and county** rather than a yes/no flag. From 1851
a stated relationship is documented.

1891 adds Welsh/Gaelic language and rooms occupied; 1901 and 1911 add employer
/ worker / own-account status. **1911** additionally records years of present
marriage and children born/living/died, and is the first census where the
surviving record is the **householder's own schedule in their handwriting**
rather than an enumerator's transcription.

---

## Applying this

- Before summarizing a household in a log note or a triage presentation, check
  the year against the sections above. If the relationship column did not
  exist, phrase the family structure as inferred and name the basis.
- Do not treat a missing field as a defective record or a reason to downgrade
  a match — check whether the field existed that year first.
- A field that exists for the year and is genuinely blank *is* meaningful, and
  is worth a note.
- Non-federal **state censuses** (New York, Iowa, Kansas and others) follow
  their own schedules and often carry fields the federal census of that decade
  lacks — check the collection description rather than assuming the federal
  pattern.

---

## Sources

The year-boundary claims above were checked against these, not written from
memory. Check here first if a claim looks wrong; correct the table and this
list together.

- **[Clues in Census Records, 1850–1950](https://www.archives.gov/research/census/1850-1950)**
  (US National Archives) — column-level confirmation for the 1870 parents'
  foreign-birth flags (cols 11–12) vs. the 1880 parents' *birthplaces*
  (cols 25–26) and relationship-to-head; 1900 month-and-year of birth (col 7);
  children born/living on 1900 (cols 11–12) and 1910 (cols 10–11); 1920 year of
  naturalization (col 15).
- **[The 1930 Census Schedules](https://www.archives.gov/publications/prologue/2002/spring/1930-census-2.html)**
  and **[IPUMS 1930 enumerator instructions](https://usa.ipums.org/usa/voliii/inst1930.shtml)**
  — age at first marriage is 1930 col 15, asked of every married person.
- **[1940 Census, General Information](https://www.archives.gov/research/census/1940/general-info)**
  — the circled X marking the informant, and the 5% supplementary-sample
  questions.
- **[United States Federal Census](https://www.familysearch.org/en/wiki/United_States_Federal_Census)**
  (FamilySearch Research Wiki) — 1850 as the first census naming every free
  person.
- **[1841](https://en.wikipedia.org/wiki/1841_United_Kingdom_census)** /
  **[1851 United Kingdom census](https://en.wikipedia.org/wiki/1851_United_Kingdom_census)**
  and **[Census Returns for England and Wales 1841–1911](https://www.digitalpanopticon.org/Census_Returns_for_England_and_Wales_1841-1911)**
  (Digital Panopticon) — 1841 ages 15+ rounded down to five and no relationship
  column; 1851 as the first with relationship, exact age, and birth parish.

Not independently re-verified here, and the first thing to doubt: the finer
1890 question list, the 1910/1920/1930 language and veteran columns, and the
1950 sample-line detail.
