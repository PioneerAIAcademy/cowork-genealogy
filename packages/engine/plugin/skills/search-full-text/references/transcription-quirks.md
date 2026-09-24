# Full-Text Search Transcription and Coverage Quirks

Read this reference when interpreting FTS results or when searches
return unexpected results. These quirks affect query construction
and result interpretation.

## HTR error patterns

Common AI handwriting-recognition confusions. Use wildcards to
compensate.

| Pattern | Substitution | Example | Wildcard |
|---|---|---|---|
| long-s `ʃ` | f, l, t, p | Massachusetts → Mafsachusetts | `Ma?sachusetts` |
| `rn` | m, in, iii, w, ui, iu, nr | Turnpike → Tumpike | `Tu*pike` |
| `u` | n, v | Mountain → Monntain | `Mo?ntain` |
| `m` | rn, in, iii, w, ui, iu, nr | William → Williain | `Willia*` |
| `c` | e, o, a, d (a/d mainly followed by a flourish or an `l`) | uncle → unele | `un?le` |
| `e` | c, o, a, d (a/d mainly followed by a flourish or an `l`) | angel → angcl | `ang?l` |
| `l` | I, 1, t, d, b, i (d/b vary with neighboring letters) | Alice → Atice | `A?ice` |
| ornate capital S | F | Scott → Fcott | search both |
| double-l | tt, H | Powell → Powett | `Powe*` |
| `&` ligature | et, &c | & → et | search both |
| superscript abbrev | dropped, or a letter swap | Mrs → Ms, Mes | search both |

Confusable letters compound within a word. `?` reaches exactly one
character, so a run of several needs `*`, which absorbs any number
(`Willia*`, `Powe*`, `Mo*ntain`). Two constraints still bind: a wildcard
may never open a term, and keep three or more literal characters in the
term overall (`references/query-syntax.md`'s wildcard rules).

## Faithful representation symbols

The AI transcription uses special symbols:
- `✍` = clerk's flourish
- `⌨` = unrecognizable symbol(s)
- `█ ▓ ▒` = shading or bleed-through
- `↔` = horizontal rules, dashes, ditto strings
- `⎬` = brace
- `* 〰 ⚭ ✝ ▭` = church register symbols (birth, baptism,
  marriage, death, burial)

Searching for these is technically possible but rarely useful.
They help interpret transcripts.

## Era-specific handwriting issues

Where the transcription mis-reads a hand is where the wildcard goes. These
are error profiles of the transcription, not palaeography:

- **Secretary hand (16th–17th c. English):** Errors concentrate
  in word endings (-ed, -es, -eth). `e` looks like a backwards-c.
  Anchor the wildcard at the stem and let the ending vary.
- **Copperplate (18th–19th c. legal):** Stylized capitals (S, F,
  T, L) confuse recognition. "Gasper" vs. "Casper" confusion. A
  surname's first letter is the least reliable character to require.
- **German Kurrent/Sütterlin:** NOT well-supported. H/Y, e/n, B/L
  most confused. Search English transliterations too, and read a nil
  as a fact about coverage rather than about the person.
- **Spanish Procesal/colonial:** Abbreviations (`q'`=que,
  `dho`=dicho) frequently truncated or expanded inconsistently —
  search the contracted AND expanded form as separate queries.

## Content quirks

- **Marginalia ARE indexed** — annotations added later can surface
  in searches.
- **Struck-through text is indexed as written** — AI does not
  interpret strikethrough as deletion.
- **Multi-column/tabular data** is read row-major across columns,
  causing spurious cross-column phrase matches (e.g., Col A
  "William" aligns with Col B "Wilson" on same row).
- **Line-broken/hyphenated words** — inconsistently handled. A
  surname wrapping across a page boundary may not be findable as
  a whole token. Try both halves.
- **~10% error rate** in user-perceived results (empirically
  observed). Always verify against the original image.

## Coverage

The `fulltext_search` tool description states the coverage shape, and it
is the only copy: an incomplete and continuously growing subset, strongest
on English-language records from the Americas, the UK and Australasia,
weaker on non-Latin scripts and continental Europe. Do not restate a
collection count or a record total here — the precise values move with
every upstream re-run and live in `docs/specs/fulltext-search-tool-spec.md`
for the humans who need them.

The consequence for searching is the part that matters: a collection
existing at FamilySearch does not mean FTS can reach it, so **a nil is
not an absence until coverage is checked**. Where a volume's own metadata
reports it as not full-text searchable, `fulltext_search` says so on the
nil itself.

## Important behaviors

- **FTS does NOT deduplicate against indexed Records search.**
  A record findable via both will appear in both.
- **Auto-collection dates/places come from metadata, not document
  content.** A document's actual date may not match the collection's
  date range. Do not exclude possibilities solely because a date
  filter doesn't match.
- **Today's negative result may be positive tomorrow.** Coverage
  grows continuously. Log exact queries with timestamps for
  periodic re-checking.
