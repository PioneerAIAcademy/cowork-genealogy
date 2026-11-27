/**
 * Measure: how often `research_log_append` refuses a `negative` or `partial`
 * entry for a search pinned to a browse-only collection
 * (research-log-editor-spec.md §8.7), over every committed run log.
 *
 * Two walks, judged with the real `browseOnlyNilInvariants` against the live
 * catalog:
 *   - every `log[]` entry (`id` "log_…") anywhere in a run log: the final states
 *     and any research.json snapshot a run carries, de-duplicated per file;
 *   - every op of every recorded `research_log_append` call, as the call sent it.
 *     An op with only a `stagedResultsRef` has no query here and is not judged.
 *
 * Needs a FamilySearch login for the catalog (`npx tsx dev/try-login.ts`).
 * Not shipped in any artifact.
 *
 * Usage:
 *   npx tsx dev/measure-browse-only-negatives.ts
 */
import { LOCAL } from "../src/auth/principal.js";
import { collectionCatalogLoader } from "../src/tools/collections-search.js";
import { browseOnlyNilInvariants, loggedSearchCollectionId } from "../src/tools/research-log-append.js";
import { bareName, opsOf, readRunLog, runLogFiles, toolCalls } from "./runlog-calls.js";

const catalog = await collectionCatalogLoader(LOCAL)();

/** "collection <id> (<persons> persons, <images> images)". */
const described = (id: string | undefined): string => {
  const c = id === undefined ? undefined : catalog.get(id);
  return c ? `collection ${id} (${c.personCount} persons, ${c.imageCount ?? "?"} images)` : `collection ${id}`;
};

const parsed = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};

/** Every object with a `log_…` id and a `tool`, anywhere under `node`. */
function* logEntries(node: unknown): Generator<any> {
  if (!node || typeof node !== "object") return;
  const o = node as any;
  if (typeof o.id === "string" && /^log_\d+$/.test(o.id) && typeof o.tool === "string") {
    yield o;
    return;
  }
  for (const v of Array.isArray(o) ? o : Object.values(o)) yield* logEntries(v);
}

const files = runLogFiles();
let entriesSeen = 0;
let pinnedSeen = 0;
const entryHits: string[] = [];
let opsSeen = 0;
const opHits: string[] = [];

for (const file of files) {
  const doc = readRunLog(file);
  if (doc === undefined) continue;
  const seen = new Set<string>();
  for (const e of logEntries(doc)) {
    const ext = e.external_site && typeof e.external_site === "object" ? e.external_site : null;
    const entry = { tool: e.tool, query: parsed(e.query), outcome: e.outcome, urlGenerated: ext?.url_generated };
    const key = `${e.id}|${JSON.stringify(entry)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entriesSeen++;
    const id = loggedSearchCollectionId(entry);
    if (id !== undefined) pinnedSeen++;
    if (browseOnlyNilInvariants(entry, catalog).length > 0) {
      entryHits.push(`${file} ${e.id} ${e.tool} ${e.outcome} ${described(id)} ${JSON.stringify(entry.query ?? entry.urlGenerated)}`);
    }
  }
  for (const call of toolCalls(doc)) {
    if (bareName(call) !== "research_log_append") continue;
    for (const op of opsOf(call.args)) {
      if (!op || typeof op !== "object") continue;
      opsSeen++;
      const site = parsed(op.externalSite) as any;
      const entry = { tool: op.tool, query: parsed(op.query), outcome: op.outcome, urlGenerated: site?.urlGenerated };
      if (browseOnlyNilInvariants(entry, catalog).length > 0) {
        opHits.push(`${file} op ${op.tool} ${op.outcome} ${described(loggedSearchCollectionId(entry))} ${JSON.stringify(entry.query ?? entry.urlGenerated)}`);
      }
    }
  }
}

console.log(`catalog: ${catalog.size} collections; run-log files: ${files.length}`);
console.log(`\nlog[] entries: ${entriesSeen} (per file), ${pinnedSeen} pinned to a collection, ${entryHits.length} refused`);
for (const h of entryHits) console.log(`  ${h}`);
console.log(`\nresearch_log_append ops: ${opsSeen}, ${opHits.length} refused`);
for (const h of opHits) console.log(`  ${h}`);
