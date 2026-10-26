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
 * Requires a valid FS session: run `login` first (tokens.json is the only source).
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
 *
 * ── The fetched household (section D), the part that can fail ───────────────
 *
 * Everything above scores a record that cannot be fetched, so the arm falls
 * through to the projection. Section D scores one that CAN: a real record that
 * names three people (child, father, mother), fetched live, against a scaffolded
 * tree with one person per persona. It asks, for each call, whom the answer says
 * it scored, and fails (exit code 1) when that is not the persona asked for:
 * each persona against its own tree person, and the father and mother against a
 * relative by `recordRole` from the child's relationship assertion. Before the
 * role was resolved on a fetched record, that last call scored the CHILD against
 * the father's tree person and the attestation said father.
 *
 * It also fails when the call did not take the fetched route at all
 * (`recordSource` must be "record_read": a failed fetch falls to the projection,
 * which resolves these persona ids just as well and would pass for the wrong
 * reason), when the answer carries the API's echo fields, when the role path
 * scores differently from the own-persona path on the same pair, and when a
 * role or persona the record does not hold is scored instead of refused.
 *
 * Sections E and F score the same record when the extraction's persona ids are
 * not to be trusted, which is what most of the corpus looks like. In E no
 * assertion carries one, so only the names the record's name assertions give can
 * say who the father and the mother are. In F every assertion carries the child's
 * id: it names no single party, and scoring "the father" through it, by role or
 * from his own assertion, would score the child. Each must still score the persona
 * asked for, and score what that persona scores from its own assertion.
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
import type { SamePersonProjectResult } from "../src/types/same-person.js";

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
    record_basis: "stated",
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

// ─── D. the fetched household: whom did each call score? ─────────────────────

const HOUSEHOLD_RECORD = "ark:/61903/1:1:6LYF-G8RJ";

/** The three people the record names. `tree` is their person in the scaffolded
 *  tree. Ids are the record's own persona ids; a live read that no longer returns
 *  them fails the `recordPersona.id` checks, which is the point of pinning them. */
const HOUSEHOLD = {
  child: { persona: "p_300287854666", name: "Maria Elisabeth Mouchang", role: "child", tree: "I3" },
  father: { persona: "p_300287854667", name: "Pierre Mouchang", role: "father", tree: "I1" },
  mother: { persona: "p_300287854668", name: "Margreta Metzeler", role: "mother", tree: "I2" },
} as const;

const failures: string[] = [];

function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    if (detail !== "") console.log(`        ${detail}`);
    failures.push(label);
  }
}

function householdAssertion(
  id: string,
  role: string,
  persona: string,
  factType: string,
  value: string,
  structured: Record<string, unknown> | null = null,
): Record<string, unknown> {
  return {
    id,
    source_id: "src_001",
    record_id: HOUSEHOLD_RECORD,
    record_role: role,
    record_persona_id: persona,
    fact_type: factType,
    value,
    structured_value: structured,
    information_quality: "primary",
    informant: "the register",
    informant_proximity: "participant",
    record_basis: "stated",
    extracted_for_question_ids: [],
    log_entry_id: null,
  };
}

const HOUSEHOLD_ASSERTIONS = [
  householdAssertion("a_031", "child", HOUSEHOLD.child.persona, "name", HOUSEHOLD.child.name,
    { given: "Maria Elisabeth", surname: "Mouchang" }),
  householdAssertion("a_034", "father", HOUSEHOLD.father.persona, "name", HOUSEHOLD.father.name,
    { given: "Pierre", surname: "Mouchang" }),
  householdAssertion("a_036", "mother", HOUSEHOLD.mother.persona, "name", HOUSEHOLD.mother.name,
    { given: "Margreta", surname: "Metzeler" }),
  // The child's relationship assertions: the party each names is the OTHER one, so a
  // link to the father or mother cites one of these with a `recordRole`.
  householdAssertion("a_038", "child", HOUSEHOLD.child.persona, "relationship",
    "child of Pierre Mouchang", { relationship_type: "child", related_person_role: "father" }),
  householdAssertion("a_039", "child", HOUSEHOLD.child.persona, "relationship",
    "child of Margreta Metzeler", { relationship_type: "child", related_person_role: "mother" }),
];

const HOUSEHOLD_TREE: SimplifiedGedcomX = {
  persons: [
    { id: "I1", gender: "Male", names: [{ preferred: true, given: "Pierre", surname: "Mouchang" }] },
    { id: "I2", gender: "Female", names: [{ preferred: true, given: "Margreta", surname: "Metzeler" }] },
    {
      id: "I3", gender: "Female",
      names: [{ preferred: true, given: "Maria Elisabeth", surname: "Mouchang" }],
      facts: [{ type: "Birth", date: "1 April 1800" }],
    },
  ],
  relationships: [
    { type: "Couple", person1: "I1", person2: "I2" },
    { type: "ParentChild", parent: "I1", child: "I3" },
    { type: "ParentChild", parent: "I2", child: "I3" },
  ],
};

