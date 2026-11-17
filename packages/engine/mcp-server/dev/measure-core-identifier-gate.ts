// Re-derive the core-identifier gate's figures for the four #2537 follow-ups
// over the committed corpus.
//
//   npx tsx dev/measure-core-identifier-gate.ts            # the figures
//   npx tsx dev/measure-core-identifier-gate.ts --list     # + one line per refusal
//   npx tsx dev/measure-core-identifier-gate.ts --coords   # distance test with live coordinates
//
// The gates are the TOOL'S OWN, imported, never restated, so the script runs
// unchanged against any revision: run it on main and on a branch with --list and
// diff the two outputs to read what a change refuses or releases. A function a
// revision does not export is reported as absent.
//
// Corpus: every committed eval/fixtures/scenarios/<name>/research.json with its
// tree.gedcomx.json, and every committed e2e run-*.final-research.json with its
// .final-tree.gedcomx.json (`git ls-files`, so untracked scratch runs are not
// counted). Each link is gated with every other live link of its document in
// view, the state the document ended in.
//
// Without --coords no coordinates are looked up, so every same-country birthplace
// pair counts as far apart (the place arm before the distance test). Both sides
// of a diff must use the same setting.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import * as ra from "../src/tools/research-append.js";
import * as rp from "../src/utils/record-persona.js";
import * as sbd from "../src/utils/settled-birth-disputes.js";
import { lookupWithin } from "../src/utils/place-coords.js";
import { standardPlaceToCoords } from "../src/utils/place-resolver.js";

