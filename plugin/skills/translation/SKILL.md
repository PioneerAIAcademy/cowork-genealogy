---
name: translation
description: Genealogy-specific translation and paleography assistance for
  historical records in German, French, Spanish, Italian, Dutch, Latin, and
  Portuguese. Covers period handwriting (Kurrentschrift, Sütterlin), Latin
  abbreviations in parish registers, genealogy-specific vocabulary, and
  record-type conventions by language and era. Use when the user says
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

Provides genealogy-specific translation and paleography assistance
for historical records in Western European languages. Genealogical
records use specialized vocabulary, period handwriting styles, and
abbreviation systems that general translation doesn't cover.

## Languages supported

| Language | Common record types | Period concerns |
|----------|-------------------|----------------|
| **German** | Church registers (Kirchenbücher), civil registration (Standesamt), guild records | Kurrentschrift (1500s-1940s), Sütterlin (1911-1941), Fraktur print |
| **French** | Parish registers, notarial records (actes notariés), civil registration (état civil) | Old French orthography, legal formulae, regional dialects |
| **Spanish** | Parish registers (partidas), civil registration, notarial records | Colonial-era abbreviations, regional terminology |
| **Italian** | Parish registers (registri parrocchiali), civil registration (stato civile) | Latin-Italian mix in early registers, regional dialects |
| **Dutch** | Church registers (doopboeken), civil registration (burgerlijke stand), notarial records | Similar to German script pre-1800, Dutch Reformed terminology |
| **Latin** | Catholic parish registers throughout Europe, legal documents, university records | Abbreviations, case declensions affecting name forms, church formulae |
| **Portuguese** | Parish registers (registos paroquiais), civil registration | Brazilian vs. European Portuguese, colonial records |

## What this skill does

### 1. Translate record text

Given text from a historical record (typed, transcribed, or
described by the user), provide:
- Full translation to English
- Notes on ambiguous readings
- Identification of names, dates, places, and relationships
- Explanation of formulaic language

### 2. Explain genealogy-specific vocabulary

| Term | Language | Meaning |
|------|----------|---------|
| Taufbuch / Taufregister | German | Baptismal register |
| Trauungsbuch | German | Marriage register |
| Sterbebuch / Totenbuch | German | Death/burial register |
| Pate / Patin | German | Godfather / Godmother |
| Eheleute | German | Married couple |
| lediger Stand | German | Unmarried status |
| acte de naissance | French | Birth certificate |
| acte de mariage | French | Marriage certificate |
| acte de décès | French | Death certificate |
| témoin | French | Witness |
| parrain / marraine | French | Godfather / Godmother |
| partida de bautismo | Spanish | Baptismal record |
| partida de matrimonio | Spanish | Marriage record |
| partida de defunción | Spanish | Death record |
| padrino / madrina | Spanish | Godfather / Godmother |
| obiit | Latin | He/she died |
| natus/nata est | Latin | He/she was born |
| baptizatus/a est | Latin | He/she was baptized |
| matrimonium contraxerunt | Latin | They contracted marriage |
| filius/filia legitimus/a | Latin | Legitimate son/daughter |
| patrini | Latin | Godparents |
| testes | Latin | Witnesses |

### 3. Read period handwriting

**German Kurrentschrift / Sütterlin:**
- Runs from approximately 1500s to 1941
- Letters look very different from modern Latin script
- Common confusion pairs: e/n, u/n, m/nn, f/s, k/t, C/E
- The user provides an image or transcription attempt; this skill
  helps decipher unclear characters

**Key differences from modern script:**
- Long s (ſ) vs. round s — position-dependent
- Capital letters often unrecognizable without training
- Connected letters create ligatures that change form
- Spacing between words is often minimal

**Practical approach:** When the user provides text they can't
read, work through it character by character. Identify the record
type first (baptism, marriage, burial) because the formulaic
structure constrains what words are possible.

### 4. Decode abbreviations

**Latin abbreviations in church registers:**

