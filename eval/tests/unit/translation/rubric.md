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

Wherever a specific date appears in the response — prose narration, a structured assertions section, a translated passage, anywhere — is it expressed in ISO 8601 format alongside the prose form, except where the pre-Gregorian carve-out requires it to be withheld?

- **pass:** Every date in the response carries both the human-readable prose form and the ISO 8601 parenthetical — e.g., "15 March 1845 (1845-03-15)". A date the record states only partially is given only as far as the record states it (1845-03, or 1845). A date whose jurisdiction had not yet adopted the Gregorian calendar at that date — or whose jurisdiction the record leaves undetermined, such as a Dutch record between 1582 and 1701 that names no province — correctly carries **no** ISO form, and is instead flagged Old Style (or indeterminate) and handed to convert-dates. That is a pass, not a miss: withholding the ISO form is what the skill requires there.
- **partial:** Dates appear in prose form but at least one lacks its ISO 8601 parenthetical, and no carve-out reason is given for the omission. Includes the case where no date carries the ISO form.
- **fail:** The agent declines to translate the date(s) at all, or provides no date information from the record despite the record containing a clear date.