const LIST = process.argv.includes("--list");
const COORDS = process.argv.includes("--coords");
const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf-8"));
const tracked = (pattern: string): string[] =>
  execFileSync("git", ["ls-files", pattern], { cwd: ROOT, encoding: "utf-8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter(Boolean);

const docs: { label: string; research: any; tree: any }[] = [];
for (const rel of tracked("eval/fixtures/scenarios/*/research.json")) {
  const tree = join(ROOT, dirname(rel), "tree.gedcomx.json");
  if (existsSync(tree)) docs.push({ label: dirname(rel), research: readJson(join(ROOT, rel)), tree: readJson(tree) });
}
for (const rel of tracked("eval/runlogs/e2e/*.final-research.json")) {
  const tree = join(ROOT, rel.replace(".final-research.json", ".final-tree.gedcomx.json"));
  if (existsSync(tree)) docs.push({ label: rel, research: readJson(join(ROOT, rel)), tree: readJson(tree) });
}

const RELATIONAL = new Set(["relationship", "parentage", "parentchild", "marriage"]);
const gate = ra.coreIdentifierContradictionInvariants;
const recheck = (ra as any).scopedRelationalLinkInvariants as
  | ((e: any, r: any, t: any, l?: any, b?: any, c?: any) => string[])
  | undefined;
const containment = (ra as any).placeContainmentErrors as ((e: any, r: any) => string[]) | undefined;
const keyer = (rp as any).recordPartyKeyer as ((list: any[]) => (a: any) => string | null) | undefined;

let links = 0, linksRelational = 0;
let refused = 0, refusedRelational = 0, refusedPlace = 0, refusedDate = 0;
let refusedWithoutConflicts = 0;
let refusedAttached = 0;
let conflictsBirthPlace = 0, conflictsAttachedRefused = 0;
const conflictRule = (ra as any).attachedBirthConflictInvariants as ((c: any, r: any, t: any, l?: any, coords?: any) => string[]) | undefined;
const conflictNames = (ra as any).attachedBirthConflictPlaceNames as ((c: any, r: any, l?: any) => string[]) | undefined;
const isBirthPlace = (sbd as any).isBirthPlaceDispute as ((a: unknown) => boolean) | undefined;
const judgedAttached = new Set<string>();
const attachedOf = (ra as any).attachedBirthsOf as ((p: string, r: any, l?: any) => any[]) | undefined;
let recheckRefusals = 0;
let conflictsChecked = 0, conflictsRefused = 0;
let mixedGroups = 0, sharedPids = 0, keyerMoves = 0;
const lines: string[] = [];

for (const { label, research, tree } of docs) {
  const assertions: any[] = Array.isArray(research.assertions) ? research.assertions : [];
  const byId = new Map(assertions.filter((a) => a && typeof a.id === "string").map((a) => [a.id, a]));

  // Party-key shapes, per record.
  const byRecord = new Map<string, any[]>();
  for (const a of assertions) {
    const rec = a?.record_id ?? a?.source_id;
    if (typeof rec !== "string") continue;
    (byRecord.get(rec) ?? byRecord.set(rec, []).get(rec)!).push(a);
  }
  for (const [rec, list] of byRecord) {
    const withPid = new Map<string, { pid: number; none: number }>();
    const rolesByPid = new Map<string, Set<string>>();
    for (const a of list) {
      const role = a?.record_role;
      if (typeof role !== "string" || role === "absent") continue;
      const c = withPid.get(role) ?? { pid: 0, none: 0 };
      const pid = typeof a.record_persona_id === "string" && a.record_persona_id !== "" ? a.record_persona_id : null;
      if (pid) c.pid += 1;
      else c.none += 1;
      withPid.set(role, c);
      if (pid) (rolesByPid.get(pid) ?? rolesByPid.set(pid, new Set()).get(pid)!).add(role);
    }
    for (const [role, c] of withPid) {
      if (c.pid > 0 && c.none > 0) {
        mixedGroups += 1;
        if (LIST) lines.push(`MIXED\t${label}\t${rec}\trole=${role}`);
      }
    }
    for (const [pid, roles] of rolesByPid) {
      if (roles.size > 1) {
        sharedPids += 1;
        if (LIST) lines.push(`SHARED\t${label}\t${rec}\tpid=${pid}\troles=${[...roles].join("|")}`);
      }
    }
    if (keyer) {
      const key = keyer(list);
      for (const a of list) {
        const naive = a?.record_persona_id || a?.record_role || null;
        if (key(a) !== naive) keyerMoves += 1;
      }
    }
  }

  const live = ((research.person_evidence ?? []) as any[]).filter(
    (e) => e && !e.superseded_by && typeof e.assertion_id === "string" && typeof e.person_id === "string",
  );
  const personLinks = live.map((e) => ({
    id: e.id, assertion_id: e.assertion_id, person_id: e.person_id, confidence: e.confidence,
  }));

  let coords: any = undefined;
  if (COORDS) {
    const names = new Set<string>();
    const withNames = new Set<string>();
    for (const e of live) for (const n of ra.birthPlaceCoordNames(e, research, tree, personLinks)) names.add(n);
    const attachedNames = ((ra as any).birthPlaceNameLookups ?? (ra as any).attachedBirthPlaceNames) as ((e: any, r: any, t: any, l?: any) => string[]) | undefined;
    if (attachedNames) for (const e of live) for (const n of attachedNames(e, research, tree, personLinks)) withNames.add(n);
    if (conflictNames) for (const c of (research.conflicts ?? []) as any[]) for (const n of conflictNames(c, research, personLinks)) withNames.add(n);
    const info = (ra as any).birthPlaceInfo as ((n: string, w: boolean) => Promise<any>) | undefined;
    for (const n of withNames) names.add(n);
    coords = names.size
      ? await lookupWithin([...names], (n) => (info ? info(n, withNames.has(n)) : standardPlaceToCoords(n)), 60_000)
      : new Map();
  }
  const noConflicts = { ...research, conflicts: [] };

  // #4444: people whose readable attached births (live or ruled out) number two
  // or more -- the population the attached-births arm can judge at all.
  if (attachedOf) {
    for (const p of new Set(live.map((e) => e.person_id))) {
      if (attachedOf(p, research, personLinks).length >= 2) judgedAttached.add(`${label}#${p}`);
    }
  }

  for (const e of live) {
    if (e.confidence !== "confident" && e.confidence !== "probable") continue;
    links += 1;
    const relational = RELATIONAL.has(String(byId.get(e.assertion_id)?.fact_type ?? "").toLowerCase());
    if (relational) linksRelational += 1;
    const errs = gate(e, research, tree, personLinks, undefined, coords);
    if (gate(e, noConflicts, tree, personLinks, undefined, coords).length > 0) refusedWithoutConflicts += 1;
    if (errs.length === 0) continue;
    refused += 1;
    if (relational) refusedRelational += 1;
    const text = errs.join(" ");
    if (/the record states '/.test(text)) refusedPlace += 1;
    if (/-year gap/.test(text)) refusedDate += 1;
    if (/own attached records disagree|ruled is not this person/.test(text)) {
      refusedAttached += 1;
      if (LIST) lines.push(`ATTACHED\t${label}\t${e.id}\t${e.person_id}\t${text.slice(0, 260)}`);
    }
    if (LIST) lines.push(`REFUSE\t${label}\t${e.id}\t${relational ? "relational" : "one-party"}\t${text.slice(0, 220)}`);
  }

  // Every live link, any tier, replayed as the one this call writes: would
  // writing it LAST make another relationship link a refused one?
  if (recheck) {
    for (const e of live) {
      const asWritten = personLinks.map((l) => (l.id === e.id ? { ...l, fromBatch: true } : l));
      const errs = recheck(e, research, tree, asWritten, undefined, coords);
      if (errs.length === 0) continue;
      recheckRefusals += 1;
      if (LIST) lines.push(`RECHECK\t${label}\t${e.id}\t${errs.join(" ").slice(0, 220)}`);
    }
  }

  // #4444: every resolved birthplace fact conflict, replayed through the rule
  // that refuses resolving one across a person's contradicting attached births.
  if (conflictRule && isBirthPlace) {
    for (const c of (research.conflicts ?? []) as any[]) {
      if (c?.conflict_type !== "fact" || c?.status !== "resolved" || !isBirthPlace(c.disputed_attribute)) continue;
      conflictsBirthPlace += 1;
      if (conflictRule(c, research, tree, personLinks, coords).length === 0) continue;
      conflictsAttachedRefused += 1;
      if (LIST) lines.push(`CONFLICT-ATTACHED\t${label}\t${c.id}\t${(c.competing_assertion_ids ?? []).join(",")}\tpreferred ${c.preferred_assertion_id}`);
    }
  }

  if (containment) {
    for (const c of (research.conflicts ?? []) as any[]) {
      if (!c || c.conflict_type !== "fact") continue;
      conflictsChecked += 1;
      const errs = containment(c, research);
      if (errs.length === 0) continue;
      conflictsRefused += 1;
      if (LIST) lines.push(`CONFLICT\t${label}\t${c.id}\t${c.disputed_attribute}`);
    }
  }
}

const absent = (f: unknown) => (f ? "" : " (not exported by this revision)");
console.log(`documents read                              : ${docs.length}${COORDS ? "" : "  (no coordinates)"}`);
console.log(`confident/probable links                    : ${links} (${linksRelational} on a two-party assertion)`);
console.log(`  refused by the gate                       : ${refused} (${refusedRelational} two-party; ${refusedPlace} place, ${refusedDate} date)`);
console.log(`  refused with every conflict removed       : ${refusedWithoutConflicts}`);
console.log(`  refused by the attached-births arm (#4444): ${attachedOf ? refusedAttached : "-"}${absent(attachedOf)}`);
console.log(`people with two or more attached births    : ${attachedOf ? judgedAttached.size : "-"}${absent(attachedOf)}`);
console.log(`resolved birthplace conflicts / refused    : ${conflictRule ? `${conflictsBirthPlace} / ${conflictsAttachedRefused}` : "-"}${absent(conflictRule)}`);
console.log(`one-party links the re-check refuses        : ${recheck ? recheckRefusals : "-"}${absent(recheck)}`);
console.log(`fact conflicts / refused as one place       : ${containment ? `${conflictsChecked} / ${conflictsRefused}` : "-"}${absent(containment)}`);
console.log(`record+role groups with mixed persona ids   : ${mixedGroups}`);
console.log(`persona ids worn by >1 role in a record     : ${sharedPids}`);
console.log(`assertions the record-wide party key re-keys: ${keyer ? keyerMoves : "-"}${absent(keyer)}`);
if (LIST) for (const l of lines.sort()) console.log(l);
// A floor, so the attached-births figures cannot read as a clean zero when the
// arm judged nobody: thomas-hanrahan-marriage's 2026-11-09 run must stay in view.
if (attachedOf && (judgedAttached.size === 0 || refusedAttached === 0)) {
  console.error("attached-births arm judged no person or refused nothing: the corpus or the arm is broken");
  process.exit(2);
}
