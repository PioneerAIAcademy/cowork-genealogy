/// <reference types="node" />
/**
 * Smoke test for `same_person`'s PROJECT-RELATIVE arm, against the live
 * FamilySearch API. The unit suites mock `scorePair`, so they prove the arm
 * resolves and records correctly but say nothing about whether the documents it
 * assembles are ones matchTwoExamples accepts and scores sensibly. That is what
 * this is for.
 *
 * It scaffolds a throwaway project in a temp directory, so it touches nothing
 * of yours and needs no existing research folder.
 *
 * Requires a valid FS session (run `login` first, or set FS_ACCESS_TOKEN).
 *
 * Usage:
 *   npx tsx dev/try-same-person-project.ts
 *
 * ── The `age` question this probe exists to settle ──────────────────────────
 *
 * The record-side projection admits `age` as an `Age` fact, unlike the tree
 * write, on the argument that the match engine scores on document content and
 * an age is a prime discriminator. But surveying every committed real record
 * persona (eval/fixtures/mcp/record-search-*.json, eval/fixtures/scenarios/
 * ..../results/*.json): 356 person-level facts, of which `Marriage` = 14 and
 * `Age` = **0**. So `Age` on a record persona has no precedent in anything
 * FamilySearch itself has handed us, and "the projection should look like a
 * real record persona" is the standard the projection is held to.
 *
 * Nothing rejects it — the fact `type` is an open enum and `Age` passes the
 * initial-capital rule — but whether it RAISES or LOWERS the score is the
 * question, and no unit test can answer it. Run B below is the same pairing
 * with the `Age` fact stripped. If B scores at or above A, drop `age` from
 * `RECORD_PERSONA_SKIP_TYPES`' complement in `src/utils/record-persona.ts` and
 * record the delta in `docs/specs/same-person-tool-spec.md`.
 */
import { mkdtemp, writeFile, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LOCAL } from "../src/auth/principal.js";
import { samePerson } from "../src/tools/same-person.js";
import {
  projectRecordPersonas,
  projectedRecordDocument,
} from "../src/utils/record-persona.js";
import { scorePair } from "../src/utils/match-engine.js";
import { getValidToken } from "../src/auth/refresh.js";
import { Mob } from "../src/utils/mob.js";
import type { SimplifiedGedcomX } from "../src/types/gedcomx.js";

// A record with no fetchable GedcomX — an image id, so `record_read` refuses it
// and the arm must fall through to the projection. That is the route this probe
// is really about: the fetched route is just `record_read` plus `scorePair`,
// both already exercised elsewhere.
const RECORD_ID = "004516861_00304";

function assertion(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "a_001",
    source_id: "src_001",
    record_id: RECORD_ID,
    record_role: "principal",
    fact_type: "name",
    value: "Johann Georg Hufenreuter",
    information_quality: "primary",
    informant: "the register",
    informant_proximity: "participant",
    evidence_type: "direct",
    extracted_for_question_ids: [],
    log_entry_id: null,
    record_persona_id: null,
    ...over,
  };
}

const ASSERTIONS = [
  assertion(),
  assertion({ id: "a_002", fact_type: "sex", value: "Male" }),
  assertion({
    id: "a_003",
    fact_type: "birth",
    value: "",
    date: "11 January 1758",
    place: "Biesenrode, Sachsen, Preussen",
  }),
  assertion({ id: "a_004", fact_type: "age", value: "42" }),
];

