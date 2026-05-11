# Seed Unit Tests for All Skills — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create minimal rubrics, fixtures, and unit tests for the 22 remaining skills (conflict-resolution already done), giving the CRUD UI and test harness real data to exercise across all 23 skills.

**Architecture:** Reuse existing scenarios (`mid-research-flynn`, `flynn-with-birthplace-conflict`) wherever possible. Create simple MCP fixtures only for skills that call tools. Each skill gets a rubric.md (3 dimensions) and one positive unit test JSON. Minimize new scenario creation — for seed data, `scenario_notes` can describe ideal state when mid-research-flynn is close enough.

**Tech Stack:** JSON, Markdown

---

## Scenario Strategy

Most skills can use `mid-research-flynn`. Only create new scenarios when a skill fundamentally can't work with existing state.

| Scenario | Skills that use it |
|----------|--------------------|
| `mid-research-flynn` | assertion-classification, check-warnings, citation, hypothesis-tracking, person-evidence, project-status, proof-conclusion, question-selection, research-plan, search-external-sites, search-full-text, search-records, timeline, tree-edit, validate-schema |
| `flynn-with-birthplace-conflict` | conflict-resolution (already done) |
| `null` (stateless) | convert-dates, historical-context, init-project, locality-guide, translation, wiki-lookup, record-extraction |

No new scenarios needed. Stateless skills use `scenario: null`. Skills that need MCP tool output in context (record-extraction, init-project) use fixtures to provide the record data — they don't need a research.json scenario because they create or operate on records directly.

## MCP Fixture Strategy

Create minimal fixtures — just enough valid JSON for the harness to return. One fixture per tool needed. Fixtures are intentionally simple (1-2 results, minimal fields).

---

### Task 1: Create MCP fixtures

**Files to create** (all under `eval/fixtures/mcp/`):

- [ ] **Step 1: Create all MCP fixture files**

Create the following fixture files. Each is a JSON file with `tool`, `description`, and `response` fields. The response should be minimal but structurally valid.

`wikipedia-schuylkill-county.json`:
```json
{
  "tool": "wikipedia_search",
  "description": "Wikipedia article for Schuylkill County, Pennsylvania",
  "response": {
    "title": "Schuylkill County, Pennsylvania",
    "extract": "Schuylkill County is a county in the U.S. state of Pennsylvania. As of the 2020 census, the population was 143,049. Its county seat is Pottsville. The county was created on March 1, 1811, from parts of Berks and Northampton counties. It was named after the Schuylkill River. The county became a major anthracite coal mining region in the 19th century.",
    "url": "https://en.wikipedia.org/wiki/Schuylkill_County,_Pennsylvania"
  }
}
```

`search-wiki-irish-immigration.json`:
```json
{
  "tool": "search_wiki",
  "description": "FamilySearch Wiki search for Irish immigration records",
  "response": {
    "query": "Irish immigration records Pennsylvania",
    "total_chunks_searched": 1500,
    "results": [
      {
        "rank": 1,
        "relevance_score": 0.87,
        "chunk_text": "Irish immigrants to Pennsylvania in the 1840s-1850s often arrived at the port of Philadelphia. Ship passenger lists are held at NARA and are indexed on FamilySearch.",
        "page_title": "Pennsylvania Immigration and Emigration",
        "section_heading": "Irish Immigration",
        "source_url": "https://www.familysearch.org/en/wiki/Pennsylvania_Immigration_and_Emigration"
      }
    ],
    "query_time_ms": 250
  }
}
```

`places-schuylkill-county.json`:
```json
{
  "tool": "places",
  "description": "FamilySearch place data for Schuylkill County",
  "response": {
    "placeId": "326",
    "name": "Schuylkill",
    "fullName": "Schuylkill, Pennsylvania, United States",
    "type": "County",
    "latitude": 40.7,
    "longitude": -76.2,
    "parentPlaceId": "262",
    "wikipedia": {
      "title": "Schuylkill County, Pennsylvania",
      "extract": "Schuylkill County is a county in Pennsylvania."
    }
  }
}
```

`record-search-1850-census-flynn.json`:
```json
{
  "tool": "record_search",
  "description": "1850 Census search results for Patrick Flynn in Schuylkill County",
  "response": {
    "results": [
      {
        "id": "ark:/61903/1:1:MXYZ",
        "collection": "1850 United States Federal Census",
        "score": 0.95,
        "fields": {
          "name": "Patrick Flynn",
          "age": "5",
          "birthplace": "Ireland",
          "residence": "Schuylkill County, Pennsylvania",
          "head_of_household": "Thomas Flynn"
        }
      }
    ],
    "total_results": 1
  }
}
```

`fulltext-search-flynn-witnesses.json`:
```json
{
  "tool": "fulltext_search",
  "description": "Full-text search for Flynn witnesses in Schuylkill County records",
  "response": {
    "results": [
      {
        "id": "ark:/61903/1:1:QRST",
        "collection": "Pennsylvania Land Records",
        "score": 0.72,
        "snippet": "...witnessed by Thomas Flynn and Patrick Flynn of Schuylkill County..."
      }
    ],
    "total_results": 1
  }
}
```

