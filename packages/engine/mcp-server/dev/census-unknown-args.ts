// Issue #3736: every tool call in the committed e2e run logs through the shipped
// `rejectUnknownArgs`, so the PR can show what the guard would refuse. Prints
// each refused (tool, key) with its count and the dates of the runs that sent
// it. Offline.
//
//   npx tsx dev/census-unknown-args.ts

import { allToolSchemas } from "../src/tool-schemas.js";
import { rejectUnknownArgs } from "../src/utils/unknown-args.js";
import { bareName, readRunLog, runLogFiles, toolCalls } from "./runlog-calls.js";

const advertised = new Set((allToolSchemas as any[]).map((t) => t.name));

let calls = 0;
let refused = 0;
const byKey = new Map<string, { n: number; first: string; last: string }>();
for (const file of runLogFiles("e2e")) {
  if (!/\/run-[^/]*\.json$/.test(file) || /\.final-/.test(file)) continue;
  const date = file.split("/run-").pop()!.slice(0, 10);
  for (const call of toolCalls((readRunLog(file) as any)?.tool_calls)) {
    const tool = bareName(call);
    if (!advertised.has(tool)) continue;
    calls += 1;
    const refusal = rejectUnknownArgs(tool, call.args);
    if (refusal === null) continue;
    refused += 1;
    for (const [key, value] of Object.entries(call.args)) {
      if (rejectUnknownArgs(tool, { [key]: value }) === null) continue;
      const id = `${tool}.${key}`;
      const e = byKey.get(id) ?? { n: 0, first: date, last: date };
      e.n += 1;
      if (date < e.first) e.first = date;
      if (date > e.last) e.last = date;
      byKey.set(id, e);
    }
  }
}
console.log(`calls ${calls}, refused ${refused}, distinct refused (tool, key) ${byKey.size}`);
for (const [id, e] of [...byKey].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(e.n).padStart(5)}  ${id}  ${e.first}..${e.last}`);
}
if (calls === 0) {
  console.log("no calls read: the run-log path is wrong");
  process.exit(1);
}
