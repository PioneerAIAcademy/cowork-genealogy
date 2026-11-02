// The namesake checks (issue #3363) over the committed e2e corpus, per ADR-0011
// limit 2: how often each rule fires, with the definition of every figure
// printed beside it.
//
//   npx tsx dev/measure-namesake-cap.ts [--verbose]
//
// No committed document carries `namesakes`, so nothing is refused today. Every
// figure after §0 plants rows and asks what the shipped functions would do; none
// of them re-implements a rule.
//
//   §0  committed research documents that carry namesakes.
//   §1  static: each committed e2e final state, a row planted on every person
//       holding a live probable or confident link, each link judged by
//       `namesakeVerdicts` with every other such link as a voucher. Relatives
//       come from the starting tree (TS) and from the final tree (TF). Neither
//       bounds the other link by link: a relationship the run removed ties in TS
//       what TF refuses, so §1 prints how many each refuses that the other
//       allows. Each link is judged twice more, with the two-party set before
//       item 14b and with one source per record (R = record), to count what
//       those two choices clear and add.
//   §2  write time: each research_append call with person_evidence ops in the
//       runs whose person_evidence the replay rebuilds exactly, with a row
//       planted before the first call on every person holding a probable or
//       confident link at the end of the run. Each link the call ASSERTS is
//       judged by `assertedNamesakeVerdicts`, the function the tool calls, on
//       the call's state as eval/harness/scripts/dump_namesake_call_states.py
//       rebuilds it with harness.replay. Relatives come from the relationships,
//       refs and sources the run had recorded by the call (TR) and from the
//       final tree (TF). The dump's shapes line counts, over every committed
//       run, the call shapes the namesake register rows quote.
//   §3  merges: each committed merge_tree_persons call, rows planted on the
//       survivors (A), the folded persons (B) and both (C), judged by
//       `mergeNamesakeRefusals`, `mergeCarryRefusals` and the pair checks on the
//       call's state, with brackets, unmoved links, the gates a merge skips and
//       a replay of lowering every refused link.
//   §3b merge link checks (#2537): each §3 call through the shipped
//       `mergeLinkCheckRefusals` on the merged tree and remapped research, no
//       rows planted; birth places resolve live.
//   §4  the namesake warning (1d): each committed e2e final state, rows
//       written in one call on every person holding a live probable or
//       confident link, then on the fixture subject alone; what
//       `namesakeRowListings` lists.
//   §5  the materialize copy gate (1d): each persona op of a committed
//       materialize_facts call, judged by `personaTargetRefusal` on the
//       run's final state with and without the rows.
//   §6  tree writes (1e): each tree_edit add_fact or add_name and
//       tree_correct update_fact or update_name that cites a source ref onto
//       a person's fact or name, charged with the citations it introduces by
//       the shipped `introducedCitations` and judged by the shipped
//       `namesakeCitationRefusals`, at the call and on the run's final state.
//       The dump keeps no tree, so updates are also judged charging none and
//       every one of their refs, which brackets the shipped check. It replays
//       op by op, so a call that writes one fact or name twice, or removes
//       one, fails a floor: the shipped check judges what a call adds as a
//       whole.
//   §7  item 10 (PR 2): each committed e2e final state carrying rows, read as
//       written, no row planted: the personas `research_append` stamped, and
//       what a refusal keyed on them would refuse and spare
//       (dev/namesake-persona-counts.ts). Zero until runs write rows.
//   §8  tree-derived namesake pairs (#3681): each committed e2e final state,
//       every person with a same-named parent, child or sibling, no row
//       planted: the links ties (a) and (b) refuse, how many the pair tests
//       tie, how many of the links they allow are held because the record ties
//       a partner as well, and links moved to a partner, run again with every
//       starting-tree fact cited to the FamilySearch tree. §5 also prints the
//       copy gate's pair figures.
//
// Exits non-zero when a floor fails: a bracket that judged or refused nothing
// would read as coverage and be none.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { arkToBareId } from "../src/utils/ark.js";
import {
  assertedNamesakeVerdicts,
  carryTriggerSources,
  derivedNamesakePairs,
  mergeCarryRefusals,
  mergeDirections,
  mergeLinkCheckRefusals,
  mergeNamesakeRefusals,
  namesakeRowListings,
  namesakeVerdicts,
  refsReach,
  introducedCitations,
  namesakeCitationRefusals,
  RELATIONAL_FACT_TYPES,
  unexplainedMoveInvariants,
  type IntroducedCitation,
} from "../src/tools/research-append.js";
import { isTwoParty } from "../src/utils/record-persona.js";
import { joinedPairRefusals, survivorOrderRefusals } from "../src/tools/merge-tree-persons.js";
import { startingPersonIdsOf } from "../src/utils/starting-tree.js";
import { mergeGedcomx } from "../src/utils/merge-gedcomx.js";
import { remapResearchPersonIds } from "../src/tools/merge-shared.js";
import { personaTargetRefusal } from "../src/tools/materialize-facts.js";
import { personaStampCounts } from "./namesake-persona-counts.js";
import { bareName, opsOf, readRunLog, repoRoot, responseOf, toolCalls } from "./runlog-calls.js";

const VERBOSE = process.argv.includes("--verbose");
const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8" });
const sha = git("rev-parse", "--short=9", "HEAD").trim();

function readJson(rel: string): any {
  try {
    return JSON.parse(readFileSync(join(repoRoot, rel), "utf-8"));
  } catch {
    return null;
  }
}

let floorsFailed = 0;
function floor(ok: boolean, what: string): void {
  if (!ok) {
    floorsFailed += 1;
    console.log(`  FLOOR FAILED: ${what}`);
  }
}

/** Record-hint fixtures whose hint was adjudicated, from each fixture's notes
 *  and its README's "Notes for reviewers" (read 2026-10-16): true when the
 *  hint record is the subject's own, false when it is a namesake's. Every
 *  other fixture is unlabelled. */
const HINT_TRUE = new Set([
  "anna-findejsova-daughter", "asgeir-brinjolfsson-birth", "chresten-nielsen-daughter",
  "ciriaco-bardales-spouse", "concepcion-alegre-parents", "elisabeth-myslisch-marriage",
  "elsa-heikkinen-birth", "eulogia-gatica-burial", "fernando-suarez-marriage", "francis-fisher-spouse",
  "friedrich-weber-daughter", "gertrudis-hoffmans-daughter", "heinrich-dewus-children-death",
  "ignacio-alvarado-daughter", "isabel-carvajal-daughter", "isabel-flores-birth", "isabella-inglis-parents",
  "isleifur-isleifsson-spouse", "jacob-klatkiewicz-spouse", "jacobo-clotten-marriage", "jean-cupis-burial",
  "john-nielssen-birth", "juan-goni-daughter", "juan-rodriguez-son", "julius-eilertsen-spouse",
  "katherine-smith-birth", "manoel-oliveira-daughter", "maria-fuenmayor-parents", "marie-kayser-death",
  "marina-lopez-parents", "mary-kavanaugh-son", "matyas-muck-son", "micaela-salgado-son",
  "nicola-domenichelli-death", "nicolas-uhres-birth", "olaya-guerrero-marriage", "paerai-teupooihi-spouse",
  "pedro-chaves-spouse", "pierre-desobry-spouse", "rafael-reyes-daughter", "santiago-gonzalez-son",
  "sarah-henderson-death", "sebastiana-sandoval-daughter", "sebastiano-mingazzini-son",
  "susanna-dawson-marriage", "susanna-szljacsan-spouse", "victoriano-macatangay-parents",
  "wasyl-kapach-birth", "wendel-weichel-mother",
]);
const HINT_FALSE = new Set([
  "adelaida-martinez-mother", "anna-macek-son", "antonio-lucas-spouse", "catharina-gosner-daughter",
  "cornelius-booysen-death", "creszentia-haas-birth", "domingo-olivera-parents", "elisabetha-sugecz-parents",
  "estefania-zambrana-son", "georg-gajdosch-spouse", "gust-huhtala-spouse", "heinrich-zinsmeister-death",
  "hinrich-burmeister-spouse", "jantje-willems-birth", "joseph-david-daughter",
  "kierstin-jonsdotter-daughter", "marie-badoux-daughter", "mary-dwyer-father", "mary-mcandrew-son",
  "matilde-cavagnaro-spouse", "patrick-hoban-spouse", "pierre-tullier-son", "robert-lord-children",
  "rozal-sarman-daughter", "thomas-werdmuller-spouse", "umbelina-azevedo-death", "vasily-romanov-spouse",
  "william-mcallister-son",
]);
const labelOf = (slug: string) => (HINT_TRUE.has(slug) ? "true" : HINT_FALSE.has(slug) ? "false" : "unlabelled");

/** Fixtures whose hint is a namesake's record and whose cap must refuse it. */
const MUST_FIRE = new Set([
  "antonio-lucas-spouse", "georg-gajdosch-spouse", "hinrich-burmeister-spouse", "kierstin-jonsdotter-daughter",
  "patrick-hoban-spouse", "vasily-romanov-spouse", "joseph-david-daughter", "mary-mcandrew-son", "robert-lord-children",
]);

const STRONG = new Set(["probable", "confident"]);

/** Sources holding two documents, found by reading the 27 sources whose
 *  assertions span two or more record ids: the cap reads each as one record
 *  (residual D3.11b). */
const TWO_DOCUMENT_SOURCES = new Set(["mikkel-blyeberg-father/2026-07-09_17-23-35/src_004"]);

/** A row planted on each of `personIds`: the cap reads only `person_id`. */
function plantRows(research: any, personIds: Iterable<string>): any {
  const namesakes = [...personIds].map((p, i) => ({
    id: `ns_${String(i + 1).padStart(3, "0")}`,
    person_id: p,
    name: "planted",
    place: "planted",
    record_ids: [],
    created: "2026-10-17",
  }));
  return { ...research, namesakes };
}

// ─── §0 ─────────────────────────────────────────────────────────────────────

function section0(): void {
  const docs = git("ls-files").split("\n").filter((f) => /research\.json$/.test(f));
  const carrying = docs.filter((f) => {
    const d = readJson(f);
    return Array.isArray(d?.namesakes) && d.namesakes.length > 0;
  });
  console.log(`§0  committed research documents (tracked *research.json): ${docs.length}; carrying namesakes: ${carrying.length}`);
  for (const f of carrying) console.log(`    ${f}`);
}

// ─── §1 ─────────────────────────────────────────────────────────────────────