`external-links-schuylkill.json`:
```json
{
  "tool": "external_links",
  "description": "External genealogy links for Schuylkill County 1840-1860",
  "response": {
    "place": "Schuylkill, Pennsylvania, United States",
    "totalResults": 3,
    "matchedCount": 2,
    "results": [
      { "url": "https://www.ancestry.com/search/collections/7163/", "linkText": "Pennsylvania, Tax and Exoneration, 1768-1801" },
      { "url": "https://www.ancestry.com/search/collections/8054/", "linkText": "1850 United States Federal Census" }
    ]
  }
}
```

`collections-schuylkill.json`:
```json
{
  "tool": "collections",
  "description": "FamilySearch collections for Schuylkill County",
  "response": {
    "query": "Schuylkill County",
    "matchingCollections": 5,
    "collections": [
      {
        "id": 1325221,
        "title": "Pennsylvania, County Marriages, 1885-1950",
        "dateRange": "1885-1950",
        "recordCount": 1200000,
        "personCount": 2400000,
        "imageCount": 0,
        "url": "https://www.familysearch.org/search/collection/1325221"
      }
    ]
  }
}
```

`person-read-flynn.json`:
```json
{
  "tool": "person_read",
  "description": "FamilySearch tree person read for Patrick Flynn stub",
  "response": {
    "id": "LZNY-BRF",
    "gender": "Male",
    "names": [{ "given": "Patrick", "surname": "Flynn" }],
    "facts": [
      { "type": "Birth", "date": "about 1845", "place": "Ireland" },
      { "type": "Death", "date": "12 March 1908", "place": "Schuylkill County, Pennsylvania" }
    ]
  }
}
```

