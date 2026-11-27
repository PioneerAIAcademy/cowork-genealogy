// The circular-corroboration gate (issue #2943) over the committed e2e corpus, per
// ADR-0011 limit 2: what it refuses, with the definition of every figure printed
// beside it. Replays the shipped `circularCorroborationVerdict`; re-implements
// nothing.
//
//   npx tsx dev/measure-circular-corroboration.ts [--verbose]
//
//   §1  as committed: each live probable or confident `person_evidence` link in
//       each committed e2e final state, judged against that fixture's committed
//       starting tree (the baseline) with the run's final research and tree.
//       Prints every refusal. The committed starting trees were captured before
//       relationship sources existed (PR #3294), so this bracket mostly cannot
//       fire: it counts how many baseline relationships carry a source at all.
//   §2  planted: the same links, with each role-matched baseline relationship
//       given one source that is the linked record itself (what a doubted
//       attachment looks like once the tree carries edge sources). It measures
//       how many links the gate reaches (a role-matched relative the baseline
//       holds) and what clears them, which §1 cannot.
//   §3  planted, then cleared: the §2 edges also carry a source that is another
//       record, so the gate must refuse none.
//   §4  the audit arm (#4430), the §1 links with the questions re-marked:
//       unmarked (every `audits_tree` removed) must judge nothing by the audit
//       arm and refuse exactly what §1's role arms do;
//       every question marked is the upper bound, read as the over-fire figure;
//       questions whose text reads as an audit marked is the realistic bracket,
//       which undercounts (premise checks are marked too and the text misses
//       them). Final states see links made after each judged one, and most of
//       their questions are resolved, so both marked brackets read low against
//       write time.
//
// Exits non-zero when a floor fails: a bracket that judged or refused nothing
// would read as coverage and be none.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { arkToBareId } from "../src/utils/ark.js";
import { circularCorroborationVerdict } from "../src/tools/research-append.js";
import { repoRoot } from "./runlog-calls.js";

const VERBOSE = process.argv.includes("--verbose");
const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf-8", maxBuffer: 1 << 28 });
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

const STRONG = new Set(["probable", "confident"]);

interface State {
  slug: string;
  run: string;
  research: any;
  finalTree: any;
  baseline: any;
}

function finalStates(): State[] {
  const out: State[] = [];
  const files = git("ls-files", "eval/runlogs/e2e").split("\n").filter((f) => f.endsWith(".final-research.json"));
  for (const f of files) {
    const slug = basename(dirname(f));
    const research = readJson(f);
    const finalTree = readJson(f.replace(/\.final-research\.json$/, ".final-tree.gedcomx.json"));
    const baseline = readJson(`eval/tests/e2e/${slug}/starting-tree.gedcomx.json`);
    if (research && finalTree && baseline) out.push({ slug, run: basename(f).slice(4, 23), research, finalTree, baseline });
  }
  return out;
}

const liveStrong = (research: any): any[] =>
  ((research?.person_evidence ?? []) as any[]).filter(
    (e) => e && !e.superseded_by && STRONG.has(e.confidence) && typeof e.assertion_id === "string" && typeof e.person_id === "string",
  );

/** The baseline with one extra source on each edge between `personId` and a
 *  relative, and the research's assertion record as that source's url, or a
 *  different record's. */
function withEdgeSource(baseline: any, personId: string, relatives: string[], sourceId: string, url: string): any {
  const sources = [...(baseline.sources ?? []), { id: sourceId, title: "planted", url }];
  const relationships = ((baseline.relationships ?? []) as any[]).map((r) => {
    const ends = r?.type === "ParentChild" ? [r.parent, r.child] : r?.type === "Couple" ? [r.person1, r.person2] : [];
    return ends.includes(personId) && relatives.some((x) => ends.includes(x))
      ? { ...r, sources: [...(r.sources ?? []), { ref: sourceId }] }
      : r;
  });
  return { ...baseline, sources, relationships };
}

const states = finalStates();
console.log(`measured at ${sha}; ${states.length} committed e2e final states with a starting tree`);
floor(states.length > 0, "no committed e2e final state with a starting tree was read");

// ─── §1 ─────────────────────────────────────────────────────────────────────
const section1Refusals: string[] = [];
{
  let relationships = 0;
  let sourced = 0;
  for (const s of states) {
    for (const r of (s.baseline.relationships ?? []) as any[]) {
      relationships += 1;
      if (Array.isArray(r?.sources) && r.sources.length > 0) sourced += 1;
    }
  }
  let judged = 0;
  let applicable = 0;
  let relationship = 0;
  let subject = 0;
  const refusals = section1Refusals;
  for (const s of states) {
    for (const e of liveStrong(s.research)) {
      judged += 1;
      const v = circularCorroborationVerdict(e, s.research, s.finalTree, s.baseline);
      if (!v) continue;
      applicable += 1;
      if (v.kind === "relationship") relationship += 1;
      else if (v.kind === "subject") subject += 1;
      if (v.refused) refusals.push(`${s.slug} ${s.run} ${e.id} ${e.person_id} ${e.confidence} ${v.kind} record ${v.record}`);
    }
  }
  console.log(
    `\n§1  as committed: links judged ${judged} (live, probable or confident); the gate applies to ${applicable} ` +
      `(person in the starting tree, record and basis present): ${relationship} through a role-matched parent or spouse the ` +
      `baseline holds, ${subject} on the subject alone; refused ${refusals.length}`,
  );
  console.log(`    baseline relationships ${relationships}, carrying any source ${sourced}: the gate can fire only on those`);
  for (const r of refusals) console.log(`    REFUSED ${r}`);
  floor(judged > 0, "§1 judged no link");
  floor(applicable > 0, "§1 applied to no link");
}

