/**
 * Capture real `record_read` sidecars as extractor test fixtures.
 *
 * Live and one-shot; run `dev/try-login.ts` first. Writes
 * `tests/fixtures/record-extract/<name>.json`, each the staged element exactly
 * as `record_read` produces it — `{ recordId, gedcomx, indexFields? }`.
 *
 * Fixtures are CAPTURED, never hand-written. The extractor's whole warrant is
 * that it reads what FamilySearch actually returns, and a hand-built document
 * would encode what I believe that is — which the census probe has already shown
 * twice to be wrong (`SOURCE_PERSON_NBR` does not exist on the schedules its
 * rule was written for; 1870 carries a `Head` value with no relationship
 * column).
 *
 * Re-run to refresh. Record ids are pinned so a re-capture is comparable; the
 * census pair are records the probe characterised, so their expected shape is
 * on the record rather than in my head.
 *
 * Run: `npx tsx dev/capture-extract-fixtures.ts` from
 * `packages/engine/mcp-server`.
 */
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { recordReadTool } from "../src/tools/record-read.js";
import { recordSearchTool } from "../src/tools/record-search.js";
import { LOCAL } from "../src/auth/principal.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "tests", "fixtures", "record-extract");

/** Each fixture names WHY it is in the set — the acceptance check asks for one
 *  census with a relationship column, one without, a marriage, a death and a
 *  baptism. */
interface FixtureSpec {
  name: string;
  recordId: string;
  why: string;
  /** When `recordId` is empty, find one: first hit in this collection. */
  search?: { recordType: string; collectionId: string };
}

const FIXTURES: FixtureSpec[] = [
  {
    name: "census-1880-with-relationship-column",
    recordId: "MNH8-SCH",
    why: "US 1880: schedule HAS a relationship column; head + wife + 12 children",
  },
  {
    name: "census-1870-no-relationship-column",
    recordId: "MZGS-1BH",
    why:
      "US 1870: schedule has NO relationship column, yet the index supplies " +
      "PR_RELATIONSHIP_TO_HEAD='Head'. The record that proves the year table " +
      "cannot be replaced by reading the field.",
  },
  {
    name: "census-1850-no-relationship-column",
    recordId: "MXQP-96T",
    why: "US 1850: no relationship column AND no relationship field at all",
  },
  {
    name: "marriage",
    recordId: "Z838-9RN2",
    why:
      "Ohio county marriage: Couple pair -> groom/bride, ParentChild edges on " +
      "BOTH sides -> father_of_groom / mother_of_bride etc., plus two further " +
      "persons that fall to witness_N",
  },
  // Discovered rather than pinned: a search picks the first hit in the named
  // collection and the id is recorded in the written fixture (`_capturedFrom`).
  // Pinning by hand meant reading a whole search response to copy one string.
  { name: "death", recordId: "", why: "principal -> deceased; parents from edges", search: { recordType: "death", collectionId: "2128172" } },
  { name: "baptism", recordId: "", why: "principal -> child; presenting parents", search: { recordType: "birth", collectionId: "1680845" } },
];

const EMPTY_RESEARCH = {
  project: {
    id: "rp_001",
    objective: "fixture capture",
    status: "active",
    created: "2026-01-01",
    updated: "2026-01-01",
  },
  questions: [],
  plans: [],
  log: [],
  sources: [],
  assertions: [],
  person_evidence: [],
  conflicts: [],
  hypotheses: [],
  timelines: [],
  proof_summaries: [],
  evaluations: [],
};

async function capture(spec: FixtureSpec): Promise<void> {
  const { name, why } = spec;
  let recordId = spec.recordId;
  if (!recordId && spec.search) {
    const found: any = await recordSearchTool(
      {
        surname: "Miller",
        recordType: spec.search.recordType as any,
        collectionId: spec.search.collectionId,
        count: 1,
      } as any,
      LOCAL,
    );
    recordId = found?.results?.[0]?.recordId ?? "";
    if (!recordId) {
      console.log(`SKIP ${name}: search found no record`);
      return;
    }
  }
  if (!recordId) {
    console.log(`SKIP ${name}: no record id`);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "capture-"));
  writeFileSync(join(dir, "research.json"), JSON.stringify(EMPTY_RESEARCH, null, 2), {
    encoding: "utf8",
  });
  writeFileSync(
    join(dir, "tree.gedcomx.json"),
    JSON.stringify({ persons: [], relationships: [], sources: [] }, null, 2),
    { encoding: "utf8" },
  );
  try {
    const res = (await recordReadTool(
      { recordId, projectPath: dir },
      LOCAL,
    )) as Record<string, any>;
    const ref: string | undefined = res.staged?.resultsRef;
    if (!ref) {
      console.log(`FAIL ${name}: no sidecar (${res.stagingError ?? "?"})`);
      return;
    }
    const element = JSON.parse(readFileSync(join(dir, ref), "utf8")).payload.results[0];
    mkdirSync(OUT_DIR, { recursive: true });
    const path = join(OUT_DIR, `${name}.json`);
    writeFileSync(
      path,
      JSON.stringify({ _why: why, _capturedFrom: recordId, element }, null, 2) + "\n",
      { encoding: "utf8" },
    );
    const persons = element.gedcomx?.persons?.length ?? 0;
    const withFields = Object.keys(element.indexFields ?? {}).length;
    console.log(`OK   ${name}: ${persons} persons, ${withFields} with indexFields`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  for (const f of FIXTURES) {
    try {
      await capture(f);
    } catch (e) {
      console.log(`FAIL ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
