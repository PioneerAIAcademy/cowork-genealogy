/// <reference types="node" />
/** Does step 3 refuse an unattested link, accept an attested one, and exempt a
 *  circular stub? Exercised against a real project folder. */
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { researchAppend } from "../src/tools/research-append.js";
import { recordMatchScore } from "../src/utils/match-scores.js";

const RESEARCH = {
  assertions: [
    { id: "a_001", record_id: "rec_A", record_persona_id: "P1", record_role: "principal",
      fact_type: "name", value: "Patrick Flynn", source_id: "src_001" },
  ],
  sources: [{ id: "src_001", gedcomx_source_description_id: "S1" }],
  log: [], person_evidence: [],
};
const TREE = {
  persons: [
    { id: "I1", names: [{ preferred: true, given: "Patrick", surname: "Flynn" }] },
    { id: "I9", names: [{ preferred: true, given: "Minted", surname: "Stub",
        sources: [{ ref: "S1" }] }] },
  ],
  relationships: [],
  sources: [{ id: "S1", title: "Record A" }],
};

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "score-gate-"));
  await writeFile(join(dir, "research.json"), JSON.stringify(RESEARCH, null, 2), "utf8");
  await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(TREE, null, 2), "utf8");
  await mkdir(join(dir, "results"), { recursive: true });
  return dir;
}
const link = (dir: string, personId: string, score: number | null) => ({
  projectPath: dir, section: "person_evidence", op: "append" as const,
  entry: { assertion_id: "a_001", person_id: personId, confidence: "probable",
    rationale: "Names match.", match_score: score, created: "2026-09-24", superseded_by: null },
});

