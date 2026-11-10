// Measure #4226's entry-link expansion over the committed e2e corpus, BEFORE
// the rule is built. Issue #4226, plan §2.1.
//
//   npx tsx dev/replay-entry-link.ts [--list]
//
// The predicates are the TOOL'S OWN — `recordPartyKeyer`, `isTwoParty`,
// `isLiveAssertion`, `recordBasisOf` and `isAttachmentLink` are imported, never
// re-implemented here. A replay that restates the rule measures the
// restatement.
//
// Three questions, all from the plan:
//
//   1. How many entries would expand, and how many rows would that add?
//   2. (separate probe) derived rows the contradiction gate would newly refuse.
//      Expected zero: `contradictionScope` already scopes to the whole record
//      PARTY, so a derived row's inputs are identical to its trigger's.
//   3. The §0.6 refusal — "an entry already linked to someone else" — under
//      BOTH readings: counting any live link (naive), and counting only
//      one-party links (the plan's). ADR-0011 wants these read individually,
//      not quoted as a rate, so `--list` prints every case.
//
// Reads every eval/runlogs/e2e/<fixture>/*.final-research.json. No network: the
// contradiction gate's place arm resolves coordinates live and is out of scope
// here, which is why question 2 is a separate probe rather than a column.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { recordPartyKeyer, isTwoParty } from "../src/utils/record-persona.js";
import { isLiveAssertion } from "../src/utils/assertion-liveness.js";
import { recordBasisOf } from "../src/utils/record-basis.js";
import { isAttachmentLink } from "../src/utils/tree-person.js";
import { arkToBareId } from "../src/utils/ark.js";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const RUNS = join(ROOT, "eval", "runlogs", "e2e");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const LIST = process.argv.includes("--list");

const SEP = "\u0000";

let files = 0;
let partiesWithLinks = 0;
let pairsWithTrigger = 0;      // (entry, person) pairs a one-party link triggers
let entriesExpanded = 0;       // ...of which at least one derived row follows
let rowsAdded = 0;
let bridgedTriggers = 0;       // triggers carrying move_bridge (§0.2)
let refuseStrict = 0;          // §0.6 as planned: one-party holders only
let refuseNaive = 0;           // the rejected reading: any live link
const strictCases: string[] = [];
const naiveOnly: string[] = [];
// A contested entry is reported once per person holding it, so the pair count
// double-counts the entry. Both numbers matter: pairs are refused WRITES,
// entries are the distinct situations a reviewer has to read.
const strictEntries = new Set<string>();
// entry -> person -> the one-party facts that person holds on it. This is the
// artifact ADR-0011 asks for: the cases readable, not a rate.
const contested = new Map<string, Map<string, { facts: string[]; first: number }>>();
// The refusal is ORDER-DEPENDENT: it refuses whichever link arrives second. So
// the question that decides whether it helps or harms is which side arrives
// second — the thin claim (one stray `name`, the anders-monsen defect) or the
// full one. Counted per contested entry.
let refusalHitsThinner = 0, refusalHitsFuller = 0, refusalTie = 0;
// DOES THE RULE REACH THE BUG? A (entry, person) pair is "partial" when the
// person holds a link on the entry but some of its one-party facts are not
// linked to them -- the shape the issue is about. Split by whether the rule can
// do anything: a pair with a one-party trigger expands; a pair linked ONLY
// through two-party assertions never triggers and stays partial forever.
let partialWithTrigger = 0, partialTwoPartyOnly = 0, rowsStranded = 0;
let secondPartyOnEntry = 0;
const secondPartyRuns = new Set<string>();
const unreachedRuns = new Set<string>();

