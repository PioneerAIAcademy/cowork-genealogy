# transcribe-image

Reads one FamilySearch page scan and returns a verbatim transcription.

```ts
const { text, truncated, model, imageUrl } = await transcribeImage(
  { ark: "ark:/61903/3:1:3Q9M-CSDM-2S31-F" }, // or { imageId: "004884748_02613" }
  { fsToken, llm },
);
```

## Input

Give exactly one of these:

- **`ark`**: a document-image ARK (`ark:/61903/3:1:…` or `3:2:…`), a bare `3:1:…`
  id, or a familysearch.org URL containing one. Pass the full URL when you have
  it, because its `i`/`cc`/`groupId` parameters select the right page of a
  multi-image film.
- **`imageId`**: an Image Group Number with its image index, e.g. `004884748_02613`.

## Output

| Field | Meaning |
|---|---|
| `text` | The transcription. Spelling and layout are kept as written, and unreadable text is marked `[illegible]`. Never empty. |
| `truncated` | `true` when the model hit its output limit. `text` is the part it read; the rest of the page is unread, not blank. |
| `model` | The model that read the page. |
| `imageUrl` | The FamilySearch URL the scan was fetched from. |

## Errors

| `code` | When |
|---|---|
| `bad_input` | Neither or both identifiers are given, or the identifier is malformed or is a record ARK. |
| `unauthorized` | FamilySearch rejected the token, or the LLM rejected its key. |
| `forbidden` | The image is restricted for this user. |
| `not_found` | No image exists at that identifier. |
| `too_large` | The scan is over 14 MiB. |
| `upstream` | FamilySearch or the model failed, or the model returned nothing. |

## Measured accuracy

`npm run eval:transcribe-image`, 2026-10-29, `google/gemini-3.7-flash`.

The test set is ten printed pages of Frederick Holt, *Holt genealogy*, each with
a human-verified transcription. The score is character error rate: edit distance
divided by key length, after collapsing whitespace.

| | |
|---|---|
| Pages read | 10 of 10, on each of two runs |
| Mean character error rate | 2.3% (range 0.1%–6.4%) |
| Time per page | 12–27s |

The rate moves between runs even at temperature 0. An earlier run, made before
Markdown fences were stripped, scored a mean of 3.8%, and single pages swung by
up to 11 points between the two runs. Treat one run as a rough figure.

These are printed pages. Handwritten records will score worse, and this test set
does not measure them yet. Adding handwritten pages with verified
transcriptions to `fixtures/` is the next step.
