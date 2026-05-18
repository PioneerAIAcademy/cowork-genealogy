---
name: citation
model: claude-sonnet-4-6
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

Load `references/gps-citation-standards.md` before beginning work for
the full BCG documentation standards (Standards 1-8) and principles.

**The replication test:** Could another researcher find the exact same
record using only your citation? If not, the citation is incomplete.

## The Who/What/When/Where/Wherein Framework (BCG Standard 5)

Every citation must describe at least four facets of the source, plus
a fifth facet (Wherein) for reference-note citations that document
specific facts. These map to the `citation_detail` object:

| Element | Field | What to capture | Example |
|---------|-------|----------------|---------|
| **Who** | `who` | The person, agency, or body that CREATED the record -- not the repository that hosts it. If an informant is identified, note them. | "U.S. Census Bureau", "Pennsylvania Department of Health", "St. Mary's Catholic Church" |
| **What** | `what` | Title or name of the source. If untitled, a clear item-specific description. | "1850 U.S. Federal Census, population schedule", "Death certificate no. 4521" |
| **When** | `when_created` | Date the record was created or the event it reports | "1850", "1908-03-14" |
| | `when_accessed` | Date the researcher accessed the record (required for online sources) | "2026-05-04" |
| **Where** | `where` | Where the record was VIEWED (cite what you see), then the original repository | "FamilySearch.org (NARA microfilm M432, roll 810)", "Ancestry.com" |
| **Wherein** | `where_within` | Specific locator: page, image, entry, certificate, dwelling, family, box, folder number | "Schuylkill County, dwelling 84, family 91", "Certificate no. 4521", "Page 12, entry 47" |

### The "Cite What You See" Principle

The `where` field follows a layered path from access point back to
origin. The first location is where you actually viewed the record:

1. Access point (FamilySearch.org, Ancestry.com)
2. Medium (NARA microfilm M432, roll 810)
3. Original custodian (Schuylkill County Courthouse)

### Collection Citation vs. Document Citation

- **Collection citation**: Identifies the record set as a whole.
  Appropriate for research planning and negative-search documentation.
- **Document citation**: Identifies a specific record within the
  collection. Required when supporting factual claims about individuals.

Always cite at the document level. The `where_within` field is what
distinguishes a document citation from a mere collection reference.

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

**Fixing auto-generated citations:**

Websites like FamilySearch and Ancestry provide machine-generated
citations that are starting points, not finished products. When
refining these, check for:
- Creator listed as the website rather than the originating agency
- Only the collection name cited, not the specific document within it
- Missing locators (volume, page, entry, image numbers visible in
  the record image)
- Informant not identified (critical for death certificates)
- Formatting inconsistent with humanities-style standards

**URL best practices:**

- A URL alone is NEVER a complete citation. URLs break and sites
  restructure.
- Shorten query strings: remove everything after the first `?` in
  FamilySearch and Ancestry URLs. Query parameters contain
  session-specific search data useless to future researchers.
- Include the shortened URL as a convenience locator alongside the
  full descriptive citation, not as a substitute.

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

## Terminology guardrail

If the user says "primary source" or "secondary source," gently
correct: sources are classified as Original, Derivative, or Authored.
The terms "primary" and "secondary" apply only to information quality
(informant proximity), not to sources themselves. Source classification
is handled by record-extraction, not this skill — but correct the
terminology if it appears in a citation string being refined.

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

## Decision rules

| Situation | Action |
|-----------|--------|
| User provides only a URL | Expand to full citation. A URL alone never constitutes a citation. Use the URL as a convenience locator within the formatted string |
| Record type has no matching template above | Follow the general pattern: Creator, Record title, specific locator; repository chain; access method and date. Consult Evidence Explained chapter headings for analogous source types |
| Cannot determine the creator (who) | Use the custodial agency as a fallback and note the uncertainty in `notes`. Never leave `who` blank |
| Missing locator (where_within) | Flag the gap to the user. Ask if they can check the record image for page/entry/certificate numbers. Do not leave `where_within` empty without explanation |
| citation_detail fields contradict the citation string | The `citation_detail` fields are the structured truth; regenerate the `citation` string from them |
| Source was accessed both online and in person | Cite the version you are working from. If the user viewed a digital image, cite the digital access path even if the original is in a courthouse |
| Multiple informants on one record | This is an extraction/classification concern — do not address it here. Only note the primary creator in `who` |
| User asks to classify or assess source quality | Redirect to assertion-classification. This skill formats citations, it does not evaluate evidence weight |
