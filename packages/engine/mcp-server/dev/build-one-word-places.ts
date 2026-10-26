/**
 * Rebuild config/one-word-places.json, the list `resolveBareName` answers a
 * one-word place from, out of matcher-lab's `m13/one_word_places_final.json`
 * (the lead's 2026-10-26 list). Keeps every entry whose condition is "always"
 * and names no record-country exception. An entry for one record country, or
 * one excepted in some record countries, waits for a resolver that knows a
 * record's country. Writes nothing when a kept entry's recorded spellings do not
 * fold to its key under `foldPlaceKey`, or when two entries share a key.
 *
 *   npx tsx dev/build-one-word-places.ts <path>/m13/one_word_places_final.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { foldPlaceKey, ONE_WORD_PLACES_PATH } from "../src/utils/one-word-places.js";

interface SourceEntry {
  key: string;
  text: string;
  spellings: string[];
  full_name: string;
  condition_struct: { type: string; except_record_countries?: string[] };
}

const file = process.argv[2];
if (!file) {
  console.error("usage: npx tsx dev/build-one-word-places.ts <one_word_places_final.json>");
  process.exit(2);
}
const raw = readFileSync(file);
const source = JSON.parse(raw.toString("utf-8")) as { entries: SourceEntry[] };

const kept = new Map<string, string>();
const problems: string[] = [];
let oneCountry = 0;
let excepted = 0;
for (const e of source.entries) {
  if (e.condition_struct.type !== "always") {
    oneCountry += 1;
    continue;
  }
  if ((e.condition_struct.except_record_countries ?? []).length > 0) {
    excepted += 1;
    continue;
  }
  for (const spelling of [e.text, ...e.spellings]) {
    const folded = foldPlaceKey(spelling);
    if (folded !== e.key) problems.push(`${JSON.stringify(spelling)} folds to ${JSON.stringify(folded)}, not its key ${JSON.stringify(e.key)}`);
  }
  if (kept.has(e.key)) problems.push(`two entries for the key ${JSON.stringify(e.key)}`);
  if (typeof e.full_name !== "string" || e.full_name.trim() === "") problems.push(`no full name for ${JSON.stringify(e.key)}`);
  kept.set(e.key, e.full_name);
}
if (problems.length > 0 || kept.size === 0) {
  for (const p of problems) console.error(p);
  console.error(`not written: ${problems.length} problem(s), ${kept.size} entries kept`);
  process.exit(1);
}

const entries = Object.fromEntries([...kept].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const out = {
  _meta: {
    what: "One-word place texts, folded, and the FamilySearch place each standardizes to on every record: the unconditional entries of the lead's 2026-10-26 list.",
    source: basename(file),
    source_sha256: createHash("sha256").update(raw).digest("hex"),
    built_by: "dev/build-one-word-places.ts",
    entries: kept.size,
    left_out: { one_record_country: oneCountry, record_country_exceptions: excepted },
  },
  entries,
};
writeFileSync(ONE_WORD_PLACES_PATH, JSON.stringify(out, null, 1) + "\n", "utf-8");
console.log(
  `wrote ${ONE_WORD_PLACES_PATH}: ${kept.size} entries; left out ${oneCountry} for one record country ` +
    `and ${excepted} with record-country exceptions`,
);
