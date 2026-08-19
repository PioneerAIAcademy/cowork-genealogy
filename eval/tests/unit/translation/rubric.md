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

- **pass:** Genealogically significant terms are explained when their translation would lose context â€” e.g., "Pate" (godfather) is translated and the relationship's research significance is noted.
- **partial:** Significant terms are translated but their genealogical implications (kinship structure, legal status, sacrament-tied dating) aren't flagged.
- **fail:** Translation is purely literal; the genealogist would have to research the cultural/legal context themselves.

## Next-step offers

Did the skill close with both required workflow handoff offers using the canonical phrases from SKILL.md: "Extract assertions from this record?" (record-extraction) and "Link [person] to the tree?" (person-evidence)?

- **pass:** Both offers are present after the translation and annotations, each labeled with its skill name. Phrasing matches the canonical forms in SKILL.md.
- **partial:** One offer is present but the other is missing, or one offer uses a paraphrase rather than the canonical phrase (e.g., "Extract these assertions into research.json?" instead of "Extract assertions from this record?").
- **fail:** Neither offer is present, or both are replaced by open-ended genealogical research suggestions with no skill handoff prompts.

## Date formatting

Where the response includes specific dates in a structured assertions section, are those dates expressed in ISO 8601 format (YYYY-MM-DD) alongside the prose form?

- **pass:** Every date assertion includes both the human-readable prose form and the ISO 8601 parenthetical — e.g., "15 March 1845 (1845-03-15)".
- **partial:** At least one date assertion includes ISO format but one or more do not.
- **fail:** No date assertions include ISO 8601 format; dates appear in prose form only.
