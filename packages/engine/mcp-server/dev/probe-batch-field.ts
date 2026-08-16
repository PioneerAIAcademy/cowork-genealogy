/**
 * Probe — evidence trail behind `extractBatchNumber` in
 * `src/tools/record-search.ts` and the `batchNumber` response field documented
 * in `docs/specs/record-search-tool-spec-v2.md` (#1592).
 *
 * Issue #1592 reported that FamilySearch returns the extraction batch on every
 * persona and that `record_search` discards it. Both halves of that turned out
 * to need qualifying, and this probe is what qualified them:
 *
 *   LEG 1 — WHERE does the batch live? The issue's scope note guessed
 *           per-person. Prints every path under an entry whose key is `fields`,
 *           so the answer is read off the document rather than assumed.
 *   LEG 2 — Is the field's `type` URI stable? The issue quotes
 *           `.../types/fields/UdeBatchNbr`. Runs four collections and reports
 *           every batch-ish type suffix seen, with its labelId.
 *   LEG 3 — Is it on "every persona"? Counts presence by record type over an
 *           ordinary indexed search that anchors on no batch at all.
 *   LEG 4 — Is presence a property of the COLLECTION or of the RECORD? Pairs
 *           each hit with its collection so a collection holding both kinds is
 *           visible as such.
 *
 * EVERY VERDICT IS COMPUTED FROM THE RUN, never a literal — same rule as
 * probe-batch-anchor.ts and probe-search-qualifiers.ts. A leg that errors
 * prints NOT MEASURED rather than a direction, so a failed request can never
 * read as a finding — and a 200 carrying ZERO entries counts as not measured
 * too, since a direction drawn off an empty sample is the most convincing kind
 * of nothing (these queries can nil legitimately as the index drifts). Counts
 * are printed as `n/total` for the same reason: the sample size travels with
 * the number.
 *
 * What the run on 2026-08-13 showed, and what the code depends on:
 *   - the batch sits on the gedcomx ROOT's `fields[]`, not on the person
 *     (person-level `fields` carry PR_AGE and Role);
 *   - the type suffix is spelled BOTH `UdeBatchNbr` and `UdeBatchNumber`
 *     depending on collection, while `labelId` is `FS_UDE_BATCH_NBR` in every
 *     case — which is why `extractBatchNumber` keys on labelId alone;
 *   - presence is per RECORD, not per collection or per record type: one
 *     collection returned hits both with and without a batch.
 *
 * Leg 2 sends the collection filter as `f.collectionId`, matching what
 * `record-search.ts` emits. `q.collectionId` scopes identically — measured
 * 2026-08-13, both return 5,281 hits confined to collection 1494474 against
 * 35.4M unscoped — so a run using either is valid evidence; this uses the
 * tool's spelling so the leg cannot be mistaken for an unscoped search.
 *
 * Run:  npx tsx dev/probe-batch-field.ts
 * Needs a live FamilySearch token (`login` tool first).
 */
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchWithTimeout } from "../src/utils/http.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";
const BATCH_LABEL_ID = "FS_UDE_BATCH_NBR";

type AnyObj = Record<string, unknown>;

