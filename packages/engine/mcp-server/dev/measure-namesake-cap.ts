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
//   §4  the namesake warning (1d): each committed e2e final state, rows
//       written in one call on every person holding a live probable or
//       confident link, then on the fixture subject alone; what
//       `namesakeRowListings` lists.
//   §5  the materialize copy gate (1d): each persona op of a committed
//       materialize_facts call, judged by `personaTargetRefusal` on the
//       run's final state with and without the rows.
//   §6  tree writes (1e): each tree_edit or tree_correct op that cites a
//       source ref onto a person's fact or name, judged on the project at
//       the call with the shipped `namesakeVerdicts` and `refsReach`.
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
  mergeCarryRefusals,
  mergeDirections,
  mergeNamesakeRefusals,
  namesakeRowListings,
  namesakeVerdicts,
  refsReach,
  type NamesakeVerdicts,
  RELATIONAL_FACT_TYPES,
  unexplainedMoveInvariants,
} from "../src/tools/research-append.js";
import { isTwoParty } from "../src/utils/record-persona.js";
import { joinedPairRefusals, survivorOrderRefusals } from "../src/tools/merge-tree-persons.js";
import { startingPersonIdsOf } from "../src/utils/starting-tree.js";
import { personaTargetRefusal } from "../src/tools/materialize-facts.js";
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
}

// ─── §6 tree writes (1e) ─────────────────────────────────────────────────────

/** Whether a live probable or confident link from research source `src` to
 *  `personId` passes the cap, judged with `verdicts`. */
function sourcePasses(research: any, verdicts: NamesakeVerdicts | null, personId: string, src: string): boolean {
  const sourceOf = new Map<string, unknown>(
    ((research?.assertions ?? []) as any[]).filter((a) => typeof a?.id === "string").map((a) => [a.id, a.source_id]),
  );
  return ((research?.person_evidence ?? []) as any[]).some(
    (e) =>
      e &&
      !e.superseded_by &&
      e.person_id === personId &&
      STRONG.has(e.confidence) &&
      sourceOf.get(e.assertion_id) === src &&
      verdicts?.verdicts.get(e.id)?.allowed === true,
  );
}

