/**
 * The most characters a tool should put in one answer. Over 50,000 Claude Code
 * saves a tool result to a file and hands the agent a preview, and an agent
 * without Bash cannot Read a file that large; the 10,000 margin absorbs the
 * envelope around the answer. Shared by every tool that sizes its own output.
 */
export const TOOL_RESULT_CHAR_BUDGET = 40_000;

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