interface FinalState {
  file: string;
  slug: string;
  run: string;
  subject: string;
  research: any;
  finalTree: any;
  startTree: any;
  startingIds: ReadonlySet<string>;
}

/** Each committed e2e final state whose fixture names its subject. */
function finalStates(): { states: FinalState[]; skipped: number } {
  const states: FinalState[] = [];
  let skipped = 0;
  const files = git("ls-files", "eval/runlogs/e2e").split("\n").filter((f) => f.endsWith(".final-research.json"));
  for (const f of files) {
    const slug = basename(dirname(f));
    const subject = readJson(`eval/tests/e2e/${slug}/fixture.json`)?.source_pid;
    const research = readJson(f);
    const finalTree = readJson(f.replace(/\.final-research\.json$/, ".final-tree.gedcomx.json"));
    if (typeof subject !== "string" || !research || !finalTree) {
      skipped += 1;
      continue;
    }
    const startTree = readJson(`eval/tests/e2e/${slug}/starting-tree.gedcomx.json`) ?? { persons: [], relationships: [] };
    states.push({
      file: f,
      slug,
      run: basename(f).slice(4, 23),
      subject,
      research,
      finalTree,
      startTree,
      startingIds: startingPersonIdsOf(startTree),
    });
  }
  return { states, skipped };
}

/** The persons holding a live probable or confident link. */
function linkedPersons(research: any): string[] {
  const out = new Set<string>();
  for (const e of (research?.person_evidence ?? []) as any[]) {
    if (e && !e.superseded_by && typeof e.assertion_id === "string" && typeof e.person_id === "string" && STRONG.has(e.confidence)) {
      out.add(e.person_id);
    }
  }
  return [...out].sort();
}

/** The project with every two-party assertion outside the set the cap read
 *  before item 14b (`RELATIONAL_FACT_TYPES`) made one-party. */
function beforeItem14b(research: any): any {
  return {
    ...research,
    assertions: (research.assertions ?? []).map((a: any) =>
      a && isTwoParty(a.fact_type) && !RELATIONAL_FACT_TYPES.has(String(a.fact_type ?? "").toLowerCase())
        ? { ...a, fact_type: "other" }
        : a,
    ),
  };
}

/** The project with one source per record (R = record): each assertion moves
 *  to a copy of its source keyed on its record id, citing the same S entry. */
function onePerRecord(research: any): any {
  const sourceById = new Map<string, any>(((research.sources ?? []) as any[]).map((x) => [x?.id, x]));
  const copies = new Map<string, any>();
  const assertions = ((research.assertions ?? []) as any[]).map((a) => {
    if (!a || typeof a.source_id !== "string" || typeof a.record_id !== "string") return a;
    const id = `${a.source_id}#${arkToBareId(a.record_id)}`;
    if (!copies.has(id)) copies.set(id, { ...(sourceById.get(a.source_id) ?? {}), id });
    return { ...a, source_id: id };
  });
  return { ...research, assertions, sources: [...(research.sources ?? []), ...copies.values()] };
}

function section1(states: FinalState[]): void {
  console.log(
    "\n§1  static: a row planted on every person holding a live probable or confident link; each such link judged " +
      "with every other as a voucher; TS = relatives from the starting tree, TF = from the final tree",
  );
  const allowedIn: Record<string, Map<string, boolean>> = { TS: new Map(), TF: new Map() };
  for (const bracket of ["TS", "TF"] as const) {
    const c = {
      judged: 0, refused: 0, subject: 0, subjectRefused: 0,
      byLabel: { true: 0, false: 0, unlabelled: 0 } as Record<string, number>,
      mustFire: 0, mustFireRefused: 0,
      tieBOnly: 0, occupationOnly: 0, crossRecordOnly: 0, crossRecordAny: 0, twoDocOnly: 0, twoDocAny: 0,
      clears14b: 0, adds14b: 0, clearsR: 0, addsR: 0, selfTieOnly: 0,
      voided: { grounding: 0, "co-resident": 0, role: 0 } as Record<string, number>,
    };
    const crossRecordOnly: string[] = [];
    const crossByLabel: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    const crossFalseBySlug = new Map<string, number>();
    const crossSubjectByLabel: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    for (const s of states) {
      const persons = linkedPersons(s.research);
      const planted = plantRows(s.research, persons);
      const tree = bracket === "TS" ? s.startTree : s.finalTree;
      const assertionOfLink = new Map<string, unknown>(((planted.person_evidence ?? []) as any[]).map((e) => [e?.id, e?.assertion_id]));
      const old14b = beforeItem14b(planted);
      const byRecord = onePerRecord(planted);
      for (const p of persons) {
        const v = namesakeVerdicts(p, planted, tree, { startingPersonIds: s.startingIds });
        const v14b = namesakeVerdicts(p, old14b, tree, { startingPersonIds: s.startingIds });
        const vR = namesakeVerdicts(p, byRecord, tree, { startingPersonIds: s.startingIds });
        for (const [id, verdict] of v?.verdicts ?? []) {
          allowedIn[bracket].set(`${s.slug}/${s.run}/${id}`, verdict.allowed);
          const was14b = v14b?.verdicts.get(id)?.allowed;
          if (verdict.allowed && was14b === false) c.clears14b += 1;
          if (!verdict.allowed && was14b === true) c.adds14b += 1;
          const wasR = vR?.verdicts.get(id)?.allowed;
          if (verdict.allowed && wasR === false) c.clearsR += 1;
          if (!verdict.allowed && wasR === true) c.addsR += 1;
          const isSubject = p === s.subject;
          c.judged += 1;
          if (isSubject) c.subject += 1;
          if (isSubject && MUST_FIRE.has(s.slug)) c.mustFire += 1;
          if (!verdict.allowed) {
            c.refused += 1;
            for (const b of verdict.blockedBy) c.voided[b] += 1;
            if (isSubject) {
              c.subjectRefused += 1;
              c.byLabel[labelOf(s.slug)] += 1;
              if (MUST_FIRE.has(s.slug)) c.mustFireRefused += 1;
            }
            continue;
          }
          const a = verdict.ties.filter((t) => t.kind === "a");
          const b = verdict.ties.filter((t) => t.kind === "b");
          if (a.length === 0) c.tieBOnly += 1;
          const own = assertionOfLink.get(id);
          if (b.length === 0 && a.length > 0 && a.every((t) => t.kind === "a" && assertionOfLink.get(t.link) === own)) c.selfTieOnly += 1;
          if (a.length === 0 && b.every((t) => t.kind === "b" && t.field === "occupation")) c.occupationOnly += 1;
          if (a.some((t) => t.kind === "a" && t.crossRecord)) c.crossRecordAny += 1;
          if (TWO_DOCUMENT_SOURCES.has(`${s.slug}/${s.run}/${verdict.source}`) && a.some((t) => t.kind === "a" && t.crossRecord)) {
            c.twoDocAny += 1;
            if (b.length === 0 && a.every((t) => t.kind === "a" && t.crossRecord)) c.twoDocOnly += 1;
          }
          if (b.length === 0 && a.every((t) => t.kind === "a" && t.crossRecord)) {
            c.crossRecordOnly += 1;
            crossRecordOnly.push(`${s.slug} ${s.run} ${id} on ${p}`);
            const label = labelOf(s.slug);
            crossByLabel[label] += 1;
            if (label === "false") crossFalseBySlug.set(s.slug, (crossFalseBySlug.get(s.slug) ?? 0) + 1);
            if (isSubject) crossSubjectByLabel[label] += 1;
          }
        }
      }
    }
    console.log(
      `  ${bracket}: links judged ${c.judged}, refused ${c.refused} | subject links ${c.subject}, refused ${c.subjectRefused} ` +
        `(hint the subject's own ${c.byLabel.true}, a namesake's ${c.byLabel.false}, unlabelled ${c.byLabel.unlabelled}) | ` +
        `must-fire fixtures' subject links refused ${c.mustFireRefused} of ${c.mustFire}`,
    );
    console.log(
      `      allowed by street address or occupation alone ${c.tieBOnly}, by occupation alone ${c.occupationOnly}; ` +
        `allowed only through a co-party on another record id of the same source ${c.crossRecordOnly} ` +
        `(with any such tie ${c.crossRecordAny}); of those, on a source holding two documents read as one record: ` +
        `${c.twoDocOnly} (with any such tie ${c.twoDocAny})`,
    );
    console.log(
      `      of the links allowed only through a co-party on another record id, by fixture: hint the subject's own ` +
        `${crossByLabel.true}, a namesake's ${crossByLabel.false}` +
        (crossFalseBySlug.size > 0 ? ` (${[...crossFalseBySlug].map(([k, n]) => `${k} ${n}`).join(", ")})` : "") +
        `, unlabelled ${crossByLabel.unlabelled}; subject links among them: hint the subject's own ` +
        `${crossSubjectByLabel.true}, a namesake's ${crossSubjectByLabel.false}, unlabelled ${crossSubjectByLabel.unlabelled}`,
    );
    console.log(
      `      item 14b (the two-party set) clears ${c.clears14b} and adds ${c.adds14b} refusals; ` +
        `R = source rather than one source per record clears ${c.clearsR} and adds ${c.addsR}; ` +
        `allowed only through the link's own assertion linked to a relative ${c.selfTieOnly}`,
    );
    console.log(
      `      refused links where a rule voided a tie they would otherwise have had: grounding ${c.voided.grounding}, ` +
        `the co-resident exclusion ${c.voided["co-resident"]}, the role check ${c.voided.role}`,
    );
    if (VERBOSE) for (const l of crossRecordOnly) console.log(`      cross-record only: ${l}`);
    floor(c.judged > 0 && c.refused > 0, `§1 ${bracket} judged ${c.judged} and refused ${c.refused}`);
  }
  let tfOnly = 0;
  let tsOnly = 0;
  for (const [k, allowed] of allowedIn.TF) {
    const ts = allowedIn.TS.get(k);
    if (!allowed && ts === true) tfOnly += 1;
    if (allowed && ts === false) tsOnly += 1;
  }
  console.log(`  links TF refuses that TS allows: ${tfOnly}; links TS refuses that TF allows: ${tsOnly}`);
}

// ─── §2 ─────────────────────────────────────────────────────────────────────

/** The must-fire records: the hint records of two must-fire fixtures, every
 *  probable or confident link from which to the subject is the namesake's. */
