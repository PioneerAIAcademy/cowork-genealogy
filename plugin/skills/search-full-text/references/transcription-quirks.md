# Full-Text Search Transcription and Coverage Quirks

Read this reference when interpreting FTS results or when searches
return unexpected results. These quirks affect query construction
and result interpretation.

## HTR error patterns

Common AI handwriting-recognition confusions. Use wildcards to
compensate.

| Pattern | Substitution | Example | Wildcard |
|---|---|---|---|
| long-s `ʃ` | f, l, t | Massachusetts → Mafsachusetts | `Ma?sachusetts` |
| `rn` | m, in, iii | Turnpike → Tumpike | `Tu*pike` |
| `u` | n, ii | Mountain → Mountan | `Mo?ntain` |
| `m` | rn, in, iii | William → Williain | `Willi*m` |
| `c` | e, o | Cole → Cele | `C?le` |
| `e` | c, o | execute → cxccute | `*xecute` |
| `l` | I, 1, t | Alice → Atice | `A?ice` |
| ornate capital S | F | Scott → Fcott | `?cott` |
| double-l | tt, H | Allen → Atten | `A??en` |
| `&` ligature | et, &c | & → et | search both |
| superscript abbrev | dropped | Mrs → Mes | `M?s` |

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

- **Secretary hand (16th–17th c. English):** Errors concentrate
  in word endings (-ed, -es, -eth). `e` looks like a backwards-c.
- **Copperplate (18th–19th c. legal):** Stylized capitals (S, F,
  T, L) confuse recognition. "Gasper" vs. "Casper" confusion.
- **German Kurrent/Sütterlin:** NOT well-supported as of 2026.
  H/Y, e/n, B/L most confused. Search English transliterations.
- **Spanish Procesal/colonial:** Abbreviations (`q'`=que,
  `dho`=dicho) frequently truncated or expanded inconsistently.

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

## Coverage (as of mid-2026)

~6,665 searchable auto-collections; ~1.95 billion result-records.
Coverage is opaque and dynamic — collections grow by ~4–6 per week.

**Strong coverage:**
- US deeds and wills 1750–1900
- US Legal, Vitals, Migrations, Land/Probate, Military
- UK Military and Legal
- Latin American notarial protocols (17th–19th c.)
- Revolutionary War Pension files
- Australian and New Zealand probate
- Italian civil records (growing rapidly)

**Weak/absent:**
- Continental European records in non-Latin scripts (German
  Kurrent, Cyrillic, Greek)
- East Asian (Chinese, Japanese, Korean — models under development)
- Arabic, Hebrew
- Eastern European (Polish, Czech, Hungarian)

**Coverage mismatch:** FamilySearch's internal count is "8,000+"
auto-collection definitions; the user-searchable surface is ~6,665.
Agents should not assume all collections are searchable.

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
