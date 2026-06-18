# Convert Dates Rubric

Grading dimensions for convert-dates unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness).

## Conversion accuracy

Did the skill apply the correct calendar conversion rules for the time period and jurisdiction? Julian-to-Gregorian shifts vary by country and year of adoption.

- **pass:** Conversion uses the right offset for the jurisdiction-and-year combination (11 days for England 1752; 10 days for Catholic Europe 1582).
- **partial:** Conversion is in the right direction with the right approximate offset but off by 1 day, or applies a generic offset instead of the jurisdiction-specific one.
- **fail:** Conversion is wrong direction, wrong offset, or unapplied when the date clearly requires it.

## Ambiguity handling

Did the skill correctly handle dates that are genuinely ambiguous (e.g., dates near a calendar transition, dual-dating periods, or jurisdictions where the recorder's convention is unknown)?

This dimension applies ONLY when the input contains real ambiguity in the source date — meaning multiple valid interpretations actually exist. If the input is deterministic and a single conversion is correct, mark this dimension N/A. Do NOT credit Claude's explanatory commentary about hypothetical ambiguity in other dates, or educational context about historical transitions, as "ambiguity handling" when no ambiguity exists in the input.

- **pass:** Input is genuinely ambiguous, AND the skill explicitly flags both possible interpretations and records both so the genealogist can pick.
- **partial:** Input is genuinely ambiguous, AND the ambiguity is noted but the skill picks an interpretation without spelling out the alternative.
- **fail:** Input is genuinely ambiguous, AND the skill silently converts to one interpretation with no mention of the alternative.
- **N/A:** Input contains no genuine ambiguity.

## Genealogical presentation

Did the skill present the converted date in a format suitable for genealogical records?

Score this dimension strictly on FORMAT and PRESERVATION: does the output preserve the original date as recorded in the source AND show the converted form in standard genealogical notation? Do NOT credit explanatory commentary, methodological guidance, or contextual teaching content as part of presentation quality. Those are valuable but belong outside this dimension.

- **pass:** Output records both the original (as stated in the source) and the converted form in a notation a genealogist would recognize ("11 Mar 1752/3" for dual dating). Format is clean and consistent.
- **partial:** Both forms are recorded but the notation is non-standard, omits the dual-dating convention when relevant, or buries the original in surrounding prose rather than presenting it clearly.
- **fail:** Only the converted form is preserved; the original is lost, OR the format is unusable as a genealogical record (e.g., dates only wrapped in prose with no clean date string).