for (const slug of readdirSync(RUNS)) {
  const dir = join(RUNS, slug);
  let entries: string[];
  try { entries = readdirSync(dir); } catch { continue; }
  for (const name of entries) {
    if (!name.endsWith(".final-research.json")) continue;
    let research: any;
    try { research = readJson(join(dir, name)); } catch { continue; }
    files++;

    const live = new Map<string, any>();
    for (const a of (research.assertions ?? []) as any[]) {
      if (isLiveAssertion(a) && typeof a?.id === "string") live.set(a.id, a);
    }

    // Group live assertions by record, then key each to its party with the
    // tool's own keyer (read across the whole record, per #2537).
    const byRecord = new Map<string, any[]>();
    for (const a of live.values()) {
      const rec = arkToBareId(String(a?.record_id ?? ""));
      if (rec === "") continue;
      (byRecord.get(rec) ?? byRecord.set(rec, []).get(rec)!).push(a);
    }
    const entryOf = new Map<string, string>();   // assertion id -> entry key
    const inEntry = new Map<string, any[]>();    // entry key -> assertions
    for (const [rec, list] of byRecord) {
      // The keyer is given the WHOLE record (its #2537 rules are read across
      // it), but negative evidence gets no entry of its own: `absent` is not an
      // entry (plan §0.7). This has to happen here, not per use. The keyer
      // returns the persona id for an `absent` assertion that carries one --
      // anders-monsen's a_029 is "Unna absent from 1801 Hamre" filed on ANDERS'
      // persona and linked to Unna. Left in, it makes Unna a one-party holder
      // of Anders' entry, and the §0.6 refusal fires on a record that is doing
      // exactly what it should.
      const keyer = recordPartyKeyer(list);
      for (const a of list) {
        if (recordBasisOf(a) === "absent") continue;
        const party = keyer(a);
        if (party === null) continue;
        const k = `${rec}${SEP}${party}`;
        entryOf.set(a.id, k);
        (inEntry.get(k) ?? inEntry.set(k, []).get(k)!).push(a);
      }
    }

    // Live links, indexed by (entry, person).
    const linksByPair = new Map<string, any[]>();
    const personsByEntry = new Map<string, Set<string>>();
    for (const pe of (research.person_evidence ?? []) as any[]) {
      if (pe?.superseded_by != null) continue;
      const a = live.get(pe?.assertion_id);
      if (!a) continue;
      const k = entryOf.get(a.id);
      if (k === undefined) continue;
      const pair = `${k}${SEP}${pe.person_id}`;
      (linksByPair.get(pair) ?? linksByPair.set(pair, []).get(pair)!).push(pe);
      (personsByEntry.get(k) ?? personsByEntry.set(k, new Set()).get(k)!).add(String(pe.person_id));
    }
    partiesWithLinks += personsByEntry.size;

    // Append order of each live link, for the order-dependence question above.
    const order = new Map<string, number>();
    ((research.person_evidence ?? []) as any[]).forEach((pe, i) => {
      if (pe?.superseded_by == null && typeof pe?.id === "string") order.set(pe.id, i);
    });

    // Which persons hold a ONE-PARTY link on each entry (the §0.6 reading).
    const onePartyHolders = new Map<string, Set<string>>();
    for (const [pair, pes] of linksByPair) {
      const k = pair.slice(0, pair.lastIndexOf(SEP));
      const person = pair.slice(pair.lastIndexOf(SEP) + 1);
      const hasOneParty = pes.some((pe) => {
        const a = live.get(pe.assertion_id);
        return !!a && !isTwoParty(a.fact_type);
      });
      if (hasOneParty) {
        (onePartyHolders.get(k) ?? onePartyHolders.set(k, new Set()).get(k)!).add(person);
      }
    }

    for (const [pair, pes] of linksByPair) {
      const k = pair.slice(0, pair.lastIndexOf(SEP));
      const person = pair.slice(pair.lastIndexOf(SEP) + 1);

      // A trigger: a one-party link that is not attachment-shaped (§0.8).
      const triggers = pes.filter((pe) => {
        const a = live.get(pe.assertion_id);
        return !!a && !isTwoParty(a.fact_type) && !isAttachmentLink(pe);
      });

      // Measured BEFORE the `continue`: the pairs the rule cannot reach are the
      // whole question of whether it fixes the issue.
      const alreadyAll = new Set(pes.map((pe) => String(pe.assertion_id)));
      const unlinkedOneParty = (inEntry.get(k) ?? []).filter(
        (a) => !alreadyAll.has(a.id) && !isTwoParty(a.fact_type),
      );
      if (unlinkedOneParty.length > 0) {
        if (triggers.length > 0) partialWithTrigger++;
        else {
          // Split, per the lead's 2026-11-10 review. A two-party link is keyed
          // to the entry its assertion is FILED on, which is usually the OTHER
          // party's: Thomas linked through "Father: Thomas Flynn" on Patrick's
          // death record keys to PATRICK's entry, so Patrick's own birth and
          // death were counted as stranded FOR THOMAS while they are linked to
          // Patrick. Counting those made UNREACHED read as a defect when it is
          // the correct shape.
          const heldByOther = [...(onePartyHolders.get(k) ?? [])].some((pp) => pp !== person);
          if (heldByOther) {
            secondPartyOnEntry++;
            secondPartyRuns.add(slug);
          } else {
            partialTwoPartyOnly++;
            rowsStranded += unlinkedOneParty.length;
            unreachedRuns.add(slug);
          }
        }
      }

      if (triggers.length === 0) continue;
      pairsWithTrigger++;
      if (triggers.some((pe) => typeof pe.move_bridge === "string" && pe.move_bridge.trim() !== "")) {
        bridgedTriggers++;
      }

      // §0.6, both readings.
      const naiveOthers = [...(personsByEntry.get(k) ?? [])].filter((p) => p !== person);
      const strictOthers = [...(onePartyHolders.get(k) ?? [])].filter((p) => p !== person);
      if (strictOthers.length > 0) {
        refuseStrict++;
        const ek = `${slug}${SEP}${k}`;
        strictEntries.add(ek);
        const facts = triggers
          .map((pe) => String(live.get(pe.assertion_id)?.fact_type ?? "?"))
          .sort();
        const first = Math.min(...triggers.map((pe) => order.get(pe.id) ?? Number.MAX_SAFE_INTEGER));
        (contested.get(ek) ?? contested.set(ek, new Map()).get(ek)!).set(person, { facts, first });
        strictCases.push(`${slug}  ${k.replace(SEP, " / ")}  ${person} vs ${strictOthers.join(",")}`);
      }
      if (naiveOthers.length > 0) {
        refuseNaive++;
        if (strictOthers.length === 0) {
          naiveOnly.push(`${slug}  ${k.replace(SEP, " / ")}  ${person} vs ${naiveOthers.join(",")}`);
        }
      }

      // Derived rows: the entry's other one-party, non-absent live assertions
      // with no live link to this person yet.
      const already = new Set(pes.map((pe) => String(pe.assertion_id)));
      // `inEntry` already excludes `absent` (see above), so the filter here is
      // only the two-party rule and "not already linked to this person".
      const derived = (inEntry.get(k) ?? []).filter(
        (a) => !already.has(a.id) && !isTwoParty(a.fact_type),
      );
      if (derived.length > 0) {
        entriesExpanded++;
        rowsAdded += derived.length;
      }
    }
  }
}