| Abbreviation | Full form | Meaning |
|-------------|-----------|---------|
| bapt. | baptizatus/a | baptized |
| n. / nat. | natus/a | born |
| ob. | obiit | died |
| sep. / s. | sepultus/a | buried |
| conj. | conjux | spouse |
| fil. | filius/filia | son/daughter |
| leg. | legitimus/a | legitimate |
| illeg. | illegitimus/a | illegitimate |
| vid. | vidua/viduus | widow/widower |
| d.d. | de dato | dated |
| SS. | sanctissimus/sanctorum | most holy / of the saints |
| par. | parentes / parochia | parents / parish |
| test. | testes | witnesses |
| a.d. | anno domini | in the year of the Lord |
| ej. / ejd. | ejusdem | of the same (month/year) |
| sup. | supra | above (referring to previously mentioned) |

**German abbreviations:**

| Abbreviation | Full form | Meaning |
|-------------|-----------|---------|
| geb. | geboren | born |
| gest. | gestorben | died |
| get. | getauft | baptized |
| verh. | verheiratet | married |
| Ehefr. | Ehefrau | wife |
| Ehem. | Ehemann | husband |
| led. | ledig | unmarried |
| verw. | verwitwet | widowed |
| ev. | evangelisch | Protestant/Lutheran |
| kath. | katholisch | Catholic |
| d. / des | des/der | of the (genitive) |

### 5. Explain record structure

Different record types follow predictable patterns:

**Catholic baptism register (Latin):**

> Die [date] baptizatus/a est [name], filius/filia legitimus/a
> [father's name] et [mother's maiden name], conjugum.
> Patrini fuerunt [godfather] et [godmother].

"On [date] was baptized [name], legitimate son/daughter of
[father] and [mother], married couple. The godparents were
[godfather] and [godmother]."

**German church marriage record:**

> [Date] sind ehelich verbunden worden der Junggesell [groom name],
> [groom's father]'s ehelicher Sohn, und die Jungfrau [bride name],
> [bride's father]'s eheliche Tochter.
> Zeugen: [witness 1], [witness 2].

"[Date] were married the bachelor [groom], legitimate son of
[father], and the maiden [bride], legitimate daughter of [father].
Witnesses: [witness 1], [witness 2]."

## Steps

### 1. Identify the language and record type

From the text or context provided by the user:
- What language? (German, French, Latin, etc.)
- What record type? (baptism, marriage, burial, civil registration,
  notarial, etc.)
- What period? (affects script, abbreviations, and formulae)

### 2. Translate and annotate

Provide:
- Full English translation
- Names identified (in original form and standardized)
- Dates identified (convert to standard format)
- Places identified
- Relationships identified (parent, godparent, witness)
- Notes on uncertain readings: "[?]word" for unclear text
- Abbreviation expansions

### 3. Extract genealogically relevant information

Highlight the facts that matter for the research:
- **Person names** with roles (subject, father, mother, godparent,
  witness)
- **Dates** (event date, not just document date)
- **Places** (parish, town, jurisdiction)
- **Relationships** stated in the document
- **Status** (legitimate/illegitimate, single/widowed, occupation)

### 4. Connect to the research pipeline

After translation, suggest:
- "Would you like me to extract assertions from this record?"
  (record-extraction) — the translation output provides the English
  text that record-extraction needs
- "This record names [person] as [role] — should I link this to
  the persons in the tree?" (person-evidence)

## Important rules

- **Output only — no file writes.** This skill translates and
  explains. It does not write to project files. The translated
  content feeds into record-extraction for formal assertion creation.
- **Preserve original text.** Show both the original and the
  translation. Don't discard the original — it's the primary source.
- **Flag uncertainty.** Use [?] for unclear readings. Never guess
  silently at ambiguous characters — especially in names, which are
  the most critical genealogical data.
- **Names in original form.** Don't anglicize names in the
  translation. "Johann" not "John," "Guillaume" not "William,"
  "María" not "Mary." Note the English equivalent if helpful, but
  the original form is what goes into assertions.
- **Date conventions vary.** German: day.month.year. French:
  day month year (month spelled out). Latin: varies by scribe.
  Convert to ISO 8601 (YYYY-MM-DD) in the genealogical summary.
- **Genitive names aren't errors.** In Latin and German records,
  names appear in different cases. "Johannis" is the genitive of
  "Johannes" (meaning "of Johannes"), not a different person.
  Normalize to nominative form.
