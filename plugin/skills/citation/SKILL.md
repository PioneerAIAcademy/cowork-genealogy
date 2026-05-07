---
name: citation
description: Refines source citations to Evidence Explained standards. Updates
  the citation and citation_detail fields on existing source entries in
  research.json. GPS Step 2 — Complete and Accurate Source Citation. Use
  when the user says "cite this source", "fix citations", "format citation",
  "Evidence Explained", "improve citations", "who what when where", or when
  source entries have rough working citations that need polishing. Do NOT
  use when the user wants to search for records (use search-records), wants
  to extract assertions from a record (use record-extraction), or wants to
  classify evidence (use assertion-classification). This skill never creates
  new source entries — it only refines entries created by record-extraction.
---

# Citation

Refines source citations in `research.json` to meet Evidence Explained
standards. record-extraction creates source entries with best-effort
working citations; this skill upgrades them to GPS-compliant citations
that enable research replication.

## Why citations matter

GPS Element 2 requires complete and accurate citation of every source.
A citation must enable another researcher to:
1. Find the exact same record
2. Evaluate the source's reliability
3. Distinguish this source from similar records

"The inability to replicate the research casts doubts on the
conclusion." — Board for Certification of Genealogists

## The Who/What/When/Where/Where-within Framework

Every citation must answer five questions, captured in the
`citation_detail` object:

| Element | Field | What to capture | Example |
|---------|-------|----------------|---------|
| **Who** | `who` | Creator, agency, or corporate body responsible for the record | "U.S. Census Bureau", "Pennsylvania Department of Health", "St. Mary's Catholic Church" |
| **What** | `what` | Title or specific description of the record | "1850 U.S. Federal Census, population schedule", "Death certificate no. 4521" |
| **When** | `when_created` | Date the record was created | "1850", "1908-03-14" |
| | `when_accessed` | Date the agent/user accessed the record | "2026-05-04" |
| **Where** | `where` | Repository — physical or digital | "FamilySearch.org (NARA microfilm M432, roll 810)", "Ancestry.com" |
| **Where-within** | `where_within` | Specific locator within the source | "Schuylkill County, dwelling 84, family 91", "Certificate no. 4521", "Page 12, entry 47" |

## Steps

### 1. Read existing sources

Read `research.json` and identify source entries needing citation
refinement. Prioritize:
- Sources with incomplete `citation_detail` (missing fields)
- Sources with rough `citation` strings that don't follow Evidence
  Explained patterns
- Sources the user specifically asks about

### 2. Refine citation_detail

For each source, ensure all six `citation_detail` fields are
complete and accurate:

```json
{
  "who": "U.S. Census Bureau",
  "what": "1850 U.S. Federal Census, population schedule",
  "when_created": "1850",
  "when_accessed": "2026-05-04",
  "where": "FamilySearch.org (NARA microfilm M432, roll 810)",
  "where_within": "Schuylkill County, dwelling 84, family 91"
}
```

**Common problems to fix:**
- `who` says "FamilySearch" — that's the repository, not the creator.
  The creator is the agency that produced the original record.
- `what` is too vague ("census record") — specify the exact title,
  year, and schedule type.
- `where_within` is missing — every citation must include a specific
  locator. Page numbers, entry numbers, dwelling numbers, certificate
  numbers, image numbers, microfilm roll numbers.
- `when_accessed` is missing — always include the access date for
  digital sources.

### 3. Format the citation string

Generate the `citation` field following Evidence Explained patterns.
The citation is a single formatted string that encodes all five
elements.

**Template by source type:**

#### Census records
```
[YEAR] U.S. Census, [COUNTY], [STATE], population schedule,
[LOCATOR]; NARA microfilm publication [SERIES], roll [ROLL];
digital image, [REPOSITORY], accessed [DATE].
```
Example:
```
1850 U.S. Census, Schuylkill County, Pennsylvania, population
schedule, dwelling 84, family 91, Thomas Flynn household; NARA
microfilm publication M432, roll 810; digital image,
FamilySearch.org, accessed 1 May 2026.
```

#### Vital records (death certificate)
```
[STATE] Department of Health, death certificate no. [NUMBER]
([YEAR]), [PERSON NAME]; [ARCHIVES], [CITY]; digital image,
[REPOSITORY], accessed [DATE].
```
Example:
```
Pennsylvania Department of Health, death certificate no. 4521
(1908), Patrick Flynn; Pennsylvania State Archives, Harrisburg;
digital image, FamilySearch.org, accessed 3 May 2026.
```

#### Vital records (birth certificate)
```
[STATE/COUNTY] [OFFICE], birth certificate no. [NUMBER] ([YEAR]),
[PERSON NAME]; [ARCHIVES/OFFICE], [CITY]; digital image,
[REPOSITORY], accessed [DATE].
```

#### Probate records (will)
```
[COUNTY] [COURT], [STATE], [DOCUMENT TYPE], [PERSON NAME],
[DATE]; [BOOK/VOLUME], [PAGE]; [ARCHIVES], [CITY].
```
Example:
```
Schuylkill County Orphans' Court, Pennsylvania, will of Thomas
Flynn, 15 March 1881; Will Book 12, p. 247; Schuylkill County
Courthouse, Pottsville.
```

