/**
 * Probe: what place string does a live `record_read` hand the resolver, and does
 * the resolver place it correctly TODAY?
 *
 * Evidence for issue #1908 (phase 1). `record_read`'s live path calls
 * `toSimplified` (not `toSimplifiedStandardized`), so it fills `standard_place`
 * only from the record's own `normalized` values, never from the resolver —
 * whether recapi supplies a `normalized` value at all is one thing this probe
 * measures. The justification (the "Use toSimplified, NOT toSimplifiedStandardized"
 * block in record-read.ts) cites two
 * mis-resolutions observed 2026-07-08 — before two resolver fixes landed
 * (4823ffdf, 2026-07-22, phrase-quote the `name:` query; 1af50fab, 2026-07-31,
 * derive a `contextName` from the second comma-segment). This probe re-measures,
 * per place string, what the resolver returns NOW, so a human can judge whether
 * the blanket skip is still warranted. It changes NO behaviour and writes nothing.
 *
 * Requires a live FamilySearch session (run `make e2e-login` first). Not shipped
 * in any artifact.
 *
 * IMPORTANT — run only AFTER PR #1877 has landed. #1877 rewrites `searchPlace`'s
 * query sanitisation in place-api.ts — the exact call every resolution here goes
 * through — so numbers taken on plain `main` are stale the day it merges. Rebase
 * onto its branch or wait (issue #1908).
 *
 * Usage:
 *   npx tsx dev/probe-record-read-places.ts
 *
 * The ARKs below are taken verbatim from committed fixtures under
 * eval/fixtures/mcp/record-read-*.json, labelled by each fixture's FS collection
 * title. None are invented, but fixture-derived is not the same as captured-live:
 * only the Richardson pair (JMF4-CL9, NFCY-7VM) is marked CAPTURED LIVE in its
 * fixture; the other six ARKs are constructed or carry no live-capture note
 * (ackerman-1860 / patrick-flynn "mirror an embedded gedcomx"; 68Q9-K34P,
 * birkeland, anders, and urna claim no live capture), so a run over them settles
 * less than a run over live-captured records. Adjust the list before the live run
 * for wider real coverage of the three record families.
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";
import { extractEntityId } from "../src/tools/record-read.js";
import {
  resolveStandardPlace,
  countryConsistency,
  deriveContextName,
} from "../src/utils/place-resolver.js";

// Mirrors RECAPI_BASE in src/tools/record-read.ts (not exported there); the
// fetch below reproduces record_read's live call exactly.
const RECAPI_BASE =
  "https://sg30p0.familysearch.org/service/cds/recapi/records/persona";

type Category =
  | "US census"
  | "England parish"
  | "Scandinavian church book"
  | "Scandinavian marriage index";

interface Ark {
  id: string;
  category: Category;
  note: string;
}

const ARKS: Ark[] = [
  { id: "M7QZ-8KD", category: "US census", note: "United States Census, 1860 (Ackerman)" },
  { id: "68Q9-K34P", category: "US census", note: "United States Census, 1850" },
  { id: "CFLT-9K2", category: "US census", note: "United States Census, 1850 (Flynn)" },
  { id: "JMF4-CL9", category: "England parish", note: "England, Births and Christenings, 1538-1975 (Richardson)" },
  { id: "NFCY-7VM", category: "England parish", note: "England, Births and Christenings, 1538-1975 (Richardson)" },
  { id: "68Q3-5SGC", category: "Scandinavian church book", note: "Norway, Church Books, 1797-1958 (Birkeland baptism)" },
  { id: "NW44-PM2", category: "Scandinavian marriage index", note: "Norway, Marriages, 1660-1926 (Urna/Anders)" },
  { id: "9XKT-M2P", category: "Scandinavian church book", note: "Norway, Church Books, 1815-1930 (Anders)" },
];

// Loose shape for the raw recapi gedcomx — only what this probe reads.
interface RawFact {
  place?: { original?: string; normalized?: { value?: string }[] };
}
interface RawPerson {
  facts?: RawFact[];
}
interface RawRelationship {
  facts?: RawFact[];
}
interface RawGedcomX {
  persons?: RawPerson[];
  relationships?: RawRelationship[];
}

interface PlaceObs {
  ark: string;
  category: Category;
  original: string;
  hasNormalized: boolean;
  segments: number;
  contextName: string | undefined;
  resolved: string | null;
  consistency: "ok" | "contradiction" | "unverifiable" | "no-resolve";
}

async function fetchRecord(entityId: string, token: string): Promise<RawGedcomX> {
  const url = `${RECAPI_BASE}/${encodeURIComponent(entityId)}.json`;
  const res = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`recapi ${res.status} for ${entityId}`);
  }
  return (await res.json()) as RawGedcomX;
}

// Walk every fact's place — the same places record_read returns verbatim.
// record_read returns toSimplified(body), which surfaces BOTH person facts and
// relationship (e.g. a Couple Marriage) facts — see collectFacts in
// gedcomx-convert.ts ("Gather every fact (person + relationship)"). Walk both so
// the probe measures every place record_read hands back, not just person-fact
// places.
function placesOf(body: RawGedcomX): { original: string; hasNormalized: boolean }[] {
  const out: { original: string; hasNormalized: boolean }[] = [];
  const factLists: (RawFact[] | undefined)[] = [
    ...(body.persons ?? []).map((p) => p.facts),
    ...(body.relationships ?? []).map((r) => r.facts),
  ];
  for (const facts of factLists) {
    for (const f of facts ?? []) {
      const original = f.place?.original;
      if (typeof original === "string" && original.trim() !== "") {
        const normalized = f.place?.normalized;
        // Mirror record_read's own gate (pickNormalizedPlace in
        // gedcomx-convert.ts): a normalized value counts only when some entry has
        // a truthy `.value` — a non-empty array of value-less entries yields no
        // standard_place in the tool, so it must not read as "supplied" here.
        const hasNormalized =
          Array.isArray(normalized) &&
          normalized.some((n) => typeof n?.value === "string" && n.value !== "");
        out.push({ original, hasNormalized });
      }
    }
  }
  return out;
}

async function main(): Promise<void> {
  const token = await getValidToken();
  const rows: PlaceObs[] = [];
  const seen = new Set<string>();
  const skippedArks: string[] = [];

  for (const ark of ARKS) {
    const entityId = extractEntityId(ark.id);
    let body: RawGedcomX;
    try {
      body = await fetchRecord(entityId, token);
    } catch (e) {
      console.error(`SKIP ${ark.id} (${ark.category}): ${(e as Error).message}`);
      skippedArks.push(ark.id);
      continue;
    }
    for (const { original, hasNormalized } of placesOf(body)) {
      const dedupeKey = `${ark.id}::${original}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const resolved = await resolveStandardPlace(original);
      rows.push({
        ark: ark.id,
        category: ark.category,
        original,
        hasNormalized,
        segments: original.split(",").length,
        contextName: deriveContextName(original),
        resolved,
        consistency:
          resolved === null ? "no-resolve" : countryConsistency(original, resolved),
      });
    }
  }

  console.log("\n=== per-place observations ===");
  for (const r of rows) {
    console.log(
      [
        r.ark,
        `[${r.category}]`,
        `orig=${JSON.stringify(r.original)}`,
        `norm=${r.hasNormalized ? "yes" : "no"}`,
        `seg=${r.segments}`,
        `ctx=${r.contextName ?? "undefined"}`,
        `resolved=${r.resolved === null ? "null" : JSON.stringify(r.resolved)}`,
        `consistency=${r.consistency}`,
      ].join("  "),
    );
  }

  const total = rows.length;
  const single = rows.filter((r) => r.segments === 1).length;
  const normalizedSupplied = rows.filter((r) => r.hasNormalized).length;
  const byConsistency = {
    ok: rows.filter((r) => r.consistency === "ok").length,
    contradiction: rows.filter((r) => r.consistency === "contradiction").length,
    unverifiable: rows.filter((r) => r.consistency === "unverifiable").length,
    noResolve: rows.filter((r) => r.consistency === "no-resolve").length,
  };

  console.log("\n=== summary ===");
  console.log(
    `ARKs: ${ARKS.length} requested, ${ARKS.length - skippedArks.length} fetched, ` +
      `${skippedArks.length} skipped${skippedArks.length ? ` (${skippedArks.join(", ")})` : ""}`,
  );
  console.log(`places observed: ${total}`);
  console.log(
    `single-segment: ${single} (${total ? Math.round((single / total) * 100) : 0}%)`,
  );
  console.log(`recapi supplied place.normalized: ${normalizedSupplied}/${total}`);
  console.log(
    `countryConsistency: ok=${byConsistency.ok} contradiction=${byConsistency.contradiction} ` +
      `unverifiable=${byConsistency.unverifiable} no-resolve=${byConsistency.noResolve}`,
  );
  console.log(
    "\nCORRECT vs WRONG is a human read: compare each `resolved` against the " +
      "record's true place. countryConsistency is only a proxy (a wrong resolve " +
      "inside the same country still reads `ok`).",
  );
  console.log(
    "NOTE: `resolved=null` (consistency=no-resolve) means resolveStandardPlace " +
      "returned null, which is EITHER a genuine no-match (definitive) OR a " +
      "transient network failure after retries — the two are indistinguishable " +
      "in this output. An unexpectedly high no-resolve count should be " +
      "re-run/checked before drawing conclusions.",
  );
  console.log("Paste this table into issue #1908.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
