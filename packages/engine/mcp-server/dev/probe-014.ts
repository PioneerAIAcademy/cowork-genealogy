/// <reference types="node" />
/** ut_person_evidence_014's exact defect: the agent scores a_005 against the
 *  three EXISTING tree persons, mints I4 from the will's persona, then records
 *  one of those scores on the I4 link. Does step 3 refuse it? */
import { mkdtemp, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";
import { researchAppend } from "../src/tools/research-append.js";

const SCEN = "../../../eval/fixtures/scenarios/flynn-stub-needed";

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "probe014-"));
  await cp(SCEN, dir, { recursive: true });

  // Mint I4 the way materialize_facts does: a sourced name citing the will (S4).
  const tree = JSON.parse(await readFile(join(dir, "tree.gedcomx.json"), "utf8"));
  tree.persons.push({
    id: "I4",
    names: [{ id: "N9", preferred: true, given: "James", surname: "Flynn",
              sources: [{ ref: "S4" }] }],
  });
  await writeFile(join(dir, "tree.gedcomx.json"), JSON.stringify(tree, null, 2), "utf8");

  const link = (score: number | null) => ({
    projectPath: dir, section: "person_evidence", op: "append" as const,
    entry: { assertion_id: "a_005", person_id: "I4", confidence: "probable",
      rationale: "Named as a son in the will.", match_score: score,
      created: "2026-09-24", superseded_by: null },
  });

  let r: any = await researchAppend(link(0.005) as any);
  console.log(`  carries a score from another pairing -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);
  if (!r.ok) console.log(`     ${String(r.errors?.[0]).slice(0, 120)}`);

  const dir2 = await mkdtemp(join(tmpdir(), "probe014b-"));
  await cp(SCEN, dir2, { recursive: true });
  const t2 = JSON.parse(await readFile(join(dir2, "tree.gedcomx.json"), "utf8"));
  t2.persons.push({ id: "I4", names: [{ id: "N9", preferred: true, given: "James",
    surname: "Flynn", sources: [{ ref: "S4" }] }] });
  await writeFile(join(dir2, "tree.gedcomx.json"), JSON.stringify(t2, null, 2), "utf8");
  r = await researchAppend({ ...link(null), projectPath: dir2 } as any);
  console.log(`  leaves match_score null              -> ${r.ok ? "ACCEPTED" : "REFUSED"}`);

  // BOTH mint routes, because staging only the sourced one is what let the
  // reachability-gated version of this guard read as closing ut_014 when it did
  // not. `tree_edit add_person` mints a person with NO source ref, so the
  // circular walk returns false; a_005 is full-text sourced, so reachability
  // returns false too. 274 of 711 run-added corpus persons are ref-less.
  for (const [label, sources] of [
    ["sourced mint   (materialize_facts)", [{ ref: "S4" }]],
    ["UNSOURCED mint (tree_edit add_person)", undefined],
  ] as const) {
    for (const score of [0.005, null]) {
      const d = await mkdtemp(join(tmpdir(), "probe014c-"));
      await cp(SCEN, d, { recursive: true });
      const t = JSON.parse(await readFile(join(d, "tree.gedcomx.json"), "utf8"));
      const name: any = { id: "N9", preferred: true, given: "James", surname: "Flynn" };
      if (sources) name.sources = sources;
      t.persons.push({ id: "I4", names: [name] });
      await writeFile(join(d, "tree.gedcomx.json"), JSON.stringify(t, null, 2), "utf8");
      const out: any = await researchAppend({ ...link(score), projectPath: d } as any);
      const s = String(score).padEnd(5);
      console.log(`  ${label}, score ${s} -> ${out.ok ? "ACCEPTED" : "REFUSED"}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
