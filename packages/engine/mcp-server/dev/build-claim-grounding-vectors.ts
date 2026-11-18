// Build tests/fixtures/claim-grounding-vectors.json from the hand labels in
// tests/fixtures/claim-grounding-labels/ (issue #3032, Stage 1b, claim rule 7).
//
// Each label names one committed e2e proof (`<slug>/<run ts>/<ps id>`) and the
// objects a genealogist read it as concluding: ParentChild and Couple edges
// (`rel`), person facts (`facts`) and couple facts (`cfacts`). Each becomes one
// vector: the object as a claim at its labelled tier, citing the proof's full
// supporting set, with the assertions rule 7 reads (the cited ones and the rest
// of their records) and their live links, stored once per proof under `proofs`.
// Only the fields rule 7 reads are kept -- including every field recordPartyKeyer,
// recordBasisOf, toTreeFactType and countsForProofGate read -- so the test never
// reads eval/runlogs.
//
//   npx tsx dev/build-claim-grounding-vectors.ts
//
// Re-run after a label changes; the test asserts the counts the plan measured.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordIdOf } from "../src/utils/settled-birth-disputes.js";

const repo = join(import.meta.dirname, "..", "..", "..", "..");
const labelsDir = join(import.meta.dirname, "..", "tests", "fixtures", "claim-grounding-labels");
const outPath = join(import.meta.dirname, "..", "tests", "fixtures", "claim-grounding-vectors.json");

const ASSERTION_FIELDS = [
  "id", "record_id", "source_id", "record_persona_id", "record_role", "fact_type",
  "record_basis", "evidence_type", "status", "superseded_by", "retired", "log_entry_id", "value",
] as const;
const LINK_FIELDS = ["id", "assertion_id", "person_id", "confidence", "superseded_by"] as const;

function pick(obj: any, fields: readonly string[]): any {
  const out: any = {};
  for (const f of fields) if (obj?.[f] !== undefined) out[f] = obj[f];
  return out;
}

const labels: Record<string, any> = {};
for (const file of readdirSync(labelsDir).filter((f) => f.endsWith(".json")).sort()) {
  Object.assign(labels, JSON.parse(readFileSync(join(labelsDir, file), "utf-8")));
}

const vectors: any[] = [];
const proofs: Record<string, any> = {};
for (const [labelId, label] of Object.entries(labels)) {
  const [slug, run, psId] = String(label.key).split("/");
  const research = JSON.parse(
    readFileSync(join(repo, "eval", "runlogs", "e2e", slug, `run-${run}.final-research.json`), "utf-8"),
  );
  const ps = (research.proof_summaries ?? []).find((p: any) => p?.id === psId);
  if (!ps) throw new Error(`${labelId}: ${psId} not in ${slug} run-${run}`);
  const cited = new Set<string>(ps.supporting_assertion_ids ?? []);
  for (const c of ps.claims ?? []) for (const id of c?.supporting_assertion_ids ?? []) cited.add(id);

  const assertions: any[] = research.assertions ?? [];
  const records = new Set(
    assertions.filter((a) => cited.has(a?.id)).map((a) => recordIdOf(a)).filter((r): r is string => r !== null),
  );
  const kept = assertions.filter((a) => cited.has(a?.id) || records.has(recordIdOf(a) ?? ""));
  const keptIds = new Set(kept.map((a) => a.id));
  const links = (research.person_evidence ?? []).filter((pe: any) => keptIds.has(pe?.assertion_id));
  const doc = {
    assertions: kept.map((a) => pick(a, ASSERTION_FIELDS)),
    person_evidence: links.map((pe: any) => pick(pe, LINK_FIELDS)),
  };
  const supporting = [...cited].sort();
  proofs[labelId] = doc;

  for (const [i, [type, a, b, tier]] of (label.rel ?? []).entries()) {
    const relationship = type === "Couple" ? { type, person1: a, person2: b } : { type, parent: a, child: b };
    vectors.push({
      id: `${labelId}.rel${i}`, label: labelId, kind: "relationship",
      claim: { claim: `${type} ${a} ${b}`, proof_tier: tier, supporting_assertion_ids: supporting, relationship },
    });
  }
  for (const [i, f] of (label.facts ?? []).entries()) {
    const fact: any = { subject: f.p, fact_type: f.t };
    if (f.d) fact.date = f.d;
    if (f.pl) fact.place = f.pl;
    vectors.push({
      id: `${labelId}.fact${i}`, label: labelId, kind: "fact",
      claim: { claim: `${f.t} ${f.p}`, proof_tier: f.tier, supporting_assertion_ids: supporting, fact },
    });
  }
  for (const [i, f] of (label.cfacts ?? []).entries()) {
    const fact: any = { subject: { person1: f.c[0], person2: f.c[1] }, fact_type: "Marriage" };
    if (f.d) fact.date = f.d;
    if (f.pl) fact.place = f.pl;
    vectors.push({
      id: `${labelId}.cfact${i}`, label: labelId, kind: "couple_fact",
      claim: { claim: `Marriage ${f.c.join(" ")}`, proof_tier: f.tier, supporting_assertion_ids: supporting, fact },
    });
  }
}

writeFileSync(outPath, JSON.stringify({ built_from: "tests/fixtures/claim-grounding-labels", proofs, vectors }) + "\n", "utf-8");
const count = (k: string) => vectors.filter((v) => v.kind === k).length;
console.log(`${vectors.length} vectors: ${count("relationship")} relationships, ${count("fact")} facts, ${count("couple_fact")} couple facts -> ${outPath}`);
