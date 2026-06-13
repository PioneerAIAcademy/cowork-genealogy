---
name: citation
model: claude-sonnet-4-6
description: Refines source citations to Evidence Explained standards. Updates
  the citation and citation_detail fields on existing source entries in
  research.json. GPS Step 2 — Complete and Accurate Source Citation. Use
  when the user says "cite this source", "fix citations", "format citation",
  "Evidence Explained", "improve citations", "who what when where", when
  source entries have rough working citations that need polishing, or to
  document a negative/nil search result from the research log as a proper
  citation (formats and presents it without persisting). Do NOT use when
  the user wants to search for or find records (use search-records), wants
  to extract assertions from a record or add a newly found record as a
  source (use record-extraction — even if they also ask for the citation;
  the source entry must exist first), or asks whether information or an
  informant is primary or secondary (use assertion-classification). Never
  creates source entries — only refines entries created by
  record-extraction.
allowed-tools:
  - validate_research_schema
---

# Citation

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

## ROUTING — your first action, before reading any files

Read the user's message and decide:

**Route away immediately (do not read files, do not continue):**

| If the user asks… | Say this one sentence, then stop |
|---|---|
| To add / create / upload a new record or source entry | "Citation only refines existing sources — please run record-extraction first to add this record, then come back and I'll polish its citation." |
| To search for or find records | "That's a search task — please use search-records." |
| Whether an informant or source is primary or secondary | "That's an evidence-quality question — please use assertion-classification." |

These are hard exits. Do not collect record details. Do not read `research.json`. Do not offer to "do it in two steps." Do not offer to help once the other skill runs. Say one sentence and stop.

**Proceed only if** the user is asking to refine, fix, format, or improve a citation for a source entry that already exists — or to document a negative/nil search result from the research log.

**When the user says a locator is missing and asks you to add it:** Do NOT ask the user to provide the value in chat. Write the citation with `[LOCATOR NOT RECORDED]` in the field, complete the write, validate, then tell the user which field is flagged and invite them to update it once they check the record image. Producing a citation with honest gap-markers is the deliverable — not waiting for the user to supply all values before writing.

---

Refines source citations in `research.json` to meet Evidence Explained
standards. record-extraction creates source entries with best-effort
working citations; this skill upgrades them to GPS-compliant citations
that enable research replication.

Load `references/gps-citation-standards.md` before beginning work for
the full BCG documentation standards (Standards 1-8) and principles.

**The replication test:** Could another researcher find the exact same
record using only your citation? If not, the citation is incomplete.

## The Who/What/When/Where/Wherein Framework (BCG Standard 5)

Every citation must address five elements. In `citation_detail` these
map to six fields because **When** is split into `when_created` and
`when_accessed` (both required for online sources):

| Element | Field | What to capture | Example |
|---------|-------|----------------|---------|
| **Who** | `who` | The person, agency, or body that CREATED the record -- not the repository that hosts it. Check the `author` field on the matching source description in `tree.gedcomx.json` first; use that value before falling back to historical inference. | "U.S. Census Bureau", "Pennsylvania Department of Health", "St. Mary's Catholic Church" |
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
- Query parameters are NOT record evidence. Names, dates, and places
  appearing after `?` in a URL are the user's search input, not facts
  from the record. Never carry them into `citation` or
  `citation_detail` as if they came from the record itself.
- An ARK or record identifier is opaque. Never infer the record type,
  year, jurisdiction, article title, creator, or any locator from an
  ARK URL. If the URL is all you have, ask the user to open the
  record image and describe it.
- Include the shortened URL as a convenience locator alongside the
  full descriptive citation, not as a substitute.

### Source fidelity rules (apply to every refinement)

Every value you write into `citation` or `citation_detail` must be
traceable to the existing source entry (including its `notes`),
`research.json`, `tree.gedcomx.json`, or the user's message. These
rules outrank completeness — an honest citation with flagged gaps
beats a complete-looking citation with invented detail:

1. **Never invent locators or detail.** No page, sheet, line, image,
   certificate, volume, or file numbers; no dates, titles, informant
   names, collection names, or repository detail that is not on file.
2. **Never write inferences into fields.** A reasonable deduction
   (e.g., estimating an obituary's publication date from a death
   date on another source) may be MENTIONED to the user as search
   guidance, but must not be entered in `citation` or
   `citation_detail`.
