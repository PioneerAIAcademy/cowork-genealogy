---
name: translation
model: claude-sonnet-4-6
description: Genealogy-specific translation and paleography assistance for
  historical records in German, French, Spanish, Italian, Dutch, Latin, and
  Portuguese. Covers period handwriting (Kurrentschrift, Sütterlin), Latin
  abbreviations in parish registers, genealogy-specific vocabulary, and
  record-type conventions by language and era. Outputs translations and
  term glosses to the user; does not modify project files. Use when the user says
  "translate this record", "what does this say?", "German church record",
  "Latin abbreviations", "read this handwriting", "French notarial record",
  "what does [foreign word] mean?", when a record is in a non-English
  Western language, or when record-extraction encounters text it cannot
  parse due to language or script. Do NOT use when the user wants to
  extract assertions from an English record (use record-extraction), wants
  historical context about a place (use historical-context), or wants a
  locality guide (use locality-guide).
---

# Translation

**Narration:** Read `researcher_profile.narration_guidance` from `research.json` and apply it as your narration style for this invocation. If absent, default to a one-line preamble per action.

Provides genealogy-specific translation and paleography assistance
for historical records in Western European languages. Genealogical
records use specialized vocabulary, period handwriting styles, and
abbreviation systems that general translation tools miss.

## GPS grounding

This skill implements BCG standards 23, 24, 29, 32, and 6 (read period scripts correctly, read words in their period meaning, transcribe the entire item exactly, follow Chicago conventions for foreign text) — see `references/gps-translation-standards.md`. The operational rules live in the Steps below.

**Critical principle:** A translation is a derivative source. Always
preserve the original text alongside any translation. When a
translation conflicts with the original, the original governs.

**Reference files — load on demand:**
- `references/gps-translation-standards.md` — detailed GPS standard
  application to translation work
- `references/vocabulary-and-record-structures.md` — vocabulary
  tables, abbreviation tables, and record-structure templates

## Languages supported

German, French, Spanish, Italian, Dutch, Latin, Portuguese.

| Language | Period concerns |
|----------|----------------|
| **German** | Kurrentschrift (1500s-1940s), Sütterlin (1911-1941), Fraktur print |
| **French** | Old French orthography, legal formulae, regional dialects |
| **Spanish** | Colonial-era abbreviations, regional terminology |
| **Italian** | Latin-Italian mix in early registers, regional dialects |
| **Dutch** | Similar to German script pre-1800, Dutch Reformed terminology |
| **Latin** | Abbreviations, case declensions, church formulae |
| **Portuguese** | Brazilian vs. European Portuguese, colonial records |

## Reading images

Translation works on text, or on an image that is already in the
conversation. It does not fetch images itself.

- **Image already in the conversation** — uploaded by the user, or
  pasted from a FamilySearch, Ancestry, MyHeritage, FindMyPast, or
  FindAGrave record viewer or PDF: read it in-context and attempt the
  paleographic reading directly. No tool call is needed.
- **Only an image URL, no image** — translation cannot open URLs. Ask
  the user to open the link in the record viewer and paste or attach
  the image. A record handed off from `record-extraction` arrives with
  its image already in context.

## Steps

### 1. Identify the language and record type

From the text or context provided by the user, determine:
- Language (German, French, Latin, etc.)
- Record type (baptism, marriage, burial, civil registration,
  notarial, etc.)
- Period (affects script, abbreviations, and formulae)

Load `references/vocabulary-and-record-structures.md` to use the
record-structure templates as constraints when deciphering text.

### 2. Transcribe the original text

Before translating, produce a faithful transcription:
- Reproduce wording, spelling, abbreviations, and numbering exactly.
- Handle obsolete letterforms: long s as "s" (not "f"), thorn as
  "th" (not "y"), double-f capital as "F" (not "ff").
- Include the entire item — headings, column labels, marginal notes.
- Annotate damage with [illegible], [damaged], or [?reading].
- Mark transcription boundaries clearly.

If the user provides their own transcription, review it for
accuracy before translating.

### 3. Translate and annotate

Provide:
- Full English translation (labeled as derivative)
- Ambiguous readings flagged with [?]
- Abbreviation expansions (abbreviated form shown alongside)
- Period-specific meanings explained where they differ from modern
- Formulaic language explained in plain English

