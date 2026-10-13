/**
 * Count: assertions re-extracted under a NEW log entry, in a project's final
 * research.json (handoff U16, "Duplicates").
 *
 * The §3.4.3 re-extraction guard keys an assertion on (source, record, log entry,
 * person in the record, fact type) — `reextractionKey`, imported, never
 * re-implemented. Scoping it to one log entry lets a second extraction pass of the
 * same record through, which is correct for an image-transcription pass (a second
 * reading) and a miss for anything else. This applies the same key with the log
 * entry blanked and reports every key held under two or more log entries, assertions
 * whose log entry is an image pass excluded. An image pass is a log entry whose tool
 * is `image_transcribe`, `image_read` or `image_search`: the prototype's paerai export
 * logs every scan reading under its `image_search` entry. Two
 * same-keyed assertions under ONE log entry are ordinary extraction (a birth date
 * and a birth place) and are not counted.
 *
 * One non-image cross-log group is the handoff's trigger for widening the guard's
 * key to ignore the log entry. Values are printed so a reader can tell a re-run
 * from a genuinely distinct second fact of the same type.
 *
 * Works on final documents alone, so it covers prototype exports, which have no run
 * log; `dev/replay-reextraction-guard.ts` is the call-by-call replay of the harness
 * corpus.
 *
 * Offline. Not shipped in any artifact.
 *
 * Usage (from packages/engine/mcp-server/):
 *   npx tsx dev/count-cross-log-duplicates.ts [<research.json | project dir> ...]
 * With no argument it reads every committed prototype export: an
 * eval/runlogs/e2e/<fixture>/run-<ts>.final-research.json with no run-<ts>.json.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { reextractionKey } from "../src/tools/research-append.js";

const IMAGE_TOOLS = new Set(["image_transcribe", "image_read", "image_search"]);

export interface CrossLogGroup {
  key: string;
  logEntryIds: string[];
  assertions: { id: string; log_entry_id: string; value: unknown }[];
}

export interface CrossLogCount {
  assertions: number;
  imagePassExcluded: number;
  notComparable: number;
  groups: CrossLogGroup[];
}

export function crossLogDuplicates(research: any): CrossLogCount {
  const logTool = new Map<string, unknown>(
    (Array.isArray(research?.log) ? research.log : []).map((l: any) => [l?.id, l?.tool]),
  );
  const assertions: any[] = Array.isArray(research?.assertions) ? research.assertions : [];
  const byKey = new Map<string, CrossLogGroup["assertions"]>();
  let imagePassExcluded = 0;
  let notComparable = 0;
  for (const a of assertions) {
    const log = typeof a?.log_entry_id === "string" ? a.log_entry_id : "";
    if (log !== "" && IMAGE_TOOLS.has(logTool.get(log) as string)) {
      imagePassExcluded++;
      continue;
    }
    const key = reextractionKey({ ...a, log_entry_id: "" });
    if (key === undefined) {
      notComparable++;
      continue;
    }
    byKey.set(key, [...(byKey.get(key) ?? []), { id: a.id, log_entry_id: log, value: a.value }]);
  }
  const groups: CrossLogGroup[] = [];
  for (const [key, members] of byKey) {
    const logEntryIds = [...new Set(members.map((m) => m.log_entry_id))];
    if (logEntryIds.length >= 2) groups.push({ key, logEntryIds, assertions: members });
  }
  return { assertions: assertions.length, imagePassExcluded, notComparable, groups };
}

function defaultTargets(): string[] {
  const e2e = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "eval", "runlogs", "e2e");
  const out: string[] = [];
  for (const fixture of readdirSync(e2e).sort()) {
    const dir = join(e2e, fixture);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) {
      const m = /^(run-.+)\.final-research\.json$/.exec(f);
      if (m && !existsSync(join(dir, `${m[1]}.json`))) out.push(join(dir, f));
    }
  }
  return out;
}

if (process.argv[1]?.endsWith("count-cross-log-duplicates.ts")) {
  const args = process.argv.slice(2);
  const targets = (args.length > 0 ? args : defaultTargets()).map((p) =>
    statSync(p).isDirectory() ? join(p, "research.json") : p,
  );
  if (targets.length === 0) {
    console.error("no research.json to read");
    process.exit(1);
  }
  let total = 0;
  for (const path of targets) {
    const c = crossLogDuplicates(JSON.parse(readFileSync(path, "utf-8")));
    total += c.groups.length;
    console.log(
      `${path}\n  assertions: ${c.assertions}; image-pass excluded: ${c.imagePassExcluded}; ` +
        `not comparable: ${c.notComparable}; non-image cross-log groups: ${c.groups.length}`,
    );
    for (const g of c.groups) {
      console.log(`  - ${g.key.split("\u0000").filter(Boolean).join(" | ")} — log entries ${g.logEntryIds.join(", ")}`);
      for (const a of g.assertions) console.log(`      ${a.id} (${a.log_entry_id || "no log entry"}): ${JSON.stringify(a.value)}`);
    }
  }
  console.log(`\nexports read: ${targets.length}; non-image cross-log groups: ${total}`);
}