/** Every attestation in the project, keyed `<assertion>|<tree person>`. */
async function readAttestations(projectDir: string): Promise<Record<string, Record<string, unknown>>> {
  const scoreDir = join(projectDir, "results", ".scores");
  const out: Record<string, Record<string, unknown>> = {};
  for (const name of await readdir(scoreDir).catch(() => [] as string[])) {
    const file = JSON.parse(await readFile(join(scoreDir, name), "utf8"));
    Object.assign(out, file.scores);
  }
  return out;
}

/** One call of a household run: whom it asks for, from which assertion, against
 *  whose tree person. */
interface HouseholdCase {
  label: string;
  assertionId: string;
  recordRole?: string;
  asked: keyof typeof HOUSEHOLD;
  treePerson: keyof typeof HOUSEHOLD;
}

/** The five calls of section D: each persona from its own assertion, and the
 *  father and mother from the child's relationship assertions by `recordRole`. */
const OWN_CHILD: HouseholdCase =
  { label: "the child, her own assertion", assertionId: "a_031", asked: "child", treePerson: "child" };
const OWN_FATHER: HouseholdCase =
  { label: "the father, his own assertion", assertionId: "a_034", asked: "father", treePerson: "father" };
const OWN_MOTHER: HouseholdCase =
  { label: "the mother, her own assertion", assertionId: "a_036", asked: "mother", treePerson: "mother" };
const BY_ROLE_FATHER: HouseholdCase = {
  label: "the father BY ROLE, from the child's relationship assertion",
  assertionId: "a_038", recordRole: "father", asked: "father", treePerson: "father",
};
const BY_ROLE_MOTHER: HouseholdCase = {
  label: "the mother BY ROLE, from the child's relationship assertion",
  assertionId: "a_039", recordRole: "mother", asked: "mother", treePerson: "mother",
};

/**
 * Score a household project's calls against the live record and check, for each,
 * whom the answer says it scored. Returns each call's score by label, so a later
 * run can compare its by-role scores with the own-assertion scores of the first.
 *
 * `reference` is those first scores. A father scored BY ROLE must score what the
 * father scores from his own assertion, whichever way the role was resolved: it is
 * the live check, independent of what any answer says, that the role path compared
 * the right people.
 */