async function main(): Promise<void> {
  let dir = await project();
  let r: any = await researchAppend(link(dir, "I1", 0.82) as any);
  console.log(`  unattested link              -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);

  dir = await project();
  await recordMatchScore(dir, { record_id: "rec_A", record_persona_id: "P1",
    record_role: "principal", tree_person_id: "I1", score: 0.82, scorer: "familysearch", model: null,
    assertion_id: "a_001", record_source: "record_read", computed: "2026-09-24T00:00:00Z" });
  r = await researchAppend(link(dir, "I1", 0.82) as any);
  console.log(`  attested link                -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);

  dir = await project();
  r = await researchAppend(link(dir, "I9", null) as any);
  console.log(`  circular stub, null score    -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);

  dir = await project();
  r = await researchAppend(link(dir, "I9", 0.005) as any);
  console.log(`  circular stub, carries score -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);
  if (!r.ok) console.log(`     ${String(r.errors?.[0]).slice(0, 110)}`);

  // --- the four defects an adversarial review found before this shipped -----

  // 1. The FETCHED route resolves a real persons[].id where the assertion
  //    carries null. Keyed on the party, this legitimate score was unfindable
  //    and the gate refused exactly the links whose call HAD been made.
  dir = await project();
  await recordMatchScore(dir, { record_id: "rec_A", record_persona_id: "PERSON1",
    record_role: "principal", tree_person_id: "I1", score: 0.82, scorer: "familysearch", model: null,
    assertion_id: "a_001", record_source: "record_read", computed: "2026-09-24T00:00:00Z" });
  r = await researchAppend(link(dir, "I1", 0.82) as any);
  console.log(`  fetched-route attestation    -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);

  // 2. A person_evidence op placed BEFORE its assertion in one batch used to
  //    resolve no record, so the gate returned [] and a fabricated score landed.
  dir = await project();
  r = await researchAppend({ projectPath: dir, ops: [
    { section: "person_evidence", op: "append",
      entry: { assertion_id: "a_002", person_id: "I1", confidence: "probable",
        rationale: "x", match_score: 0.99, created: "2026-09-24", superseded_by: null } },
    { section: "assertions", op: "append", entry: { source_id: "src_001",
      record_id: "rec_A", record_role: "principal", fact_type: "name", value: "T F",
      information_quality: "primary", informant: "self",
      informant_proximity: "participant", record_basis: "stated",
      extracted_for_question_ids: [], log_entry_id: "log_1", record_persona_id: null } },
  ] } as any);
  console.log(`  batch: link BEFORE assertion -> ${r.ok ? "ACCEPTED (bypass)" : "REFUSED"}`);

  // 3. Append circular-with-null, then UPDATE the score in: ut_014's defect in
  //    two calls. An update that does NOT touch match_score must stay legal, or
  //    a legacy entry could never be superseded.
  dir = await project();
  const a0: any = await researchAppend(link(dir, "I9", null) as any);
  const peId = a0.ok ? (a0.entry?.id ?? "pe_001") : "pe_001";
  r = await researchAppend({ projectPath: dir, section: "person_evidence",
    op: "update", entryId: peId, fields: { match_score: 0.995 } } as any);
  console.log(`  update score onto circular   -> ${r.ok ? "ACCEPTED (bypass)" : "REFUSED"}`);
  r = await researchAppend({ projectPath: dir, section: "person_evidence",
    op: "update", entryId: peId, fields: { superseded_by: "pe_002" } } as any);
  console.log(`  update superseded_by only    -> ${r.ok ? "ACCEPTED" : "REFUSED (regression)"}`);

  // --- #3552: one score per record persona -----------------------------------
  // a_002 is another fact of P1; a_003 is a fact of the record with no persona id.
  const PERSONA_RESEARCH = {
    ...RESEARCH,
    assertions: [
      ...RESEARCH.assertions,
      { ...RESEARCH.assertions[0], id: "a_002", fact_type: "birth", value: "1850" },
      { ...RESEARCH.assertions[0], id: "a_003", fact_type: "birth", value: "1851", record_persona_id: null },
    ],
  };
  const personaProject = async (): Promise<string> => {
    const d = await project();
    await writeFile(join(d, "research.json"), JSON.stringify(PERSONA_RESEARCH, null, 2), "utf8");
    await recordMatchScore(d, { record_id: "rec_A", record_persona_id: "P1",
      record_role: "principal", tree_person_id: "I1", score: 0.82, scorer: "familysearch", model: null,
      assertion_id: "a_001", record_source: "record_read", computed: "2026-10-27T00:00:00Z",
      party_resolved: true });
    return d;
  };
  const linkTo = (d: string, assertionId: string) => ({ ...link(d, "I1", 0.82),
    entry: { ...link(d, "I1", 0.82).entry, assertion_id: assertionId } });

  dir = await personaProject();
  r = await researchAppend(linkTo(dir, "a_002") as any);
  console.log(`  persona: 2nd fact, scored    -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);

  dir = await personaProject();
  r = await researchAppend(linkTo(dir, "a_003") as any);
  console.log(`  persona: fact with no id     -> ${r.ok ? "ACCEPTED (bypass)" : "REFUSED"}`);

  // A reused hint: persona ids under the hint's sidecar-less entry are verified
  // against the read extraction_append staged in the same call.
  const hintProject = async (): Promise<string> => {
    const d = await project();
    await writeFile(join(d, "research.json"), JSON.stringify({ ...RESEARCH,
      log: [{ id: "log_h", plan_item_id: null, performed: "2026-10-27T00:00:00Z",
        tool: "person_record_matches", query: { recordId: "rec_A" }, outcome: "positive",
        results_examined: 1, external_site: null, results_ref: null }] }, null, 2), "utf8");
    await mkdir(join(d, "results", ".staging"), { recursive: true });
    await writeFile(join(d, "results", ".staging", "read.json"), JSON.stringify({ tool: "record_read",
      payload: { results: [{ recordId: "rec_A", gedcomx: { persons: [{ id: "P1" }] } }] } }), "utf8");
    return d;
  };
  const hintFact = { section: "assertions", op: "append", entry: { source_id: "src_001",
    record_id: "rec_A", record_role: "principal", fact_type: "birth", value: "1850",
    information_quality: "primary", informant: "self", informant_proximity: "participant",
    record_basis: "stated", extracted_for_question_ids: [], log_entry_id: "log_h",
    record_persona_id: "P1" } };
  dir = await hintProject();
  r = await researchAppend({ projectPath: dir, ops: [hintFact] } as any,
    { hintReads: new Map([["log_h", "results/.staging/read.json"]]) });
  console.log(`  hint: persona id, read named -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);
  if (!r.ok) console.log(`     ${String(r.errors?.[0]).slice(0, 110)}`);
  dir = await hintProject();
  r = await researchAppend({ projectPath: dir, ops: [hintFact] } as any);
  console.log(`  hint: persona id, no read    -> ${r.ok ? "ACCEPTED (bypass)" : "REFUSED"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