- [ ] **Step 2: Remove the .gitkeep from eval/fixtures/mcp/**

```bash
rm eval/fixtures/mcp/.gitkeep
```

- [ ] **Step 3: Verify all fixture JSON is valid**

```bash
find eval/fixtures/mcp -name "*.json" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

- [ ] **Step 4: Commit**

```bash
git add eval/fixtures/mcp/
git commit -m "feat(eval): add seed MCP fixtures for unit test harness testing"
```

---

### Task 2: Create rubrics for skills batch 1 (stateless + simple analysis)

Create `rubric.md` files for these 8 skills. Each rubric has 3 dimensions with 2-3 sentence descriptions.

**Files to create:**

- [ ] **Step 1: Create all rubric files**

`eval/tests/unit/wiki-lookup/rubric.md`:
```markdown
# Wiki Lookup Rubric

## Dimensions

### Query formulation
Did the skill construct an appropriate Wikipedia search query from the user's request? The query should capture the core topic without unnecessary qualifiers.

### Output formatting
Did the skill produce a well-structured markdown summary with the article title, key extract, and source URL? The summary should be useful for genealogical context.

### File handling
Did the skill save the summary to a file in the user's working folder with an appropriate filename? The file should be created, not just displayed.
```

`eval/tests/unit/translation/rubric.md`:
```markdown
# Translation Rubric

## Dimensions

### Accuracy
Did the skill translate the text accurately, preserving the meaning of genealogical terms (names, places, dates, relationships, occupations)?

### Notation of uncertainty
Did the skill flag ambiguous words, archaic spellings, or abbreviations rather than silently guessing? Genealogical records often use period-specific terminology that has multiple possible meanings.

### Genealogical context
Did the skill identify and explain genealogically significant terms (relationship words, legal terms, religious terminology) rather than providing a generic translation?
```

`eval/tests/unit/convert-dates/rubric.md`:
```markdown
# Convert Dates Rubric

## Dimensions

### Conversion accuracy
Did the skill apply the correct calendar conversion rules for the time period and jurisdiction? Julian-to-Gregorian shifts vary by country and year of adoption.

### Ambiguity handling
Did the skill flag dates that are ambiguous (e.g., dates near a calendar transition, dual-dating periods) rather than silently picking one interpretation?

### Genealogical presentation
Did the skill present the converted date in a format usable for genealogical records, noting both the original and converted forms?
```

`eval/tests/unit/historical-context/rubric.md`:
```markdown
# Historical Context Rubric

## Dimensions

### Relevance to research
Did the skill provide historical context directly relevant to the genealogical research question, not just general history of the time period?

### Source quality
Did the skill draw from reliable historical sources and provide references? Context should be factual, not speculative.

### Genealogical implications
Did the skill explain how the historical context affects record availability, migration patterns, naming conventions, or other factors that impact the research?
```

`eval/tests/unit/project-status/rubric.md`:
```markdown
# Project Status Rubric

## Dimensions

### Completeness of summary
Did the skill report on all GPS elements — questions, plans, search log, evidence, conflicts, hypotheses, and conclusions? Missing sections should be explicitly noted.

### Accuracy
Does the summary accurately reflect the current state of research.json? Are counts, statuses, and next-step recommendations correct?

### Actionability
Did the skill clearly identify what should be done next and why? The recommendation should be specific (e.g., "resolve birthplace conflict before writing proof") not generic ("continue research").
```

`eval/tests/unit/validate-schema/rubric.md`:
```markdown
# Validate Schema Rubric

## Dimensions

### Error detection
Did the skill detect all schema violations in the input files? Missing required fields, invalid enum values, and broken ID references should all be caught.

### Error clarity
Are error messages specific enough to locate and fix the problem? Each error should identify the section, field, and what's wrong.

### False positive rate
Did the skill avoid flagging valid data as errors? Legitimate patterns (null optional fields, empty arrays, valid open enum values) should not trigger warnings.
```

`eval/tests/unit/assertion-classification/rubric.md`:
```markdown
# Assertion Classification Rubric

## Dimensions

### Three-layer accuracy
Did the skill correctly apply all three GPS classification layers: source classification (original/derivative/authored), information quality (primary/secondary/indeterminate), and evidence type (direct/indirect/negative)?

### Informant analysis
Did the skill identify the actual informant and assess their proximity to the event? The recorder (e.g., census enumerator) is not the informant — the person who provided the information is.

### Classification justification
Did the skill explain why each classification was chosen, citing specific characteristics of the source and informant? Classifications without reasoning are not useful.
```

`eval/tests/unit/citation/rubric.md`:
```markdown
# Citation Rubric

## Dimensions

### Evidence Explained compliance
Does the citation follow the Who/What/When/Where/Where-within framework from Evidence Explained? All five elements should be present and correctly populated.

### Replication test
Could another researcher find the exact same record using only this citation? The citation must include enough specificity (page, entry, certificate number, microfilm roll) to locate the source.

### Source vs information distinction
Is the source classified at the source level (original/derivative/authored), not confused with information quality? A single original source can contain both primary and secondary information.
```

- [ ] **Step 2: Remove .gitkeep files from directories that now have rubric.md**

```bash
for skill in wiki-lookup translation convert-dates historical-context project-status validate-schema assertion-classification citation; do
  rm -f "eval/tests/unit/$skill/.gitkeep"
done
```

- [ ] **Step 3: Commit**

```bash
git add eval/tests/unit/
git commit -m "feat(eval): add rubrics for 8 skills (stateless + simple analysis)"
```

---

### Task 3: Create rubrics for skills batch 2 (search, planning, synthesis)

Create `rubric.md` files for these 8 skills.

**Files to create:**

- [ ] **Step 1: Create all rubric files**

`eval/tests/unit/search-records/rubric.md`:
```markdown
# Search Records Rubric

## Dimensions

### Search strategy
Did the skill construct appropriate search parameters from the plan item? Name variants, date ranges, and jurisdictions should be informed by the research context.

### Result triage
Did the skill correctly categorize results as promising, not relevant, or needs review? Near-matches should be flagged, not silently discarded.

### Log quality
Does the log entry accurately record what was searched, how many results were examined, and what was captured? Negative results must be logged honestly — they support exhaustiveness claims.
```

`eval/tests/unit/search-full-text/rubric.md`:
```markdown
# Search Full Text Rubric

## Dimensions

### Query construction
Did the skill construct effective full-text search queries using appropriate operators? Queries should account for spelling variants and name patterns relevant to the time period.

### FAN awareness
Did the skill look for Family, Associates, and Neighbors — not just the research subject? Witness signatures, neighbor listings, and business associates can provide indirect evidence.

### Negative result handling
Did the skill log negative results with enough detail to support exhaustiveness claims? "No results" is different from "searched X, Y, Z collections with queries A, B, C — no results."
```

`eval/tests/unit/search-external-sites/rubric.md`:
```markdown
# Search External Sites Rubric

## Dimensions

### URL generation
Did the skill generate a correctly pre-filled search URL for the target site (Ancestry, MyHeritage, etc.)? The URL should include the search parameters from the plan item.

### Capture guidance
Did the skill provide clear instructions for the click-capture workflow? The user needs to know what to look for and how to return results.

### Result triage
After receiving a capture, did the skill correctly identify relevant records and distinguish them from false positives?
```

`eval/tests/unit/research-plan/rubric.md`:
```markdown
# Research Plan Rubric

## Dimensions

### Record type selection
Did the plan target appropriate record types for the research question? Census, vital, probate, church, and land records each answer different questions — the plan should select based on what information is needed.

### Sequencing logic
Are plan items ordered logically? Free/indexed sources before paid/unindexed. Broad searches before narrow. Fallbacks identified for items that might fail.

### Jurisdiction accuracy
Are the jurisdictions correct for the time period? County boundaries, state formations, and jurisdiction changes over time must be accounted for.
```

`eval/tests/unit/question-selection/rubric.md`:
```markdown
# Question Selection Rubric

## Dimensions

### Prioritization logic
Did the skill correctly prioritize among competing next-question candidates? Unresolved conflicts > timeline gaps > hypothesis tests > new decompositions. The rationale must explain why the selected question takes priority.

### Question specificity
Is the research question specific and answerable? "Learn more about Patrick" is not a research question. "What is Patrick Flynn's birthplace?" is.

### Dependency awareness
Does the question account for dependencies — questions that must be answered first, and questions this answer will unblock? The depends_on and unblocks fields should be populated correctly.
```

`eval/tests/unit/hypothesis-tracking/rubric.md`:
```markdown
# Hypothesis Tracking Rubric

## Dimensions

### Claim clarity
Is the hypothesis stated as a specific, testable claim? "Thomas Flynn might be related" is vague. "Thomas Flynn of Schuylkill County was the father of Patrick Flynn" is testable.

### Evidence linkage
Are supporting and contradicting assertions correctly linked? Each linked assertion should genuinely bear on the hypothesis — tangential evidence should not be included.

### Status transitions
Are status transitions justified? A hypothesis should move to "supported" only with direct evidence and no unresolved contradictions. "Ruled out" requires affirmative refutation, not just lack of evidence.
```

`eval/tests/unit/person-evidence/rubric.md`:
```markdown
# Person Evidence Rubric

## Dimensions

### Confidence calibration
Is the confidence level (confident/probable/speculative) appropriate for the strength of evidence? A single census co-residence is "probable" at best — "confident" requires corroboration.

### Rationale quality
Does the rationale explain why this record's role is believed to be this person? It should cite specific matching attributes (name, age, location, family context), not just "names match."

### Multi-person awareness
When an assertion implies a relationship (e.g., "listed as son of Thomas"), did the skill create person_evidence links for both persons? The assertion bears on both the child and the parent.
```

`eval/tests/unit/proof-conclusion/rubric.md`:
```markdown
# Proof Conclusion Rubric

## Dimensions

### Tier justification
Is the proof tier (proved/probable/possible/not_proved/disproved) justified by the evidence? The narrative must explain why this tier and not a higher or lower one. "Probable" should cite what's missing for "proved."

### Narrative standalone
Does the narrative stand alone as a readable GPS conclusion without reference to the rest of the JSON? It must include inline citations, the evidence summary, conflict resolution, and the confidence declaration.

### Evidence completeness
Does the proof cite all relevant assertions and address all resolved conflicts? Omitting inconvenient evidence is a GPS violation.
```

- [ ] **Step 2: Remove .gitkeep files**

```bash
for skill in search-records search-full-text search-external-sites research-plan question-selection hypothesis-tracking person-evidence proof-conclusion; do
  rm -f "eval/tests/unit/$skill/.gitkeep"
done
```

- [ ] **Step 3: Commit**

```bash
git add eval/tests/unit/
git commit -m "feat(eval): add rubrics for 8 skills (search, planning, synthesis)"
```

---

### Task 4: Create rubrics for skills batch 3 (remaining 6)

**Files to create:**

- [ ] **Step 1: Create all rubric files**

`eval/tests/unit/init-project/rubric.md`:
```markdown
# Init Project Rubric

## Dimensions

### File initialization
Did the skill create both research.json and tree.gedcomx.json with all required sections? research.json should have empty arrays for all 11 sections. tree.gedcomx.json should have the stub person.

### Objective decomposition
Did the skill create at least one initial research question derived from the objective? The question should be specific and actionable, not a restatement of the objective.

### Stub person quality
Does the GedcomX stub person contain whatever facts are known (name, approximate dates, places) without fabricating information? Unknown fields should be omitted, not guessed.
```

`eval/tests/unit/record-extraction/rubric.md`:
```markdown
# Record Extraction Rubric

## Dimensions

### Assertion atomicity
Is each assertion a single extractable fact, not a compound claim? "Patrick Flynn, age 5, born Ireland" should produce separate assertions for name, age/birth, and birthplace.

### Informant identification
Did the skill identify the actual informant (not just "census") and assess their proximity to the event? The census enumerator is the recorder — the household member who provided the information is the informant.

### Evidence type accuracy
Were direct, indirect, and negative evidence types assigned correctly? A relationship stated in the 1860 census (explicit column) is direct evidence. A relationship inferred from household position in 1850 (no relationship column) is indirect.
```

`eval/tests/unit/locality-guide/rubric.md`:
```markdown
# Locality Guide Rubric

## Dimensions

### Jurisdiction accuracy
Did the skill correctly identify the relevant jurisdictions for the place and time period? County boundaries, state formations, and name changes over time must be accounted for.

### Record availability
Did the skill identify which record types are available for this jurisdiction and time period, and where they are held (FamilySearch, state archives, county courthouse)?

### Research strategy
Did the skill provide actionable guidance on how to search effectively in this locality, including common pitfalls and alternative repositories?
```

`eval/tests/unit/tree-edit/rubric.md`:
```markdown
# Tree Edit Rubric

## Dimensions

### Data preservation
Did the edit preserve all existing facts and sources from both the original and merged records? No data should be silently dropped during merges or edits.

### Cross-reference integrity
After the edit, do all cross-references in research.json (person_evidence.person_id, timelines.person_ids, project.subject_person_ids) still point to valid GedcomX persons?

### Edit minimality
Did the skill make only the requested change without modifying unrelated data? Edits should be surgical — changing a birth date should not touch relationships or other persons.
```

`eval/tests/unit/check-warnings/rubric.md`:
```markdown
# Check Warnings Rubric

## Dimensions

### Detection accuracy
Did the skill detect genuine impossibilities and anomalies (birth after death, marriage at age 5, 150-year lifespan) without flagging valid edge cases?

### Severity classification
Are warnings classified appropriately by severity? An impossibility (born after death) is critical. An anomaly (married at 16) is a note, not a warning.

### Actionability
Does each warning suggest what to investigate? "Birth year conflict between census and death certificate" is more useful than "possible date error."
```

`eval/tests/unit/timeline/rubric.md`:
```markdown
# Timeline Rubric

## Dimensions

### Chronological ordering
Are events ordered correctly by date, with date certainty reflected? Approximate dates should be positioned reasonably, not treated as exact.

### Gap detection
Did the skill identify meaningful gaps where records should exist but don't? A 48-year gap (1860-1908) is significant. A 1-year gap between census enumerations is not.

### Impossibility detection
Did the skill flag chronological impossibilities (present in two distant locations on the same date, birth after death) as evidence of potential identity conflicts?
```

- [ ] **Step 2: Remove .gitkeep files**

```bash
for skill in init-project record-extraction locality-guide tree-edit check-warnings timeline; do
  rm -f "eval/tests/unit/$skill/.gitkeep"
done
```

- [ ] **Step 3: Commit**

```bash
git add eval/tests/unit/
git commit -m "feat(eval): add rubrics for 6 remaining skills"
```

---

### Task 5: Create unit tests batch 1 — stateless skills (7 tests)

Skills: wiki-lookup, translation, convert-dates, historical-context, locality-guide, init-project, record-extraction. These use `scenario: null` and rely on MCP fixtures or no fixtures.

- [ ] **Step 1: Create all test files**

`eval/tests/unit/wiki-lookup/simple-topic-lookup.json`:
```json
{
  "test": {
    "id": "ut_wiki_lookup_001",
    "skill": "wiki-lookup",
    "name": "Simple genealogy topic lookup",
    "type": "positive",
    "description": "Basic Wikipedia lookup for a genealogically relevant place.",
    "tags": ["wikipedia", "simple", "place"]
  },
  "input": {
    "user_message": "Look up Schuylkill County, Pennsylvania on Wikipedia",
    "scenario": null
  },
  "mcp_fixtures": ["wikipedia-schuylkill-county"],
  "additional_criteria": [
    "Should save the summary to a file in the user's working folder, not just display it"
  ]
}
```

`eval/tests/unit/translation/german-kurrent-baptism.json`:
```json
{
  "test": {
    "id": "ut_translation_001",
    "skill": "translation",
    "name": "Translate German Kurrent baptism record",
    "type": "positive",
    "description": "Translate a short German Kurrent baptism record entry with genealogically significant terms.",
    "tags": ["german", "kurrent", "baptism", "church-record"]
  },
  "input": {
    "user_message": "Translate this German baptism record: 'Den 15. März 1845 wurde Johann Friedrich, ehelicher Sohn des Thomas Flynn, Bergmann, und seiner Ehefrau Maria geb. Kelly, getauft. Taufpaten: Patrick O'Brien und Bridget Mahoney.'",
    "scenario": null
  },
  "additional_criteria": [
    "Should identify and translate genealogical terms: ehelicher Sohn (legitimate son), Bergmann (miner), geb. (née/born as), Taufpaten (godparents)",
    "Should note that the names suggest an Irish family using a German church, which is common in Pennsylvania mining communities"
  ]
}
```

`eval/tests/unit/convert-dates/quaker-date-conversion.json`:
```json
{
  "test": {
    "id": "ut_convert_dates_001",
    "skill": "convert-dates",
    "name": "Convert Quaker date notation",
    "type": "positive",
    "description": "Convert a Quaker-style date (numbered months) to standard calendar format. Quaker records are common in Pennsylvania genealogy.",
    "tags": ["quaker", "numbered-months", "pennsylvania"]
  },
  "input": {
    "user_message": "Convert this Quaker date: '3rd day of 2nd month 1845'. What date is this in the standard calendar?",
    "scenario": null
  },
  "additional_criteria": [
    "Should explain that Quakers numbered months to avoid pagan day/month names",
    "Should correctly identify 2nd month as February (post-1752 in English colonies) and produce February 3, 1845"
  ]
}
```

`eval/tests/unit/historical-context/irish-famine-migration.json`:
```json
{
  "test": {
    "id": "ut_historical_context_001",
    "skill": "historical-context",
    "name": "Irish famine migration context for 1840s Pennsylvania",
    "type": "positive",
    "description": "Provide historical context for Irish immigration to Pennsylvania coal country in the 1840s-1850s.",
    "tags": ["irish", "immigration", "1840s", "pennsylvania", "famine"]
  },
  "input": {
    "user_message": "What historical context should I know about Irish immigration to Schuylkill County, Pennsylvania in the 1840s?",
    "scenario": null
  },
  "mcp_fixtures": ["search-wiki-irish-immigration"],
  "additional_criteria": [
    "Should mention the Great Famine (1845-1852) as the primary driver of Irish emigration in this period",
    "Should note that Schuylkill County was an anthracite coal mining region that attracted Irish laborers"
  ]
}
```

`eval/tests/unit/locality-guide/schuylkill-county-records.json`:
```json
{
  "test": {
    "id": "ut_locality_guide_001",
    "skill": "locality-guide",
    "name": "Schuylkill County record availability guide",
    "type": "positive",
    "description": "Provide a locality guide for genealogical research in Schuylkill County, Pennsylvania.",
    "tags": ["locality", "pennsylvania", "schuylkill", "record-availability"]
  },
  "input": {
    "user_message": "What records are available for genealogical research in Schuylkill County, Pennsylvania in the 1840s-1860s?",
    "scenario": null
  },
  "mcp_fixtures": ["places-schuylkill-county", "collections-schuylkill", "external-links-schuylkill"],
  "additional_criteria": [
    "Should identify key record types available: census (1850, 1860), church records, land records, naturalization records",
    "Should note that Pennsylvania vital records registration began in 1906 — earlier births/deaths require church or county records"
  ]
}
```

`eval/tests/unit/init-project/new-project-from-tree.json`:
```json
{
  "test": {
    "id": "ut_init_project_001",
    "skill": "init-project",
    "name": "Initialize project from FamilySearch tree person",
    "type": "positive",
    "description": "Create a new research project from a FamilySearch person ID and research objective.",
    "tags": ["initialization", "familysearch", "tree"]
  },
  "input": {
    "user_message": "Start a new research project to identify the parents of Patrick Flynn. His FamilySearch person ID is LZNY-BRF.",
    "scenario": null
  },
  "mcp_fixtures": ["person-read-flynn"],
  "additional_criteria": [
    "Should create both research.json and tree.gedcomx.json",
    "Should set the project objective to match the user's stated goal",
    "Should treat FamilySearch tree data as unverified starting points, not established facts"
  ]
}
```

`eval/tests/unit/record-extraction/census-1850-single-household.json`:
```json
{
  "test": {
    "id": "ut_record_extraction_001",
    "skill": "record-extraction",
    "name": "Extract assertions from 1850 census household",
    "type": "positive",
    "description": "Extract assertions from a simple 1850 census record. The 1850 census does not state relationships — they must be inferred from household position.",
    "tags": ["census", "1850", "extraction", "indirect-evidence"]
  },
  "input": {
    "user_message": "Extract assertions from this 1850 census record for the Thomas Flynn household in Schuylkill County: Thomas Flynn, age 32, male, born Ireland, miner; Mary Flynn, age 28, female, born Ireland; Patrick Flynn, age 5, male, born Ireland.",
    "scenario": null
  },
  "additional_criteria": [
    "Should create separate assertions for each person's name, age/birth, birthplace, and occupation",
    "Should classify relationships as indirect evidence — the 1850 census has no relationship column",
    "Should note that the informant is unknown (household member, likely Thomas or wife) and set informant_proximity accordingly"
  ]
}
```

- [ ] **Step 2: Remove .gitkeep files for skills that now have test files**

```bash
for skill in wiki-lookup translation convert-dates historical-context locality-guide init-project record-extraction; do
  rm -f "eval/tests/unit/$skill/.gitkeep"
done
```

- [ ] **Step 3: Verify all JSON**

```bash
find eval/tests/unit -name "*.json" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

- [ ] **Step 4: Commit**

```bash
git add eval/tests/unit/
git commit -m "feat(eval): add seed unit tests for 7 stateless skills"
```

---

### Task 6: Create unit tests batch 2 — skills using mid-research-flynn (8 tests)

Skills: assertion-classification, citation, check-warnings, project-status, question-selection, hypothesis-tracking, person-evidence, validate-schema. All use `scenario: "mid-research-flynn"`.

- [ ] **Step 1: Create all test files**

`eval/tests/unit/assertion-classification/reclassify-census-informant.json`:
```json
{
  "test": {
    "id": "ut_assertion_classification_001",
    "skill": "assertion-classification",
    "name": "Reclassify 1850 census informant proximity",
    "type": "positive",
    "description": "Review and refine the classification of assertion a_001 (Patrick Flynn's name from the 1850 census). The current classification has informant_proximity as 'unknown' — the skill should analyze whether this can be refined.",
    "tags": ["census", "1850", "informant", "reclassification"]
  },
  "input": {
    "user_message": "Review the evidence classification for assertion a_001.",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should analyze whether 'unknown' informant proximity for a name fact is appropriate or if it can be refined based on census enumeration practices"
  ]
}
```

`eval/tests/unit/citation/refine-census-citation.json`:
```json
{
  "test": {
    "id": "ut_citation_001",
    "skill": "citation",
    "name": "Refine 1850 census citation to Evidence Explained format",
    "type": "positive",
    "description": "Review and refine the citation for source src_001 (1850 U.S. Census). Verify it follows Evidence Explained standards.",
    "tags": ["census", "1850", "evidence-explained", "citation-format"]
  },
  "input": {
    "user_message": "Review the citation for source src_001 and make sure it follows Evidence Explained standards.",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should verify all five citation_detail fields (who, what, when_created, when_accessed, where, where_within) are populated and accurate"
  ]
}
```

`eval/tests/unit/check-warnings/check-flynn-assertions.json`:
```json
{
  "test": {
    "id": "ut_check_warnings_001",
    "skill": "check-warnings",
    "name": "Check Patrick Flynn assertions for impossibilities",
    "type": "positive",
    "description": "Run warnings check on Patrick Flynn's linked assertions. The current data has no impossibilities — the skill should confirm this cleanly.",
    "tags": ["warnings", "validation", "clean-data"]
  },
  "input": {
    "user_message": "Check Patrick Flynn's evidence for any impossibilities or warnings.",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should examine all assertions linked to person I1 via person_evidence",
    "Should confirm no chronological impossibilities exist in the current data (birth ~1845, census 1850 age 5, census 1860 age 15, death 1908 — all consistent)"
  ]
}
```

`eval/tests/unit/project-status/mid-project-summary.json`:
```json
{
  "test": {
    "id": "ut_project_status_001",
    "skill": "project-status",
    "name": "Summarize mid-project Flynn research status",
    "type": "positive",
    "description": "Generate a status summary for the Flynn parentage research project at mid-point.",
    "tags": ["status", "summary", "mid-project"]
  },
  "input": {
    "user_message": "What's the current status of this research project?",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should report that q_002 is resolved and q_001 is in progress",
    "Should note that the proof summary is at 'probable' tier and identify what's needed to reach 'proved'"
  ]
}
```

`eval/tests/unit/question-selection/next-question-after-census.json`:
```json
{
  "test": {
    "id": "ut_question_selection_001",
    "skill": "question-selection",
    "name": "Select next question with probate search pending",
    "type": "positive",
    "description": "Select the next research question given that census and death cert searches are complete but probate is pending.",
    "tags": ["question-selection", "probate", "next-step"]
  },
  "input": {
    "user_message": "What should I research next?",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should note that plan item pli_006 (probate search) is still in_progress and recommend completing it before formulating new questions"
  ]
}
```

`eval/tests/unit/hypothesis-tracking/review-parentage-hypothesis.json`:
```json
{
  "test": {
    "id": "ut_hypothesis_tracking_001",
    "skill": "hypothesis-tracking",
    "name": "Review status of parentage hypothesis h_001",
    "type": "positive",
    "description": "Review the Thomas Flynn parentage hypothesis given the current evidence.",
    "tags": ["hypothesis", "parentage", "status-review"]
  },
  "input": {
    "user_message": "What's the status of our hypothesis that Thomas Flynn was Patrick's father?",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should cite the three supporting assertions (a_004, a_010, a_013) and explain why each supports the hypothesis",
    "Should note that no contradicting evidence exists but probate records haven't been searched yet"
  ]
}
```

`eval/tests/unit/person-evidence/link-death-cert-to-patrick.json`:
```json
{
  "test": {
    "id": "ut_person_evidence_001",
    "skill": "person-evidence",
    "name": "Verify person-evidence link for death certificate",
    "type": "positive",
    "description": "Review the person-evidence link pe_005 (death cert assertion a_013 → Patrick I1). The link should be 'confident' given the death certificate directly names the deceased.",
    "tags": ["person-evidence", "death-cert", "confident-link"]
  },
  "input": {
    "user_message": "Review the identity link between the death certificate and Patrick Flynn.",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should confirm that pe_005 linking a_013 to I1 is appropriate at 'confident' level — the death certificate is for Patrick Flynn of Schuylkill County, matching all known attributes"
  ]
}
```

`eval/tests/unit/validate-schema/validate-mid-research-state.json`:
```json
{
  "test": {
    "id": "ut_validate_schema_001",
    "skill": "validate-schema",
    "name": "Validate well-formed mid-research project files",
    "type": "positive",
    "description": "Run schema validation on the mid-research-flynn project files. Both files should pass with no errors.",
    "tags": ["validation", "clean-data", "schema"]
  },
  "input": {
    "user_message": "Validate the project files for schema compliance.",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should report that both research.json and tree.gedcomx.json pass validation with no errors",
    "Should not flag any false positives on valid patterns (null optional fields, empty arrays)"
  ]
}
```

- [ ] **Step 2: Remove .gitkeep files**

```bash
for skill in assertion-classification citation check-warnings project-status question-selection hypothesis-tracking person-evidence validate-schema; do
  rm -f "eval/tests/unit/$skill/.gitkeep"
done
```

- [ ] **Step 3: Verify all JSON**

```bash
find eval/tests/unit -name "*.json" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

- [ ] **Step 4: Commit**

```bash
git add eval/tests/unit/
git commit -m "feat(eval): add seed unit tests for 8 skills using mid-research-flynn scenario"
```

---

### Task 7: Create unit tests batch 3 — remaining skills (7 tests)

Skills: research-plan, search-records, search-full-text, search-external-sites, timeline, proof-conclusion, tree-edit.

- [ ] **Step 1: Create all test files**

`eval/tests/unit/research-plan/plan-for-parentage-question.json`:
```json
{
  "test": {
    "id": "ut_research_plan_001",
    "skill": "research-plan",
    "name": "Create research plan for parentage question",
    "type": "positive",
    "description": "Generate a research plan for question q_001 (Who were Patrick Flynn's parents?). Plan pl_002 already exists — the skill should review or extend it.",
    "tags": ["planning", "parentage", "plan-review"]
  },
  "input": {
    "user_message": "Create or review the research plan for the parentage question.",
    "scenario": "mid-research-flynn"
  },
  "mcp_fixtures": ["places-schuylkill-county", "collections-schuylkill"],
  "additional_criteria": [
    "Should acknowledge that pl_002 already exists with census and death cert searches completed",
    "Should confirm that the probate search (pli_006) is the logical next step"
  ]
}
```

`eval/tests/unit/search-records/execute-census-search.json`:
```json
{
  "test": {
    "id": "ut_search_records_001",
    "skill": "search-records",
    "name": "Execute 1850 census search from plan item",
    "type": "positive",
    "description": "Execute plan item pli_001 (1850 census search on FamilySearch for Patrick Flynn in Schuylkill County).",
    "tags": ["search", "census", "1850", "plan-execution"]
  },
  "input": {
    "user_message": "Search the 1850 census for Patrick Flynn in Schuylkill County as planned.",
    "scenario": "mid-research-flynn"
  },
  "mcp_fixtures": ["record-search-1850-census-flynn"],
  "additional_criteria": [
    "Should create a log entry recording the search parameters and outcome",
    "Should pass promising results to record-extraction or present them for review"
  ]
}
```

`eval/tests/unit/search-full-text/search-for-flynn-witnesses.json`:
```json
{
  "test": {
    "id": "ut_search_full_text_001",
    "skill": "search-full-text",
    "name": "Full-text search for Flynn family associates",
    "type": "positive",
    "description": "Search for mentions of Flynn family members as witnesses or associates in Schuylkill County records.",
    "tags": ["fulltext", "FAN", "witnesses", "associates"]
  },
  "input": {
    "user_message": "Search for any mentions of Thomas Flynn or Patrick Flynn as witnesses in Schuylkill County land records.",
    "scenario": "mid-research-flynn"
  },
  "mcp_fixtures": ["fulltext-search-flynn-witnesses"],
  "additional_criteria": [
    "Should construct a full-text query targeting Flynn family names in witness/associate contexts",
    "Should log the search result even though it's a FAN search, not a direct plan item"
  ]
}
```

`eval/tests/unit/search-external-sites/ancestry-census-search.json`:
```json
{
  "test": {
    "id": "ut_search_external_sites_001",
    "skill": "search-external-sites",
    "name": "Generate Ancestry search URL for 1850 census",
    "type": "positive",
    "description": "Generate a pre-filled Ancestry search URL for Patrick Flynn in the 1850 census and guide the user through the capture workflow.",
    "tags": ["ancestry", "external-site", "census", "1850"]
  },
  "input": {
    "user_message": "Search for Patrick Flynn on Ancestry's 1850 census.",
    "scenario": "mid-research-flynn"
  },
  "mcp_fixtures": ["external-links-schuylkill"],
  "additional_criteria": [
    "Should generate a clickable URL pre-filled with Patrick Flynn's search parameters",
    "Should instruct the user to capture results as a PDF and paste them back"
  ]
}
```

`eval/tests/unit/timeline/build-patrick-timeline.json`:
```json
{
  "test": {
    "id": "ut_timeline_001",
    "skill": "timeline",
    "name": "Build timeline for Patrick Flynn",
    "type": "positive",
    "description": "Build a chronological timeline for Patrick Flynn (I1) from the current assertions and person_evidence links.",
    "tags": ["timeline", "chronological", "gap-detection"]
  },
  "input": {
    "user_message": "Build a timeline for Patrick Flynn.",
    "scenario": "mid-research-flynn"
  },
  "mcp_fixtures": ["places-schuylkill-county"],
  "additional_criteria": [
    "Should identify the 48-year gap between the 1860 census and the 1908 death as a significant gap needing research (1870, 1880, 1900 censuses, marriage, residence)"
  ]
}
```

`eval/tests/unit/proof-conclusion/write-parentage-proof.json`:
```json
{
  "test": {
    "id": "ut_proof_conclusion_001",
    "skill": "proof-conclusion",
    "name": "Write proof conclusion for Flynn parentage",
    "type": "positive",
    "description": "Write a GPS proof conclusion for question q_001 (Who were Patrick Flynn's parents?). The evidence supports 'probable' tier.",
    "tags": ["proof", "parentage", "probable", "GPS"]
  },
  "input": {
    "user_message": "Write the proof conclusion for the parentage question.",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should produce a 'probable' tier proof, not 'proved' — research is not yet exhaustive (1870/1880/1900 censuses and probate not searched)",
    "Should cite all three lines of evidence (1850 co-residence, 1860 explicit relationship, death cert naming father)"
  ]
}
```

`eval/tests/unit/tree-edit/add-birth-fact.json`:
```json
{
  "test": {
    "id": "ut_tree_edit_001",
    "skill": "tree-edit",
    "name": "Add refined birth fact to Patrick Flynn",
    "type": "positive",
    "description": "Update Patrick Flynn's birth fact in tree.gedcomx.json based on resolved evidence. The current fact says '~1845' with place 'Ireland' — this should remain as-is since the conflict was resolved in favor of Ireland.",
    "tags": ["tree-edit", "birth-fact", "update"]
  },
  "input": {
    "user_message": "Patrick Flynn's birth fact currently shows ~1845 in Ireland. The conflict resolution confirmed Ireland as the birthplace. Please verify the tree reflects this correctly.",
    "scenario": "mid-research-flynn"
  },
  "additional_criteria": [
    "Should confirm that F1 already shows place 'Ireland' which matches the conflict resolution (c_001 preferred Ireland over Pennsylvania)",
    "Should not modify the fact if it's already correct"
  ]
}
```

- [ ] **Step 2: Remove .gitkeep files**

```bash
for skill in research-plan search-records search-full-text search-external-sites timeline proof-conclusion tree-edit; do
  rm -f "eval/tests/unit/$skill/.gitkeep"
done
```

- [ ] **Step 3: Verify all JSON**

```bash
find eval/tests/unit -name "*.json" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

- [ ] **Step 4: Commit**

```bash
git add eval/tests/unit/
git commit -m "feat(eval): add seed unit tests for 7 remaining skills"
```

---

### Task 8: Final verification

- [ ] **Step 1: Verify directory structure**

```bash
# Every skill should have rubric.md + at least one .json test
for skill in $(ls eval/tests/unit/); do
  echo "=== $skill ==="
  ls eval/tests/unit/$skill/
done
```

Expected: Each of the 23 skill directories has `rubric.md` and at least one `.json` file. No `.gitkeep` files remain in skill directories.

- [ ] **Step 2: Count totals**

```bash
echo "Rubrics: $(find eval/tests/unit -name 'rubric.md' | wc -l)"
echo "Tests: $(find eval/tests/unit -name '*.json' | wc -l)"
echo "Scenarios: $(ls -d eval/fixtures/scenarios/*/ | wc -l)"
echo "MCP fixtures: $(find eval/fixtures/mcp -name '*.json' | wc -l)"
```

Expected: 23 rubrics, 23 tests (1 existing + 22 new), 2 scenarios, 8 MCP fixtures.

- [ ] **Step 3: Validate all JSON**

```bash
find eval -name "*.json" -exec python3 -c "import json,sys; json.load(open(sys.argv[1])); print(f'OK: {sys.argv[1]}')" {} \;
```

Expected: All files OK.
