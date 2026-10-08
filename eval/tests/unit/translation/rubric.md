# Translation

Grading dimensions for translation unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Accuracy

Did the agent translate the text accurately, preserving the meaning of genealogical terms (names, places, dates, relationships, occupations)?

- **pass:** Translation is faithful; genealogical terms (relationship words like Sohn/figlio, occupation labels, place names) preserve their precise meaning in the target language.
- **partial:** Translation is mostly accurate but at least one genealogical term loses precision (e.g., a specific relationship term flattened to a generic equivalent).
- **fail:** Translation distorts meaning of genealogical terms, or names/places are mistranslated as common nouns.

## Notation of uncertainty

Did the agent flag ambiguous words, archaic spellings, or abbreviations rather than silently guessing? Genealogical records often use period-specific terminology that has multiple possible meanings.

- **pass:** Ambiguous terms are explicitly flagged with possible interpretations recorded; the genealogist can pick.
- **partial:** At least one ambiguous term is silently resolved without flagging its alternatives, even if other ambiguous terms are correctly hedged.
- **fail:** The agent provides no uncertainty notation at all — no hedging language, no alternative readings, no [?] flags — across an entire response where multiple genealogical terms are clearly ambiguous.

## Genealogical context

Did the agent identify and explain genealogically significant terms (relationship words, legal terms, religious terminology) rather than providing a generic translation?

- **pass:** Genealogically significant terms are explained when their translation would lose context — e.g., "Pate" (godfather) is translated and the relationship's research significance is noted.
- **partial:** Significant terms are translated but their genealogical implications (kinship structure, legal status, sacrament-tied dating) aren't flagged.
- **fail:** Translation is purely literal; the genealogist would have to research the cultural/legal context themselves.

## Date formatting

Are the dates in the response accurately translated, and is the calendar flag correctly applied where the jurisdiction had not yet adopted the Gregorian calendar?

- **pass:** Dates are accurately rendered in prose (day, month, year match the record). Where the record's jurisdiction had not yet adopted the Gregorian calendar — or where the jurisdiction is indeterminate, such as a Dutch record between 1582 and 1701 that names no province — the response flags the date as Old Style (or indeterminate) and routes to convert-dates rather than converting it directly. Partially-stated dates (month and year only, or year only) are given only as far as the record states them.
- **partial:** A date is rendered inaccurately (wrong day, month, or year), or a pre-Gregorian date is converted directly rather than flagged and routed.
- **fail:** The agent declines to translate the date(s) at all, or provides no date information from the record despite the record containing a clear date.

## Abbreviation expansion

Did the agent expand every abbreviation in the record individually and correctly? Each church-register abbreviation stands for a specific term, and each is graded on its own: translating the surrounding entry correctly earns no credit for an abbreviation that is left unexpanded, mis-expanded, or omitted. Where the record has no abbreviations, this dimension does not apply.

- **pass:** Every abbreviation in the record is expanded to its correct full form and meaning, each handled individually — e.g., `gest.` → *gestorben* (died) and `get.` → *getauft* (baptized) are kept distinct; `fil. leg.` → *filius/filia legitimus/a* (legitimate son/daughter); `ej.` → *ejusdem* (of the same month). None is silently dropped or folded into a paraphrase.
- **partial:** Exactly one abbreviation is left unexpanded, mis-expanded (including collapsing a confusable pair such as `gest.`/`get.`), or omitted, while the rest are expanded correctly.
- **fail:** Two or more abbreviations are unexpanded, mis-expanded, or omitted, or the response translates around the abbreviations without expanding them.