const MUST_FIRE_RECORDS = new Set([
  ...["005387300_00034", "005387300_00044", "005387302_00008"].map((r) => `georg-gajdosch-spouse|${r}`),
  ...["2XS7-L43", "Q27P-BDLN", "QB58-WW2", "X9G3-FRG", "NKKY-C2T"].map((r) => `robert-lord-children|${r}`),
]);
const bareRecord = (id: unknown) => arkToBareId(String(id ?? "")).replace(/^capture:/, "");

/** The 47 must-fire links: every probable or confident link from a must-fire
 *  record to the subject in the runs the replay rebuilds, so a judged count
 *  short of 47 names what it lost. */
const MUST_FIRE_LINKS = new Set([
  ...["pe_005", "pe_006", "pe_007", "pe_008", "pe_049", "pe_050", "pe_051", "pe_052", "pe_066", "pe_067", "pe_068", "pe_069", "pe_070"].map((pe) => `georg-gajdosch-spouse/run-2026-09-16_18-43-30.json|${pe}`),
  ...["pe_045", "pe_046", "pe_047", "pe_048", "pe_049", "pe_050", "pe_051", "pe_053", "pe_055", "pe_062", "pe_072", "pe_080", "pe_096", "pe_097", "pe_098", "pe_099", "pe_100", "pe_101", "pe_102", "pe_119", "pe_120", "pe_121", "pe_122", "pe_123", "pe_124", "pe_125", "pe_136", "pe_137", "pe_138", "pe_139", "pe_146", "pe_147", "pe_148", "pe_149"].map((pe) => `robert-lord-children/run-2026-09-16_14-15-30.json|${pe}`),
]);

