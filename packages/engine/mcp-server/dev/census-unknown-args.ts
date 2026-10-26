// Issue #3736: every tool call in the committed e2e run logs through the shipped
// `rejectUnknownArgs`, so the PR can show what the guard would refuse. Walks
// `tool_calls[].args` of eval/runlogs/e2e/*/run-*.json (not the .ann / .final-*
// sidecars) and prints each refused (tool, key) with its count and the dates of
// the runs that sent it. Offline.
//
//   npx tsx dev/census-unknown-args.ts

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allToolSchemas } from "../src/tool-schemas.js";
import { rejectUnknownArgs } from "../src/utils/unknown-args.js";

const E2E = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../eval/runlogs/e2e");
const parameters = new Map((allToolSchemas as any[]).map((t) => [t.name, Object.keys(t.inputSchema?.properties ?? {})]));

let calls = 0;
let refused = 0;
const byKey = new Map<string, { n: number; first: string; last: string }>();
for (const slug of readdirSync(E2E)) {
  let files: string[];
  try {
    files = readdirSync(join(E2E, slug));
  } catch {
    continue;
  }
  for (const f of files) {
    if (!/^run-.*\.json$/.test(f) || /\.(ann|final-[^.]+(\.gedcomx)?)\.json$/.test(f)) continue;
    let log: any;
    try {
      log = JSON.parse(readFileSync(join(E2E, slug, f), "utf-8"));
    } catch {
      continue;
    }
    const date = f.slice(4, 14);
    for (const call of log?.tool_calls ?? []) {
      const tool = String(call?.tool ?? "").split("__").pop()!;
      const known = parameters.get(tool);
      if (!known || call?.args === null || typeof call?.args !== "object") continue;
      calls += 1;
      if (rejectUnknownArgs(tool, call.args) === null) continue;
      refused += 1;
      for (const key of Object.keys(call.args)) {
        if (known.includes(key)) continue;
        const id = `${tool}.${key}`;
        const e = byKey.get(id) ?? { n: 0, first: date, last: date };
        e.n += 1;
        if (date < e.first) e.first = date;
        if (date > e.last) e.last = date;
        byKey.set(id, e);
      }
    }
  }
}
console.log(`calls ${calls}, refused ${refused}, distinct unknown (tool, key) ${byKey.size}`);
for (const [id, e] of [...byKey].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(e.n).padStart(5)}  ${id}  ${e.first}..${e.last}`);
}
if (calls === 0) {
  console.log("no calls read: the run-log path is wrong");
  process.exit(1);
}
