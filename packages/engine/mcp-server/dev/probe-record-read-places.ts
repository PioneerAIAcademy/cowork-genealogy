/**
 * Probe: what place string does a live `record_read` hand the resolver, and does
 * the resolver place it correctly TODAY?
 *
 * Evidence for issue #1908 (phase 1). This probe calls the real `recordReadTool`
 * and reads its output with `collectFacts` — it measures what `record_read`
 * actually returns, it does not reconstruct it. `record_read`'s live path calls
 * `toSimplified` (not `toSimplifiedStandardized`), so a fact carries a
 * `standard_place` only when the record's own `normalized` value supplied one
 * (via `pickNormalizedPlace`); the resolver is never consulted. How often that
 * happens is the `standard_place` column / headline count below. The
 * justification (the "Use toSimplified, NOT toSimplifiedStandardized" block in
 * record-read.ts) cites two mis-resolutions observed 2026-07-08 — before two
 * resolver fixes landed (4823ffdf, 2026-07-22, phrase-quote the `name:` query;
 * 1af50fab, 2026-07-31, derive a `contextName` from the second comma-segment).
 * This probe re-measures, per place string, what `resolveStandardPlace` returns
 * NOW (the counterfactual: what a live standardization *would* produce), so a
 * human can judge whether the blanket skip is still warranted. It changes NO
 * behaviour and writes nothing.
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
import { recordReadTool } from "../src/tools/record-read.js";
import { collectFacts } from "../src/utils/gedcomx-convert.js";
import {
  resolveStandardPlace,
  countryConsistency,
  deriveContextName,
  placeSegments,
  mapWithConcurrency,
} from "../src/utils/place-resolver.js";

const CONCURRENCY = 6;

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

type Consistency = "ok" | "contradiction" | "unverifiable" | "no-resolve";

interface PlaceObs {
  ark: string;
  note: string;
  category: Category;
  original: string;
  hasStandardPlace: boolean; // record_read's output carried a standard_place
  segments: number;
  contextName: string | undefined;
  resolved: string | null; // what a live standardization WOULD produce, today
  consistency: Consistency;
}

interface ArkRead {
  ark: Ark;
  facts: ReturnType<typeof collectFacts>;
  error?: string;
}

async function main(): Promise<void> {
  // Read each record through the actual tool (parallel; the tool handles auth,
  // the recapi fetch, and toSimplified). collectFacts then gives exactly the
  // facts record_read returns — person + relationship, after toSimplified's
  // ParentChild subtype lift — so the probe measures the tool's output, not a
  // reconstruction of it.
  const reads: ArkRead[] = await mapWithConcurrency(ARKS, CONCURRENCY, async (ark) => {
    try {
      const result = await recordReadTool({ recordId: ark.id });
      return { ark, facts: collectFacts(result) };
    } catch (e) {
      return { ark, facts: [], error: (e as Error).message };
    }
  });

  const skipped = reads.filter((r) => r.error);
  for (const s of skipped) {
    console.error(`SKIP ${s.ark.id} (${s.ark.category}): ${s.error}`);
  }

  // Flatten to distinct (ark, place text, standard_place-present) observations —
  // the dedup key includes hasStandardPlace so two facts with the same text but
  // different normalization state are both kept (a real FS data inconsistency).
  const seen = new Set<string>();
  const pending: { ark: Ark; original: string; hasStandardPlace: boolean }[] = [];
  for (const { ark, facts } of reads) {
    for (const fact of facts) {
      const original = fact.place;
      if (typeof original !== "string" || original.trim() === "") continue;
      const hasStandardPlace =
        typeof fact.standard_place === "string" && fact.standard_place !== "";
      const key = `${ark.id}::${original}::${hasStandardPlace}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pending.push({ ark, original, hasStandardPlace });
    }
  }

  // Resolve each place string (parallel; resolveStandardPlace memoizes, so this
  // is safe and mapWithConcurrency preserves input order for a stable table).
  const rows: PlaceObs[] = await mapWithConcurrency(pending, CONCURRENCY, async (p) => {
    const resolved = await resolveStandardPlace(p.original);
    return {
      ark: p.ark.id,
      note: p.ark.note,
      category: p.ark.category,
      original: p.original,
      hasStandardPlace: p.hasStandardPlace,
      segments: placeSegments(p.original).length,
      contextName: deriveContextName(p.original),
      resolved,
      consistency: resolved === null ? "no-resolve" : countryConsistency(p.original, resolved),
    };
  });

  console.log("\n=== per-place observations ===");
  for (const r of rows) {
    console.log(
      [
        r.ark,
        `[${r.category}]`,
        `orig=${JSON.stringify(r.original)}`,
        `std=${r.hasStandardPlace ? "yes" : "no"}`,
        `seg=${r.segments}`,
        `ctx=${r.contextName ?? "undefined"}`,
        `resolved=${r.resolved === null ? "null" : JSON.stringify(r.resolved)}`,
        `consistency=${r.consistency}`,
        `(${r.note})`,
      ].join("  "),
    );
  }

  const total = rows.length;
  const single = rows.filter((r) => r.segments === 1).length;
  const withStandardPlace = rows.filter((r) => r.hasStandardPlace).length;

  // Keyed reduction rather than one .filter() per bucket, plus a sum check — so a
  // future countryConsistency return value cannot silently vanish from the tally.
  const byConsistency: Record<Consistency, number> = {
    ok: 0,
    contradiction: 0,
    unverifiable: 0,
    "no-resolve": 0,
  };
  for (const r of rows) byConsistency[r.consistency] += 1;
  const bucketSum = Object.values(byConsistency).reduce((a, b) => a + b, 0);
  if (bucketSum !== total) {
    throw new Error(
      `consistency buckets sum to ${bucketSum} but there are ${total} rows — an ` +
        "unaccounted countryConsistency value slipped through; add it to byConsistency.",
    );
  }

  console.log("\n=== summary ===");
  console.log(
    `ARKs: ${ARKS.length} requested, ${ARKS.length - skipped.length} fetched, ` +
      `${skipped.length} skipped${skipped.length ? ` (${skipped.map((s) => s.ark.id).join(", ")})` : ""}`,
  );
  console.log(`places observed: ${total}`);
  console.log(
    `single-segment: ${single} (${total ? Math.round((single / total) * 100) : 0}%)`,
  );
  console.log(
    `record_read output carried standard_place: ${withStandardPlace}/${total} ` +
      "(what pickNormalizedPlace produced from recapi's own normalized values)",
  );
  console.log(
    "countryConsistency: " +
      (Object.entries(byConsistency) as [Consistency, number][])
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
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
