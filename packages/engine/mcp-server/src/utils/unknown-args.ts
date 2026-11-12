// The one guard on argument NAMES (issue #3736). Before it, nothing checked
// arguments against a tool's `inputSchema`, so a key that is not a parameter was
// dropped and the tool ran as if it had never been sent: `record_search` with
// `marriageYear` ran with no year filter, and with `collection` / `country` it
// searched every collection worldwide. `server.ts` calls `rejectUnknownArgs` once,
// before any tool arm runs. Top-level keys only; types and nested objects are
// still each handler's job.

import { allToolSchemas } from "../tool-schemas.js";
// A util importing a tool, deliberately: `../tool-schemas.js` above already loads
// every tool, so this adds no module and no cycle, and the research_query hints
// read the section table rather than copying it.
import {
  RESEARCH_QUERY_SECTIONS,
  SECTION_FILTERS,
  type ResearchQuerySection,
} from "../tools/research-query.js";
import { RECORD_TYPE_GROUP_NAMES } from "./record-type-groups.js";
import {
  PERSON_READ_REF_REMOVED,
  PROJECT_TREE_REMOVED,
  RETIRED_EXTRACTION_KEYS,
  retiredExtractionMessage,
  SECTIONS_NEAR_MISS,
  treeCorrectRejection,
  treeEditRejection,
} from "./tool-hint-messages.js";
import { levenshteinDistance } from "./string-similarity.js";

const NEAREST = 3;
/** A longer key is echoed cut short and gets no suggestions: the edit-distance
 *  pass costs its length times every parameter's, on the shared event loop. */
const MAX_KEY_CHARS = 64;
/** Unknown keys named one by one; the rest are counted. */
const MAX_NAMED_KEYS = 10;

/** `key` as a refusal echoes it: whole, or its first MAX_KEY_CHARS characters
 *  and an ellipsis, never splitting a surrogate pair. */
