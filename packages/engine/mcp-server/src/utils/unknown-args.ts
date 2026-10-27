// The one guard on argument NAMES (issue #3736). Before it, nothing checked
// arguments against a tool's `inputSchema`, so a key that is not a parameter was
// dropped and the tool ran as if it had never been sent: `record_search` with
// `marriageYear` ran with no year filter, and with `collection` / `country` it
// searched every collection worldwide. `server.ts` calls `rejectUnknownArgs` once,
// before any tool arm runs. Top-level keys only; types and nested objects are
// still each handler's job.

import { allToolSchemas } from "../tool-schemas.js";
import { RECORD_TYPE_GROUP_NAMES } from "./record-type-groups.js";
import { RETIRED_EXTRACTION_KEYS, retiredExtractionMessage } from "../tools/extraction-append.js";
import { SECTIONS_NEAR_MISS } from "../tools/research-query.js";
import { levenshteinDistance } from "./string-similarity.js";

const NEAREST = 3;

const PARAMETERS: ReadonlyMap<string, readonly string[]> = new Map(
  (allToolSchemas as ReadonlyArray<{ name: string; inputSchema?: { properties?: Record<string, unknown> } }>).map(
    (t) => [t.name, Object.keys(t.inputSchema?.properties ?? {})],
  ),
);

/** Keys a handler reads that its schema deliberately does not advertise. Every
 *  entry needs a reason; a key that is not read belongs on the schema or is
 *  refused. */
const ACCEPTED_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // `foldImageArkInput` (fs-image-fetch.ts) reads it as `ark`: record_read hands
  // page images out under this name, and callers carry it forward.
  image_read: ["imageArk"],
  image_transcribe: ["imageArk"],
};

/** A tool's own wording for some of its unknown keys: the message, and the keys
 *  it covers. Keys it leaves out get the generic line. */
type Hint = (unknown: ReadonlyArray<[string, unknown]>) => { message: string; covers: string[] } | null;

const groupsLine = () => `Valid groups: ${RECORD_TYPE_GROUP_NAMES.join(", ")}.`;

const firstOf = (unknown: ReadonlyArray<[string, unknown]>, keys: readonly string[]) =>
  unknown.find(([k]) => keys.includes(k))?.[0];

const HINTS: Readonly<Record<string, Hint>> = {
  // A key whose name reads as a place in the film was meant to pick one item.
  image_search: (unknown) => {
    const key = unknown.find(([k]) => /item|image|page|frame/i.test(k))?.[0];
    if (key === undefined) return null;
    return {
      message:
        `image_search has no parameter \`${key}\`; to address one item use \`item\` / \`itemImage\`, ` +
        "or drop it to list the whole group.",
      covers: [key],
    };
  },
  // `record_search` and `fulltext_search` take a singular `recordType`, so that
  // is the name reached for here; `record_type` is research.json's spelling.
  volume_search: (unknown) => {
    const alias = firstOf(unknown, ["recordType", "record_type", "recordTypes"]);
    if (alias === undefined) return null;
    return {
      message: `volume_search filters by recordTypeGroups (an array of group names), not ${alias}. ${groupsLine()}`,
      covers: [alias],
    };
  },
  collections_search: (unknown) => {
    const alias = firstOf(unknown, ["recordType", "record_type", "recordTypes", "recordTypeGroup", "recordTypeGroups"]);
    if (alias === undefined) return null;
    return {
      message:
        `collections_search has no record-type filter: it lists every collection for the ` +
        `place, so ${alias} cannot narrow it. To filter by record type, use volume_search's ` +
        `recordTypeGroups (an array of group names). ${groupsLine()}`,
      covers: [alias],
    };
  },
  extraction_append: (unknown) => {
    const retired = RETIRED_EXTRACTION_KEYS.filter((k) => unknown.some(([u]) => u === k));
    if (retired.length === 0) return null;
    return { message: retiredExtractionMessage(retired), covers: [...retired] };
  },
  research_query: (unknown) =>
    unknown.some(([k]) => k === "sections")
      ? { message: `research_query has no parameter \`sections\`. ${SECTIONS_NEAR_MISS}`, covers: ["sections"] }
      : null,
};

/** The `NEAREST` parameters closest to `key` by edit distance, case folded;
 *  ties keep the schema's order. */
export function nearestParameters(key: string, parameters: readonly string[]): string[] {
  const k = key.toLowerCase();
  return parameters
    .map((p, i) => ({ p, i, d: levenshteinDistance(k, p.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, NEAREST)
    .map((x) => x.p);
}

/** The refusal for `args` keys that are not parameters of `toolName`, or null
 *  when every key is one (or the tool is not advertised, which the dispatcher
 *  reports itself). */
export function rejectUnknownArgs(toolName: string, args: unknown): string | null {
  const parameters = PARAMETERS.get(toolName);
  if (parameters === undefined) return null;
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  const accepted = ACCEPTED_ALIASES[toolName] ?? [];
  const unknown = Object.entries(args as Record<string, unknown>).filter(
    ([k]) => !parameters.includes(k) && !accepted.includes(k),
  );
  if (unknown.length === 0) return null;

  const lines: string[] = [];
  const hint = HINTS[toolName]?.(unknown) ?? null;
  if (hint) lines.push(hint.message);
  for (const [key] of unknown) {
    if (hint?.covers.includes(key)) continue;
    const nearest = nearestParameters(key, parameters).map((p) => `\`${p}\``).join(", ");
    lines.push(
      nearest === ""
        ? `${toolName} takes no parameters; drop \`${key}\`.`
        : `${toolName} has no parameter \`${key}\`; the nearest are ${nearest}.`,
    );
  }
  lines.push("Nothing was run: an argument the tool does not take would have been ignored, not applied.");
  return lines.join(" ");
}
