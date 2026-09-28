/**
 * WHAT does a CENSUS persona carry that says relationship-to-head, and what says
 * line/source-person order?
 *
 * EXPLORATORY. **Its output is not in `dev/measured-figures.json` and must not be
 * cited as measured.** Nothing here calls `record()`.
 *
 * ## Why it exists
 *
 * Issue #2937 decides a census persona's `record_role` in code. The plan's first
 * draft assumed two things, and the repo already contradicted one of them:
 *
 *   - `dev/explore-relative-role-classifier-records.ts` ("What it measured" §1)
 *     found `fields[]` to be a DEAD END for kin — a walker over every `fields[]`
 *     at root/person/name/fact level found ZERO kin labels across two
 *     collections. But it also warns labels are PER COLLECTION, and neither of
 *     those two was a census. So "no kin label on a census" was never measured.
 *   - `SOURCE_PERSON_NBR` appears nowhere in this repo. There is no committed
 *     evidence FamilySearch returns it under that or any name.
 *
 * So: read censuses specifically, and read one WITH a relationship column
 * (US 1880+, England & Wales 1851+) against one WITHOUT (US pre-1880), because
 * the whole point of the year table is that the two differ in the schedule, not
 * in whether an indexer happened to fill a cell.
 *
 * ## What it prints
 *
 * Per pool: the collection titles actually returned (so a wrong collection id
 * cannot masquerade as a finding), a `role` histogram, a `fields[].values[]`
 * labelId histogram split by where it hangs, and a full per-person dump of the
 * first household — id, role, names, and every field — which is the only view
 * that answers "is the relationship stated anywhere I can read it".
 *
 * Run: `npx tsx dev/probe-census-persona-fields.ts [collectionId ...]` from
 * `packages/engine/mcp-server`.
 */
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchRetry, sleep } from "./http-retry.js";

const BASE = "https://www.familysearch.org/service/search/hr/v2/personas";

/**
 * Candidate census collections. The ids are UNVERIFIED inputs — the probe prints
 * the collection title it actually got back, so the run itself says whether the
 * id was right. Do not copy an id out of here as established.
 */
const POOLS: { label: string; qs: string }[] = [
  {
    label: "US 1880 (relationship column EXPECTED present)",
    qs: "f.collectionId=1417683&q.surname=Miller&q.residencePlace=Ohio",
  },
  {
    label: "US 1850 (relationship column EXPECTED absent)",
    qs: "f.collectionId=1401638&q.surname=Miller&q.residencePlace=Ohio",
  },
  {
    label: "England & Wales 1851 (relationship column EXPECTED present)",
    qs: "f.collectionId=1493747&q.surname=Jones",
  },
];

/** Every `role` in the object tree, with counts. */
function collectRoles(node: any, out: Map<string, number>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectRoles(x, out);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "role" && typeof v === "string") out.set(v, (out.get(v) ?? 0) + 1);
    collectRoles(v, out);
  }
}

/**
 * Every `fields[].values[].labelId`, tagged by the key path it hangs under, so
 * "the root carries it" and "the person carries it" are distinguishable — that
 * distinction is the whole question for a per-person relationship label.
 */
function collectLabels(node: any, where: string, out: Map<string, number>): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectLabels(x, where, out);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "fields" && Array.isArray(v)) {
      for (const f of v as any[]) {
        for (const val of f?.values ?? []) {
          if (val?.labelId) {
            const key = `${where}:${String(val.labelId)}`;
            out.set(key, (out.get(key) ?? 0) + 1);
          }
        }
      }
      continue;
    }
    collectLabels(v, k === "persons" || k === "names" || k === "facts" ? k : where, out);
  }
}

/** A person's own fields, flattened to `labelId=text` for the dump. */
function personFields(p: any): string[] {
  const out: string[] = [];
  for (const f of p?.fields ?? []) {
    for (const v of f?.values ?? []) {
      if (v?.labelId) out.push(`${v.labelId}=${JSON.stringify(v.text ?? null)}`);
    }
  }
  return out;
}