// Which side the order-dependent refusal lands on, per contested entry.
for (const holders of contested.values()) {
  const rows = [...holders.values()];
  if (rows.length < 2) continue;
  const latest = rows.reduce((a, b) => (b.first > a.first ? b : a));
  const most = Math.max(...rows.map((r) => r.facts.length));
  if (latest.facts.length < most) refusalHitsThinner++;
  else if (latest.facts.length === most && rows.every((r) => r.facts.length === most)) refusalTie++;
  else refusalHitsFuller++;
}

console.log(`files                       ${files}`);
console.log(`record parties with links   ${partiesWithLinks}`);
console.log(`(entry, person) w/ trigger  ${pairsWithTrigger}`);
console.log(`  ...carrying move_bridge   ${bridgedTriggers}   <- these must inherit it (plan §0.2)`);
console.log(`entries that would expand   ${entriesExpanded}`);
console.log(`derived rows added          ${rowsAdded}`);
console.log("");
console.log(`§0.6 refusal, ANY live link (rejected reading)   ${refuseNaive}`);
console.log(`§0.6 refusal, one-party links only (the plan)    ${refuseStrict}`);
console.log(`  ...distinct entries behind those refusals      ${strictEntries.size}`);
console.log(`  refused ONLY by the rejected reading           ${naiveOnly.length}`);
console.log("");
console.log("DOES THE RULE REACH THE BUG? partially-linked (entry, person) pairs:");
console.log(`  reachable  -- has a one-party trigger, expands    ${partialWithTrigger}`);
console.log(`  second-party link, entry held by its own person  ${secondPartyOnEntry}  (${secondPartyRuns.size} runs) -- NOT stranded`);
console.log(`  UNREACHED  -- two-party only AND nobody holds it   ${partialTwoPartyOnly}  (${unreachedRuns.size} runs)`);
console.log(`     one-party facts left stranded in those          ${rowsStranded}`);
console.log("");
console.log("the refusal is order-dependent -- which side arrives second:");
console.log(`  the THINNER claim (the defect)                ${refusalHitsThinner}`);
console.log(`  the FULLER claim (refusal would harm)         ${refusalHitsFuller}`);
console.log(`  tie, both sides equally thin                  ${refusalTie}`);

if (LIST) {
  console.log("\n--- every ENTRY the planned refusal fires on (ADR-0011: read, don't rate) ---");
  for (const ek of [...contested.keys()].sort()) {
    const [slug, rest] = [ek.slice(0, ek.indexOf(SEP)), ek.slice(ek.indexOf(SEP) + 1)];
    console.log(`\n  ${slug}  ${rest.replace(SEP, " / ")}`);
    for (const [person, v] of contested.get(ek)!) {
      console.log(`      ${person.padEnd(16)} ${v.facts.join(", ")}`);
    }
  }
  console.log("\n--- the same, as refused writes ---");
  for (const c of strictCases) console.log(`  ${c}`);
  console.log("\n--- refused only by the rejected 'any live link' reading (first 40) ---");
  for (const c of naiveOnly.slice(0, 40)) console.log(`  ${c}`);
}