/** A page of entries, or null when the request failed (never an empty page). */
async function fetchEntries(
  params: Record<string, string>,
): Promise<{ entries: AnyObj[]; total: unknown } | null> {
  try {
    const token = await getValidToken();
    const qs = new URLSearchParams({
      ...params,
      "m.queryRequireDefault": "on",
      "m.defaultFacets": "off",
    });
    const res = await fetchWithTimeout(
      `${BASE}?${qs}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "en",
          "User-Agent": BROWSER_USER_AGENT,
        },
      },
      30_000,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as AnyObj;
    const entries = (body.entries ?? []) as AnyObj[];
    // A 200 carrying zero entries is NOT evidence, and must not reach a leg's
    // verdict line. An empty sample would otherwise print "only one type suffix
    // observed" (the conclusion that justifies the one-spelling matcher this
    // code deliberately avoids) or "no collection held both kinds" (the direct
    // negation of the verdict the spec cites this probe for) — both off zero
    // observations. These queries can legitimately nil as the index drifts, so
    // this is a live path, not a theoretical one.
    if (entries.length === 0) return null;
    return { entries, total: body.results };
  } catch {
    return null;
  }
}

const gedcomxOf = (entry: AnyObj): AnyObj =>
  ((entry.content as AnyObj)?.gedcomx ?? {}) as AnyObj;

/** Every path under `node` whose key is `fields`, with the array's length. */
function fieldsPaths(node: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((v, i) => fieldsPaths(v, `${path}[${i}]`, out));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as AnyObj)) {
      const p = path ? `${path}.${k}` : k;
      if (k === "fields") {
        out.push(`${p} (len ${Array.isArray(v) ? v.length : "n/a"})`);
      }
      fieldsPaths(v, p, out);
    }
  }
  return out;
}

/** The batch as `extractBatchNumber` reads it: root fields, matched on labelId. */
function batchOf(entry: AnyObj): string | undefined {
  for (const f of (gedcomxOf(entry).fields ?? []) as AnyObj[]) {
    for (const v of (f.values ?? []) as AnyObj[]) {
      if (v.labelId === BATCH_LABEL_ID && v.text) return String(v.text);
    }
  }
  return undefined;
}

/** type-suffix -> labelIds, for every field-typed object ANYWHERE in the entry. */
function batchishTypes(node: unknown, acc = new Map<string, Set<string>>()) {
  if (Array.isArray(node)) {
    node.forEach((v) => batchishTypes(v, acc));
  } else if (node && typeof node === "object") {
    const o = node as AnyObj;
    if (typeof o.type === "string" && /batch/i.test(o.type)) {
      const suffix = o.type.split("/").pop() ?? "?";
      const labels = acc.get(suffix) ?? new Set<string>();
      for (const v of (o.values ?? []) as AnyObj[]) {
        if (v.labelId) labels.add(String(v.labelId));
      }
      acc.set(suffix, labels);
    }
    Object.values(o).forEach((v) => batchishTypes(v, acc));
  }
  return acc;
}

/**
 * Selected the way `mapEntry` selects it — the Collection-typed
 * sourceDescription — NOT "the last `about` that looks like a collection URL".
 * LEG 4's per-collection grouping is what produces the "presence is per RECORD"
 * verdict the spec cites, so grouping the hits differently from the tool could
 * manufacture or erase that conclusion from an entry carrying a second
 * collection-shaped `about`.
 */
const COLLECTION_RESOURCE_TYPE = "http://gedcomx.org/Collection";

function collectionOf(entry: AnyObj): { id: string; title: string } {
  const sds = (gedcomxOf(entry).sourceDescriptions ?? []) as AnyObj[];
  const sd = sds.find((d) => d.resourceType === COLLECTION_RESOURCE_TYPE);
  if (!sd) return { id: "?", title: "?" };
  const m = String(sd.about ?? "").match(/\/collections\/([^/?#]+)/);
  return {
    id: m ? m[1] : "?",
    title: String(((sd.titles ?? []) as AnyObj[])[0]?.value ?? "?"),
  };
}

async function leg1() {
  console.log("\n=== LEG 1 — where does the batch live? ===");
  const page = await fetchEntries({
    "q.batchNumber": "M01048-5",
    count: "3",
  });
  if (!page) {
    console.log("  NOT MEASURED (request failed or returned no entries)");
    return;
  }
  for (const [i, entry] of page.entries.entries()) {
    console.log(`  entry[${i}] id=${entry.id}`);
    for (const p of fieldsPaths(entry)) console.log(`    ${p}`);
    const personFields = ((gedcomxOf(entry).persons ?? []) as AnyObj[])
      .flatMap((p) => (p.fields ?? []) as AnyObj[])
      .flatMap((f) => (f.values ?? []) as AnyObj[])
      .map((v) => String(v.labelId ?? "?"));
    console.log(`    person-level labelIds: ${JSON.stringify(personFields)}`);
    console.log(`    batch read off the ROOT: ${batchOf(entry) ?? "(none)"}`);
  }
}

async function leg2() {
  console.log("\n=== LEG 2 — is the `type` URI stable across collections? ===");
  const legs: { name: string; params: Record<string, string> }[] = [
    { name: "batch B01883-5 (the issue's own probe)", params: { "q.batchNumber": "B01883-5" } },
    { name: "batch M01048-5 (English IGI parish)", params: { "q.batchNumber": "M01048-5" } },
    { name: "batch 8317102 (all-numeric)", params: { "q.batchNumber": "8317102" } },
    { name: "collection 1494474 (Germany)", params: { "q.surname": "Martin", "f.collectionId": "1494474" } },
  ];
  const suffixesSeen = new Set<string>();
  const labelsSeen = new Set<string>();
  for (const leg of legs) {
    const page = await fetchEntries({ ...leg.params, count: "5" });
    if (!page) {
      console.log(`  ${leg.name}: NOT MEASURED (failed or empty)`);
      continue;
    }
    const acc = new Map<string, Set<string>>();
    for (const e of page.entries) batchishTypes(e, acc);
    for (const [suffix, labels] of acc) {
      suffixesSeen.add(suffix);
      labels.forEach((l) => labelsSeen.add(l));
    }
    const withBatch = page.entries.filter((e) => batchOf(e) !== undefined).length;
    console.log(
      `  ${leg.name}: ${withBatch}/${page.entries.length} carry a batch; ` +
        `types ${JSON.stringify([...acc.keys()])}`,
    );
  }
  const batchTypes = [...suffixesSeen].filter((s) => /^UdeBatch/.test(s));
  console.log(`  DISTINCT batch type suffixes across all legs: ${JSON.stringify(batchTypes)}`);
  console.log(`  DISTINCT labelIds on batch-ish fields:        ${JSON.stringify([...labelsSeen])}`);
  console.log(
    batchTypes.length === 0
      ? "  => NOT MEASURED: no batch-typed field observed in any leg."
      : batchTypes.length > 1
        ? "  => the type suffix VARIES; a matcher keyed on one spelling misses the others."
        : `  => only one type suffix observed in this run (${batchTypes[0]}); this run does not, on its own, justify keying on it.`,
  );
}

async function leg3() {
  console.log("\n=== LEG 3 — is it on every persona? (no batch anchor) ===");
  // recordType ints per RECORD_TYPE_TO_INT in src/tools/record-search.ts.
  for (const [label, type] of [["birth", "0"], ["marriage", "1"], ["census", "3"]] as const) {
    const page = await fetchEntries({
      "q.surname": "Ackerman",
      "q.recordCountry": "United States",
      "f.recordType": type,
      count: "10",
    });
    if (!page) {
      console.log(`  ${label.padEnd(9)} NOT MEASURED (failed or empty)`);
      continue;
    }
    const n = page.entries.filter((e) => batchOf(e) !== undefined).length;
    console.log(`  ${label.padEnd(9)} ${n}/${page.entries.length} entries carry a batch`);
  }
}

async function leg4() {
  console.log("\n=== LEG 4 — is presence a property of the collection or the record? ===");
  const page = await fetchEntries({
    "q.surname": "Ackerman",
    "q.recordCountry": "United States",
    "f.recordType": "1",
    count: "20",
  });
  if (!page) {
    console.log("  NOT MEASURED (request failed or returned no entries)");
    return;
  }
  const byCollection = new Map<string, { with: number; without: number; title: string }>();
  for (const e of page.entries) {
    const { id, title } = collectionOf(e);
    const row = byCollection.get(id) ?? { with: 0, without: 0, title };
    if (batchOf(e) === undefined) row.without++;
    else row.with++;
    byCollection.set(id, row);
  }
  let mixed = 0;
  for (const [id, row] of byCollection) {
    if (row.with > 0 && row.without > 0) mixed++;
    console.log(`  coll ${id.padEnd(8)} ${row.with} with / ${row.without} without — ${row.title.slice(0, 55)}`);
  }
  console.log(
    mixed > 0
      ? `  => ${mixed} collection(s) hold BOTH kinds, so presence is per RECORD, not per collection.`
      : "  => no collection in this sample held both kinds; presence may be collection-level here.",
  );
}

async function main() {
  await leg1();
  await leg2();
  await leg3();
  await leg4();
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
