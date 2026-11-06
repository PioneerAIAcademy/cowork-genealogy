/**
 * Issue #4299: is a tree fact's `standard_place` FamilySearch's own
 * `place.normalized`, or the engine's resolver? Fetches one person raw and
 * prints each place-bearing fact's `original` and `normalized` (read-only).
 *
 *   npx tsx dev/probe-standard-place-4299.ts MKJ4-3F1
 */
import { LOCAL } from "../src/auth/principal.js";
import { fsFetch } from "../src/utils/fs-fetch.js";

const pid = process.argv[2];
if (!pid) throw new Error("Usage: npx tsx dev/probe-standard-place-4299.ts <personId>");
const url = `https://api.familysearch.org/platform/tree/persons/${encodeURIComponent(pid)}`;
const res = await fsFetch(LOCAL, url, { headers: { Accept: "application/x-fs-v1+json", "Accept-Language": "en" } });
const body = (await res.json()) as { persons?: { id: string; facts?: { type?: string; place?: unknown }[] }[] };
for (const p of body.persons ?? []) {
  if (p.id !== pid) continue;
  for (const f of p.facts ?? []) if (f.place) console.log(f.type, JSON.stringify(f.place));
}
