// Audit of the deed/probate formula patterns (deed-formula.ts) against every
// transcription-like string in the e2e corpus. Usage: npx tsx dev/probe-deed-formula.ts <file>...
import { readFileSync } from "node:fs";
import { formulaPhrases } from "../src/utils/deed-formula.js";

const strings = (o: unknown, out: string[] = []): string[] => {
  if (typeof o === "string") { if (/know (ye|all men)|administrat(or|rix)|in (the )?presence of/i.test(o)) out.push(o); }
  else if (Array.isArray(o)) o.forEach((x) => strings(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => strings(x, out));
  return out;
};

for (const f of process.argv.slice(2)) {
  let texts: string[] = [];
  try { texts = strings(JSON.parse(readFileSync(f, "utf8"))); } catch { console.log(`${f}	UNREADABLE`); continue; }
  const found = texts.flatMap((t) => formulaPhrases(t));
  const by: Record<string, number> = {};
  for (const h of found) if (h.names.length > 0) by[h.formula] = (by[h.formula] ?? 0) + 1;
  console.log(`${f}	strings=${texts.length}	phrases-with-names=${JSON.stringify(by)}	${found.filter((h) => h.names.length).slice(0, 2).map((h) => JSON.stringify(h.phrase.slice(0, 90))).join(" | ")}`);
}
