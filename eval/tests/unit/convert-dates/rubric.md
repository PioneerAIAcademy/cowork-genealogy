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

- **pass:** Input is genuinely ambiguous, AND the skill explicitly flags both possible interpretations and records both so the genealogist can pick. "Records both" means both readings survive as usable options; naming an alternative and then telling the researcher not to use it does not qualify.
- **partial:** Input is genuinely ambiguous, AND the ambiguity is noted but the skill picks an interpretation without spelling out the alternative, OR mentions the alternative and then forecloses it — a resolved single answer is partial even when the reasoning behind it is explained at length.
- **fail:** Input is genuinely ambiguous, AND the skill silently converts to one interpretation with no mention of the alternative.
- **N/A:** Input contains no genuine ambiguity.

## Genealogical presentation

Did the skill present the converted date in a format suitable for genealogical records?

Score this dimension strictly on FORMAT and PRESERVATION: does the output preserve the original date as recorded in the source AND show the converted form in standard genealogical notation? Do NOT credit explanatory commentary, methodological guidance, or contextual teaching content as part of presentation quality. Those are valuable but belong outside this dimension.

- **pass:** Output records both the original (as stated in the source) and the converted form in a notation a genealogist would recognize ("11 Mar 1752/3" for dual dating). Format is clean and consistent.
- **partial:** Both forms are recorded but the notation is non-standard, omits the dual-dating convention when relevant, or buries the original in surrounding prose rather than presenting it clearly.
- **fail:** Only the converted form is preserved; the original is lost, OR the format is unusable as a genealogical record (e.g., dates only wrapped in prose with no clean date string).

## Tool response interpretation

Did the skill present what `convert_calendar` actually returned, rather than its own arithmetic dressed up as the tool's answer?

The skill holds exactly one tool and its body forbids hand arithmetic. So the graded question is not whether a call happened (Tool Arguments covers the call itself) but whether the RESPONSE drove the output: the stated rule and day offset should come from the tool's `applied[]` entries, and an `{ ok: false }` should be surfaced as the finding it is — with what to fix — not silently replaced by a hand-computed date.

Score N/A when no conversion arithmetic was warranted, so no call was needed (a notation-only or routing question).

- **pass:** Every rule and offset the response asserts traces to the tool's `applied[]` / `converted` values. Where the tool returned `{ ok: false }`, the response states the error, explains what it means for this date, and does NOT assert a converted date anyway.
- **partial:** The tool was called and its result is broadly consistent with the response, but the offset or rule is narrated from the skill's own tables rather than the returned `applied[]` — or an `ok: false` is mentioned only in passing while the response proceeds as though the conversion had succeeded.
- **fail:** The response contradicts what the tool returned, asserts a converted date after an `ok: false`, or performs the arithmetic by hand when a call was warranted and available.
- **N/A:** No calendar arithmetic was warranted, so no tool response was required.

**A step the tool has no correction for is the skill's own, and is not hand
arithmetic.** `convert_calendar` offers only `doubleDatedYear`, `osNsYear`,
`quakerMonth` and `julianToGregorianDay`. The Swedish calendar is not among
them, so converting a Swedish date to its Julian equivalent (Swedish 30 Feb
1712 = Julian 29 Feb 1712) is a judgment the skill must make itself before any
call is possible. Do not score that step down as bypassing the tool, and do not
treat the tool receiving the Julian date rather than the Swedish one as an
argument mismatch — passing a date the tool cannot interpret would be the
error. What this dimension grades on such a test is the part the tool did
handle: whether the returned Julian→Gregorian offset and rule are the ones the
response presents.