#### Church records
```
[CHURCH NAME], [CITY/TOWN], [STATE/COUNTRY], [RECORD TYPE],
[DATE], [PERSON NAME]; [VOLUME/PAGE]; [REPOSITORY].
```

#### Land records (deed)
```
[COUNTY] [OFFICE], [STATE], [DOCUMENT TYPE], [GRANTOR] to
[GRANTEE], [DATE]; [BOOK], [PAGE]; [REPOSITORY].
```

#### Newspaper
```
"[ARTICLE TITLE]," [NEWSPAPER NAME] ([CITY], [STATE]), [DATE],
p. [PAGE], col. [COLUMN]; digital image, [REPOSITORY], accessed
[DATE].
```

#### Ancestry/MyHeritage/FindMyPast (derivative index)
```
[ORIGINAL RECORD TITLE]; digital index, [SITE].com
([SITE URL]): accessed [DATE]), [COLLECTION NAME],
[PERSON NAME] entry.
```
Example:
```
1850 U.S. Census, Schuylkill County, Pennsylvania, population
schedule, dwelling 84, Thomas Flynn household; digital index,
Ancestry.com, accessed 1 May 2026.
```

#### FindAGrave
```
Find A Grave, memorial [MEMORIAL NUMBER], [PERSON NAME]
([DATES]), [CEMETERY NAME], [LOCATION]; digital memorial,
FindAGrave.com, accessed [DATE].
```

### 4. Handle special cases

**Negative searches:** When a source was searched but yielded nil
results, the citation documents what was searched. The citation
string should indicate the scope of the search:
```
1870 U.S. Census, Schuylkill County, Pennsylvania, population
schedule; searched all Smith/Flynn entries, no match found;
NARA microfilm M593; digital image, FamilySearch.org,
accessed 2 May 2026.
```

**User-captured PDFs from external sites:** The citation must
identify both the original record and the access method:
```
1850 U.S. Census, Schuylkill County, Pennsylvania, population
schedule, dwelling 84, Thomas Flynn household; digital image,
Ancestry.com (user-captured PDF), accessed 1 May 2026.
```

**Image transcriptions:** Note that the text was transcribed from
an image, and whether the transcription was reviewed:
```
St. Mary's Catholic Church, Pottsville, Pennsylvania, baptismal
register, 1845, Patrick Flynn entry; transcribed from digital
image, FamilySearch.org, accessed 3 May 2026; transcription
reviewed by user.
```

### 5. Update source entries

Write the refined `citation` and `citation_detail` fields back to
`research.json`. This is an in-place update to existing `src_`
entries — never create new source entries.

Do NOT change: `id`, `gedcomx_source_description_id`,
`source_classification`, `repository`, `access_date`, `url`,
`url_archived`. These are set by record-extraction.

The `notes` field may be updated if the citation analysis reveals
provenance concerns not previously noted.

### 6. Validate

Invoke `validate-schema` after writing updates.

### 7. Present results

Show the user each refined citation with the formatted string and
the structured citation_detail. Highlight any gaps that couldn't
be filled (e.g., missing microfilm roll number, unknown creator).

## Terminology guardrails

**FORBIDDEN terms:**
- "Primary source" or "secondary source" — sources are classified
  as Original, Derivative, or Authored. The terms "primary" and
  "secondary" apply only to INFORMATION quality on individual
  assertions.

**REQUIRED terms:**
- **Original:** The first recording of an event
- **Derivative:** Copies, transcriptions, indexes
- **Authored:** Compiled works

If the user says "primary source," gently correct: "In GPS
terminology, sources are classified as Original, Derivative, or
Authored. The term 'primary' applies to information quality — whether
the informant was a direct witness. This census is an Original source
that contains both Primary information (the enumerator witnessed the
residence) and Indeterminate information (the household member who
reported ages is unknown)."

## Example

**Before (working citation from record-extraction):**
```json
{
  "citation": "1850 census, Schuylkill Co PA, Thomas Flynn",
  "citation_detail": {
    "who": "FamilySearch",
    "what": "1850 census",
    "when_created": "1850",
    "when_accessed": "2026-05-01",
    "where": "FamilySearch",
    "where_within": "dwelling 84"
  }
}
```

**After (refined by citation skill):**
```json
{
  "citation": "1850 U.S. Census, Schuylkill County, Pennsylvania, population schedule, dwelling 84, family 91, Thomas Flynn household; NARA microfilm publication M432, roll 810; digital image, FamilySearch.org, accessed 1 May 2026.",
  "citation_detail": {
    "who": "U.S. Census Bureau",
    "what": "1850 U.S. Federal Census, population schedule",
    "when_created": "1850",
    "when_accessed": "2026-05-01",
    "where": "FamilySearch.org (NARA microfilm M432, roll 810)",
    "where_within": "Schuylkill County, dwelling 84, family 91"
  }
}
```

Changes: `who` corrected from repository to creator, `what` expanded
to full title, `where` includes both digital and physical repository,
`where_within` expanded with full locator, `citation` string follows
Evidence Explained census pattern.
