# Online Search Literacy — Quick Reference

Load this reference when evaluating a database before searching or
when handling nil results.

## Search Philosophy Decision

| Situation | Approach |
|---|---|
| Uncommon surname, uncertain spelling/dates, new locality | **"Less is more"** — surname only, filter after |
| Extremely common surname (Smith, Johnson), high confidence in details | **"Kitchen sink"** — multiple required terms |
| FTS specifically (no fuzzy matching, no abbreviation expansion) | **Default to "less is more"** — every extra term risks missing variant transcriptions |

Start broad, check hit count, narrow iteratively with filters.

## Database Evaluation Checklist

Before searching, answer these:

1. **What does this database actually contain?** Read the collection
   description — titles can mislead about geographic/temporal scope.
2. **Is this an index or original records?** FTS searches AI
   transcripts (derivative). The chain is: original → image → AI
   transcript → search snippet.
3. **What coverage exists?** ~6,665 FTS-searchable collections as of
   mid-2026. Not all FamilySearch collections are included.
4. **Known limitations?** English-language records from Americas/UK/
   Australasia are strongest. Non-Latin scripts and continental
   European records have weaker support.

## Nil-Result Checklist

Work through in order before declaring a search negative:

1. Is the query too restrictive? Drop terms, use filter instead.
2. Spelling/abbreviation variants? (Wm, Jno, Jas, Thos)
3. Transcription errors hiding it? Use wildcards on confused letters.
4. Wrong field? Try Keywords vs. Name (different behavior).
5. Does the collection exist in FTS? Verify coverage.
6. Would this record type exist for this place/time?

After exhausting variants:
- Log the negative with exact query and date
- Note whether absence is analytically meaningful (negative evidence)
- Coverage grows ~4-6 collections/week — today's nil may be
  tomorrow's hit
- Suggest alternatives: indexed search, different repository,
  physical visit

## Derivative Source Awareness

```
Original (handwritten) → Image → AI transcript → Search snippet
```

Each step introduces errors. Professional standards require working
back toward the original. When citing, distinguish whether information
came from the transcript or from the original image examined.

A well-maintained search log transforms "I couldn't find anything"
into "I searched these specific sources with these parameters on
these dates and found no matching records."