// ─── §2, §3 ─────────────────────────────────────────────────────────────────
{
  let reached = 0;
  let refused = 0;
  let clearedByRecord = 0;
  let clearedNew = 0;
  const bySlug = new Map<string, number>();
  for (const s of states) {
    for (const e of liveStrong(s.research)) {
      const v = circularCorroborationVerdict(e, s.research, s.finalTree, s.baseline);
      if (!v || v.kind !== "relationship") continue;
      reached += 1;
      const a = (s.research.assertions ?? []).find((x: any) => x?.id === e.assertion_id);
      const url = `https://www.familysearch.org/${a.record_id}`;
      const ids = v.relatives.map((r) => r.id);
      // §2: the planted edge source is the record itself; the live tree is the baseline, so only a record can clear it.
      const planted = withEdgeSource(s.baseline, e.person_id, ids, "S_PLANT", url);
      const p = circularCorroborationVerdict(e, s.research, s.baseline, planted);
      if (p?.refused) {
        refused += 1;
        bySlug.set(s.slug, (bySlug.get(s.slug) ?? 0) + 1);
      } else if (p && p.relatives.some((r) => r.cleared)) clearedByRecord += 1;
      // §3: the live tree then gains an edge source that is another record.
      const live = withEdgeSource(planted, e.person_id, ids, "S_OTHER", "https://www.familysearch.org/ark:/61903/1:1:ZZZZ-ZZZ");
      const c = circularCorroborationVerdict(e, s.research, live, planted);
      if (c && !c.refused) clearedNew += 1;
      if (VERBOSE) console.log(`    ${s.slug} ${s.run} ${e.id} ${arkToBareId(a.record_id)} planted ${p?.refused ? "refused" : "allowed"}`);
    }
  }
  console.log(
    `\n§2  planted: ${reached} links reach a role-matched baseline relative; with each such edge sourced to the record ` +
      `alone, refused ${refused} in ${bySlug.size} fixtures; allowed because a record outside the entry already ties the ` +
      `person and the relative ${clearedByRecord}`,
  );
  console.log(`§3  planted then cleared by a new edge source that is another record: refused ${reached - clearedNew} of ${reached}`);
  floor(reached > 0, "§2 reached no link");
  floor(refused > 0, "§2 refused nothing: the gate is inert on real record shapes");
  floor(clearedNew === reached, "§3 refused a link its edge's other-record source should clear");
}

// ─── §4 ─────────────────────────────────────────────────────────────────────
{
  const AUDIT_TEXT = /confirm or refute|attribut|correctly identified|misattrib/i;
  const remark = (research: any, mark: (q: any) => boolean): any => ({
    ...research,
    questions: ((research?.questions ?? []) as any[]).map((q) => {
      const { audits_tree: _drop, ...rest } = q ?? {};
      return mark(q) ? { ...rest, audits_tree: true } : rest;
    }),
  });
  const bracket = (label: string, mark: (q: any) => boolean) => {
    let marked = 0;
    let judged = 0;
    let cleared = 0;
    const refusals: string[] = [];
    for (const s of states) {
      const research = remark(s.research, mark);
      marked += ((research.questions ?? []) as any[]).filter((q) => q.audits_tree === true).length;
      for (const e of liveStrong(research)) {
        const v = circularCorroborationVerdict(e, research, s.finalTree, s.baseline);
        if (v?.refused) refusals.push(`${s.slug} ${s.run} ${e.id} ${e.person_id} ${e.confidence} ${v.kind} record ${v.record}`);
        if (v?.kind !== "audit") continue;
        judged += 1;
        if (!v.refused) cleared += 1;
      }
    }
    const audit = refusals.filter((r) => r.includes(" audit record "));
    console.log(
      `§4  ${label}: questions marked ${marked}; links the audit arm judged ${judged} (confident, on a marked question, ` +
        `to a person whose starting tree cites the record), refused ${audit.length}, cleared ${cleared}; refused in all ${refusals.length}`,
    );
    for (const r of audit) console.log(`    REFUSED ${r}`);
    return { judged, refusals };
  };
  console.log("");
  const unmarked = bracket("unmarked", () => false);
  floor(unmarked.judged === 0, "§4 unmarked: the audit arm judged a link on a question nothing marks");
  // §1 judges the corpus's own markers, so its audit refusals are the only
  // ones removing every marker may take away.
  const roleRefusals = section1Refusals.filter((r) => !r.includes(" audit record "));
  floor(
    unmarked.refusals.length === roleRefusals.length && unmarked.refusals.every((r, i) => r === roleRefusals[i]),
    "§4 unmarked refuses other than §1's role-arm refusals: removing the corpus's own markers changed a role verdict",
  );
  bracket("realistic (question text reads as an audit)", (q) => AUDIT_TEXT.test(String(q?.question ?? "")));
  const upper = bracket("upper bound (every question marked)", () => true);
  floor(upper.judged > 0, "§4 upper bound judged no link: the audit arm is inert on real record shapes");
}

if (floorsFailed > 0) {
  console.log(`\n${floorsFailed} floor(s) failed`);
  process.exit(1);
}