function section6(lines: any[], states: FinalState[]): void {
  console.log(
    "\n§6  tree writes (1e: item 8 as ruled 2026-10-18, facts and names): each tree_edit add_fact or add_name and " +
      "tree_correct update_fact or update_name onto a person, citing a source ref, in a call that landed, judged on " +
      "the project as it stood at the call (as §3 builds it). A research source the op cites passes when a live " +
      "probable or confident link from it to the person is allowed by the cap; a ref that reaches no research " +
      "source is not judged. An op is refused when a source it cites does not pass, and a call when an op is. " +
      "Ordering only: on the run's final state each source that failed has such a link, so the call passes once " +
      "the link is written first. Faithful: runs whose person_evidence the replay rebuilds exactly. Final: every " +
      "such call, unmeasured ones included, judged the same way on the run's final state, which counts links " +
      "written after the call, so its refusals are a floor",
  );
  const byRun = new Map(states.map((s) => [`${s.slug}/run-${s.run}.json`, s]));
  const faithful = new Set(lines.filter((l) => l.kind === "run" && l.fidelity).map((l) => l.run));
  const stripped = new Set(lines.filter((l) => l.kind === "run" && l.captures_stripped).map((l) => l.run));
  const tw = lines.filter((l) => l.kind === "treewrite" && byRun.has(l.run));
  for (const bracket of BRACKETS) {
    let calls = 0, judgedCalls = 0, refusedCalls = 0, orderingOnly = 0, faithfulJudged = 0, faithfulRefused = 0;
    let judgedOps = 0, refusedOps = 0, unjudgedRefs = 0, unmeasured = 0, finalJudged = 0, finalRefused = 0;
    const finalSubject: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    const finalWhy: Record<string, number> = {};
    const finalFires: string[] = [];
    const subject: Record<string, number> = { true: 0, false: 0, unlabelled: 0 };
    const fires: string[] = [];
    for (const l of tw) {
      const s = byRun.get(l.run)!;
      const holders = new Set(holdersIn(s, bracket));
      const ops = (l.ops as any[]).filter((op) => holders.has(op?.personId));
      if (ops.length === 0) continue;
      calls += 1;
      {
        const fin = plantRows(s.research, [...holders].sort());
        let judged = false;
        let refused = false;
        for (const op of ops) {
          const p = String(op.personId);
          const refs = (((op.fact ?? op.name)?.sources ?? []) as any[]).map((x) => x?.ref).filter((r): r is string => typeof r === "string" && r !== "");
          const sources = refsReach(refs, fin).sourceIds;
          if (sources.size === 0) continue;
          judged = true;
          const v = namesakeVerdicts(p, fin, s.finalTree, { startingPersonIds: s.startingIds });
          const failedSrc = [...sources].filter((src) => !sourcePasses(fin, v, p, src));
          if (failedSrc.length === 0) continue;
          refused = true;
          if (p === s.subject) finalSubject[labelOf(s.slug)] += 1;
          for (const src of failedSrc) {
            const sourceOf = new Map<string, unknown>(((fin.assertions ?? []) as any[]).map((a) => [a?.id, a?.source_id]));
            const toP = ((fin.person_evidence ?? []) as any[]).filter(
              (e) => e && !e.superseded_by && e.person_id === p && sourceOf.get(e.assertion_id) === src,
            );
            const why = toP.some((e) => STRONG.has(e.confidence)) ? "the cap refuses its links" : toP.length > 0 ? "speculative only" : "no link from it";
            finalWhy[why] = (finalWhy[why] ?? 0) + 1;
            finalFires.push(`${l.run} #${l.call} ${op.operation} ${p}${p === s.subject ? " (subject)" : ""} ${src}: ${why}`);
          }
        }
        if (judged) finalJudged += 1;
        if (refused) finalRefused += 1;
      }
      if (stripped.has(l.run) && (l.pe_before ?? []).length === 0) {
        unmeasured += 1;
        continue;
      }
      const w = mergeWorld(l, s);
      const planted = plantRows(w.research, [...holders].sort());
      const finalPlanted = plantRows(s.research, [...holders].sort());
      let callJudged = false;
      let callRefused = false;
      let callOrderingOnly = true;
      for (const op of ops) {
        const p = String(op.personId);
        const node = op.fact ?? op.name;
        const refs = ((node?.sources ?? []) as any[]).map((x) => x?.ref).filter((r): r is string => typeof r === "string" && r !== "");
        const sources = new Set<string>();
        for (const ref of refs) {
          const reached = refsReach([ref], planted).sourceIds;
          if (reached.size === 0) unjudgedRefs += 1;
          for (const src of reached) sources.add(src);
        }
        if (sources.size === 0) continue;
        callJudged = true;
        judgedOps += 1;
        const verdicts = namesakeVerdicts(p, planted, w.tree, { startingPersonIds: w.startingIds });
        const failed = [...sources].filter((src) => !sourcePasses(planted, verdicts, p, src));
        if (failed.length === 0) continue;
        refusedOps += 1;
        callRefused = true;
        const finalVerdicts = namesakeVerdicts(p, finalPlanted, s.finalTree, { startingPersonIds: s.startingIds });
        if (!failed.every((src) => sourcePasses(finalPlanted, finalVerdicts, p, src))) callOrderingOnly = false;
        fires.push(`${l.run} #${l.call} ${l.tool} ${op.operation} ${p}${p === s.subject ? " (subject)" : ""}: ${failed.join(", ")}`);
        if (p === s.subject) subject[labelOf(s.slug)] += 1;
      }
      if (!callJudged) continue;
      judgedCalls += 1;
      if (faithful.has(l.run)) faithfulJudged += 1;
      if (!callRefused) continue;
      refusedCalls += 1;
      if (faithful.has(l.run)) faithfulRefused += 1;
      if (callOrderingOnly) orderingOnly += 1;
    }
    console.log(
      `  ${bracket}: ${calls} calls cite onto a row holder (${unmeasured} unmeasured: captures stripped, no links ` +
        `replayed); ${judgedCalls} judged, ${refusedCalls} refused, ${orderingOnly} of them ordering only; in faithful ` +
        `runs ${faithfulRefused} of ${faithfulJudged}; ops ${refusedOps} of ${judgedOps} refused (onto the subject: ` +
        `hint the subject's own ${subject.true}, a namesake's ${subject.false}, unlabelled ${subject.unlabelled}); ` +
        `refs reaching no research source ${unjudgedRefs}; final: ${finalRefused} of ${finalJudged} calls refused ` +
        `(ops onto the subject: hint the subject's own ${finalSubject.true}, a namesake's ${finalSubject.false}, ` +
        `unlabelled ${finalSubject.unlabelled})`,
    );
    console.log(`      final refusals by source: ${Object.entries(finalWhy).map(([k, n]) => `${k} ${n}`).join("; ") || "none"}`);
    for (const f of VERBOSE ? finalFires : []) console.log(`      final ${f}`);
    for (const f of VERBOSE ? fires : fires.slice(0, 12)) console.log(`      ${f}`);
    if (!VERBOSE && fires.length > 12) console.log(`      ... ${fires.length - 12} more (--verbose)`);
    if (bracket === "every linked person") floor(judgedCalls > 0, "§6 judged no tree write");
  }
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
section4(states);
section5(states);
section6(lines, states);
if (floorsFailed > 0) {
  console.log(`\n${floorsFailed} floor(s) failed`);
  process.exit(1);
}
