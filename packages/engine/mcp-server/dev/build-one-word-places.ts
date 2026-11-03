/**
 * Rebuild config/one-word-places.json, the list `resolveBareName` answers a
 * one-word place from, out of matcher-lab's `m13/one_word_places_final.json`
 * (the lead's 2026-10-26 list). Every entry is kept, as `OneWordEntry` stores it:
 *   {type: "always"}                                   -> the full name
 *   {type: "always", except_record_countries: [..]}    -> {place, except_record_countries}
 *   {type: "record_country", country}                  -> {place, record_country}
 *   {type: "always_accented_only", accented_spellings_required: [..]} -> {place, accented_spellings}
 * Writes nothing when an entry's condition is any other shape (an unknown type
 * or key), when a recorded spelling does not fold to its key under
 * `foldPlaceKey`, when an accent-only spelling carries no accent, or when two
 * entries share a key.
 *
 *   npx tsx dev/build-one-word-places.ts <path>/m13/one_word_places_final.json
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { accentKey, foldPlaceKey, ONE_WORD_PLACES_PATH, type OneWordEntry } from "../src/utils/one-word-places.js";

export interface SourceEntry {
  key: string;
  text: string;
  spellings: string[];
  full_name: string;
  condition_struct: Record<string, unknown>;
}

export type Kind = "always" | "except_record_countries" | "record_country" | "accented_spellings";

const isNames = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim() !== "");
const sameKeys = (o: Record<string, unknown>, keys: string[]) =>
  Object.keys(o).sort().join() === [...keys].sort().join();

/** The entry a source condition gives, or why it cannot be read. */
function convert(e: SourceEntry): { kind: Kind; entry: OneWordEntry } | string {
  const c = e.condition_struct ?? {};
  const place = e.full_name;
  if (c.type === "always" && sameKeys(c, ["type"])) return { kind: "always", entry: place };
  if (c.type === "always" && sameKeys(c, ["type", "except_record_countries"]) && isNames(c.except_record_countries)) {
    return { kind: "except_record_countries", entry: { place, except_record_countries: c.except_record_countries } };
  }
  if (c.type === "record_country" && sameKeys(c, ["type", "country"]) && isNames([c.country])) {
    return { kind: "record_country", entry: { place, record_country: c.country as string } };
  }
  if (
    c.type === "always_accented_only" &&
    sameKeys(c, ["type", "accented_spellings_required"]) &&
    isNames(c.accented_spellings_required)
  ) {
    return { kind: "accented_spellings", entry: { place, accented_spellings: c.accented_spellings_required } };
  }
  return `unknown condition ${JSON.stringify(c)}`;
}

/** The bundled list's entries, sorted by key, and their count by kind; or the
 *  problems that keep the source from being written. */
export function buildOneWordPlaces(source: { entries: SourceEntry[] }): {
  entries: Record<string, OneWordEntry>;
  counts: Record<Kind, number>;
  problems: string[];
} {
  const kept = new Map<string, OneWordEntry>();
  const counts: Record<Kind, number> = { always: 0, except_record_countries: 0, record_country: 0, accented_spellings: 0 };
  const problems: string[] = [];
  for (const e of source.entries) {
    const at = JSON.stringify(e.key);
    const got = convert(e);
    if (typeof got === "string") {
      problems.push(`${at}: ${got}`);
      continue;
    }
    for (const spelling of [e.text, ...e.spellings]) {
      const folded = foldPlaceKey(spelling);
      if (folded !== e.key) problems.push(`${JSON.stringify(spelling)} folds to ${JSON.stringify(folded)}, not its key ${at}`);
    }
    if (typeof got.entry === "object" && "accented_spellings" in got.entry) {
      for (const s of got.entry.accented_spellings) {
        if (foldPlaceKey(s) !== e.key) problems.push(`accented spelling ${JSON.stringify(s)} does not fold to its key ${at}`);
        if (accentKey(s) === e.key) problems.push(`accented spelling ${JSON.stringify(s)} of ${at} carries no accent`);
      }
    }
    if (kept.has(e.key)) problems.push(`two entries for the key ${at}`);
    if (typeof e.full_name !== "string" || e.full_name.trim() === "") problems.push(`no full name for ${at}`);
    kept.set(e.key, got.entry);
    counts[got.kind] += 1;
  }
  if (kept.size === 0) problems.push("no entries");
  const entries = Object.fromEntries([...kept].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { entries, counts, problems };
}

if (process.argv[1]?.endsWith("build-one-word-places.ts")) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: npx tsx dev/build-one-word-places.ts <one_word_places_final.json>");
    process.exit(2);
  }
  const raw = readFileSync(file);
  const source = JSON.parse(raw.toString("utf-8")) as { version?: number; entries: SourceEntry[] };
  const { entries, counts, problems } = buildOneWordPlaces(source);
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    console.error(`not written: ${problems.length} problem(s)`);
    process.exit(1);
  }
  const out = {
    _meta: {
      what: "One-word place texts, folded, and the FamilySearch place each standardizes to: the lead's 2026-10-26 list, with each entry's condition on the record's country or on the accents as written.",
      source: basename(file),
      source_version: source.version ?? null,
      source_sha256: createHash("sha256").update(raw).digest("hex"),
      built_by: "dev/build-one-word-places.ts",
      entries: Object.keys(entries).length,
      by_kind: counts,
      entries_sha256: createHash("sha256").update(JSON.stringify(entries)).digest("hex"),
    },
    entries,
  };
  writeFileSync(ONE_WORD_PLACES_PATH, JSON.stringify(out, null, 1) + "\n", "utf-8");
  console.log(`wrote ${ONE_WORD_PLACES_PATH}: ${out._meta.entries} entries ${JSON.stringify(counts)}; entries_sha256 ${out._meta.entries_sha256}`);
}
