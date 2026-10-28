// Refusal wording shared by a tool's handler and server.ts's unknown-argument
// guard (`unknown-args.ts`): the guard answers over MCP, the handler answers a
// caller that reaches it directly (the unit harness). One copy, so the two
// cannot drift.

/** The hand-built `extraction_append` forms, in both spellings (`ops` with its
 *  `sourceDescription`, and one flat op), and the one-record extractor mode
 *  (`logEntryId` + `recordId`). */
export const RETIRED_EXTRACTION_KEYS = [
  "ops", "sourceDescription", "section", "op", "entry", "entryId", "fields", "logEntryId", "recordId",
] as const;

export function retiredExtractionMessage(retired: readonly string[]): string {
  return (
    `extraction_append no longer takes ${retired.map((k) => `\`${k}\``).join(" or ")}: roles and ` +
    "classifications are decided in code, so there is nothing for a caller to compose. Send " +
    "`recordIds` for FamilySearch records, `documents` (from the record-structurer agent) for " +
    "any other source, or `absences` for people a search did not find. Correcting an " +
    "existing assertion is not an extraction and is not done here."
  );
}

/** `research_query`'s plural near-miss: `sections` is the mistake the model makes. */
export const SECTIONS_NEAR_MISS =
  "The parameter is 'section' (singular) and takes one value at a time — you sent 'sections'.";

/** The cross-tool redirects of `tree_edit` and `tree_correct`. */
export const treeEditRejection = (operation: string): string =>
  `tree_edit only adds — '${operation}' is a correction/removal op; ` +
  "corrections and removals live in tree_correct";

export const treeCorrectRejection = (operation: string): string =>
  `tree_correct only corrects or removes — '${operation}' is an additive op; ` +
  "additions live in tree_edit";
