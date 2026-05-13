# Translation Rubric

Grading dimensions for translation unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Accuracy

Did the skill translate the text accurately, preserving the meaning of genealogical terms (names, places, dates, relationships, occupations)?

- **pass:** Translation is faithful; genealogical terms (relationship words like Sohn/figlio, occupation labels, place names) preserve their precise meaning in the target language.
- **partial:** Translation is mostly accurate but at least one genealogical term loses precision (e.g., a specific relationship term flattened to a generic equivalent).
- **fail:** Translation distorts meaning of genealogical terms, or names/places are mistranslated as common nouns.

## Notation of uncertainty

Did the skill flag ambiguous words, archaic spellings, or abbreviations rather than silently guessing? Genealogical records often use period-specific terminology that has multiple possible meanings.

- **pass:** Ambiguous terms are explicitly flagged with possible interpretations recorded; the genealogist can pick.
- **partial:** Ambiguity is noted but the skill picks one interpretation without spelling out the alternative.
- **fail:** Ambiguous terms are silently translated to one interpretation, with no indication the original was uncertain.

## Genealogical context

Did the skill identify and explain genealogically significant terms (relationship words, legal terms, religious terminology) rather than providing a generic translation?

- **pass:** Genealogically significant terms are explained when their translation would lose context — e.g., "Pate" (godfather) is translated and the relationship's research significance is noted.
- **partial:** Significant terms are translated but their genealogical implications (kinship structure, legal status, sacrament-tied dating) aren't flagged.
- **fail:** Translation is purely literal; the genealogist would have to research the cultural/legal context themselves.
