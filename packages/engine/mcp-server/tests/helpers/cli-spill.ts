/** Claude Code saves any tool result longer than this many characters to a file and hands the
 *  agent a preview instead (docs/specs/sidecar-read-tool-spec.md §4), so an answer must stay under it. */
export const CLI_SPILL_CHARS = 50_000;