const TREE: SimplifiedGedcomX = {
  persons: [
    {
      id: "I1",
      names: [{ preferred: true, given: "Johann Georg", surname: "Hufenreuter" }],
      gender: "Male",
      facts: [{ type: "Birth", date: "11Jan1758", place: "Biesenrode, Schsn, Prss" }],
    },
    { id: "I2", names: [{ preferred: true, given: "Anna", surname: "Hufenreuter" }], gender: "Female" },
  ],
  relationships: [{ type: "Couple", person1: "I1", person2: "I2" }],
};

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "try-same-person-project-"));
  try {
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({ log: [], assertions: ASSERTIONS }, null, 2),
      "utf8",
    );
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(TREE, null, 2), "utf8");

    console.log(`project: ${dir}\n`);

    // ── A. the arm end to end ────────────────────────────────────────────────
    const result = await samePerson(
      { projectPath: dir, assertionId: "a_001", treePersonId: "I1" },
      LOCAL,
    );
    console.log("── A. project-relative call ──");
    console.log(JSON.stringify(result, null, 2));

    // ── the attestation it wrote ─────────────────────────────────────────────
    const scoreDir = join(dir, "results", ".scores");
    const names = await readdir(scoreDir).catch(() => [] as string[]);
    console.log(`\n── attestation (${names.length} file(s) under results/.scores/) ──`);
    for (const n of names) {
      console.log(await readFile(join(scoreDir, n), "utf8"));
    }
    if (names.length === 0) {
      console.log("NONE — step 2 did not record. That is a defect, not a quiet path.");
    }

    // ── B. the same pairing with the projected Age fact stripped ─────────────
    const token = await getValidToken(LOCAL);
    const withAge = projectedRecordDocument(
      projectRecordPersonas(ASSERTIONS, RECORD_ID),
    );
    const withoutAge = projectedRecordDocument(
      projectRecordPersonas(
        ASSERTIONS.filter((a) => a.fact_type !== "age"),
        RECORD_ID,
      ),
    );
    const treeSide = new Mob(TREE, "I1").matchSubset().gedcomx;

    const [a, b] = await Promise.all([
      scorePair(withAge, "principal", treeSide, "I1", token),
      scorePair(withoutAge, "principal", treeSide, "I1", token),
    ]);

    console.log("\n── B. does the projected Age fact help? ──");
    console.log(`with Age:    score=${a.score}  confidence=${a.confidence ?? "(none)"}`);
    console.log(`without Age: score=${b.score}  confidence=${b.confidence ?? "(none)"}`);
    const delta = a.score - b.score;
    console.log(`delta:       ${delta >= 0 ? "+" : ""}${delta}`);
    // A delta of exactly 0 does NOT mean "it helps" — on an unsaturated score it
    // is the signature of a field the matcher never reads. Distinguish the two
    // by making the age absurd: if a 42 and a 999 score identically, `Age` does
    // not participate in the comparison at all, and admitting it buys nothing.
    const absurd = projectedRecordDocument(
      projectRecordPersonas(
        ASSERTIONS.map((a) => (a.fact_type === "age" ? { ...a, value: "999" } : a)),
        RECORD_ID,
      ),
    );
    const c = await scorePair(absurd, "principal", treeSide, "I1", token);
    console.log(`absurd Age=999: score=${c.score}  confidence=${c.confidence ?? "(none)"}`);

    // Same question for `marriage`, the other type the projection admits and the
    // tree write does not. Unlike Age it HAS precedent (14 of the 356 facts on
    // committed real record personas are Marriage), so the answer changes what
    // is claimed, not necessarily what ships.
    const withMarriage = projectedRecordDocument(
      projectRecordPersonas(
        [...ASSERTIONS, assertion({ id: "a_005", fact_type: "marriage", value: "", date: "3 May 1782", place: "Biesenrode" })],
        RECORD_ID,
      ),
    );
    const withWrongMarriage = projectedRecordDocument(
      projectRecordPersonas(
        [...ASSERTIONS, assertion({ id: "a_005", fact_type: "marriage", value: "", date: "3 May 1899", place: "Nowhere, Nowhere" })],
        RECORD_ID,
      ),
    );
    const [m1, m2] = await Promise.all([
      scorePair(withMarriage, "principal", treeSide, "I1", token),
      scorePair(withWrongMarriage, "principal", treeSide, "I1", token),
    ]);
    console.log("\n── C. does the projected Marriage fact participate? ──");
    console.log(`plausible marriage: score=${m1.score}`);
    console.log(`implausible one:    score=${m2.score}`);
    console.log(
      m1.score === m2.score
        ? "=> Marriage is also IGNORED on this pairing (record-side only; a tree person carries Marriage on the Couple edge, never in facts[])."
        : "=> Marriage DOES participate.",
    );

    const participates = c.score !== a.score;
    if (!participates) {
      console.log(
        "=> `Age` is IGNORED by matchTwoExamples: an age of 42 and an age of 999 " +
          "score identically. Admitting it buys nothing and makes the projected " +
          "persona diverge from every real one (0 of 356 committed record-persona " +
          "facts are Age). DROP `age`: add it to RECORD_PERSONA_SKIP_TYPES and " +
          "update the spec + record-persona.test.ts.",
      );
    } else if (delta >= 0) {
      console.log("=> `Age` participates and does not hurt: keep it, and record the delta in the spec.");
    } else {
      console.log("=> `Age` participates and LOWERS the score: drop it.");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
