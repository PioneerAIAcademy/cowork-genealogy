/**
 * Fetch the role-scorer corpus. LIVE and billed; run `dev/try-login.ts` first.
 *
 * Every distinct `record_id` across the committed e2e final-research documents
 * that looks like a FamilySearch `1:1:` record ARK, read through the same recapi
 * endpoint `record_read` uses, and written to
 * `dev/fixtures/role-scorer-corpus.json`.
 *
 * ## Why a cache exists at all
 *
 * The committed e2e corpus keeps run logs and final states and **no sidecars**
 * (`eval/runlogs/e2e/<slug>/` holds `run-*.json` and `*.final-*.json` only). The
 * role rule cannot be evaluated from a final-research document: it needs the
 * personas, their index fields and their order, none of which survive into the
 * assertions. So the scorer would otherwise have to re-fetch ~600 records on
 * every run, which makes the ≥80% acceptance figure un-checkable offline and
 * un-reproducible by a reviewer.
 *
 * ## Why it is COMPACT
 *
 * Storing each record's whole document would be ~6 MB of mostly-unread JSON.
 * This keeps exactly what `record-extract.ts` reads — persona id, principal
 * flag, gender, name, facts, the per-person index fields, the relationship
 * edges and whether each couple carries a marriage fact, plus the collection
 * title — and drops everything else. Anything the rule does not read cannot
 * change its verdict, so the cache is lossless for this purpose and reviewable
 * by eye.
 *
 * Run: `npx tsx dev/fetch-role-corpus.ts [--limit N]` from
 * `packages/engine/mcp-server`.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { LOCAL } from "../src/auth/principal.js";
import { getValidToken } from "../src/auth/refresh.js";
import { BROWSER_USER_AGENT } from "../src/constants.js";
import { fetchRetry, sleep } from "./http-retry.js";
import { toSimplified } from "../src/utils/gedcomx-convert.js";
import { recordIndexFields } from "../src/utils/record-index-fields.js";
import type { GedcomX } from "../src/types/gedcomx.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const RUNLOGS = join(REPO, "eval", "runlogs", "e2e");
const OUT = join(HERE, "fixtures", "role-scorer-corpus.json");
const RECAPI = "https://sg30p0.familysearch.org/service/cds/recapi/records/persona";

/** Every distinct `1:1:` record ARK in the committed final-research documents,
 *  with the roles the MODEL assigned to each persona — the comparison side. */
function corpusRecords(): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  if (!existsSync(RUNLOGS)) return out;
  for (const slug of readdirSync(RUNLOGS)) {
    const dir = join(RUNLOGS, slug);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".final-research.json"));
    } catch {
      continue;
    }
    for (const f of files) {
      let doc: any;
      try {
        doc = JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        continue;
      }
      for (const a of doc.assertions ?? []) {
        const rid = a?.record_id;
        const role = a?.record_role;
        const persona = a?.record_persona_id;
        if (typeof rid !== "string" || !/1:1:/.test(rid)) continue;
        if (typeof role !== "string" || role === "") continue;
        // Only personas the model identified: without one there is nothing to
        // join the rule's answer to.
        if (typeof persona !== "string" || persona === "") continue;
        const byPersona = out.get(rid) ?? new Map<string, string>();
        // First role wins; a persona with two roles in one record is a defect
        // this scorer is not measuring.
        if (!byPersona.has(persona)) byPersona.set(persona, role);
        out.set(rid, byPersona);
      }
    }
  }
  return out;
}

function entityId(ark: string): string {
  const m = ark.match(/1:1:([^/?#]+)/);
  return m ? m[1] : ark;
}

/** Keep only what `record-extract.ts` reads. */
function compact(raw: any) {
  const simplified = toSimplified(raw as GedcomX);
  const indexFields = recordIndexFields(raw);
  const persons = (simplified.persons ?? []).map((p) => ({
    id: p.id,
    ...(p.principal ? { principal: true } : {}),
    ...(p.gender ? { gender: p.gender } : {}),
    ...(p.names?.[0]
      ? { names: [{ given: p.names[0].given ?? "", surname: p.names[0].surname ?? "" }] }
      : {}),
    ...(p.facts?.length
      ? {
          facts: p.facts.map((f) => ({
            type: f.type,
            ...(f.date ? { date: f.date } : {}),
            ...(f.place ? { place: f.place } : {}),
            ...(f.standard_place ? { standard_place: f.standard_place } : {}),
            ...(f.value ? { value: f.value } : {}),
          })),
        }
      : {}),
  }));
  const relationships = (simplified.relationships ?? []).map((r) => ({
    type: r.type,
    ...(r.parent ? { parent: r.parent } : {}),
    ...(r.child ? { child: r.child } : {}),
    ...(r.person1 ? { person1: r.person1 } : {}),
    ...(r.person2 ? { person2: r.person2 } : {}),
    ...(r.facts?.length
      ? { facts: r.facts.map((f) => ({ type: f.type, ...(f.date ? { date: f.date } : {}) })) }
      : {}),
  }));
  const collection = (simplified.sources ?? []).find((s) =>
    /collection/i.test(String(s.resource_type ?? "")),
  );
  return {
    gedcomx: {
      persons,
      ...(relationships.length ? { relationships } : {}),
      ...(collection
        ? { sources: [{ resource_type: collection.resource_type, title: collection.title }] }
        : {}),
    },
    ...(indexFields ? { indexFields } : {}),
  };
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const wanted = corpusRecords();
  console.log(`${wanted.size} distinct 1:1 record ARKs with a model-assigned persona role`);

  mkdirSync(dirname(OUT), { recursive: true });
  const existing: Record<string, any> = existsSync(OUT)
    ? JSON.parse(readFileSync(OUT, "utf8")).records ?? {}
    : {};

  let fetched = 0;
  let skipped = 0;
  let failed = 0;
  let n = 0;
  for (const [ark, modelRoles] of wanted) {
    if (n++ >= limit) break;
    if (existing[ark]) {
      skipped++;
      continue;
    }
    await sleep(250);
    let raw: any;
    try {
      const token = await getValidToken(LOCAL);
      const res = await fetchRetry(
        `${RECAPI}/${encodeURIComponent(entityId(ark))}.json`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Accept-Language": "en",
            "User-Agent": BROWSER_USER_AGENT,
          },
        },
        { maxRetries: 3, baseMs: 5_000, label: ark },
      );
      if (!res.ok) {
        failed++;
        continue;
      }
      raw = await res.json();
    } catch {
      failed++;
      continue;
    }
    existing[ark] = {
      ...compact(raw),
      // The comparison side, stored beside the record so the scorer is offline.
      modelRoles: Object.fromEntries(modelRoles),
    };
    fetched++;
    if (fetched % 25 === 0) {
      writeFileSync(OUT, JSON.stringify({ records: existing }, null, 1) + "\n", {
        encoding: "utf8",
      });
      console.log(`  ${fetched} fetched, ${failed} failed, ${skipped} already cached`);
    }
  }

  writeFileSync(OUT, JSON.stringify({ records: existing }, null, 1) + "\n", { encoding: "utf8" });
  const bytes = readFileSync(OUT).length;
  console.log(
    `\ndone: ${fetched} fetched, ${skipped} cached, ${failed} failed; ` +
      `${Object.keys(existing).length} records, ${(bytes / 1024 / 1024).toFixed(2)} MB`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