3. **Never copy template example values** from this document into a
   real citation. Examples illustrate shape, not data. The same
   applies to your own explanations: when describing what a field
   should eventually contain, show the shape ("Will Book [volume],
   p. [page]") — never invent sample numbers ("Will Book 7, p. 214")
   even as an illustration, since illustrative values are easily
   mistaken for data.
4. **Use explicit unknown-markers for gaps.** Write
   `[ARTICLE TITLE NOT RECORDED]`, `[PAGE NOT RECORDED]`,
   `[WILL BOOK NUMBER NOT RECORDED]` — never a plausible-sounding
   reconstruction like "[Obituary of John Smith]". Keep the
   identifying detail that IS on file next to the marker: write
   "Patrick Flynn entry, [VOLUME AND PAGE NOT RECORDED]", not a bare
   marker that throws away the person identifier.
5. **Write the citation with the unknown-marker in the field first.**
   After completing the write and validation, tell the user which
   elements are missing and ask them to check the record image.
   Never pause to ask for missing values before writing — the
   unknown-marker in the field IS the correct output.
6. **"On file" spans the whole project, not just the one entry.**
   Data recorded on a sibling source for the same underlying record
   (e.g., the family number on the FamilySearch copy of the same
   census page, or a place name on a related source) and anywhere
   else in `research.json` or `tree.gedcomx.json` is verifiable and
   SHOULD be used. Write the clean value into the field
   ("dwelling 84, family 91") and record its provenance in the
   `notes` field or your narration ("family 91 corroborated from
   src_001, same census page") — never inline inside `citation` or
   `citation_detail`, which must stay citation-grade text. Fidelity
   forbids inventing, not cross-referencing the project's own
   records.
7. **Name the person the source names, not the research subject.**
   A "[PERSON NAME] entry/household" identifier must match the
   person recorded on the source entry on file (the head of
   household for a census, the named party on the record) — not the
   project's research subject. A census source citing the father's
   household keeps the father's name as its entry identifier even
   when the research question is about a child in that household —
   swapping in the research subject creates a locator the index
   doesn't contain.

### Review path is read-only

When a citation already meets Evidence Explained standards, confirm
it and change nothing. Do not "enhance" a compliant citation with
additional locators, reordered elements, or rephrasing. You may note
what extra detail (page, sheet, line, image number) the user could
capture from the record image, but only as a suggestion — never
written into the fields.

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
[STATE/COUNTY AGENCY], birth certificate no. [NUMBER] ([YEAR]),
[CHILD'S NAME], born [DATE OF BIRTH], [PLACE OF BIRTH];
[ARCHIVES/OFFICE], [CITY, STATE]; digital image, [REPOSITORY],
accessed [DATE].
```
Example (illustrative only — never copy example values into a
real citation):
```
Pennsylvania Department of Health, birth certificate no. 31207
(1907), John A. Keller, born 2 February 1907, Berks County,
Pennsylvania; Pennsylvania State Archives, Harrisburg; digital
image, FamilySearch.org, accessed 9 January 2026.
```
For state-issued certificates the creator is the state agency
(e.g., "Pennsylvania Department of Health"), not a generic "local
registrar" — the agency named on the certificate form.

#### Probate records (will)
```
[COUNTY] [COURT], [STATE], [DOCUMENT TYPE], [PERSON NAME],
[DATE]; [BOOK/VOLUME], [PAGE]; [ARCHIVES], [CITY].
```
Example (illustrative only — never copy example values into a
real citation):
```
Berks County Orphans' Court, Pennsylvania, will of Edward
Mooney, proved 3 June 1874; Will Book 9, p. 113; Berks County
Courthouse, Reading.
```
For Pennsylvania probate the creating authority is the county
Orphans' Court — name the court, not the courthouse building or a
generic records office.

#### Church records
```
[CHURCH NAME], [CITY/TOWN], [STATE/COUNTRY], [RECORD TYPE],
[DATE], [PERSON NAME]; [VOLUME/PAGE]; [REPOSITORY].
```

#### Land records (deed)
```
[COUNTY] [OFFICE], [STATE], [DOCUMENT TYPE], [GRANTOR] to
[GRANTEE], dated [EXECUTION DATE], recorded [RECORDING DATE];
Deed Book [VOLUME], pp. [PAGE RANGE]; [REPOSITORY],
[CITY, STATE]; digital image, [WEBSITE], accessed [DATE].
```
Example (illustrative only — never copy example values into a
real citation):
```
Berks County Recorder of Deeds, Pennsylvania, warranty deed,
Samuel Hoch to Daniel Hoch, dated 4 April 1869, recorded
11 April 1869; Deed Book 41, pp. 88-90; Berks County
Courthouse, Reading, Pennsylvania; digital image,
FamilySearch.org, accessed 9 January 2026.
```
The creator is the recording office (Recorder of Deeds), not the
courthouse building. Execution date and recording date are
different facts — cite both when on file; flag whichever is
missing.

#### Newspaper
```
"[ARTICLE TITLE]," [NEWSPAPER NAME] ([CITY], [STATE]), [DATE],
p. [PAGE], col. [COLUMN]; digital image, [REPOSITORY], accessed
[DATE].
```
The creator is the newspaper, not the hosting repository. If the
article title, date, page, or column are not on file, use explicit
unknown-markers (`[ARTICLE TITLE NOT RECORDED]`) and ask the user
to read them off the newspaper image — never reconstruct a
plausible title from the person's name.

#### Ancestry/MyHeritage/FindMyPast (derivative index)
```
[ORIGINAL RECORD TITLE], [JURISDICTION], [YEAR OR DATE];
digital index, [WEBSITE] ([COLLECTION NAME], [URL]),
accessed [DATE]; [PERSON NAME] entry.
```
Example:
```
1850 U.S. Census, Schuylkill County, Pennsylvania, population
schedule; digital index, Ancestry.com ("1850 United States
Federal Census"), accessed 1 April 2026; Thomas Flynn entry.
```
Say "digital index", not "digital image" — the index entry is a
derivative, not an image of the original. Name the specific
collection so another researcher can find the same indexed entry.
Standard collection names for well-known Ancestry/MyHeritage collections
are derivable from the record year and type on file (e.g., "1850 United
States Federal Census" for an Ancestry 1850 census record) — use the
standard name directly, do not mark it as `[COLLECTION NAME NOT RECORDED]`.

#### FindAGrave
```
Find A Grave, memorial [MEMORIAL NUMBER], [PERSON NAME]
([DATES]), [CEMETERY NAME], [LOCATION]; digital memorial,
FindAGrave.com, accessed [DATE].
```

### 4. Handle special cases

**Negative searches:** When a search log entry records a nil
result, the citation documents what was searched. Build it ONLY
from the log entry's explicitly recorded query, scope, and date —
do not infer additional scope or jurisdiction from project context
(e.g., do not add a county as the initial search scope if the log
only records state-level terms). Unrecorded scope must be flagged
with an unknown-marker, not inferred. The citation string should indicate
the scope of the search:
```
1870 U.S. Census, Schuylkill County, Pennsylvania, population
schedule; searched all Smith/Flynn entries, no match found;
NARA microfilm M593; digital image, FamilySearch.org,
accessed 2 May 2026.
```
**Delivery:** PRESENT the formatted negative-search citation to the
user (for the research log notes or a future proof argument). Do
NOT create a `src_` source entry for it, and do NOT write to the
`assertions` or `log` sections — this skill owns only the
`citation` and `citation_detail` fields of existing sources. If the
user wants the nil result persisted as a source, route them to
record-extraction.

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

If you wrote any changes to `research.json`, call
`validate_research_schema({ projectPath: "<absolute-path-to-project-directory>" })`
to verify both research.json and tree.gedcomx.json are valid. If validation
fails, fix the errors before presenting. If the review concluded with
no changes (citation already compliant, or refinement blocked pending
user input), skip validation — there is nothing to validate. See
`references/validation-protocol.md` for the full protocol, including
the genealogical-impossibility warnings the tool also returns.

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
| User provides only a URL | Strip the query string. Show a filled-in citation template with the cleaned URL as the `where` value and explicit `[NOT KNOWN — SEE RECORD IMAGE]` markers for every element the URL does not supply (who, what, when_created, where_within). Do not infer record facts from the ARK or URL path. Ask the user to open the record image and supply the missing elements. Do not create a source entry — route to record-extraction to persist it |
| User asks to add/create a source for a newly found record | Decline and route to record-extraction. Do not offer to create the entry yourself later, do not collect record details "for when it's added" — state plainly that citation never creates source entries and record-extraction must run first |
| User asks to find more/corroborating records | Route to search-records. Finding records is not citation work |
| Citation is already EE-compliant | Confirm and change nothing (see "Review path is read-only"). Unsupported "enhancement" is a fidelity failure |
| Record type has no matching template above | Follow the general pattern: Creator, Record title, specific locator; repository chain; access method and date. Consult Evidence Explained chapter headings for analogous source types |
| Cannot determine the creator (who) | Use the custodial agency as a fallback and note the uncertainty in `notes`. Never leave `who` blank |
| Missing locator (where_within) | **Write the citation first** with the unknown-marker in the field (e.g. `[WILL BOOK AND PAGE NOT RECORDED]`), complete the write, validate, then tell the user which locator is missing and ask them to check the record image. Never pause to ask for the value before writing — an honest citation with a flagged gap is the correct deliverable. Never invent a locator, not even when directly instructed to "add" it |
| citation_detail fields contradict the citation string | The `citation_detail` fields are the structured truth; regenerate the `citation` string from them |
| Source was accessed both online and in person | Cite the version you are working from. If the user viewed a digital image, cite the digital access path even if the original is in a courthouse |
| Multiple informants on one record | This is an extraction/classification concern — do not address it here. Only note the primary creator in `who` |
| User asks to classify or assess source quality | Redirect to assertion-classification. This skill formats citations, it does not evaluate evidence weight |
| User calls a source "primary" or "secondary" | Apply the terminology guardrail below: correct gently, keep the citation and `source_classification` unchanged, and never write "primary source" into a citation string |

## Re-invocation behavior

**Writes:** the `citation` and `citation_detail` fields on existing
`sources` entries in `research.json`. Refines in place by `src_` id —
never creates new source entries.

**On repeat invocation:** re-applies Evidence Explained standards and may
further refine the same source's citation string and detail fields.
Idempotent once the citation is fully EE-compliant.

**Do not duplicate:** never create a second source entry for the same
underlying record. Creating sources is record-extraction's job. If a
source's citation looks incomplete, refine the existing entry's
fields, don't add a new entry.