### 4. Extract genealogically relevant information

Highlight:
- **Names** with roles (subject, parent, godparent, witness) — in
  original form, not anglicized
- **Dates** (event date, not just document date)
- **Places** (parish, town, jurisdiction)
- **Relationships** stated in the document
- **Status** (legitimate/illegitimate, single/widowed, occupation)

### 5. Suggest next steps

After translation, offer:
- "Extract assertions from this record?" (record-extraction)
- "Link [person] to the tree?" (person-evidence)

The translation is a working tool. Record-extraction should cite
the original record, not the translation.

## Example

**User:** *"Read this German baptism entry: 'Den 12ten Märtz 1789 ist
dem Joh. Schmid und seiner Ehefrau Anna Maria ein Söhnlein gebohren und
auf den Nahmen Georg getauft worden. Pathe: Georg Ba[u/v]er.'"*

**Response:**

*Original (as written):* Den 12ten Märtz 1789 … ein Söhnlein gebohren
und … auf den Nahmen Georg getauft worden. Pathe: Georg Ba[?]er.

*Translation (derivative — the original governs):* On 12 March 1789, a
little son was born to Joh[ann] Schmid and his wife Anna Maria, and
baptized Georg. Godfather: Georg Bauer [surname reading uncertain —
could be *Baver*].

*What matters genealogically:*
- **gebohren / getauft** — *born* vs. *baptized*: this entry gives the
  **birth** date (12 March); baptism followed. Record both; don't
  conflate them.
- **Pathe** — godfather/sponsor, not a parent — a FAN figure worth
  researching; the child sharing the name *Georg* hints at kinship.
- **Söhnlein** — diminutive of *Sohn*, confirms a male child.
- **Joh.** expanded to *Johann* (flagged as abbreviated). Names kept in
  original form (Johann, not John).
- The godfather's surname is flagged `[?]`, not silently resolved.

*Next step:* "Extract these into research.json?" (record-extraction)

## Paleography guidance

**German Kurrentschrift / Sütterlin:**
- Common confusion pairs: e/n, u/n, m/nn, f/s, k/t, C/E
- Long s vs. round s is position-dependent
- Capitals often unrecognizable without training
- Minimal word spacing; ligatures change letterforms

**Approach for unclear text:** Identify the record type first —
formulaic structure constrains which words are possible. Work
character by character through ambiguous passages.

## Output conventions

These conventions govern how the translation is written up:

- **Date conventions vary.** German: day.month.year. French: day
  month year. Latin: varies. Convert to ISO 8601 in the summary.
- **Genitive names aren't errors.** "Johannis" is genitive of
  "Johannes" — normalize to nominative form.
- **Foreign text in English narrative.** Italicize foreign words
  (not proper nouns). Quotations in the original language get
  quotation marks, not italics.

## Decision rules

| Situation | Action |
|-----------|--------|
| Record is partly English, partly foreign | Translate only the foreign portions. Note which parts are already English. |
| Mixed Latin/vernacular record (common in early Italian/German registers) | Translate both layers. Note where the scribe switches language. |
| User provides an image but no transcription | If the image is in the conversation, read it in-context (see "Reading images"). If you have only an image URL, ask the user to paste or attach the image. Then attempt paleographic reading, flag every uncertain character, and present the transcription for user confirmation before translating. |
| User provides text they already transcribed | Review for common misreadings (f/long-s, C/E confusion) before translating. |
| A word has no clear modern equivalent | Keep the original term in italics, provide the closest English explanation in parentheses. |
| The record uses regional dialect | Note the dialect and translate based on regional meaning, not standard-language meaning. |
| User asks "what does [term] mean?" without a full record | Answer directly with the genealogical meaning. Load vocabulary reference if needed. No need to run the full translation workflow. |
| User wants historical context about WHY a record exists | Hand off to historical-context. This skill translates WHAT the record says. |
| User wants citation formatting for the translated record | Hand off to citation after record-extraction creates the source entry. |

## Re-invocation behavior

Writes nothing — no files, no `research.json` / `tree.gedcomx.json`. Safe to call repeatedly; each call is a fresh translation pass.