function shownKey(key: string): string {
  if (key.length <= MAX_KEY_CHARS) return key;
  let cut = key.slice(0, MAX_KEY_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

type Schema = { name: string; inputSchema?: { properties?: Record<string, any> } };
const SCHEMAS = allToolSchemas as ReadonlyArray<Schema>;

const PARAMETERS: ReadonlyMap<string, readonly string[]> = new Map(
  SCHEMAS.map((t) => [t.name, Object.keys(t.inputSchema?.properties ?? {})]),
);

/** A tool's advertised `operation` enum, or empty. */
function operationsOf(tool: string): ReadonlySet<string> {
  const e = SCHEMAS.find((t) => t.name === tool)?.inputSchema?.properties?.operation?.enum;
  return new Set(Array.isArray(e) ? e.filter((x: unknown): x is string => typeof x === "string") : []);
}

/** Keys a handler reads that its schema deliberately does not advertise. Every
 *  entry needs a reason; a key that is not read belongs on the schema or is
 *  refused. */
export const ACCEPTED_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // `foldImageArkInput` (fs-image-fetch.ts) reads it as `ark`: record_read hands
  // page images out under this name, and callers carry it forward.
  image_read: ["imageArk"],
  image_transcribe: ["imageArk"],
};

/** A tool's own wording for some of its unknown keys: the message, and the keys
 *  it covers. Keys it leaves out get the generic line. */
type Hint = (
  unknown: ReadonlyArray<[string, unknown]>,
  args: Readonly<Record<string, unknown>>,
) => { message: string; covers: string[] } | null;

const groupsLine = () => `Valid groups: ${RECORD_TYPE_GROUP_NAMES.join(", ")}.`;

const firstOf = (unknown: ReadonlyArray<[string, unknown]>, keys: readonly string[]) =>
  unknown.find(([k]) => keys.includes(k))?.[0];

/** The names reached for when a record-type filter is wanted. */
const RECORD_TYPE_ALIASES = ["recordType", "record_type", "recordTypes", "recordTypeGroup", "recordTypeGroups"];

/** `a`, `a and b`, `a, b and c`. */
function listOf(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const ticked = (keys: readonly string[]) => listOf(keys.map((k) => `\`${k}\``));

/** `value` when it names a research_query section. Never an `in` test or a bare
 *  index: `"constructor" in SECTION_FILTERS` holds, and an array index is coerced
 *  to a string, so `["plans"]` would read plans' table. */
function knownSection(value: unknown): ResearchQuerySection | undefined {
  return typeof value === "string" && (RESEARCH_QUERY_SECTIONS as readonly string[]).includes(value)
    ? (value as ResearchQuerySection)
    : undefined;
}

/** The filter that reads one entry of `section` by its own id, if it has one. */
function idFilterOf(section: ResearchQuerySection): string | undefined {
  return Object.entries(SECTION_FILTERS[section]).find(([, rule]) => rule?.field === "id")?.[0];
}

/** `filters` / `filter` hold the arguments research_query takes one by one; the
 *  value is never unwrapped and run (lead ruling on #3947). */
function filtersSentence(sent: readonly string[], section: ResearchQuerySection | undefined): string {
  const head = `research_query has no parameter${sent.length > 1 ? "s" : ""} ${ticked(sent)}`;
  if (section === undefined) {
    return (
      `${head}: send each filter as its own argument beside \`section\`; this tool's ` +
      "description lists the filters each section takes."
    );
  }
  const keys = Object.keys(SECTION_FILTERS[section]);
  if (keys.length === 0) {
    return `${head}, and section \`${section}\` takes no filters: drop ${ticked(sent)} to read the whole section.`;
  }
  return (
    `${head}: send each filter as its own argument beside \`section\`. Section \`${section}\` filters only ` +
    `by ${ticked(keys)}; a filter not in that list does not exist there, so leave it out (with none left, ` +
    "the call reads the whole section)."
  );
}

/** `entryId` is how the writers address one entry; research_query reads one
 *  through the section's own id filter, which only some sections have. Never
 *  names a writer: that would send a read to one. */
function entryIdSentence(section: ResearchQuerySection | undefined): string {
  if (section === undefined) {
    const pairs = RESEARCH_QUERY_SECTIONS.flatMap((s) => {
      const key = idFilterOf(s);
      return key === undefined ? [] : [`\`${s}\` (\`${key}\`)`];
    });
    return (
      `research_query has no parameter \`entryId\`: only ${listOf(pairs)} read one entry by its own id; ` +
      "on any other section, drop `entryId` and read the section."
    );
  }
  const key = idFilterOf(section);
  return key === undefined
    ? `research_query has no parameter \`entryId\`, and section \`${section}\` has no filter on an entry's ` +
        "own id: drop `entryId` and read the section."
    : `research_query has no parameter \`entryId\`: to read one \`${section}\` entry by its id, pass \`${key}\`.`;
}

const HINTS: Readonly<Record<string, Hint>> = {
  // A key whose name reads as a place in the film was meant to pick one item;
  // one naming the group is a misspelled `imageGroupNumber`, the generic line's.
  image_search: (unknown) => {
    const key = unknown.find(([k]) => /item|image|page|frame/i.test(k) && !/group/i.test(k))?.[0];
    if (key === undefined) return null;
    return {
      message:
        `image_search has no parameter \`${shownKey(key)}\`; to address one item use \`item\` / \`itemImage\`, ` +
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
    const alias = firstOf(unknown, RECORD_TYPE_ALIASES);
    if (alias === undefined) return null;
    return {
      message:
        `collections_search has no record-type filter: it lists the place's collections ` +
        `by place and years only, so ${alias} cannot narrow it. To filter by record type, use volume_search's ` +
        `recordTypeGroups (an array of group names). ${groupsLine()}`,
      covers: [alias],
    };
  },
  // Both agents that call it search by place only, so the hint does not offer
  // `subject` or `keywords` as a record-type filter.
  // Every alias sent is covered: a second one left to the generic line would be
  // offered `keywords`.
  catalog_search: (unknown) => {
    const aliases = unknown.map(([k]) => k).filter((k) => RECORD_TYPE_ALIASES.includes(k));
    if (aliases.length === 0) return null;
    return {
      message:
        `catalog_search has no record-type filter, so drop ${listOf(aliases)} and search by place. To list ` +
        `record volumes by type, use volume_search's recordTypeGroups (an array of group names). ${groupsLine()}`,
      covers: aliases,
    };
  },
  extraction_append: (unknown) => {
    const retired = RETIRED_EXTRACTION_KEYS.filter((k) => unknown.some(([u]) => u === k));
    if (retired.length === 0) return null;
    return { message: retiredExtractionMessage(retired), covers: [...retired] };
  },
  // An op of the other tool carries that tool's keys (`factId` on an
  // `update_fact`): the redirect, not a nearest-parameter line per key.
  tree_edit: (unknown, args) => crossToolOp(unknown, args, "tree_correct", treeEditRejection),
  tree_correct: (unknown, args) => crossToolOp(unknown, args, "tree_edit", treeCorrectRejection),
  project_create: (unknown) => {
    const removed = unknown.map(([k]) => k).filter((k) => k === "personReadRef" || k === "tree");
    if (removed.length === 0) return null;
    const message = [
      ...(removed.includes("tree") ? [PROJECT_TREE_REMOVED] : []),
      ...(removed.includes("personReadRef") ? [PERSON_READ_REF_REMOVED] : []),
    ].join(" ");
    return { message, covers: removed };
  },
  research_query: (unknown, args) => {
    const keys = unknown.map(([k]) => k);
    const section = knownSection(args.section);
    const sentences: string[] = [];
    const covers: string[] = [];
    if (keys.includes("sections")) {
      sentences.push(`research_query has no parameter \`sections\`. ${SECTIONS_NEAR_MISS}`);
      covers.push("sections");
    }
    const filters = keys.filter((k) => k === "filters" || k === "filter");
    if (filters.length > 0) {
      sentences.push(filtersSentence(filters, section));
      covers.push(...filters);
    }
    if (keys.includes("entryId")) {
      sentences.push(entryIdSentence(section));
      covers.push("entryId");
    }
    return sentences.length === 0 ? null : { message: sentences.join(" "), covers };
  },
};

function crossToolOp(
  unknown: ReadonlyArray<[string, unknown]>,
  args: Readonly<Record<string, unknown>>,
  otherTool: string,
  rejection: (operation: string) => string,
): { message: string; covers: string[] } | null {
  const op = args.operation;
  if (typeof op !== "string" || !operationsOf(otherTool).has(op)) return null;
  return { message: rejection(op), covers: unknown.map(([k]) => k) };
}

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
  const hint = HINTS[toolName]?.(unknown, args as Record<string, unknown>) ?? null;
  if (hint) lines.push(hint.message);
  const rest = unknown.map(([k]) => k).filter((k) => !hint?.covers.includes(k));
  for (const key of rest.slice(0, MAX_NAMED_KEYS)) {
    const shown = shownKey(key);
    if (parameters.length === 0) {
      lines.push(`${toolName} takes no parameters; drop \`${shown}\`.`);
    } else if (shown !== key) {
      lines.push(`${toolName} has no parameter \`${shown}\` (${key.length} characters).`);
    } else {
      const nearest = nearestParameters(key, parameters).map((p) => `\`${p}\``).join(", ");
      lines.push(`${toolName} has no parameter \`${key}\`; the nearest are ${nearest}.`);
    }
  }
  const more = rest.length - MAX_NAMED_KEYS;
  if (more > 0) lines.push(more === 1 ? "1 more key is not a parameter either." : `${more} more keys are not parameters either.`);
  lines.push("Nothing was run: an argument the tool does not take would have been ignored, not applied.");
  return lines.join(" ");
}