/** Anything that smells like an ordering/sequence number, by label name alone. */
const ORDER_HINT = /(NBR|NUMBER|NUM|LINE|SEQ|ORDER|DWELL|HOUSEHOLD|HH)/i;
/** Anything that smells like a kin/relationship label, by label name alone. */
const KIN_HINT = /(REL|KIN|HEAD|SPOUSE|FATHER|MOTHER|CHILD|SON|DAU|WIFE|HUSB)/i;

async function runPool(label: string, qs: string): Promise<void> {
  console.log(`\n############ ${label} ############`);
  console.log(`  query: ${qs}`);
  await sleep(500);
  const token = await getValidToken(LOCAL);
  const res = await fetchRetry(
    `${BASE}?${qs}&count=25&offset=0&m.queryRequireDefault=on`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": BROWSER_USER_AGENT,
      },
    },
    { maxRetries: 6, baseMs: 10_000, label },
  );
  if (res.status === 204) {
    console.log("  204 — no results. The collection id is probably wrong.");
    return;
  }
  if (!res.ok) {
    console.log(`  HTTP ${res.status} — refusing to report a partial read.`);
    return;
  }
  const body: any = await res.json();
  const entries: any[] = body?.entries ?? [];
  console.log(`  read ${entries.length} personas`);
  if (entries.length === 0) return;

  // 1. SELF-VERIFICATION: what collection did we actually read?
  const titles = new Map<string, number>();
  for (const e of entries) {
    for (const sd of e?.content?.gedcomx?.sourceDescriptions ?? []) {
      if (sd?.resourceType === "http://gedcomx.org/Collection") {
        const t = sd?.titles?.[0]?.value;
        if (t) titles.set(t, (titles.get(t) ?? 0) + 1);
      }
    }
  }
  console.log("\n  -- collection(s) actually returned --");
  for (const [t, n] of [...titles].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${n.toString().padStart(4)}  ${t}`);
  }

  // 2. role vocabulary
  const roles = new Map<string, number>();
  for (const e of entries) collectRoles(e?.content?.gedcomx, roles);
  console.log("\n  -- role vocabulary --");
  if (roles.size === 0) console.log("     (none)");
  for (const [r, n] of [...roles].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${n.toString().padStart(4)}  ${r}`);
  }

  // 3. field-label vocabulary, tagged by where it hangs
  const labels = new Map<string, number>();
  for (const e of entries) collectLabels(e?.content?.gedcomx, "root", labels);
  const sorted = [...labels].sort((a, b) => b[1] - a[1]);
  console.log(`\n  -- fields[] labelId vocabulary (${sorted.length} distinct) --`);
  for (const [l, n] of sorted) console.log(`     ${n.toString().padStart(4)}  ${l}`);

  console.log("\n  -- labels matching a KIN hint --");
  const kin = sorted.filter(([l]) => KIN_HINT.test(l));
  console.log(kin.length ? kin.map(([l, n]) => `     ${n} ${l}`).join("\n") : "     NONE");

  console.log("\n  -- labels matching an ORDER hint --");
  const ord = sorted.filter(([l]) => ORDER_HINT.test(l));
  console.log(ord.length ? ord.map(([l, n]) => `     ${n} ${l}`).join("\n") : "     NONE");

  // 4. the decisive view: one full household, person by person
  const withHousehold = entries.find(
    (e) => (e?.content?.gedcomx?.persons ?? []).length > 2,
  );
  const sample = withHousehold ?? entries[0];
  const gx = sample?.content?.gedcomx;
  console.log(
    `\n  -- one household, person by person (${(gx?.persons ?? []).length} persons) --`,
  );
  for (const p of gx?.persons ?? []) {
    const name = p?.names?.[0]?.nameForms?.[0]?.fullText ?? "(no name)";
    const flags = [
      p?.principal === true ? "PRINCIPAL" : "",
      p?.role ? `role=${p.role}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`\n     id=${p?.id}  ${name}  ${flags}`);
    const fs = personFields(p);
    if (fs.length === 0) console.log("        fields: (none)");
    for (const f of fs) console.log(`        ${f}`);
    for (const fact of p?.facts ?? []) {
      const ft = String(fact?.type ?? "").split("/").pop();
      console.log(
        `        FACT ${ft} date=${JSON.stringify(fact?.date?.original ?? null)} ` +
          `place=${JSON.stringify(fact?.place?.original ?? null)} ` +
          `value=${JSON.stringify(fact?.value ?? null)}`,
      );
    }
  }

  console.log("\n     -- relationships on that household --");
  const rels = gx?.relationships ?? [];
  if (rels.length === 0) console.log("        (none)");
  for (const r of rels) {
    const t = String(r?.type ?? "").split("/").pop();
    console.log(
      `        ${t}: ${r?.person1?.resourceId ?? r?.person1?.resource} -> ` +
        `${r?.person2?.resourceId ?? r?.person2?.resource}`,
    );
  }

  // 5. THE DECISIVE COMPARISON. The search response above populates `fields[]`
  // for the SEARCHED persona only; every co-resident comes back name+facts and
  // nothing else. A role rule that needs each person's relationship-to-head
  // therefore cannot be fed from a search sidecar. `record_read` fetches the
  // whole record by ARK — so does IT carry fields for everyone? That is the
  // question that decides whether the rule is implementable at all.
  await probeRecordRead(sample);
}

/**
 * Re-fetch the sampled entry through the same recapi endpoint `record_read`
 * uses, and dump per-person fields. `record_read` itself returns `toSimplified`
 * output, which DROPS `fields[]`, so the tool cannot answer this — only the raw
 * body can.
 */
async function probeRecordRead(entry: any): Promise<void> {
  const RECAPI = "https://sg30p0.familysearch.org/service/cds/recapi/records/persona";
  const id: string | undefined = entry?.id;
  if (!id) {
    console.log("\n  -- record_read comparison: entry has no id, skipped --");
    return;
  }
  const entityId = /^\d:\d:/.test(id) ? id.split(":").slice(2).join(":") : id;
  console.log(`\n  -- record_read (raw recapi) for entity ${entityId} --`);
  await sleep(400);
  const token = await getValidToken(LOCAL);
  const res = await fetchRetry(
    `${RECAPI}/${encodeURIComponent(entityId)}.json`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": BROWSER_USER_AGENT,
      },
    },
    { maxRetries: 4, baseMs: 8_000, label: "recapi" },
  );
  if (!res.ok) {
    console.log(`     HTTP ${res.status} — no comparison available.`);
    return;
  }
  const body: any = await res.json();
  const persons: any[] = body?.persons ?? [];
  console.log(`     ${persons.length} persons in the raw record`);
  let withFields = 0;
  for (const p of persons) {
    const name = p?.names?.[0]?.nameForms?.[0]?.fullText ?? "(no name)";
    const fs = personFields(p);
    if (fs.length > 0) withFields++;
    console.log(
      `\n     id=${p?.id}  ${name}` + (p?.principal === true ? "  PRINCIPAL" : ""),
    );
    if (fs.length === 0) console.log("        fields: (none)");
    for (const f of fs) console.log(`        ${f}`);
  }
  console.log(
    `\n     >>> ${withFields}/${persons.length} persons carry fields[] in the RAW record`,
  );
  const rr = body?.relationships ?? [];
  console.log(`     >>> ${rr.length} relationships[] in the RAW record`);
  for (const r of rr) {
    const t = String(r?.type ?? "").split("/").pop();
    console.log(
      `        ${t}: ${r?.person1?.resourceId ?? r?.person1?.resource} -> ` +
        `${r?.person2?.resourceId ?? r?.person2?.resource}`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const pools = argv.length
    ? argv.map((id) => ({
        label: `collection ${id} (from argv)`,
        qs: `f.collectionId=${id}&q.surname=Miller`,
      }))
    : POOLS;
  for (const p of pools) {
    try {
      await runPool(p.label, p.qs);
    } catch (e) {
      console.log(`  ERROR on ${p.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
