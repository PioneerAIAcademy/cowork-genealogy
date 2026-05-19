---
name: historical-context
model: claude-sonnet-4-6
description: Provides historical context for genealogy research — boundary
  changes, naming conventions, migration patterns, record availability by
  era, cultural practices, and historical events that affect records. Use
  when the user says "what was happening in [place] in [year]?", "boundary
  changes", "naming conventions", "why would [thing] appear in a record?",
  "migration patterns", "explain this record's context", "what does
  [historical term] mean?", or when understanding historical context is
  needed to interpret a record correctly. Do NOT use when the user wants
  a comprehensive locality guide with record availability (use
  locality-guide), wants to search for records (use search-records), wants
  to translate a non-English record (use translation), wants to convert
  a date between calendar systems (use convert-dates), or wants to formally
  resolve conflicting evidence (use conflict-resolution).
---

# Historical Context

Provides the historical background needed to correctly interpret
genealogical records. Records were created by specific institutions,
in specific political contexts, with specific social conventions.
Misunderstanding the context leads to misinterpreting the records.

## Reference files

Load these before responding:

| File | When to load |
|------|-------------|
| `references/broad-context-factors.md` | Always — core framework for contextual analysis |
| `references/historical-terminology.md` | When interpreting relationship terms, legal language, or record vocabulary |
| `references/boundary-and-calendar-changes.md` | When place discrepancies or date conflicts arise |

The reference files contain the detailed content. Do NOT duplicate
their content when responding — load and apply them.

## MCP tools used

| Tool | Purpose |
|------|---------|
| `wiki_query` | FamilySearch wiki articles about historical topics affecting genealogy |
| `wiki_read` | Full wiki articles for detailed context |
| `wikipedia_query` | Wikipedia articles about historical events, places, institutions |
| `wikipedia_read` | Full historical context from Wikipedia |
| `place_population` | Population statistics to understand community size and record survival likelihood |

## Steps

### 1. Load reference files

Load the relevant reference files from `references/` based on the
user's question. Always load `broad-context-factors.md`. Load
the terminology or boundary references when those topics are
involved.

### 2. Identify the context question

What does the user need to understand?

- "Why does this record say X?" → interpretation. Apply the
  historical-terminology reference and broad-context factors.
- "Where would records be for [place] in [year]?" → jurisdiction.
  Check boundary changes, then hand off to locality-guide for the
  full record survey.
- "Why can't I find [person]?" → search strategy. Consider
  migration, occupation, ethnic/linguistic factors, name changes.
- "What does [term/title/abbreviation] mean?" → vocabulary. Apply
  the historical-terminology reference.
- "Why do these records conflict?" → discrepancy context. Provide
  the historical explanation, then hand off to conflict-resolution
  if the user wants a formal GPS resolution.

### 3. Research the context

Call MCP tools for relevant information:

```
wiki_query({ query: "German immigration Pennsylvania 1840s" })
wikipedia_query({ query: "History of Schuylkill County Pennsylvania" })
place_population({ place_id: "<id>", year_start: 1840, year_end: 1880 })
```

Use the `place_population` tool when community size matters for
interpreting the research context — a small rural community will
have different record-keeping practices and survival rates than a
large city.

Also consider broader historical sources — local histories, county
formation records, immigration law timelines — not just records
about the specific person. Evidence comes from histories of the
area, its population, and relevant time periods, and from works
describing customs, governance, laws, and regulations (BCG
standard 41).

### 4. Present the context

Provide clear, concise historical context with:
- The specific answer to their question
- How it affects their research (actionable implications)
- Where to look next based on the context

**Example:**

User: "Why does the 1850 census say Patrick was born in Ireland
but the death certificate says Pennsylvania?"

Response: "This is a common discrepancy. The 1850 census
informant was likely a household member with direct knowledge of
Patrick's birthplace. The 1908 death certificate informant was
James Brown (son-in-law), reporting 63 years after the event —
he may have confused place of residence with place of birth, or
may not have known Patrick immigrated as a young child.

Some Irish immigrants in the 1840s-1850s listed children's
birthplace as the first American state of residence rather than
Ireland, especially for children who arrived very young.

Implication: The census records (contemporary, household informant)
carry more weight than the death certificate (later recollection,
secondary informant) for birthplace."

**Example:**

User: "The 1861 census shows Thomas Olds with his mother and a
stepfather who is a Station Master. How does this connect to his
father who died in a railway accident?"

Response: "This reflects occupational and geographic networks.
Thomas Olds Sr. died in a railway accident, and his widow later
married a Station Master — both connected to the railway industry.
People married within their professional communities, and families
clustered near workplaces.

Note that 'in-law' in this period often meant step-relationship,
not relationship by marriage. So 'mother-in-law' on a census could
mean stepmother.

Implication: Search railway employment records, accident reports,
and occupational archives. Also look for other railway families in
the same parish — they may be connected through marriage or kinship."

## Decision rules

| Situation | Action |
|-----------|--------|
| User asks "what records exist in [place]?" | Hand off to locality-guide — that skill surveys record availability |
| User asks to formally resolve a discrepancy | Provide the historical context, then hand off to conflict-resolution for GPS-compliant resolution |
| User asks to convert a date between calendars | Hand off to convert-dates — this skill explains WHY calendar differences exist, not HOW to convert |
| User asks to translate a non-English record | Hand off to translation |
| User asks about a historical term in a foreign language | If the term is language-specific (e.g., German church vocabulary), hand off to translation. If it is English terminology with a historical meaning (e.g., "yeoman," "in-law"), handle here |
| Place discrepancy in records | Check boundary changes first (most common cause), then consider ethnic concealment, informant error, naming conventions. Present multiple possibilities |
| Date discrepancy of exactly 10-13 days or 1 year (Jan-Mar) | Note this likely reflects a calendar-system difference, not a true conflict. Suggest convert-dates for the actual conversion |
| User asks "why" about an absence of records | Explain the historical reason (courthouse fire, pre-civil-registration era, boundary change moving records to a different jurisdiction) |
| Multiple possible explanations | Present all plausible explanations, ordered by likelihood. Do not pick one without evidence |

## Important rules

- **Output only — no file writes.** This skill provides context
  to inform research decisions. It does not modify project files.
- **Always load reference files first.** The reference files contain
  the GPS-grounded framework. Do not skip them.
- **Connect context to action.** Do not just explain history —
  explain how it affects the user's specific research. "This means
  you should search in X" or "This explains the discrepancy in
  assertion a_012."
- **Consider the full range of broad context factors.** A place
  discrepancy might be caused by a boundary change, but it could
  also reflect ethnic concealment, informant error, or a naming
  convention. Consider multiple possibilities.
- **Interpret terms in their historical context.** Always consider
  whether a word meant something different at the time and place
  the record was created. See the historical-terminology reference.
- **Use occupational and geographic networks.** When families are
  connected through shared occupations or locations, note these
  connections explicitly. They suggest new sources to search.
- **Cite sources.** When information comes from a wiki article or
  Wikipedia page, mention the source.
- **Do not speculate beyond evidence.** Historical context explains
  what COULD have happened, not what DID happen. Present
  possibilities, not conclusions.
- **Distinguish from locality-guide.** This skill explains WHY
  things are the way they are. locality-guide explains WHAT records
  exist and WHERE they are.
- **Distinguish from conflict-resolution.** This skill provides
  historical explanations for discrepancies. conflict-resolution
  formally weighs evidence and writes GPS-compliant resolutions.
  Provide context here, hand off there for formal resolution.
