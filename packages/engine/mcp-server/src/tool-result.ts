// MCP result envelopes for tools that signal failure by RETURNING rather than
// throwing.
//
// `createServer` in `src/server.ts` sets `isError: true` only in its catch arms, so a tool that
// returns `{ ok: false, errors }` emitted a normal MCP success: a rejected write
// read as a successful call to the model in Cowork and the hosted path, and to
// the eval harness's guardrail detectors. Measured over the committed e2e corpus,
// roughly one in seven `research_append` calls and one in four
// `extraction_append` calls were invisible that way.
//
// This lives in its own module rather than in `server.ts`: tool files import
// it too, and `server.ts` imports every tool file, so sharing it from there
// would be an import cycle.

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
 * for the rule. Six non-writers qualify (`convert_calendar`,
 * `census_children_gap`, `research_query`, `project_context`, `sidecar_read`,
 * `source_screen`): each returns
 * `errors[]` and no payload, and each one's own spec calls the case a failure.
 * `build_external_search_url` qualifies on the same grounds and also writes —
 * its in-flight log entry, when given a `projectPath`.
 * `external_links_search` is listed too: it writes `external-collections.json`
 * (neither project document, hence also in `NOT_A_DOCUMENT_WRITER`) and reports
 * failure by throwing, so today membership only routes its arm through
 * `writerToolResult`.
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
  "evaluation_append",
  "research_log_append",
  "tree_edit",
  "tree_correct",
  "materialize_facts",
  "merge_tree_persons",
  "tree_forget",
  "convert_calendar",
  "census_children_gap",
  "timeline_build",
  "build_external_search_url",
  // Issue #4527: a search that finds NOTHING writes its own research-log entry
  // through research_log_append's write path, so record_search is a document
  // writer. It has no `ok: false` path of its own today — a refused log write
  // keeps the search result and reports `nilLogRefused` — so routing it through
  // `writerToolResult` changes nothing now and surfaces a failure correctly if
  // it ever gains one. A search WITH results still stages and is agent-logged.
  "record_search",
  // Issue #4721: every staged read in a project writes its own log entry
  // (`written_by: "image_transcribe"`), so the tool is a document writer. A
  // refused write keeps the read and reports `logRefused`; no `ok: false` today.
  "image_transcribe",
  "research_query",
  "project_context",
  "tree_query",
  "external_links_search",
  "project_create",
  "sidecar_read",
  "source_screen",
] as const;

/**
 * The members of `OK_FALSE_IS_FAILURE` that write neither project document.
 * Everything else in that list is a document writer, which is the writer-tool
 * vocabulary the ownership guard (`tests/packaging/ownership-manifest.test.ts`)
 * and `eval/harness/e2e/writer_attribution_report.py` both read from here — the
 * engine, never the manifest, so neither can be satisfied by the manifest
 * agreeing with itself. Declared in the same `[...] as const` shape so the
 * Python report parses both lists with one pattern.
 */
export const NOT_A_DOCUMENT_WRITER = [
  "convert_calendar",
  "census_children_gap",
  "research_query",
  "project_context",
  "tree_query",
  "sidecar_read",
  "external_links_search",
  "source_screen",
] as const satisfies readonly (typeof OK_FALSE_IS_FAILURE)[number][];

/**
 * Wrap a tool result in the MCP content envelope, setting `isError: true` when
 * the tool reported failure by returning `{ ok: false }`.
 *
 * `isError` is left unset (not `false`) on success, so the envelope is
 * byte-identical to what the un-wrapped arms returned before — nothing that
 * reads a successful result changes shape.
 *
 * ONE `ok: false` is exempt: `project_context`'s `reason: "no_project"`. It is
 * the one tool that answers a folder with no project (every other tool is
 * refused by the gate in `server.ts`), and the router reads that answer to pick
 * the next step, so it is an answer, not a failure.
 *
 * Mirrored by `_tool_envelope` in `eval/harness/harness/mock_mcp.py`, which
 * bypasses this dispatch entirely.
 */
export function writerToolResult(result: OkFalseResult): McpToolResult {
  const envelope: McpToolResult = {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
  if (result?.ok === false && result?.reason !== "no_project") {
    envelope.isError = true;
    markRefusal(envelope);
  }
  return envelope;
}

/**
 * The envelopes a connector caller gets as REFUSALS: the tool did nothing and
 * said why. Three makers tag one: `writerToolResult`, for any `ok: false` a
 * listed tool RETURNS, and the dispatcher's unknown-argument and no-project
 * guards. The tag rides on the envelope and is never read back out of its text,
 * so a thrown error's `{ error }` and an `ok: false` that is a tool's answer
 * (`merge_warnings`) are never taken for one.
 *
 * A returned `ok: false` is usually a rule the call broke (reword the note,
 * check the id, sign in again), but a tool may return a fault the same way.
 * `project_create` returns every failed FamilySearch read as its refusal, a 5xx
 * as much as a mistyped id (`project-create-tool-spec.md`, "Refusals"), and
 * several tools return a failed project read so. Nothing here can tell the two
 * apart, so the note below claims only what holds for both: nothing was written.
 */
const refusals = new WeakSet<object>();

export function markRefusal<T extends object>(envelope: T): T {
  refusals.add(envelope);
  return envelope;
}

/** The first key of a connector caller's refusal, so the model reads it before the errors. */
export const CONNECTOR_REFUSAL_NOTE =
  "Refused, and nothing was written or changed. " +
  "Fix what the message below names and send the call again.";

/**
 * What a CONNECTOR caller gets for a refusal: the same body under a `refused`
 * note, with no `isError`.
 *
 * In claude.ai and Desktop Chat a result marked `isError` is drawn as a red
 * "Error" box holding the raw JSON, in front of the user. A refusal is the
 * writer tools working as designed, and about one call in ten is one, so a
 * researcher saw errors all through a run in which nothing had gone wrong
 * (lead, 2026-11-26). The mark exists so the model and the harness's detectors
 * cannot read a refused write as a success (issue #1282); on this surface the
 * note does that job for the model, and the worker, the desktop and the harness
 * keep the mark. Anything not tagged a refusal is returned as it is.
 */
export function connectorToolResult<T extends object>(envelope: T): T | McpToolResult {
  if (!refusals.has(envelope)) return envelope;
  const text = (envelope as Partial<McpToolResult>).content?.[0]?.text;
  let body: unknown;
  try {
    body = JSON.parse(text ?? "");
  } catch {
    return envelope;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return envelope;
  return { content: [{ type: "text", text: JSON.stringify({ refused: CONNECTOR_REFUSAL_NOTE, ...body }) }] };
}
