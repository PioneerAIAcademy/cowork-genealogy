# Convert Dates Rubric

Grading dimensions for convert-dates unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Conversion accuracy

Did the skill apply the correct calendar conversion rules for the time period and jurisdiction? Julian-to-Gregorian shifts vary by country and year of adoption.

- **pass:** Conversion uses the right offset for the jurisdiction-and-year combination (11 days for England 1752; 10 days for Catholic Europe 1582).
- **partial:** Conversion is in the right direction with the right approximate offset but off by 1 day, or applies a generic offset instead of the jurisdiction-specific one.
- **fail:** Conversion is wrong direction, wrong offset, or unapplied when the date clearly requires it.

## Ambiguity handling

Did the skill flag dates that are ambiguous (e.g., dates near a calendar transition, dual-dating periods) rather than silently picking one interpretation?

- **pass:** Ambiguous dates are explicitly flagged with both possible interpretations recorded; the genealogist can pick.
- **partial:** Ambiguity is noted but the skill picks an interpretation without spelling out the alternative.
- **fail:** Ambiguous dates are silently converted to one interpretation, with no mention of the alternative.

## Genealogical presentation

Did the skill present the converted date in a format usable for genealogical records, noting both the original and converted forms?

- **pass:** Output records both the original (as stated in the source) and the converted form, in a notation a genealogist would recognize ("11 Mar 1752/3" for dual dating).
- **partial:** Both forms are recorded but the notation is non-standard or omits the dual-dating convention when relevant.
- **fail:** Only the converted form is preserved; the original is lost.
