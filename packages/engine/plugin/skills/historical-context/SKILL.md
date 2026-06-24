---
name: historical-context
model: claude-sonnet-4-6
description: Provides historical context for genealogy research — boundary changes, naming conventions, migration patterns, record availability by era, cultural practices, and historical events that affect records. Outputs narrative context to the user; does not modify project files. Use
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
allowed-tools:
  - wiki_search
  - wiki_read
  - wikipedia_search
  - place_search
  - place_search_all
  - place_population
---

# Historical Context

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

**Places:** When resolving or writing places, follow `references/places-guidance.md` — resolve with `place_search` / `place_search_all` and record the `standardPlace` (and `standard_place` on persisted facts/assertions/events).

Provides the historical background needed to correctly interpret
genealogical records. Records were created by specific institutions,
in specific political contexts, with specific social conventions.
Misunderstanding the context leads to misinterpreting the records.

## Routing check — do this FIRST, before loading any files or calling any tools

If the question falls into one of these categories, redirect the user immediately and stop:

| Question type | Action |
|---|---|
| "What records exist in [place]?" / "Where do I access records?" / "What records are available?" | Tell the user this is the locality-guide skill's job. Explain briefly why. Do NOT call any MCP tools or load reference files. |
| "Search for / find records for [person]" | Redirect to search-records. |
| "Translate this [non-English] record" / "What does [non-English word] mean?" | Redirect to translation. **Defining or glossing a non-English word — even a one-line "getauft = baptized" — IS translation; do not do it here, not even briefly before redirecting.** Only *English* historical terms (e.g. "relict", "yeoman") are handled in this skill. |
| "Convert this date" | Redirect to convert-dates. |

**When redirecting: output a short explanation and stop. No tool calls. No file reads.**

---

## Reference files

Load these before responding:

| File | When to load |
|------|-------------|
| `references/historical-broad-context.md` | Always — core framework for contextual analysis |
| `references/historical-terminology.md` | When interpreting relationship terms, legal language, or record vocabulary |
| `references/boundary-and-calendar-changes.md` | When place discrepancies or date conflicts arise |

The reference files contain the detailed content. Do NOT duplicate
their content when responding — load and apply them.

## Steps

### 1. Load reference files

Load the relevant reference files from `references/` based on the
user's question. Always load `historical-broad-context.md`. Load
the terminology or boundary references when those topics are
involved.

### 2. Identify the context question

What does the user need to understand?

- "Why does this record say X?" → interpretation. Apply the
  historical-terminology reference and broad-context factors.
- "What records exist / where do I access records for [place]?" →
  record availability. This is locality-guide's job — redirect there
  immediately and do NOT call MCP tools (see the Routing check above).
- "Why can't I find [person]?" → search strategy. Consider
  migration, occupation, ethnic/linguistic factors, name changes.
- "What does [term/title/abbreviation] mean?" → vocabulary for
  English terms (non-English term or record → redirect to
  translation). Apply the historical-terminology reference.

### 3. Research the context

Call MCP tools for relevant information:

```
wiki_search({ query: "German immigration Pennsylvania 1840s" })
wiki_read({ url: "<specific FamilySearch wiki page URL>" })
wikipedia_search({ query: "History of Schuylkill County Pennsylvania" })
place_search({ placeName: "Schuylkill County, Pennsylvania" })
place_population({ standardPlace: "Schuylkill, Pennsylvania, United States", year_start: 1840, year_end: 1880 })
```

Resolve the place with `place_search` first and pass the result's
`standardPlace` field to `place_population`. When the place's jurisdiction
or boundaries changed across the period you're researching, use
`place_search_all` instead — it returns every standard place a location has
belonged to over time, which can explain where records ended up.

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

## Decision rules

| Situation | Action |
|-----------|--------|
| User asks to formally resolve a discrepancy | Provide the historical context, then hand off to conflict-resolution for GPS-compliant resolution |
| User asks to translate, or asks the meaning of, a non-English term or record | If it is language-specific (e.g., German church vocabulary), hand off to translation — do not translate it here. If it is English terminology with a historical meaning (e.g., "yeoman," "in-law"), handle here |
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
  the record was created (e.g., "in-law" often denoted a
  step-relationship, not relation by marriage). See the
  historical-terminology reference.
- **Use occupational and geographic networks.** When families are
  connected through shared occupations or locations, note these
  connections explicitly. They suggest new sources to search.
- **Cite sources, and distinguish what came from tools.** When
  information comes from a wiki article or Wikipedia page, name
  the source in-line. When a tool call returns no results or an
  error, do not continue elaborating that topic as if the search
  succeeded — either narrow the response to what the successful
  calls returned, or flag the gap explicitly ("I could not confirm
  this from the wiki; the following comes from general knowledge
  and should be verified"). Never present training-knowledge claims
  in the same register as tool-verified facts.
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

## Re-invocation behavior

Writes nothing; safe to call repeatedly — each call produces a fresh narrative.