async function scoreHousehold(
  heading: string,
  assertions: Array<Record<string, unknown>>,
  cases: HouseholdCase[],
  reference: ReadonlyMap<string, number> | null,
  afterwards?: (dir: string) => Promise<void>,
): Promise<Map<string, number>> {
  console.log(`\n── ${heading} ──`);
  const dir = await mkdtemp(join(tmpdir(), "try-same-person-household-"));
  const scores = new Map<string, number>();
  try {
    await writeFile(
      join(dir, "research.json"),
      JSON.stringify({ log: [], assertions }, null, 2),
      "utf8",
    );
    await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(HOUSEHOLD_TREE, null, 2), "utf8");
    console.log(`project: ${dir}\nrecord:  ${HOUSEHOLD_RECORD} (child, father, mother; fetched live)\n`);

    for (const c of cases) {
      const want = HOUSEHOLD[c.asked];
      const tree = HOUSEHOLD[c.treePerson];
      const args = {
        projectPath: dir, assertionId: c.assertionId, treePersonId: tree.tree,
        ...(c.recordRole !== undefined ? { recordRole: c.recordRole } : {}),
      };
      console.log(`\n${c.label}: ${JSON.stringify({ ...args, projectPath: "<project>" })}`);
      let answer: Awaited<ReturnType<typeof samePerson>>;
      try {
        answer = await samePerson(args, LOCAL);
      } catch (e) {
        check(`${heading}: ${c.label}: was scored`, false, `refused: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      // Kept whatever the answer's shape, so the same-pair comparison below can
      // say what it saw even when the answer names no one.
      if ("score" in answer) scores.set(c.label, answer.score);
      const result: SamePersonProjectResult | null = "recordPersona" in answer ? answer : null;
      if (result === null) {
        check(`${heading}: ${c.label}: the answer names whom it scored`, false, JSON.stringify(answer));
        continue;
      }
      console.log(JSON.stringify(result));

      check(`${heading}: ${c.label}: took the fetched route`, result.recordSource === "record_read",
        `recordSource is ${result.recordSource}: the live fetch failed and the projection answered`);
      check(
        `${heading}: ${c.label}: scored the ${c.asked} persona`,
        result.recordPersona.id === want.persona &&
          result.recordPersona.name === want.name &&
          result.recordPersona.role === want.role,
        `asked for ${JSON.stringify({ id: want.persona, name: want.name, role: want.role })}, ` +
          `answer names ${JSON.stringify(result.recordPersona)}`,
      );
      check(
        `${heading}: ${c.label}: scored against the ${c.treePerson}'s tree person`,
        result.treePerson.id === tree.tree && result.treePerson.name === tree.name,
        `answer names ${JSON.stringify(result.treePerson)}`,
      );
      const echoed = ["queryArk", "candidateArk", "apiTitle", "updated"].filter((k) => k in result);
      check(`${heading}: ${c.label}: echoes none of the API's framing`, echoed.length === 0, `still carries ${echoed.join(", ")}`);
      check(`${heading}: ${c.label}: recorded the score`, result.recorded === true);
      const filed = (await readAttestations(dir))[`${c.assertionId}|${tree.tree}`];
      check(
        `${heading}: ${c.label}: filed the same persona and role it names`,
        filed?.record_persona_id === want.persona && filed?.record_role === want.role,
        `attestation says ${JSON.stringify({ persona: filed?.record_persona_id, role: filed?.record_role })}`,
      );
    }

    // The same pair through two routes must score the same.
    for (const [role, ownCase, roleCase] of [
      ["father", OWN_FATHER, BY_ROLE_FATHER],
      ["mother", OWN_MOTHER, BY_ROLE_MOTHER],
    ] as const) {
      if (!cases.includes(roleCase)) continue;
      const own = reference?.get(ownCase.label) ?? scores.get(ownCase.label);
      const byRole = scores.get(roleCase.label);
      check(
        `${heading}: the ${role} scores the same by role as by his or her own assertion`,
        own !== undefined && byRole !== undefined && Math.abs(own - byRole) < 0.01,
        `own assertion ${own}, by role ${byRole}`,
      );
    }
    if (afterwards !== undefined) await afterwards(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return scores;
}

/** A role or a persona the record does not hold is an answer, never a score. */
async function householdRefusals(dir: string): Promise<void> {
  const refusals: Array<{ label: string; extra: Record<string, string>; expect: RegExp }> = [
    { label: "a role the record does not hold", extra: { recordRole: "witness_1" },
      expect: /holds no persona for role 'witness_1'/ },
    { label: "a persona the record does not hold", extra: { recordPersonaId: "p_nope" },
      expect: /holds no persona with record_persona_id 'p_nope'/ },
  ];
  for (const r of refusals) {
    console.log(`\n${r.label} is refused:`);
    let refusal = "";
    let scored = "";
    try {
      scored = JSON.stringify(
        await samePerson({ projectPath: dir, assertionId: "a_038", treePersonId: "I1", ...r.extra }, LOCAL),
      );
    } catch (e) {
      refusal = e instanceof Error ? e.message : String(e);
    }
    console.log(refusal || scored);
    check(`${r.label}: refused, not scored`, scored === "" && r.expect.test(refusal),
      scored !== "" ? `scored instead: ${scored}` : `message was: ${refusal}`);
    check(
      `${r.label}: the refusal lists every persona as "id (name, role)"`,
      Object.values(HOUSEHOLD).every((h) => refusal.includes(`${h.persona} (${h.name}, ${h.role})`)),
      `message was: ${refusal}`,
    );
  }
}

async function fetchedHousehold(): Promise<void> {
  // D. The extraction stamped every assertion with its own party's persona id.
  const ownScores = await scoreHousehold(
    "D. a fetched household: whom did each call score?",
    HOUSEHOLD_ASSERTIONS,
    [OWN_CHILD, OWN_FATHER, OWN_MOTHER, BY_ROLE_FATHER, BY_ROLE_MOTHER],
    null,
    householdRefusals,
  );

  // E. The extraction left no persona id on any assertion, which is what most name
  // assertions in the corpus look like. Nothing but the names says who is who, and
  // the record's own name assertions give them: the father's and mother's name
  // assertions name the party asked for, the child's own name finds her.
  const noIds = HOUSEHOLD_ASSERTIONS.map((a) => ({ ...a, record_persona_id: null }));
  await scoreHousehold(
    "E. the same household, the extraction having set no persona ids",
    noIds,
    [OWN_CHILD, OWN_FATHER, OWN_MOTHER, BY_ROLE_FATHER, BY_ROLE_MOTHER],
    ownScores,
  );

  // F. The extraction stamped the child's persona id on every party. That id names
  // no single party, so it is no answer for "the father", and the child must not
  // be scored as him, whether the call asks for him by role from the child's
  // assertion or is about his own assertion, which carries the child's id: the id
  // is passed over as if it were not there, and the names say who each party is.
  const sharedId = HOUSEHOLD_ASSERTIONS.map((a) => ({ ...a, record_persona_id: HOUSEHOLD.child.persona }));
  await scoreHousehold(
    "F. the same household, the child's persona id stamped on every assertion",
    sharedId,
    [OWN_CHILD, OWN_FATHER, OWN_MOTHER, BY_ROLE_FATHER, BY_ROLE_MOTHER],
    ownScores,
  );
}

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
      scorePair(withAge, "principal", treeSide, "I1", LOCAL),
      scorePair(withoutAge, "principal", treeSide, "I1", LOCAL),
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
    const c = await scorePair(absurd, "principal", treeSide, "I1", LOCAL);
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
      scorePair(withMarriage, "principal", treeSide, "I1", LOCAL),
      scorePair(withWrongMarriage, "principal", treeSide, "I1", LOCAL),
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

  await fetchedHousehold();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nevery household check passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
