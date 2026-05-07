---
name: historical-context
description: Provides historical context for genealogy research — boundary
  changes, naming conventions, migration patterns, record availability by
  era, cultural practices, and historical events that affect records. Use
  when the user says "what was happening in [place] in [year]?", "boundary
  changes", "naming conventions", "why would [thing] appear in a record?",
  "migration patterns", "explain this record's context", "what does
  [historical term] mean?", or when understanding historical context is
  needed to interpret a record correctly. Do NOT use when the user wants
  a comprehensive locality guide with record availability (use
  locality-guide), wants to search for records (use search-records), or
  wants to translate a non-English record (use translation).
---

# Historical Context

Provides the historical background needed to correctly interpret
genealogical records. Records don't exist in a vacuum — they were
created by specific institutions, in specific political contexts,
with specific social conventions. Misunderstanding the context leads
to misinterpreting the records.

## MCP tools used

| Tool | Purpose |
|------|---------|
| `wiki_query` | FamilySearch wiki articles about historical topics affecting genealogy |
| `wiki_read` | Full wiki articles for detailed context |
| `wikipedia_query` | Wikipedia articles about historical events, places, institutions |
| `wikipedia_read` | Full historical context from Wikipedia |

## What this skill covers

### Boundary changes

Political boundaries change over time. A person "born in Virginia"
who later appears as "born in West Virginia" didn't move — the state
split in 1863. Common boundary changes affecting genealogy:

- **State/country formation:** West Virginia from Virginia (1863),
  Maine from Massachusetts (1820), many European boundary changes
  after WWI/WWII
- **County formation:** New counties carved from existing ones.
  Records may be in the "parent" county before the split date.
- **Parish/township changes:** Affects church and civil records
- **City annexation:** Affects which county holds records

When the user encounters a birthplace discrepancy that might be a
boundary change, research the jurisdiction's history.

### Naming conventions

Historical naming practices differ from modern ones:

- **Patronymics:** Scandinavian (Lars Andersson = Lars, son of
  Anders), Welsh (ap/ab), Irish (O'/Mac), Scottish (Mac/Mc)
- **"Junior"/"Senior":** Historically meant "younger/older man of
  same name in the community" — not necessarily father/son
- **"In-law":** Could mean step-relationship, not just
  marriage-relationship, in earlier periods
- **Americanization:** Müller → Miller, Schmidt → Smith,
  Schwarz → Black, Blanc → White
- **"Dutch" for "Deutsch":** German immigrants listed as "Dutch"
  (from "Deutsch") — not from the Netherlands
- **Occupational surnames:** Relatively recent (post-1300 in most
  of Europe)
- **Women's names:** Maiden name vs. married name conventions vary
  by jurisdiction and period

### Migration patterns

People moved in clusters — understanding migration patterns reveals
where to search:

- **Chain migration:** One family member moves, sends for others.
  Look for the same surnames in the origin and destination.
- **Religious communities:** Quakers, Mennonites, Moravians often
  moved as groups with their church.
- **Economic migration:** Mining regions attracted specific ethnic
  groups (Welsh to coal country, Cornish to copper/tin regions)
- **Push factors:** Famine (Irish 1845-1852), revolution (German
  1848), pogroms (Eastern European Jews 1880s-1910s)
- **Common routes:** Specific ports, canal routes, railroad lines
  channeled migration along predictable paths

### Record creation context

Why certain records exist or don't exist:

- **Civil registration dates:** Vary by country and state.
  England 1837, France 1792, various US states 1860-1920.
  Before civil registration: church records only.
- **Census questions changed:** 1850 US census first named all
  household members. 1870 first asked birthplace of parents.
  1880 first asked relationship to head.
- **Literacy levels:** Affect record accuracy. Enumerators wrote
  what they heard — names are phonetic approximations.
- **Record destruction:** 1890 US census fire. Courthouse fires
  (many Southern counties during Civil War). WWII bombing of
  European archives.
- **Institutional records:** Church, school, employer, union —
  these exist independent of government registration.

### Cultural practices affecting records

- **Age reporting:** "Age heaping" on round numbers (30, 40, 50)
  is well-documented in census records. Women sometimes
  understated age.
- **Military age fraud:** Men overstating age to enlist (Civil War,
  WWI) or understating to avoid conscription.
- **Ethnic concealment:** German-Americans during WWI, Japanese-
  Americans during WWII. Names anglicized, birthplace reported
  differently.
- **Religious conversion:** May change name, community, and record
  trail.
- **Adoption/informal fosterage:** Children "given" to relatives
  without legal proceedings. Common in pre-20th-century America.

## Steps

### 1. Identify the context question

What does the user need to understand? Categories:
- "Why does this record say X?" (interpretation)
- "Where would records be for [place] in [year]?" (jurisdiction)
- "Why can't I find [person]?" (search strategy)
- "What does [term/title/abbreviation] mean?" (vocabulary)

### 2. Research the context

Call MCP tools for relevant information:

```
wiki_query({ query: "German immigration Pennsylvania 1840s" })
wikipedia_query({ query: "History of Schuylkill County Pennsylvania" })
```

### 3. Present the context

Provide clear, concise historical context with:
- The specific answer to their question
- How it affects their research (actionable implications)
- Where to look next based on the context

**Example:**

User: "Why does the 1850 census say Patrick was born in Ireland
but the death certificate says Pennsylvania?"

Response: "This is a common discrepancy. The 1850 census
informant was likely a household member (Thomas Flynn or his wife)
who had direct knowledge of Patrick's birthplace. The 1908 death
certificate informant was James Brown (son-in-law), reporting 63
years after the event — he may have confused Patrick's place of
residence with his place of birth, or may not have known Patrick
immigrated as a young child.

Additionally, some Irish immigrants in the 1840s-1850s listed
their children's birthplace as the first American state of
residence rather than Ireland, especially for children who arrived
very young. This was partly assimilation pressure and partly
practical — a child who arrived at age 2 may not have been
considered 'from' Ireland by the family.

Implication for your research: The census records (contemporary,
household informant) carry more weight than the death certificate
(later recollection, secondary informant) for birthplace per the
GPS preponderance hierarchy."

## Important rules

- **Output only — no file writes.** This skill provides context
  to inform research decisions. It does not modify project files.
- **Connect context to action.** Don't just explain history —
  explain how it affects the user's specific research. "This means
  you should search in X" or "This explains the discrepancy in
  assertion a_012."
- **Cite sources.** When information comes from a wiki article or
  Wikipedia page, mention the source.
- **Don't speculate beyond evidence.** Historical context explains
  what COULD have happened, not what DID happen. Present
  possibilities, not conclusions.
- **Distinguish from locality-guide.** This skill explains WHY
  things are the way they are (history, culture, context).
  locality-guide explains WHAT records exist and WHERE they are.
  If the user asks "what records exist in Schuylkill County?" →
  locality-guide. If they ask "why is the birthplace different
  across records?" → historical-context.
