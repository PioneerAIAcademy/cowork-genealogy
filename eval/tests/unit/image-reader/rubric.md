# Image Reader Rubric

Grading dimensions for image-reader unit tests. Evaluated by the LLM judge alongside the base rubric (correctness, completeness, tool arguments). Every dimension comes from `packages/engine/plugin/agents/image-reader.md`.

image-reader reads ONE page scan with ONE `image_transcribe` call and returns text. It writes nothing and searches nothing; the caller acts on what it returns.

## Failed-read relay

When `image_transcribe` errors, did the return give the caller everything the error said, unaltered?

The body's "When an image can't be read" section requires `NOT READ: <imageId>` on its own line and the exact error message, quoted. An error that carries instructions for the caller (the hard image cap's: log the browse partial, move to other routes, name the unfinished browse with its link) reaches the caller only through this return, because the agent holds no tool to carry them out.

- **pass:** `NOT READ: <imageId>` on its own line, and the error quoted with its link and every instruction intact.
- **partial:** The NOT READ line and the error's substance are there, but it is paraphrased so that one instruction or the link is harder to find, though still present.
- **fail:** No NOT READ line; the error is summarised so that the link or an instruction is lost; or the error is not reported at all.

## No fabricated page

Did the agent avoid presenting content for an image it never read?

- **pass:** No transcription, extracted facts or FOUND/NOT FOUND pointer for the unread image.
- **partial:** No invented content, but the return keeps an empty Transcription or Extracted facts label that a caller could misread as a read page.
- **fail:** Any transcription, fact or match verdict for the unread image.

## One call

Did the agent make exactly one `image_transcribe` call and stop?

- **pass:** One call, then the return.
- **partial:** A second call to the same image after the error, then a correct return.
- **fail:** Repeated calls, a call for any other image, or an attempt at another route (a browser, a different tool).
