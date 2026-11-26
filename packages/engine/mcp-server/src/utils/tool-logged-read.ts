// A log entry `image_transcribe` wrote for its own page read. Every staged read
// in a project is logged by the tool, a navigation read (title page, index, year
// boundary) as `positive`, so such an entry is a read, never a find and never a
// plan item's search. Every reader that judges a plan item or a question by its
// log outcomes skips it.
//
// Mirrored in `eval/harness/validators/validators_lib.py` (`TOOL_LOGGED_READ`).

export const TOOL_LOGGED_READ_WRITER = "image_transcribe";

export function isToolLoggedRead(e: any): boolean {
  return e?.written_by === TOOL_LOGGED_READ_WRITER;
}
