// Re-derive the birthplace-cap figures quoted in research-append-tool-spec.md's
// contradicted-core-identifier row and guardrail-enforcement-spec.md's §5 row
// (issue #3390).
//
//   npx tsx dev/measure-birthplace-cap.ts            # the figures
//   npx tsx dev/measure-birthplace-cap.ts --pairs    # + every pair the distance test silences
//
// Replays the SHIPPED place arm (`coreIdentifierContradictionInvariants`) over
// every committed fixture and e2e document, twice: once with no coordinates,
// which is the arm before the distance test (every disagreement caps), and once
// with the coordinates `birthPlaceCoordNames` asks for, looked up live. The
// difference is what the country-and-distance rule silences. Both runs already
// skip a non-place phrase ("Same House"), so the links that skip silences are
// counted separately: before + that count is main's arm. Needs network for the
// FamilySearch Places API (unauthenticated).
//
// Corpus selection is `git ls-files`, NOT a filesystem glob, so untracked
// scratch_ runs are not counted.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import {
  coreIdentifierContradictionInvariants,
  birthPlaceCoordNames,
  type PersonLink,
} from "../src/tools/research-append.js";
import { lookupPlaceCoords } from "../src/utils/place-coords.js";
import { standardPlaceToCoords, isNonPlacePhrase } from "../src/utils/place-resolver.js";
import { haversineDistance } from "../src/tools/distance.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const tracked = (pattern: string): string[] =>
  execFileSync("git", ["ls-files", pattern], { cwd: ROOT, encoding: "utf-8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter(Boolean);

interface Doc { label: string; research: any; tree: any }
const docs: Doc[] = [];
for (const rel of tracked("eval/fixtures/scenarios/*/research.json")) {
  const tree = join(ROOT, dirname(rel), "tree.gedcomx.json");
  if (!existsSync(tree)) {
    console.error(`  (no committed tree sibling, skipped: ${rel})`);
    continue;
  }
  docs.push({ label: dirname(rel).split("/").pop()!, research: readJson(join(ROOT, rel)), tree: readJson(tree) });
}
for (const rel of tracked("eval/runlogs/e2e/*.final-research.json")) {
  const tree = join(ROOT, rel.replace(".final-research.json", ".final-tree.gedcomx.json"));
  if (!existsSync(tree)) {
    console.error(`  (no committed tree sibling, skipped: ${rel})`);
    continue;
  }
  // eval/runlogs/e2e/<fixture>/run-*.json -> index 3.
  docs.push({ label: rel.split("/")[3], research: readJson(join(ROOT, rel)), tree: readJson(tree) });
}

const linksOf = (research: any): PersonLink[] =>
  ((research.person_evidence ?? []) as any[])
    .filter((e) => e && !e.superseded_by && typeof e.assertion_id === "string" && typeof e.person_id === "string")
    .map((e) => ({ assertion_id: e.assertion_id, person_id: e.person_id }));
const PLACE_FINDING = /the record states '/;

const entries: { doc: Doc; entry: any; links: PersonLink[] }[] = [];
const names: string[] = [];
for (const doc of docs) {
  const links = linksOf(doc.research);
  for (const entry of (doc.research.person_evidence ?? []) as any[]) {
    if (entry?.confidence !== "confident" && entry?.confidence !== "probable") continue;
    entries.push({ doc, entry, links });
    names.push(...birthPlaceCoordNames(entry, doc.research, doc.tree, links));
  }
}

if (docs.length === 0) throw new Error("no committed documents matched — corpus path wrong?");
if (entries.length === 0) throw new Error(`scanned ${docs.length} document(s) but found 0 confident/probable links — shape changed?`);

const coords = await lookupPlaceCoords(names, (n) => standardPlaceToCoords(n), 600_000);
const unresolved = [...coords].filter(([, c]) => c === null).map(([n]) => n);

// Links on which the record's same party states a birth place that is a
// non-place phrase. An upper bound on what the phrase skip silences: it does not
// re-apply the credibility gates.
let phraseLinks = 0;
for (const { doc, entry } of entries) {
  const a = (doc.research.assertions ?? []).find((x: any) => x?.id === entry.assertion_id);
  if (!a) continue;
  const party = a.record_persona_id ?? a.record_role;
  const record = a.record_id ?? a.source_id;
  if ((doc.research.assertions ?? []).some((x: any) =>
    (x?.record_id ?? x?.source_id) === record && (x?.record_persona_id ?? x?.record_role) === party &&
    String(x?.fact_type ?? "").toLowerCase() === "birth" && typeof x?.place === "string" && isNonPlacePhrase(x.place),
  )) phraseLinks++;
}

let before = 0, after = 0;
const silenced: string[] = [];
for (const { doc, entry, links } of entries) {
  const was = coreIdentifierContradictionInvariants(entry, doc.research, doc.tree, links).find((m) => PLACE_FINDING.test(m));
  const now = coreIdentifierContradictionInvariants(entry, doc.research, doc.tree, links, undefined, coords)
    .some((m) => PLACE_FINDING.test(m));
  if (was) before++;
  if (now) after++;
  if (now && !was) throw new Error(`the distance test ADDED a refusal (${doc.label} ${entry.id}) — it may only remove them`);
  if (was && !now) {
    // The refusal names the assertion it compared; read that one, not a guess.
    const aid = /\(assertion '([^']+)'\)/.exec(was)?.[1];
    const a = (doc.research.assertions ?? []).find((x: any) => x?.id === aid);
    const p = (doc.tree.persons ?? []).find((x: any) => x?.id === entry.person_id);
    const birth = (p?.facts ?? []).find((f: any) => String(f?.type ?? "").toLowerCase() === "birth");
    const ca = a && coords.get(a.standard_place);
    const cb = birth && coords.get(birth.standard_place);
    const miles = ca && cb ? haversineDistance(ca.latitude, ca.longitude, cb.latitude, cb.longitude).miles : "?";
    silenced.push(
      `  ${doc.label}  ${entry.id}  record '${a?.place}' [${a?.standard_place}] (${a?.date ?? "no date"})  ` +
        `vs tree '${birth?.place}' [${birth?.standard_place}] (${birth?.date ?? "no date"})  ${miles} mi`,
    );
  }
}

console.log(`documents (git ls-files)     ${docs.length}`);
console.log(`confident/probable links     ${entries.length}`);
console.log(`links with a non-place-phrase birth place  ${phraseLinks}  (upper bound on what the phrase skip silences)`);
console.log(`place-arm refusals, before   ${before}  (no distance test)`);
console.log(`place-arm refusals, after    ${after}  (country + era-banded distance)`);
console.log(`silenced by the distance test ${before - after}`);
console.log(`places looked up             ${coords.size}, unresolved ${unresolved.length} (those pairs still cap)`);
if (process.argv.includes("--pairs")) {
  console.log(`\nthe ${silenced.length} silenced links:`);
  for (const line of silenced) console.log(line);
}
