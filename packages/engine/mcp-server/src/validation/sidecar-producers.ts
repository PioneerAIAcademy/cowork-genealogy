/**
 * Which staging producers put GedcomX personas in their sidecar, and the one
 * refusal message both enforcement sites share.
 *
 * `research-log-append.ts` stages a sidecar for three tools (`record_search`,
 * `fulltext_search`, `external_links_search`), but only one of them returns
 * GedcomX. A `FulltextResult` carries `id` and transcript text — no `recordId`,
 * no `gedcomx` — and a `PlaceExternalLink` is `{url, linkText}`. Both D2
 * (`research-append.ts`, the write path) and D5 (`validator.ts`, the persisted
 * side) matched every result on `r.recordId`, so for those two producers the
 * match was unconditionally empty: a supplied `record_persona_id` was rejected
 * by a message that listed nothing, and an omitted one silently skipped the
 * canonicalization the match exists to do.
 *
 * The fix is NOT `r.recordId ?? r.id`. An FTS-sourced assertion carries a null
 * `record_persona_id` by design — `research-schema-spec.md` §5.5,
 * `guardrail-enforcement-spec.md` §4, and `personaReachable` all say so — so a
 * successful match would resolve zero personas and reject a supplied one with a
 * second equally empty message, while implying FTS sidecars carry personas.
 *
 * The set is a WHITELIST so the next staging producer fails safe: a tool nobody
 * has classified is treated as carrying no personas, which refuses a persona
 * claim rather than silently dropping it.
 */

/** Staging producers whose sidecar results carry `gedcomx.persons[]`. */
export const PERSONA_BEARING_PRODUCERS: ReadonlySet<string> = new Set(["record_search"]);

/** True when this log entry's tool stages personas alongside its results. */
export function stagesPersonas(tool: unknown): boolean {
  return typeof tool === "string" && PERSONA_BEARING_PRODUCERS.has(tool);
}

/** Why this producer's results hold no persona to point at. Named per tool
 *  because the reason differs, with a safe default for an unclassified one.
 *
 *  Exported for the drift guard: together with `PERSONA_BEARING_PRODUCERS`
 *  these keys must classify exactly the tools that can stage a sidecar
 *  (`STAGING_CAPABLE_TOOLS`). The dangerous direction fails OPEN — a fourth
 *  staging producer that DOES return GedcomX, added there and not here, would
 *  have every legitimate `record_persona_id` hard-rejected by the message
 *  below, so the equality is asserted rather than left to a code comment. */
export const NO_PERSONA_REASON: Record<string, string> = {
  fulltext_search:
    "full-text results carry transcript text, names and places but no GedcomX personas",
  external_links_search: "external-link results carry only a url and link text",
};

/**
 * The refusal for a non-null `record_persona_id` on an assertion whose log
 * entry staged a sidecar with no personas in it. One builder, used by D2 and
 * D5, so the write path and the persisted-side check cannot drift apart.
 */
export function noPersonaInSidecarError(logId: string, tool: unknown): string {
  const named = typeof tool === "string" && tool !== "" ? tool : "unknown-tool";
  // The default must be true of EVERY unclassified tool, not just of the two
  // named above. "this tool's results carry no GedcomX personas" is false for
  // `record_read`, which returns a persons array to its caller — it simply
  // stages no sidecar, so a `results_ref` on a `record_read` entry is itself
  // out of contract. Stating what IS classified says the true thing in all
  // cases.
  const reason =
    NO_PERSONA_REASON[named] ??
    "only 'record_search' stages sidecar results that carry GedcomX personas";
  return (
    `record_persona_id must be null — log entry '${logId}' is ${named}-sourced, and ` +
    `${reason}. Set record_persona_id: null; the record_id still identifies the record.`
  );
}
