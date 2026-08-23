// MCP result envelopes for tools that signal failure by RETURNING rather than
// throwing.
//
// `src/index.ts` sets `isError: true` only in its catch arms, so a tool that
// returns `{ ok: false, errors }` emitted a normal MCP success: a rejected write
// read as a successful call to the model in Cowork and the hosted path, and to
// the eval harness's guardrail detectors. Measured over the committed e2e corpus,
// roughly one in seven `research_append` calls and one in four
// `extraction_append` calls were invisible that way.
//
// This lives in its own module rather than being extracted from `index.ts`:
// that file exports nothing and calls `await server.connect(transport)` at module
// scope, so importing it to reuse a helper would start a stdio server.

/** The only fields this helper reads. Deliberately NOT an index-signature type:
 *  the concrete result types (`ResearchAppendResult`, `TreeEditResult`, …) have
 *  no index signature, so requiring one would reject every real caller. */
export type OkFalseResult = { ok?: boolean; reason?: string };

/** The MCP `CallToolResult` shape this server returns.
 *
 *  A `type` alias, not an `interface`: the SDK's `ServerResult` carries an
 *  index signature, and TypeScript gives implicit index signatures to type
 *  aliases but not to interfaces — as an interface this is not assignable to
 *  the request handler's return type. */
export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/**
 * Tools whose `{ ok: false }` means **the call could not do what was asked**.
 *
 * The rule is that, not "the tool writes" — which is why the constant is named
 * for the rule. Three non-writers qualify (`convert_calendar`, `research_query`,
 * `project_context`): each returns `errors[]` and no payload, and each one's own
 * spec calls the case a failure.
 *
 * `merge_warnings` is deliberately ABSENT. Its `{ ok: false }` is the tool's
 * *answer about its subject* — a dry run reporting that a merge would be
 * rejected — not its own failure. It is the highest-`ok:false` tool in the
 * corpus, so marking those results `isError` would tell the agent its preview
 * crashed and push it to retry a call that already worked.
 *
 * `validate_research_schema` never enters: it answers with `valid`, not `ok`,
 * and `valid: false` is its answer.
 *
 * Keep in sync with the mirror in `eval/harness/harness/mock_mcp.py`, which
 * bypasses this dispatch entirely; a drift lint there pins the two together.
 */
export const OK_FALSE_IS_FAILURE = [
  "research_append",
  "extraction_append",
  "research_log_append",
  "tree_edit",
  "tree_correct",
  "materialize_facts",
  "merge_tree_persons",
  "tree_forget",
  "convert_calendar",
  "research_query",
  "project_context",
  "project_create",
] as const;

/**
 * Wrap a tool result in the MCP content envelope, setting `isError: true` when
 * the tool reported failure by returning `{ ok: false }`.
 *
 * `isError` is left unset (not `false`) on success, so the envelope is
 * byte-identical to what the un-wrapped arms returned before — nothing that
 * reads a successful result changes shape.
 *
 * ONE `ok: false` is exempt: `reason: "no_project"`. The user is not in a
 * research project, so nothing was asked of a project that exists — the call
 * did exactly what it could, and the rule above is scoped to "the call could
 * not do what was asked". Marking it would tell the model its work failed when
 * only the record of it is missing. The message in `errors` is written to be
 * relayed to a person unedited.
 *
 * Mirrored by `_tool_envelope` in `eval/harness/harness/mock_mcp.py`, which
 * bypasses this dispatch entirely.
 */
export function writerToolResult(result: OkFalseResult): McpToolResult {
  const envelope: McpToolResult = {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
  if (result?.ok === false && result?.reason !== "no_project") envelope.isError = true;
  return envelope;
}
