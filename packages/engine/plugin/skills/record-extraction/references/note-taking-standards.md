# Note-Taking and Record-Reading Standards

Standards for accurate capture of record content during extraction.
Based on BCG standards 23-33, adapted for AI-assisted genealogy.

## Reading Handwriting (Standard 23)

Correctly reading handwriting in historical records is fundamental.
When processing handwritten records:

- Do not guess at unclear letters. Flag uncertain readings with `[?]`
  notation (e.g., `[?]Smith`, `[?]1845`).
- Consider the writer's letter-formation habits across the document.
  Compare how they form similar letters elsewhere on the page.
- Watch for obsolete letter forms: the long s (looks like f), the
  thorn (looks like y in "ye olde"), ff as capital F, and similar
  historical conventions. Transcribe with modern equivalents, not
  modern look-alikes that have different meanings.
- Note when handwriting quality degrades (end of page, apparent
  haste, different ink suggesting later additions).
- Present the transcription to the user for review before creating
  assertions. Handwritten records have high error rates that propagate
  silently into research files.

## Understanding Historical Meanings (Standard 24)

Words and phrases may have had different meanings in the time and
place the record was created:

- "Cousin" in colonial records often meant any relative, not
  specifically an aunt/uncle's child.
- "Senior" and "Junior" in early records distinguished same-named
  men in a community by age, not necessarily father and son.
- "Mrs." before the mid-1800s sometimes indicated social status
  (a mature woman of standing), not necessarily a married woman.
- Occupational terms change meaning over time and across regions.
- Legal terms in probate, land, and court records carry precise
  meanings that may differ from common usage.
- Place names and jurisdictions change. Record the jurisdiction as
  it existed at the time of the event.

When a term's historical meaning is unclear or differs from modern
usage, note it in the assertion's value and flag it for the user.

## Note-Taking Content (Standard 25)

When examining a source, capture:

- **Physical features and context**: any indication the record is
  damaged, incomplete, or incorrectly dated
- **Content exactly as it appears**: names, dates, places,
  circumstances -- use the source's own wording, spelling, and
  formatting
- **Structural features**: headings, column headings, metadata,
  notations on front or back of a page, explanatory text,
  footnotes, amendments, and emendations
- **Stamps, annotations, cross-references**: anything added by
  the custodial office or later users

## Distinguishing Content from Comments (Standard 26)

This is critical. Notes must clearly separate three things:

1. **What the record says** -- the actual content, quoted or
   faithfully abstracted
2. **What you observe about the record** -- physical condition,
   layout, context
3. **What you interpret or infer** -- your analysis, conclusions,
   or connections to other evidence

In the assertion model:
- `value` = what the record says (content)
- `informant_bias_notes` = observations about reliability
- Evidence classification and `extracted_for_question_ids` =
  interpretation

Never embed interpretation into the `value` field. "age 5" is
content. "born approximately 1845" is interpretation.

## Objectivity (Standard 27)

Do not let bias or preconception affect what information gets
extracted. Common pitfalls:

- Extracting only facts that support a working hypothesis while
  skipping contradictory details
- Ignoring facts about individuals who seem unrelated but might
  be relevant as FAN (Family, Associates, Neighbors) connections
- Overlooking inconsistencies within the record because they
  complicate the narrative

Extract all potentially relevant facts, even those that conflict
with current assumptions. Suspend judgment until correlation.

## Transcriptions (Standard 29)

When transcribing a record:
- Include the entire item -- headings, insertions, notations,
  endorsements, front and back
- Reflect the original's format and layout when relevant
- Mark the transcription's beginning and end clearly
- Use square brackets for annotations: damaged text, illegible
  portions, omissions, or unexpected content
- Render wording, spelling, abbreviations, and numbering exactly
  as they appear

## Abstracts (Standard 30)

When abstracting rather than transcribing:
- Omit redundant and formulaic wording but retain all substantive
  content
- Use quotation marks around any phrases of three or more words
  taken directly from the original
- Do not modernize names or dates
- Otherwise follow transcription standards

## Quotations (Standard 31)

Quote directly to capture:
- Definitive phrases that establish key facts
- Confusing or unusual wording that could be misinterpreted in
  paraphrase
- Colorful or distinctive language worth preserving

Use quotation marks or indented block format. Use ellipsis points
for omissions. Never alter the original writer's meaning through
selective quotation or omission.

## Paraphrases and Summaries (Standard 33)

When paraphrasing or summarizing:
- The result must explain the original without altering its meaning
- Place quotation marks around phrases of three or more words from
  the original
- Always cite the source

## Application to Assertion Extraction

In practice, these standards mean:

1. The `value` field should faithfully represent what the record
   says, using the record's own terms when possible
2. Square-bracket annotations flag uncertainty: `[?]`, `[illegible]`,
   `[damaged]`, `[torn]`
3. The `notes` field on the source entry captures physical condition,
   provenance chain, and overall quality assessment
4. Interpretation belongs in evidence classification and downstream
   skills, not in the extraction itself
5. Every extraction should be reviewable -- someone examining the
   original record should be able to verify each assertion against
   the source