/** The call-time states the Python dumper rebuilds, one object per line. */
function dumpCallStates(): any[] {
  // NAMESAKE_DUMP reads a dump already written, so the checks below can be
  // proven to fire on an altered one.
  const given = process.env.NAMESAKE_DUMP;
  if (given) return readFileSync(given, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const dir = mkdtempSync(join(tmpdir(), "namesake-calls-"));
  const out = join(dir, "calls.jsonl");
  try {
    const coverage = execFileSync(
      "uv",
      ["run", "--no-project", "python", "eval/harness/scripts/dump_namesake_call_states.py", out],
      { cwd: repoRoot, encoding: "utf-8" },
    );
    console.log(`\n28a coverage (harness.replay):\n${coverage.trimEnd().replace(/^/gm, "    ")}`);
    return readFileSync(out, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function shapesLine(lines: any[]): void {
  const sh = lines.find((l) => l.kind === "shapes") ?? {};
  const n = (k: string) => sh[k] ?? 0;
  console.log(`\nshapes  every call of the ${n("runs")} committed e2e runs, whatever its outcome`);
  console.log(
    `  speculative person_evidence appends ${n("speculative person_evidence appends")} in ` +
      `${n("runs with a speculative person_evidence append")} runs (applied ${n("speculative person_evidence appends, applied")}, ` +
      `refused ${n("speculative person_evidence appends, rejected")}, response stripped ${n("speculative person_evidence appends, unknown")})`,
  );
  console.log(
    `  person_evidence updates ${n("person_evidence updates")}: naming superseded_by ${n("person_evidence updates naming superseded_by")}, ` +
      `clearing it ${n("person_evidence updates clearing superseded_by")}; setting a confidence ${n("person_evidence confidence updates")}, ` +
      `lowering one ${n("person_evidence confidence lowerings")} (${n("person_evidence confidence updates on an entry the replay lacks")} on an entry the replay lacks)`,
  );
  console.log(
    `  tree_correct relationship removes ${n("relationship removes")} in ${n("runs with a relationship remove")} runs; ` +
      `merge_tree_persons calls with more than one pair ${n("merge calls with more than one pair")}`,
  );
}

function section2(lines: any[], states: FinalState[]): void {
  console.log(
    "\n§2  write time: rows planted before the first call on every person holding a probable or confident " +
      "link at the end of the run; each link a research_append call asserts judged on that call's state; " +
      "TR = relationships recorded by the call, TF = the final tree",
  );
  const byRun = new Map(states.map((s) => [`${s.slug}/run-${s.run}.json`, s]));
  const rebuilt = new Set(lines.filter((l) => l.kind === "run" && l.fidelity).map((l) => l.run));
  const calls = lines.filter((l) => l.kind === "append" && rebuilt.has(l.run) && byRun.has(l.run));
  console.log(`  population: ${rebuilt.size} runs whose person_evidence the replay rebuilds exactly; ${calls.length} calls with person_evidence ops`);
  for (const bracket of ["TR", "TF"] as const) {
    const c = { asserted: 0, refused: 0, callsAsserting: 0, callsRefused: 0, byLabel: { true: 0, false: 0, unlabelled: 0 } as Record<string, number>, other: 0 };
    const mustFire = new Map<string, { judged: number; refused: number }>();
    const mustFireJudged = new Set<string>();
    const perRun = new Map<string, { asserted: number; refused: number; subject: number }>();
    for (const call of calls) {
      const pr = perRun.get(call.run) ?? { asserted: 0, refused: 0, subject: 0 };
      perRun.set(call.run, pr);
      const s = byRun.get(call.run)!;
      const rowed = new Set<string>();
      for (const e of (s.research.person_evidence ?? []) as any[]) {
        if (e && STRONG.has(e.confidence) && typeof e.person_id === "string") rowed.add(e.person_id);
      }
      let base = plantRows(s.research, [...rowed].sort());
      let tree: any = s.finalTree;
      if (bracket === "TR") {
        const sourceIds = new Set<string>(call.source_ids_after ?? call.source_ids);
        const assertionIds = new Set<string>(call.assertion_ids_after ?? []);
        const sources = ((s.research.sources ?? []) as any[]).filter((x) => sourceIds.has(x?.id));
        const sIds = new Set<string>([
          ...call.starting_s_ids,
          ...sources.map((x) => x?.gedcomx_source_description_id).filter((id: unknown) => typeof id === "string"),
        ]);
        base = {
          ...base,
          sources,
          assertions: assertionIds.size > 0 ? ((base.assertions ?? []) as any[]).filter((a) => assertionIds.has(a?.id)) : base.assertions,
        };
        tree = {
          persons: ((s.finalTree.persons ?? []) as any[]).map((p) => keepRefs(structuredClone(p), sIds)),
          relationships: call.relationships,
        };
      }
      const asserted = assertedNamesakeVerdicts(
        { research: { ...base, person_evidence: call.pe_before } },
        { research: { ...base, person_evidence: call.pe_after }, tree },
        new Set<string>(call.starting_ids),
      );
      let refusedHere = false;
      if (asserted.length > 0) c.callsAsserting += 1;
      const assertionById = new Map(((s.research.assertions ?? []) as any[]).map((a) => [a?.id, a]));
      for (const { entry, verdict } of asserted) {
        c.asserted += 1;
        pr.asserted += 1;
        const isSubject = entry.person_id === s.subject;
        const record = `${s.slug}|${bareRecord(assertionById.get(entry.assertion_id)?.record_id)}`;
        if (MUST_FIRE_LINKS.has(`${call.run}|${entry.id}`)) mustFireJudged.add(`${call.run}|${entry.id}`);
        if (isSubject && MUST_FIRE_RECORDS.has(record)) {
          const m = mustFire.get(record) ?? { judged: 0, refused: 0 };
          m.judged += 1;
          if (!verdict.allowed) m.refused += 1;
          mustFire.set(record, m);
        }
        if (verdict.allowed) continue;
        c.refused += 1;
        pr.refused += 1;
        refusedHere = true;
        if (isSubject) pr.subject += 1;
        if (isSubject) c.byLabel[labelOf(s.slug)] += 1;
        else c.other += 1;
      }
      if (refusedHere) c.callsRefused += 1;
    }
    const mf = [...mustFire.values()].reduce((t, m) => ({ judged: t.judged + m.judged, refused: t.refused + m.refused }), { judged: 0, refused: 0 });
    console.log(
      `  ${bracket}: asserted links ${c.asserted} in ${c.callsAsserting} calls, refused ${c.refused} in ${c.callsRefused} calls (subject: hint the subject's own ` +
        `${c.byLabel.true}, a namesake's ${c.byLabel.false}, unlabelled ${c.byLabel.unlabelled}; other people ${c.other}) | ` +
        `must-fire records refused ${mf.refused} of ${mf.judged}`,
    );
    if (VERBOSE) for (const [r, m] of mustFire) console.log(`      ${r}: refused ${m.refused} of ${m.judged}`);
    if (VERBOSE) {
      for (const [run, pr] of perRun) {
        const label = labelOf(run.split("/")[0]);
        console.log(`      ${run} (${label}): asserted ${pr.asserted}, refused ${pr.refused}, subject refused ${pr.subject}`);
      }
    }
    floor(c.asserted > 0 && c.refused > 0, `§2 ${bracket} asserted ${c.asserted} and refused ${c.refused}`);
    floor(mf.refused > 0, `§2 ${bracket} refused ${mf.refused} of the ${mf.judged} must-fire subject links`);
    const lost = [...MUST_FIRE_LINKS].filter((k) => !mustFireJudged.has(k));
    floor(lost.length === 0, `§2 ${bracket} judged ${MUST_FIRE_LINKS.size - lost.length} of the ${MUST_FIRE_LINKS.size} must-fire links; not judged: ${lost.join(", ")}`);
  }
}

// ─── §3 merges ──────────────────────────────────────────────────────────────

/** The links part 1 must judge on the committed merge calls: A plants rows on
 *  the survivors, B on the folded persons. */
const EXPECT_A = new Set(
  ["pe_001", "pe_002", "pe_003", "pe_004", "pe_005", "pe_009", "pe_013"].map(
    (pe) => `cruz-corona-ancestry/run-2026-09-28_17-18-07.json|${pe}`,
  ),
);
const EXPECT_B = new Set([
  ...["pe_018", "pe_021", "pe_022", "pe_030", "pe_033", "pe_034"].map((pe) => `creszentia-haas-birth/run-2026-09-11_08-49-56.json|${pe}`),
  ...["pe_081", "pe_082", "pe_083", "pe_084", "pe_085", "pe_087"].map((pe) => `cruz-corona-ancestry/run-2026-09-16_08-50-32.json|${pe}`),
]);

interface MergeWorld {
  line: any;
  state: FinalState;
  merges: Array<[string, string]>;
  research: any;
  tree: any;
  startingIds: ReadonlySet<string>;
  /** Folded members the call-time tree lacks, rebuilt from the survivor's
   *  final-tree items its starting-tree copy lacks. */
  rebuilt: string[];
}

const refsOk = (refs: unknown, sIds: ReadonlySet<string>) =>
  (Array.isArray(refs) ? refs : []).filter((r: any) => typeof r?.ref === "string" && sIds.has(r.ref.replace(/^#/, "")));
const keepRefs = (p: any, sIds: ReadonlySet<string>) => ({
  ...p,
  ...(p.sources ? { sources: refsOk(p.sources, sIds) } : {}),
  names: (p.names ?? []).map((n: any) => (n.sources ? { ...n, sources: refsOk(n.sources, sIds) } : n)),
  facts: (p.facts ?? []).map((f: any) => (f.sources ? { ...f, sources: refsOk(f.sources, sIds) } : f)),
});
const sameName = (a: any, b: any) => a?.given === b?.given && a?.surname === b?.surname;
const sameFact = (a: any, b: any) => a?.type === b?.type && a?.date === b?.date && a?.place === b?.place && a?.value === b?.value;

/** The project as it stood at the merge call. Research is the replay's at the
 *  call, with assertion and source bodies from the final research by id. The
 *  tree is the starting tree's persons, then the final tree's others, with refs
 *  kept only where their S entry existed at the call, and the relationships the
 *  run had recorded by the call. */
function mergeWorld(line: any, state: FinalState): MergeWorld {
  const assertionIds = new Set(line.assertion_ids);
  const sourceIds = new Set(line.source_ids);
  const research = {
    ...state.research,
    assertions: (state.research.assertions ?? []).filter((a: any) => assertionIds.has(a?.id)),
    sources: (state.research.sources ?? []).filter((x: any) => sourceIds.has(x?.id)),
    person_evidence: line.pe_before,
  };
  const sIds = new Set<string>([
    ...line.starting_s_ids,
    ...research.sources.map((x: any) => x?.gedcomx_source_description_id).filter((id: unknown) => typeof id === "string"),
  ]);
  const persons = new Map<string, any>();
  for (const p of state.startTree.persons ?? []) if (p?.id) persons.set(p.id, keepRefs(structuredClone(p), sIds));
  for (const p of state.finalTree.persons ?? []) if (p?.id && !persons.has(p.id)) persons.set(p.id, keepRefs(structuredClone(p), sIds));
  const merges = (typeof line.merges === "string" ? JSON.parse(line.merges) : line.merges) as Array<[string, string]>;
  const rebuilt: string[] = [];
  for (const [s, c] of merges) {
    if (persons.has(c)) continue;
    const start = (state.startTree.persons ?? []).find((p: any) => p?.id === s);
    const fin = (state.finalTree.persons ?? []).find((p: any) => p?.id === s);
    if (!start || !fin) continue;
    // An item equal to one the starting copy holds comes across only with the
    // citations it adds, as the merge folds it.
    const added = (items: any[], prior: any[], same: (x: any, y: any) => boolean) =>
      items.flatMap((x) => {
        const p = prior.find((y) => same(y, x));
        if (!p) return [x];
        const refs = (x.sources ?? []).filter((r: any) => !(p.sources ?? []).some((q: any) => q?.ref === r?.ref));
        return refs.length > 0 ? [{ ...x, sources: refs }] : [];
      });
    persons.set(c, keepRefs({
      id: c,
      gender: fin.gender,
      names: added(fin.names ?? [], start.names ?? [], sameName),
      facts: added(fin.facts ?? [], start.facts ?? [], sameFact),
      sources: (fin.sources ?? []).filter((r: any) => !(start.sources ?? []).some((q: any) => q?.ref === r?.ref)),
    }, sIds));
    rebuilt.push(c);
  }
  const tree = { persons: [...persons.values()], relationships: line.relationships, sources: [] };
  return { line, state, merges, research, tree, startingIds: new Set<string>(line.starting_ids), rebuilt };
}

const plantOn = (w: MergeWorld, ids: string[], research = w.research) => ({
  research: plantRows(research, ids),
  tree: w.tree,
});

function section3(lines: any[], states: FinalState[]): void {
  console.log(
    "\n§3  merges: each committed merge_tree_persons call on the project as it stood at the call; rows planted on " +
      "the survivors (A), on the folded persons (B), and on both (C), all of a call's rows at once",
  );
  const byRun = new Map(states.map((s) => [`${s.slug}/run-${s.run}.json`, s]));
  const stripped = new Set(lines.filter((l) => l.kind === "run" && l.captures_stripped).map((l) => l.run));
  const unmeasured = (w: MergeWorld) => stripped.has(w.line.run) && (w.line.pe_before ?? []).length === 0;
  const worlds = lines
    .filter((l) => l.kind === "merge" && byRun.has(l.run))
    .map((l) => mergeWorld(l, byRun.get(l.run)!));
  const pairs = worlds.reduce((n, w) => n + w.merges.length, 0);
  console.log(`  calls ${worlds.length}, pairs ${pairs}`);
  for (const w of worlds) {
    console.log(
      `    ${w.line.run} #${w.line.call} ${JSON.stringify(w.merges)} outcome ${w.line.outcome}` +
        (w.rebuilt.length > 0 ? `; folded ${w.rebuilt.join(", ")} rebuilt from the final tree` : "") +
        (unmeasured(w) ? "; unmeasured: its captures were stripped, so the replay rebuilds no person_evidence at this call" : ""),
    );
  }
  const joined = worlds.reduce((n, w) => n + joinedPairRefusals(w.tree, w.merges).filter((l) => l.startsWith("relationship")).length, 0);
  const order = worlds.reduce((n, w) => n + survivorOrderRefusals(w.merges, w.startingIds).filter((l) => l.startsWith("pair")).length, 0);
  console.log(`  part 2 (a relationship joins the pair): ${joined} of ${pairs}; 24e (survivor order): ${order} of ${pairs}`);

  const judgedIn: Record<string, Set<string>> = { A: new Set(), B: new Set() };
  for (const scenario of ["A", "B", "C"] as const) {
    let judged = 0;
    let refused = 0;
    let marked = 0;
    let directions = 0;
    let triggering = 0;
    let rev5 = 0;
    for (const w of worlds) {
      const rowsOn = w.merges.flatMap(([s, c]) => (scenario === "A" ? [s] : scenario === "B" ? [c] : [s, c]));
      const before = plantOn(w, rowsOn);
      const part1 = mergeNamesakeRefusals(before, w.merges, w.startingIds);
      for (const d of mergeDirections(before, w.merges, w.startingIds)) {
        directions += 1;
        for (const [id, verdict] of d.moved) {
          judged += 1;
          if (scenario !== "C") judgedIn[scenario].add(`${w.line.run}|${id}`);
          if (verdict.allowed) continue;
          refused += 1;
          const line = part1.find((l) => l.startsWith(`person_evidence '${id}' on '${d.G}'`)) ?? "";
          if (line.includes("Do not lower it")) marked += 1;
          if (VERBOSE) {
            const mark = line.includes("was created from this record") ? "minted" : line.includes("Do not lower it") ? "tied on the giver" : "unmarked";
            console.log(`      ${scenario} ${w.line.run} ${d.G}->${d.T} ${id} refused (${mark})`);
          }
        }
        const triggers = carryTriggerSources(before, d);
        if (triggers.size > 0) triggering += 1;
        for (const reasons of triggers.values()) {
          if (reasons.every((r) => r.endsWith("withdrawn") || r.endsWith("speculative"))) rev5 += 1;
        }
        if (triggers.size > 0) {
          const items = w.startingIds.has(d.T) || w.rebuilt.includes(d.G)
            ? mergeCarryRefusals(before, w.merges, w.startingIds).filter((l) => l.includes(` on '${d.G}' `) && !l.startsWith("Nothing was written"))
            : null;
          console.log(
            `      ${scenario} ${w.line.run} ${d.G}->${d.T}: part 3 trigger sources ${[...triggers.keys()].join(", ")}; ` +
              (items === null ? `items not read: '${d.T}' made during the run` : `items read ${items.length}`),
          );
          if (VERBOSE && items) for (const it of items) console.log(`        ${it.slice(0, 160)}`);
        }
      }
    }
    console.log(
      `  ${scenario}: part 1 judged ${judged}, refused ${refused} (${marked} marked 'do not lower it'); ` +
        `part 3 trigger sources in ${triggering} of ${directions} directions (${rev5} sources with no live probable or confident link at all)`,
    );
    if (scenario === "A") floor(judged > 0 && refused > 0, `§3 A judged ${judged} and refused ${refused}`);
    if (scenario === "B") floor(judged > 0, `§3 B judged ${judged}`);
  }
  for (const [scenario, expected] of [["A", EXPECT_A], ["B", EXPECT_B]] as const) {
    const got = judgedIn[scenario];
    const missing = [...expected].filter((k) => !got.has(k));
    const extra = [...got].filter((k) => !expected.has(k));
    floor(missing.length === 0 && extra.length === 0, `§3 ${scenario} judged set: missing ${missing.join(", ") || "none"}; extra ${extra.join(", ") || "none"}`);
  }

  // Unmoved links: a strong link the merge does not move (the survivors' own
  // included), judged before it and
  // on an approximation of the project after it (ids mapped through the
  // collapse map, self-edges dropped, each survivor given both members' names,
  // facts and person-level refs), with a row on every person holding one.
  let unmoved = 0;
  let flips = 0;
  for (const w of worlds) {
    const survivorOf = new Map(w.merges.map(([s, c]) => [c, s] as const));
    const mapId = (id: any) => survivorOf.get(id) ?? id;
    const folded = new Set(w.merges.map(([, c]) => c));
    const holders = linkedPersons(w.research);
    const pre = plantRows(w.research, holders);
    const post = plantRows(
      { ...w.research, person_evidence: (w.research.person_evidence ?? []).map((e: any) => (e ? { ...e, person_id: mapId(e.person_id) } : e)) },
      [...new Set(holders.map(mapId))],
    );
    const persons = new Map<string, any>(w.tree.persons.map((p: any) => [p.id, structuredClone(p)]));
    for (const [s, c] of w.merges) {
      const a = persons.get(s);
      const b = persons.get(c);
      if (a && b) for (const f of ["names", "facts", "sources"]) if (b[f]?.length) a[f] = [...(a[f] ?? []), ...structuredClone(b[f])];
      persons.delete(c);
    }
    const rels = (w.tree.relationships ?? [])
      .map((r: any) => ({ ...r, ...Object.fromEntries(["parent", "child", "person1", "person2"].filter((k) => r[k] !== undefined).map((k) => [k, mapId(r[k])])) }))
      .filter((r: any) => !(r.parent !== undefined && r.parent === r.child) && !(r.person1 !== undefined && r.person1 === r.person2));
    const postTree = { persons: [...persons.values()], relationships: rels };
    for (const p of holders) {
      if (folded.has(p)) continue;
      const before = namesakeVerdicts(p, pre, w.tree, { startingPersonIds: w.startingIds });
      const after = namesakeVerdicts(p, post, postTree, { startingPersonIds: w.startingIds });
      for (const [id, v] of before?.verdicts ?? []) {
        unmoved += 1;
        if (v.allowed && after?.verdicts.get(id)?.allowed === false) {
          flips += 1;
          console.log(`      unmoved flip: ${w.line.run} ${id} on ${p}`);
        }
      }
    }
  }
  const measured = worlds.filter((w) => !unmeasured(w)).length;
  console.log(
    `  unmoved probable or confident links, in the ${measured} measured calls: ${unmoved}; ` +
      `allowed before the merge and refused after: ${flips}`,
  );

  // Brackets: relatives from the starting tree and from the final tree, A and B.
  for (const bracket of ["starting", "final"] as const) {
    const out: Record<string, number> = {};
    for (const scenario of ["A", "B"] as const) {
      let refused = 0;
      for (const w of worlds) {
        const base = bracket === "starting" ? w.state.startTree : w.state.finalTree;
        const have = new Set((base.persons ?? []).map((p: any) => p?.id));
        const tree = {
          persons: [...(base.persons ?? []), ...w.tree.persons.filter((p: any) => !have.has(p.id))],
          relationships: base.relationships ?? [],
        };
        const research = bracket === "final" ? { ...w.research, sources: w.state.research.sources ?? [] } : w.research;
        const rowsOn = w.merges.map(([s, c]) => (scenario === "A" ? s : c));
        for (const d of mergeDirections({ research: plantRows(research, rowsOn), tree }, w.merges, w.startingIds)) {
          for (const v of d.moved.values()) if (!v.allowed) refused += 1;
        }
      }
      out[scenario] = refused;
    }
    console.log(`  bracket, relatives from the ${bracket} tree: part 1 refuses A ${out.A}, B ${out.B}`);
  }

  // Other gates the merge skips: the move rule on each moved strong link, and
  // how many moved links carry a recorded match score.
  let moved = 0;
  let confident = 0;
  let scored = 0;
  let moveRefused = 0;
  for (const w of worlds) {
    const merged = { ...w.tree, persons: w.tree.persons.map((p: any) => structuredClone(p)) };
    for (const [s, c] of w.merges) {
      const a = merged.persons.find((p: any) => p.id === s);
      const b = merged.persons.find((p: any) => p.id === c);
      if (a && b) a.facts = [...(a.facts ?? []), ...(b.facts ?? [])];
    }
    for (const [s, c] of w.merges) {
      for (const e of (w.research.person_evidence ?? []) as any[]) {
        if (!e || e.superseded_by || (e.person_id !== c && e.person_id !== s) || !STRONG.has(e.confidence)) continue;
        if (e.person_id !== c) continue;
        moved += 1;
        if (e.confidence === "confident") confident += 1;
        if (e.match_score != null) scored += 1;
        if (unexplainedMoveInvariants({ ...e, person_id: s }, w.research, merged).length > 0) moveRefused += 1;
      }
    }
  }
  console.log(
    `  links the merges move onto the survivor: ${moved} probable or confident, ${confident} confident, ` +
      `${scored} carrying a match score; the move rule would refuse ${moveRefused}`,
  );

  measuredMergeWorlds = worlds;

  let replays = 0;
  // The lowering replay: at the call whose part 1 refuses links in A, lower
  // each refused link to speculative (what the routing offers an agent that
  // ignores 'do not lower it') and judge again.
  for (const w of worlds) {
    const rowsOn = w.merges.map(([s]) => s);
    const refusedIds = new Set<string>();
    for (const d of mergeDirections(plantOn(w, rowsOn), w.merges, w.startingIds)) {
      for (const [id, v] of d.moved) if (!v.allowed) refusedIds.add(id);
    }
    if (refusedIds.size === 0) continue;
    replays += 1;
    const lowered = {
      ...w.research,
      person_evidence: (w.research.person_evidence ?? []).map((e: any) => (refusedIds.has(e?.id) ? { ...e, confidence: "speculative" } : e)),
    };
    const after = plantOn(w, rowsOn, lowered);
    const directions = mergeDirections(after, w.merges, w.startingIds);
    const judged = directions.reduce((n, d) => n + d.moved.size, 0);
    const triggers = directions.flatMap((d) => [...carryTriggerSources(after, d).keys()]);
    const items = mergeCarryRefusals(after, w.merges, w.startingIds).filter((l) => !l.startsWith("Nothing was written"));
    console.log(
      `  lowering replay at ${w.line.run} #${w.line.call}: ${refusedIds.size} links lowered; part 1 judges ${judged}; ` +
        `trigger sources ${triggers.join(", ") || "none"}; part 3 lists ${items.length} items`,
    );
    if (VERBOSE) for (const it of items) console.log(`      ${it.slice(0, 160)}`);
    floor(triggers.length > 0 && items.length > 0, `§3 lowering replay at ${w.line.run}: triggers ${triggers.length}, items ${items.length}`);
  }
  floor(replays > 0, "§3 no call refuses a link in A, so the lowering replay judged nothing");
}

// ─── §4 the namesake warning ─────────────────────────────────────────────────

/** Rows planted on every person holding a live probable or confident link, or
 *  on the fixture subject alone when they hold one. */
const BRACKETS = ["every linked person", "the subject alone"] as const;
const holdersIn = (s: FinalState, bracket: (typeof BRACKETS)[number]) =>
  linkedPersons(s.research).filter((p) => bracket === "every linked person" || p === s.subject);

function section4(states: FinalState[]): void {
  console.log(
    "\n§4  the namesake warning (1d): each committed e2e final state, the rows written in one call; what " +
      "`namesakeRowListings` lists: the links the cap refuses (relatives from the final tree, every strong link " +
      "a voucher, as §1 TF), the facts their parties carried and the names citing their sources",
  );
  for (const bracket of BRACKETS) {
    let withHolders = 0, persons = 0, warned = 0, warnedStates = 0, links = 0, facts = 0, names = 0, most = 0;
    const subject: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    for (const s of states) {
      const holders = holdersIn(s, bracket);
      if (holders.length === 0) continue;
      withHolders += 1;
      persons += holders.length;
      const planted = plantRows(s.research, holders);
      const applied = (planted.namesakes as any[]).map((r) => ({ section: "namesakes", entryId: r.id }));
      const listings = namesakeRowListings({ research: planted }, { research: planted, tree: s.finalTree }, applied, s.startingIds);
      if (listings.length > 0) warnedStates += 1;
      warned += listings.length;
      let here = 0;
      for (const l of listings) {
        links += l.refused.length;
        facts += l.facts.length;
        names += l.names.length;
        here += l.refused.length;
        if (l.personId === s.subject) subject[labelOf(s.slug)] += l.refused.length;
      }
      most = Math.max(most, here);
    }
    console.log(
      `  ${bracket}: ${withHolders} states, ${persons} persons with a row; warned ${warned} persons in ${warnedStates} ` +
        `states, listing ${links} links (subject: hint the subject's own ${subject.true}, a namesake's ` +
        `${subject.false}, unlabelled ${subject.unlabelled}; at most ${most} in one state), ${facts} facts, ${names} names`,
    );
    if (bracket === "every linked person") floor(links > 0, "§4 the warning listed no link");
  }
}

// ─── §5 the materialize copy gate ────────────────────────────────────────────

function section5(states: FinalState[]): void {
  console.log(
    "\n§5  the materialize copy gate (1d): each persona op of a committed materialize_facts call that did not " +
      "fail, judged by `personaTargetRefusal` on the run's final state, as dev/replay-materialize-link.ts reads " +
      "it. Explicit: ops onto a row holder's personId admitted without the row and refused with it. Implicit: " +
      "row holders the op's persona facts reach in the final tree, admitted without the row and refused with " +
      "it, so the lookup passes them over",
  );
  for (const bracket of BRACKETS) {
    let explicitJudged = 0, explicitRefused = 0, implicitJudged = 0, implicitMint = 0;
    const subject: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    for (const s of states) {
      const holders = new Set(holdersIn(s, bracket));
      if (holders.size === 0) continue;
      const planted = plantRows(s.research, [...holders].sort());
      const assertions = (s.research.assertions ?? []) as any[];
      for (const call of toolCalls(readRunLog(s.file.replace(/\.final-research\.json$/, ".json")))) {
        if (bareName(call) !== "materialize_facts" || responseOf(call)?.ok === false) continue;
        for (const op of opsOf(call.args)) {
          if (typeof op?.assertionId === "string" || typeof op?.recordId !== "string" || typeof op?.recordRole !== "string") continue;
          const personId = typeof op.personId === "string" ? op.personId : undefined;
          const own = new Set(
            assertions.filter((a) => a?.record_id === op.recordId && a?.record_role === op.recordRole).map((a) => a?.id),
          );
          const targets =
            personId !== undefined
              ? [personId]
              : ((s.finalTree.persons ?? []) as any[])
                  .filter((p) => (p?.facts ?? []).some((f: any) => own.has(f?.assertion_id)))
                  .map((p) => String(p.id));
          for (const target of targets) {
            if (!holders.has(target)) continue;
            const judged = { ...op, personId: target };
            if (personaTargetRefusal(s.finalTree, s.research, judged, s.startingIds) !== null) continue;
            const refused = personaTargetRefusal(s.finalTree, planted, judged, s.startingIds) !== null;
            if (personId !== undefined) {
              explicitJudged += 1;
              if (refused) explicitRefused += 1;
              if (refused && target === s.subject) subject[labelOf(s.slug)] += 1;
            } else {
              implicitJudged += 1;
              if (refused) implicitMint += 1;
            }
          }
        }
      }
    }
    console.log(
      `  ${bracket}: explicit ${explicitJudged} judged, ${explicitRefused} refused (onto the subject: hint the ` +
        `subject's own ${subject.true}, a namesake's ${subject.false}, unlabelled ${subject.unlabelled}); ` +
        `implicit ${implicitJudged} row holders judged, ${implicitMint} passed over`,
    );
    if (bracket === "every linked person") {
      floor(explicitJudged > 0 && explicitRefused > 0, `§5 explicit judged ${explicitJudged}, refused ${explicitRefused}`);
    }
  }

  // Namesakes in the tree (#3681): no row planted. A pair member the op's facts
  // reach, admitted without pairs and refused with them; the lookup refuses an
  // op it would otherwise mint for, rather than passing the member over.
  let pairExplicitJudged = 0, pairExplicitRefused = 0, pairImplicitJudged = 0, pairImplicitRefused = 0;
  for (const s of states) {
    const paired = new Set(
      ((s.finalTree.persons ?? []) as any[])
        .map((p) => String(p?.id))
        .filter((id) => derivedNamesakePairs(s.finalTree, id).length > 0),
    );
    if (paired.size === 0) continue;
    const assertions = (s.research.assertions ?? []) as any[];
    for (const call of toolCalls(readRunLog(s.file.replace(/\.final-research\.json$/, ".json")))) {
      if (bareName(call) !== "materialize_facts" || responseOf(call)?.ok === false) continue;
      for (const op of opsOf(call.args)) {
        if (typeof op?.assertionId === "string" || typeof op?.recordId !== "string" || typeof op?.recordRole !== "string") continue;
        const personId = typeof op.personId === "string" ? op.personId : undefined;
        const own = new Set(
          assertions.filter((a) => a?.record_id === op.recordId && a?.record_role === op.recordRole).map((a) => a?.id),
        );
        const targets =
          personId !== undefined
            ? [personId]
            : ((s.finalTree.persons ?? []) as any[])
                .filter((p) => (p?.facts ?? []).some((f: any) => own.has(f?.assertion_id)))
                .map((p) => String(p.id));
        for (const target of targets) {
          if (!paired.has(target)) continue;
          const judged = { ...op, personId: target };
          if (personaTargetRefusal(s.finalTree, s.research, judged, s.startingIds) !== null) continue;
          const refusal = personaTargetRefusal(s.finalTree, s.research, judged, s.startingIds, s.finalTree, {
            startingTree: s.startTree,
            derivedPairs: true,
          });
          const refused = refusal !== null;
          if (VERBOSE && refused) {
            console.log(`      pair copy refused: ${s.slug} ${s.run} ${op.recordId} ${op.recordRole} onto ${target}`);
          }
          if (personId !== undefined) {
            pairExplicitJudged += 1;
            if (refused) pairExplicitRefused += 1;
          } else {
            pairImplicitJudged += 1;
            if (refused) pairImplicitRefused += 1;
          }
        }
      }
    }
  }
  console.log(
    `  namesakes in the tree (no row): explicit ${pairExplicitJudged} ops onto a pair member admitted without ` +
      `pairs, ${pairExplicitRefused} refused with them; implicit ${pairImplicitJudged} pair members the lookup ` +
      `would reuse, ${pairImplicitRefused} refused with pairs (the op is refused when no other person is eligible)`,
  );
  floor(pairExplicitJudged + pairImplicitJudged > 0, `§5 pair ops judged ${pairExplicitJudged + pairImplicitJudged}`);
}

// ─── §8 tree-derived namesake pairs (#3681) ──────────────────────────────────

/** The final state with every starting-tree fact cited to the FamilySearch
 *  tree's own source, as project creation has cited them since 2026-10-06. */
function fsCited(s: FinalState): { finalTree: any; startTree: any } {
  const FS = { id: "S_FSTREE", title: "FamilySearch Family Tree" };
  const started = new Set(((s.startTree.persons ?? []) as any[]).map((p) => String(p?.id)));
  const cite = (f: any) => (Array.isArray(f?.sources) && f.sources.length > 0 ? f : { ...f, sources: [{ ref: FS.id }] });
  const citeAll = (tree: any, only: ReadonlySet<string> | null) => ({
    ...tree,
    persons: ((tree.persons ?? []) as any[]).map((p) =>
      only === null || only.has(String(p?.id)) ? { ...p, facts: ((p?.facts ?? []) as any[]).map(cite) } : p,
    ),
    sources: [...((tree.sources ?? []) as any[]), FS],
  });
  return { finalTree: citeAll(s.finalTree, started), startTree: citeAll(s.startTree, null) };
}

function section8(states: FinalState[]): void {
  console.log(
    "\n§8  tree-derived namesake pairs: each committed e2e final state, every person with a parent, child or " +
      "sibling of the same first given name not known to be of the other sex (`derivedNamesakePairs`). Refused " +
      "by ties: their live probable or confident links `namesakeVerdicts` refuses with a row planted on them. " +
      "Tied by the pair tests: of those, the links it allows with no row and `derivedPairs`. Held: of the links " +
      "the ties allow, those it refuses with `derivedPairs`, the record tying a partner as well and the pair " +
      "tests not tying them. Mix-ups: each " +
      "link moved to a partner with the person's other links from its source, judged with `derivedPairs`",
  );
  for (const variant of ["as committed", "starting-tree facts cited to the FamilySearch tree"] as const) {
    let pairPersons = 0, refused = 0, tied = 0, movedJudged = 0, movedTied = 0, tieMovedJudged = 0, tieMovedTied = 0;
    let tieAllowed = 0, held = 0;
    const left: string[] = [];
    for (const s of states) {
      const { finalTree, startTree } = variant === "as committed" ? s : fsCited(s);
      const research = { ...s.research, namesakes: [] };
      const aById = new Map<string, any>(((research.assertions ?? []) as any[]).map((a) => [a?.id, a]));
      const sourceOf = (e: any) => {
        const a = aById.get(e?.assertion_id);
        return typeof a?.source_id === "string" && a.source_id !== "" ? a.source_id : (a?.record_id ?? null);
      };
      for (const p of ((finalTree.persons ?? []) as any[]).map((x) => String(x?.id))) {
        const partners = derivedNamesakePairs(finalTree, p);
        if (partners.length === 0) continue;
        pairPersons += 1;
        const byTies = namesakeVerdicts(p, plantRows(research, [p]), finalTree, { startingPersonIds: s.startingIds });
        const withPairs = namesakeVerdicts(p, research, finalTree, {
          startingPersonIds: s.startingIds,
          derivedPairs: true,
          startingTree: startTree,
        });
        for (const [id, verdict] of byTies?.verdicts ?? []) {
          const e = ((research.person_evidence ?? []) as any[]).find((x) => x?.id === id);
          const move = (q: string) => ({
            ...research,
            person_evidence: ((research.person_evidence ?? []) as any[]).map((x) =>
              x && !x.superseded_by && x.person_id === p && sourceOf(x) === sourceOf(e) ? { ...x, person_id: q } : x,
            ),
          });
          const movedAllowed = (q: string) => {
            const v = namesakeVerdicts(q, move(q), finalTree, {
              startingPersonIds: s.startingIds,
              only: new Set([id]),
              derivedPairs: true,
              startingTree: startTree,
            })?.verdicts.get(id);
            if (VERBOSE && v?.allowed && !verdict.allowed && variant === "as committed") {
              const ties = v.ties.map((t) => (t.kind === "a" ? `a:${t.relative}(${t.relation})` : t.kind === "b" ? `b:${t.field}` : `pair:${t.test}`));
              console.log(`    mix-up tied: ${s.slug} ${s.run} ${id} ${p} -> ${q} by ${ties.join(", ")}`);
            }
            return v?.allowed === true;
          };
          if (verdict.allowed) {
            tieAllowed += 1;
            if (!withPairs?.verdicts.get(id)?.allowed) held += 1;
            for (const q of partners) {
              tieMovedJudged += 1;
              if (movedAllowed(q.personId)) tieMovedTied += 1;
            }
            continue;
          }
          refused += 1;
          if (withPairs?.verdicts.get(id)?.allowed) tied += 1;
          else left.push(`${s.slug} ${s.run} ${id} on ${p}`);
          for (const q of partners) {
            movedJudged += 1;
            if (movedAllowed(q.personId)) movedTied += 1;
          }
        }
      }
    }
    console.log(
      `  ${variant}: ${pairPersons} pair members; refused by ties ${refused}, tied by the pair tests ${tied}, ` +
        `left ${refused - tied}; allowed by ties ${tieAllowed}, held ${held}; mix-ups of refused links wrongly ` +
        `tied ${movedTied} of ${movedJudged}; tie-allowed links still allowed when moved to a partner ` +
        `${tieMovedTied} of ${tieMovedJudged}`,
    );
    for (const l of left) console.log(`    left: ${l}`);
    floor(
      refused > 0 && tied > 0 && movedJudged > 0 && held > 0,
      `§8 ${variant}: refused ${refused}, tied ${tied}, held ${held}, moved ${movedJudged}`,
    );
  }
}

// ─── §6 tree writes (1e) ─────────────────────────────────────────────────────

const bareRef = (r: unknown) => (typeof r === "string" && r.startsWith("#") ? r.slice(1) : String(r ?? ""));
const nodeRefs = (node: any) =>
  ((node?.sources ?? []) as any[]).map((x) => x?.ref).filter((r): r is string => typeof r === "string" && r !== "");

/** The node an op writes: an update names it; an add is matched to the final
 *  tree's node on the person with the same type and date (a fact) or the same
 *  given name and surname (a name), since the dump keeps no assigned ids. */
function opNodeId(op: any, finalTree: any): string | null {
  if (typeof op.factId === "string") return op.factId;
  if (typeof op.nameId === "string") return op.nameId;
  const person = ((finalTree?.persons ?? []) as any[]).find((p) => p?.id === op.personId);
  if (op.fact) {
    const f = ((person?.facts ?? []) as any[]).find((x) => x?.type === op.fact.type && (x?.date ?? null) === (op.fact.date ?? null));
    return typeof f?.id === "string" ? f.id : null;
  }
  const n = ((person?.names ?? []) as any[]).find((x) => x?.given === op.name?.given && x?.surname === op.name?.surname);
  return typeof n?.id === "string" ? n.id : null;
}

/** The refs a node carried before an update, read by hand from the run log, for
 *  every update whose call is judged or refused differently when its updates are
 *  charged none or every one of their refs. Keyed `<run>#<call> <node id>`. */
const TRACED_PRIOR_REFS: ReadonlyMap<string, string[]> = new Map([
  // add_person at call 184 made N28 citing S5.
  ["antonio-lucas-spouse/run-2026-08-04_22-45-15.json#205 N28", ["S5"]],
  // Call 208 set F11's sources to S6.
  ["antonio-lucas-spouse/run-2026-08-04_22-45-15.json#214 F11", ["S6"]],
  // add_fact at call 206 made F13 citing S6.
  ["antonio-lucas-spouse/run-2026-08-04_22-45-15.json#214 F13", ["S6"]],
  // Call 205 set N28's sources to S6 and S5.
  ["antonio-lucas-spouse/run-2026-08-04_22-45-15.json#214 N28", ["S6", "S5"]],
  // add_person at call 184 made F12 citing S5; call 307, citing S9 too, was refused.
  ["antonio-lucas-spouse/run-2026-08-04_22-45-15.json#309 F12", ["S5"]],
  // materialize_facts made F1 from S1's record at call 62 and enriched it from S3's at call 125.
  ["ciriaco-bardales-spouse/run-2026-09-18_12-52-26.json#187 F1", ["S1", "S3"]],
  // materialize_facts made F1 from S1's record at call 72 and enriched it from S3's, the
  // other index entry for the burial, at call 73; S4 was registered at call 94.
  ["ignacio-alvarado-daughter/run-2026-09-10_14-16-30.json#145 F1", ["S1", "S3"]],
  // add_fact at call 171 made F3 citing S3; the dump matches it by a date call 219 changed.
  ["john-perry-witbeck-vitals/run-2026-07-24_23-52-08.json#219 F3", ["S3"]],
  // add_person at call 164 made F2 citing S3; call 163 was refused.
  ["susanna-szljacsan-spouse/run-2026-08-03_22-34-20.json#174 F2", ["S3"]],
  // add_fact at call 49 made F2 with no source; calls 43 and 44 were refused.
  ["wilkins-death-kentucky/run-2026-07-16_20-44-07.json#51 F2", []],
]);

/** The citations one op introduces, through the shipped `introducedCitations`.
 *  An add makes a new node, so it introduces every ref it cites. An update sets
 *  the node's `sources` to the op's and introduces the refs the node did not
 *  carry: `rebuilt` takes those from the starting tree and the run's earlier
 *  dumped ops only (an add or update of a fact or name citing a source), so a
 *  node made or changed by anything else (add_person, materialize_facts, a
 *  merge, an update citing nothing) has its earlier refs missed or stale.
 *  `all` charges an update with every ref it cites; the shipped check charges
 *  no more than that, and no less than the adds alone. `traced` overrides the
 *  rebuild with the refs read from the run log. `unseen`: an update on a node no
 *  dumped op or starting tree recorded. */
function opIntroduced(
  op: any,
  index: number,
  holders: ReadonlySet<string>,
  known: Map<string, string[]>,
  finalTree: any,
  traced?: string[],
) {
  const kind = op.fact ? "facts" : "names";
  const id = opNodeId(op, finalTree);
  const key = `${op.personId}|${kind}|${id}`;
  const node = { ...(op.fact ?? op.name), id: id ?? "(unmatched)" };
  const add = op.operation.startsWith("add_");
  const charge = (priorRefs: string[] | null) =>
    introducedCitations(
      { persons: [{ id: op.personId, [kind]: priorRefs === null ? [] : [{ id: node.id, sources: priorRefs.map((ref) => ({ ref })) }] }] },
      { persons: [{ id: op.personId, [kind]: [node] }] },
      holders,
      index,
    );
  const rebuilt = charge(add ? null : (traced ?? known.get(key) ?? []));
  const all = add ? rebuilt : charge([]);
  const unseen = !add && !known.has(key);
  if (id !== null) known.set(key, nodeRefs(node).map(bareRef));
  return { rebuilt, all, add, unseen };
}

function section6(lines: any[], states: FinalState[]): void {
  console.log(
    "\n§6  tree writes (1e: item 8 as ruled 2026-10-18, facts and names): each tree_edit add_fact or add_name and " +
      "tree_correct update_fact or update_name onto a person, citing a source ref, in a call that landed. Each op's " +
      "introduced citations come from the shipped `introducedCitations` (an update's refs less those the node carried " +
      "from the starting tree and the run's earlier dumped ops) and are judged by the shipped " +
      "`namesakeCitationRefusals` on the project as it stood at the call (as §3 builds it); a call is refused when " +
      "an op is. Ordering only: the call passes when judged on the run's final state, so writing the link first " +
      "would pass. Faithful: runs whose person_evidence the replay rebuilds exactly. Final: every such call, " +
      "unmeasured ones included, judged on the run's final state, which counts every link the run wrote. Refs " +
      "reaching no research source: refs the measured calls introduce that the check does not judge. Updates: the " +
      "dump keeps no tree, so the same counts with every update charged none of its refs, and every one of them; " +
      "the shipped check lies between",
  );
  const byRun = new Map(states.map((s) => [`${s.slug}/run-${s.run}.json`, s]));
  const faithful = new Set(lines.filter((l) => l.kind === "run" && l.fidelity).map((l) => l.run));
  const stripped = new Set(lines.filter((l) => l.kind === "run" && l.captures_stripped).map((l) => l.run));
  const tw = lines.filter((l) => l.kind === "treewrite" && byRun.has(l.run));
  for (const bracket of BRACKETS) {
    let calls = 0, judgedCalls = 0, refusedCalls = 0, orderingOnly = 0, faithfulJudged = 0, faithfulRefused = 0;
    let unmeasured = 0, finalJudged = 0, finalRefused = 0, judgedOps = 0, refusedOps = 0, unjudgedRefs = 0;
    let updates = 0, unseen = 0, tracedUsed = 0;
    const untraced: string[] = [];
    const netRisk: string[] = [];
    const endsOf = () => ({ finalJudged: 0, finalRefused: 0, finalSubject: 0, judged: 0, refused: 0 });
    const ends = { none: endsOf(), every: endsOf() };
    const subject: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    const finalSubject: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    const finalWhy: Record<string, number> = {};
    const fires: string[] = [];
    const finalFires: string[] = [];
    const updateFires: string[] = [];
    const known = new Map<string, Map<string, string[]>>();
    for (const l of tw) {
      const s = byRun.get(l.run)!;
      if (!known.has(l.run)) {
        const seed = new Map<string, string[]>();
        for (const p of (s.startTree.persons ?? []) as any[]) {
          for (const kind of ["facts", "names"] as const) {
            for (const n of (p?.[kind] ?? []) as any[]) {
              if (typeof n?.id === "string") seed.set(`${p.id}|${kind}|${n.id}`, nodeRefs(n).map(bareRef));
            }
          }
        }
        known.set(l.run, seed);
      }
      const holders = new Set(holdersIn(s, bracket));
      const traceKey = (op: any) => `${l.run}#${l.call} ${op?.factId ?? op?.nameId}`;
      const perOp = (l.ops as any[]).map((op, i) =>
        holders.has(op?.personId) ? opIntroduced(op, i, holders, known.get(l.run)!, s.finalTree, TRACED_PRIOR_REFS.get(traceKey(op))) : null,
      );
      if (!(l.ops as any[]).some((op) => holders.has(op?.personId))) continue;
      calls += 1;
      const nodeKeys = (l.ops as any[]).map((op) => op?.factId ?? op?.nameId).filter((k) => typeof k === "string");
      if (new Set(nodeKeys).size < nodeKeys.length || (l.removes ?? 0) > 0) netRisk.push(`${l.run} #${l.call}`);
      const introduced = perOp.flatMap((o) => o?.rebuilt ?? []);
      const atEnd = { none: perOp.flatMap((o) => (o?.add ? o.rebuilt : [])), every: perOp.flatMap((o) => o?.all ?? []) };
      const updateOps = (l.ops as any[]).filter((op, i) => perOp[i] && !perOp[i]!.add);
      updates += updateOps.length;
      unseen += perOp.filter((o) => o?.unseen).length;
      tracedUsed += updateOps.filter((op) => TRACED_PRIOR_REFS.has(traceKey(op))).length;
      const needTrace = () => {
        for (const op of updateOps) {
          const k = traceKey(op);
          if (!TRACED_PRIOR_REFS.has(k) && !untraced.includes(k)) untraced.push(k);
        }
      };
      const reaches = (cites: IntroducedCitation[], research: any) =>
        cites.some((c) => c.refs.some((ref) => refsReach([ref], research).sourceIds.size > 0));
      const fin = plantRows(s.research, [...holders].sort());
      const finalAtEnd = {
        none: namesakeCitationRefusals(fin, s.finalTree, atEnd.none, s.startingIds),
        every: namesakeCitationRefusals(fin, s.finalTree, atEnd.every, s.startingIds),
      };
      for (const end of ["none", "every"] as const) {
        if (reaches(atEnd[end], fin)) ends[end].finalJudged += 1;
        if (finalAtEnd[end].length === 0) continue;
        ends[end].finalRefused += 1;
        if (atEnd[end].some((c) => c.personId === s.subject)) ends[end].finalSubject += 1;
      }
      if (reaches(atEnd.none, fin) !== reaches(atEnd.every, fin) || (finalAtEnd.none.length > 0) !== (finalAtEnd.every.length > 0)) needTrace();
      const finalFindings = namesakeCitationRefusals(fin, s.finalTree, introduced, s.startingIds);
      const listDeciding = (when: string, findings: Array<{ index: number | null; message: string }>, why: string) => {
        for (const f of findings) {
          const op = (l.ops as any[])[f.index ?? -1] ?? {};
          if (op.operation?.startsWith("add_")) continue;
          const cited = /cites (\S+) \(research source '([^']+)'\)/.exec(f.message);
          updateFires.push(
            `${when}, ${why}: ${l.run} #${l.call} ${op.operation} ${op.factId ?? op.nameId} on ${op.personId}` +
              `${op.personId === s.subject ? " (subject)" : ""}${perOp[f.index ?? -1]?.unseen ? " (unseen node)" : ""}: ` +
              `${cited ? `${cited[1]}, research source ${cited[2]}` : f.message.slice(0, 80)}`,
          );
        }
      };
      const listJudging = (when: string, research: any) => {
        for (const c of introduced) {
          const op = (l.ops as any[])[c.index ?? -1] ?? {};
          const reached = c.refs.filter((ref) => refsReach([ref], research).sourceIds.size > 0);
          if (op.operation?.startsWith("add_") || reached.length === 0) continue;
          updateFires.push(
            `${when}, judged only through an update: ${l.run} #${l.call} ${op.operation} ${op.factId ?? op.nameId} on ` +
              `${op.personId}${perOp[c.index ?? -1]?.unseen ? " (unseen node)" : ""}: ${reached.join(", ")}`,
          );
        }
      };
      if (reaches(introduced, fin) && !reaches(atEnd.none, fin)) listJudging("final", fin);
      if (finalFindings.length > 0 && finalAtEnd.none.length === 0) listDeciding("final", finalFindings, "refused only through an update");
      if (finalAtEnd.every.length > 0 && finalFindings.length === 0) listDeciding("final", finalAtEnd.every, "refused only when an update is charged every ref");
      const judgedAtAll = reaches(introduced, fin);
      if (judgedAtAll) finalJudged += 1;
      if (finalFindings.length > 0) {
        finalRefused += 1;
        for (const f of finalFindings) {
          const why = f.message.includes("is not tied") ? "the cap refuses its links" : f.message.includes("records an absence") ? "an absent basis link" : "no probable or confident link";
          finalWhy[why] = (finalWhy[why] ?? 0) + 1;
          finalFires.push(`final ${l.run} #${l.call} ${l.tool}${introduced.some((c) => c.personId === s.subject) ? " (subject)" : ""}: ${why}`);
        }
        if (introduced.some((c) => c.personId === s.subject)) finalSubject[labelOf(s.slug)] += 1;
      }
      if (stripped.has(l.run) && (l.pe_before ?? []).length === 0) {
        unmeasured += 1;
        continue;
      }
      const w = mergeWorld(l, s);
      const planted = plantRows(w.research, [...holders].sort());
      const callAtEnd = {
        none: namesakeCitationRefusals(planted, w.tree, atEnd.none, w.startingIds),
        every: namesakeCitationRefusals(planted, w.tree, atEnd.every, w.startingIds),
      };
      for (const end of ["none", "every"] as const) {
        if (!reaches(atEnd[end], planted)) continue;
        ends[end].judged += 1;
        if (callAtEnd[end].length > 0) ends[end].refused += 1;
      }
      if (reaches(atEnd.none, planted) !== reaches(atEnd.every, planted) || (callAtEnd.none.length > 0) !== (callAtEnd.every.length > 0)) needTrace();
      const callFindings = namesakeCitationRefusals(planted, w.tree, introduced, w.startingIds);
      if (reaches(introduced, planted) && !reaches(atEnd.none, planted)) listJudging("at call time", planted);
      if (callFindings.length > 0 && callAtEnd.none.length === 0) listDeciding("at call time", callFindings, "refused only through an update");
      if (callAtEnd.every.length > 0 && callFindings.length === 0) listDeciding("at call time", callAtEnd.every, "refused only when an update is charged every ref");
      for (const c of introduced) {
        unjudgedRefs += c.refs.filter((ref) => refsReach([ref], planted).sourceIds.size === 0).length;
      }
      judgedOps += introduced.filter((c) => reaches([c], planted)).length;
      if (!reaches(introduced, planted)) continue;
      judgedCalls += 1;
      if (faithful.has(l.run)) faithfulJudged += 1;
      const findings = callFindings;
      if (findings.length === 0) continue;
      refusedOps += new Set(findings.map((f) => f.index)).size;
      refusedCalls += 1;
      if (faithful.has(l.run)) faithfulRefused += 1;
      if (finalFindings.length === 0) orderingOnly += 1;
      if (introduced.some((c) => c.personId === s.subject)) subject[labelOf(s.slug)] += 1;
      fires.push(`${l.run} #${l.call} ${l.tool}: ${findings.length} finding(s); ${findings[0].message.slice(0, 120)}`);
    }
    console.log(
      `  ${bracket}: ${calls} calls cite onto a row holder (${unmeasured} unmeasured: captures stripped, no links ` +
        `replayed); at call time ${judgedCalls} judged, ${refusedCalls} refused, ${orderingOnly} of them ordering only; ` +
        `in faithful runs ${faithfulRefused} of ${faithfulJudged}; ops ${refusedOps} of ${judgedOps} refused (calls ` +
        `onto the subject: hint the subject's own ${subject.true}, a namesake's ${subject.false}, unlabelled ` +
        `${subject.unlabelled}); refs reaching no research source ${unjudgedRefs}; final: ${finalRefused} of ` +
        `${finalJudged} calls refused (onto the subject: hint the subject's own ${finalSubject.true}, a namesake's ` +
        `${finalSubject.false}, unlabelled ${finalSubject.unlabelled})`,
    );
    console.log(`      final refusals by source: ${Object.entries(finalWhy).map(([k, n]) => `${k} ${n}`).join("; ") || "none"}`);
    const endText = (e: ReturnType<typeof endsOf>) =>
      `at call time ${e.refused} of ${e.judged}, final ${e.finalRefused} of ${e.finalJudged} (${e.finalSubject} onto the subject)`;
    const subjectRefused = finalSubject.true + finalSubject.false + finalSubject.unlabelled;
    const same =
      [ends.none, ends.every].every((e) => e.refused === refusedCalls && e.judged === judgedCalls) &&
      [ends.none, ends.every].every((e) => e.finalRefused === finalRefused && e.finalJudged === finalJudged && e.finalSubject === subjectRefused);
    console.log(
      `      updates: ${updates} ops, ${unseen} on a node no dumped op or starting tree recorded, ${tracedUsed} read ` +
        `from the run log (TRACED_PRIOR_REFS); charging none of their refs: ${endText(ends.none)}; charging every ` +
        `one: ${endText(ends.every)}` +
        (same
          ? "; the same as above either way, so no figure above depends on how an update's earlier refs are rebuilt"
          : untraced.length === 0
            ? "; every update that moves a count between the two is read from its run log, so the figures above are the shipped check's"
            : `; ${untraced.length} update(s) that move a count are not traced, so the figures above are estimates: ${untraced.join("; ")}`),
    );
    for (const f of VERBOSE ? fires : fires.slice(0, 12)) console.log(`      ${f}`);
    for (const f of VERBOSE ? finalFires : []) console.log(`      ${f}`);
    for (const f of VERBOSE ? updateFires : []) console.log(`      ${f}`);
    if (!VERBOSE && fires.length > 12) console.log(`      ... ${fires.length - 12} more (--verbose)`);
    if (bracket === "every linked person") floor(finalJudged > 0, "§6 judged no tree write");
    if (bracket === "every linked person") floor(updates > 0, "§6 saw no update, so its two ends bracket nothing");
    floor(untraced.length === 0, `§6 (${bracket}): an update moves a count and its earlier refs are not traced in TRACED_PRIOR_REFS`);
    floor(
      netRisk.length === 0,
      `§6 (${bracket}): a call writes one fact or name twice, or removes one, so judging it op by op can differ from ` +
        `the shipped check, which judges what the call adds as a whole: ${netRisk.join("; ")}`,
    );
  }
}

// ─── §3b the link checks a merge runs (#2537) ───────────────────────────────

let measuredMergeWorlds: MergeWorld[] = [];

/** Each §3 call through the shipped `mergeLinkCheckRefusals`, on the merged
 *  tree and the remapped research, with no namesake rows. Birth places resolve
 *  live, and a place that does not resolve counts as far apart, so an offline
 *  run is an upper bound on the contradiction cap. The project dir is empty, so
 *  no recorded score exists and every moved link carrying one is refused. */
async function section3b(): Promise<void> {
  console.log("\n§3b merge link checks: each §3 call through mergeLinkCheckRefusals, no rows planted");
  const scratch = mkdtempSync(join(tmpdir(), "merge-link-checks-"));
  let moved = 0;
  let refused = 0;
  let unmerged = 0;
  try {
    for (const w of measuredMergeWorlds) {
      const survivorOf = new Map(w.merges.map(([s, c]) => [c, s] as const));
      const live = ((w.research.person_evidence ?? []) as any[]).filter((e) => e && !e.superseded_by && survivorOf.has(e.person_id));
      moved += live.length;
      let merged: any;
      try {
        merged = mergeGedcomx(w.tree, null, w.merges);
      } catch (e) {
        unmerged += 1;
        console.log(`    ${w.line.run} #${w.line.call}: ${live.length} live links moved; the core refused the merge: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      const research = structuredClone(w.research);
      remapResearchPersonIds(research, new Map(survivorOf));
      const lines = await mergeLinkCheckRefusals(scratch, { research: w.research }, { research, tree: merged }, w.merges, w.startingIds);
      const findings = lines.filter((l) => l.startsWith("person_evidence"));
      refused += findings.length;
      console.log(`    ${w.line.run} #${w.line.call}: ${live.length} live links moved, ${findings.length} refused`);
      for (const f of findings) console.log(`      ${f}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`  links moved ${moved}, refused ${refused}; calls the core could not merge ${unmerged}`);
  floor(moved > 0, "§3b judged no moved link");
}

// ─── §7 item 10: the stamped namesake personas ──────────────────────────────

function section7(states: FinalState[]): void {
  const sum = { listed: 0, stamped: 0, absent: 0, wouldRefuse: 0, spared: 0 };
  const refusedByLabel: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
  let carrying = 0;
  for (const s of states) {
    if (!Array.isArray(s.research?.namesakes) || s.research.namesakes.length === 0) continue;
    carrying += 1;
    const c = personaStampCounts(s.research);
    for (const k of Object.keys(sum) as Array<keyof typeof sum>) sum[k] += c[k];
    refusedByLabel[labelOf(s.slug)] += c.wouldRefuse;
  }
  console.log(
    "\n§7  item 10 (PR 2): each committed e2e final state carrying rows, as written; the record_persona_ids " +
      "research_append stamped and what a refusal keyed on them would do",
  );
  console.log(`    final states carrying rows: ${carrying}`);
  console.log(
    `    (c) listed records stamped: ${sum.stamped} of ${sum.listed}; ` +
      `(d) unstamped though their row cites a persona search with a sidecar: ${sum.absent}`,
  );
  console.log(
    `    (a) probable or confident links a persona rule would refuse: ${sum.wouldRefuse} ` +
      `(hint is a namesake's: ${refusedByLabel.false}; the subject's own: ${refusedByLabel.true}; unlabelled: ${refusedByLabel.unlabelled})`,
  );
  console.log(`    (b) links on a listed record with another persona, which a record-id rule would refuse: ${sum.spared}`);
}

// ─── main ───────────────────────────────────────────────────────────────────

console.log(`measured at ${sha} (working tree of this checkout)\n`);
section0();
const { states, skipped } = finalStates();
console.log(`\nfinal states: ${states.length} (skipped ${skipped}: no fixture subject, or a document missing)`);
section1(states);
const lines = dumpCallStates();
shapesLine(lines);
section2(lines, states);
section3(lines, states);
await section3b();
section4(states);
section5(states);
section6(lines, states);
section7(states);
section8(states);
if (floorsFailed > 0) {
  console.log(`\n${floorsFailed} floor(s) failed`);
  process.exit(1);
}
