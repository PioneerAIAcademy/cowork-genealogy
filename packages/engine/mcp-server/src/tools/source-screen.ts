// MCP tool: source_screen
// See `docs/specs/source-screen-tool-spec.md`.
//
// One verdict per attachment on a tree person, from the project person mode
// built (`extraction_append({ personId })`). Read-only: it writes nothing to
// research.json, the tree, results/ or images/, and removes nothing.

import type { Principal } from "../auth/principal.js";
import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";
import type { MatchPair, PairScore } from "../types/matcher.js";
import type {
  PartyScore,
  SourceScreenAttachment,
  SourceScreenCheck,
  SourceScreenInput,
  SourceScreenNotScored,
  SourceScreenResponse,
  SourceScreenSignals,
  SourceScreenVerdict,
} from "../types/source-screen.js";
import { RECORD_TOKEN, arkToBareId } from "../utils/ark.js";
import { isLiveAssertion } from "../utils/assertion-liveness.js";
import {
  type AttachmentSupport,
  factsDisagree,
  leaveOneOut,
  personaLinks,
  relationshipMatches,
  statedRelationships,
  supportOf,
  vitalAssertions,
} from "../utils/attachment-support.js";
import { matchPairs as realMatchPairs } from "../utils/matcher.js";
import { Mob } from "../utils/mob.js";
import { introducedByLink } from "../utils/persona-copy.js";
import { NoProjectError, noProjectResult, readProjectJson } from "../utils/project-io.js";
import { VITAL_EVENT, yearsOf } from "../utils/question-state.js";
import { personaFor, selectSubjectPersona } from "../utils/record-persona-select.js";
import { readStagedResults } from "../utils/results-staging.js";
import { collectSourceRefs, findAnchor } from "../utils/tree-person.js";
import { preferredName } from "../utils/name-helpers.js";
import { imageTranscribeTool } from "./image-transcribe.js";

export type { SourceScreenInput, SourceScreenResponse } from "../types/source-screen.js";

/** A leave-one-out score below this marks the attachment misattributed. The
 *  baseline's `DEFAULT_THRESHOLD`; reset from the planted-fixture measurement. */
export const MISATTRIBUTED_BELOW = 0.5;
/** A score from `MISATTRIBUTED_BELOW` up to this is the grey band: weak. */
export const WEAK_BELOW = 0.8;
/** Every image read finishes within this much of the call's entry (Cowork
 *  aborts an MCP call at 60 s). */
export const OCR_DEADLINE_MS = 45_000;

/** Whether an attachment gets the page-image read (check e): a or c called it
 *  misattributed, b raised any warning (an implausible one included — a wrong
 *  year in the index is what b sees first), or h names a contradiction. */
export function flaggedForImage(mis: readonly string[], soft: readonly string[], contradicts?: readonly string[]): boolean {
  return [...mis, ...soft].some((m) => m.startsWith("b:")) || mis.some((m) => /^[ac]:/.test(m)) || (contradicts?.length ?? 0) > 0;
}

export const ALL_CHECKS: readonly SourceScreenCheck[] = ["a", "b", "c", "e", "h"];

export interface SourceScreenOptions {
  /** The checks to run; all by default. Not on the MCP schema: the dev
   *  measurement script passes it to score a check's absence. */
  checks?: readonly SourceScreenCheck[];
  matchPairs?: typeof realMatchPairs;
  imageTranscribe?: typeof imageTranscribeTool;
  now?: () => number;
  deadlineMs?: number;
}

export const sourceScreenToolSchema = {
  name: "source_screen",
  description:
    "Screen every source attached to one tree person and return one verdict per attachment: " +
    "misattributed, indexing_error, contradicts (naming the other attachment), weak, fine, or " +
    "not_scored with its reason. Read-only: it changes nothing and removes nothing. Needs the " +
    "project's person mode first (extraction_append with personId); it reads those extracted " +
    "records, scores each against the person minus what only that record supports, and reads " +
    "the page image only for an attachment the rules already flagged.",
  inputSchema: {
    type: "object" as const,
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory holding research.json and tree.gedcomx.json.",
      },
      personId: {
        type: "string",
        description: "The person whose attachments to screen: a tree person id (e.g. I1), or a FamilySearch id a tree person's ark links to.",
      },
    },
    required: ["projectPath", "personId"],
  },
} as const;

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const refOf = (raw: string) => (raw.startsWith("#") ? raw.slice(1) : raw);
const recordArk = (bare: string) => `ark:/61903/1:1:${bare}`;

interface Row {
  sourceId: string;
  level: "person" | "relationship";
  bare?: string;
  rels: any[];
  out: SourceScreenAttachment;
  // Set once the row is scorable.
  record?: any;
  recordBares?: Set<string>;
  personaId?: string;
  assertions?: any[];
  parties?: Array<{ personId: string; personaId: string }>;
  mis: string[];
  soft: string[];
}

function notScored(row: Row, reason: SourceScreenNotScored, sentence: string): void {
  row.out.verdict = "not_scored";
  row.out.reasons = [`${reason}: ${sentence}`];
}

function fullName(n: { given?: string; surname?: string } | undefined): string {
  return [n?.given, n?.surname].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
}

export async function sourceScreenTool(
  input: SourceScreenInput,
  principal: Principal,
  opts: SourceScreenOptions = {},
): Promise<SourceScreenResponse> {
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.deadlineMs ?? OCR_DEADLINE_MS);
  const on = new Set(opts.checks ?? ALL_CHECKS);
  const matchPairs = opts.matchPairs ?? realMatchPairs;
  const transcribe = opts.imageTranscribe ?? imageTranscribeTool;

  const personId = typeof input?.personId === "string" ? input.personId.trim() : "";
  if (personId === "") return { ok: false, errors: ["`personId` must be a non-empty tree or FamilySearch person id."] };
  let tree: SimplifiedGedcomX;
  let research: any;
  try {
    research = await readProjectJson(input.projectPath, "research.json");
    tree = await readProjectJson(input.projectPath, "tree.gedcomx.json");
  } catch (e) {
    if (e instanceof NoProjectError) return noProjectResult("read");
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  let person: SimplifiedPerson;
  try {
    person = findAnchor(arr(tree?.persons), personId);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  const pid = person.id as string;

  // ── the attachments: the person's own refs, then their relationships' ──
  const sourceById = new Map<string, any>(arr(tree.sources).filter((s) => typeof s?.id === "string").map((s) => [s.id, s]));
  const bareOf = (sid: string): string | undefined => {
    const m = RECORD_TOKEN.exec(String(sourceById.get(sid)?.url ?? ""));
    return m ? m[1].toUpperCase() : undefined;
  };
  const rows: Row[] = [];
  const bySid = new Map<string, Row>();
  const addRow = (sid: string, level: "person" | "relationship", rel?: any) => {
    const held = bySid.get(sid);
    if (held) {
      if (rel && held.level === "relationship") held.rels.push(rel);
      return;
    }
    const bare = bareOf(sid);
    const row: Row = {
      sourceId: sid, level, bare, rels: rel ? [rel] : [], mis: [], soft: [],
      out: { sourceId: sid, recordId: bare ? recordArk(bare) : null, level, verdict: "fine", reasons: [], signals: {} },
    };
    rows.push(row);
    bySid.set(sid, row);
  };
  for (const raw of collectSourceRefs(person)) addRow(refOf(raw), "person");
  for (const r of arr(tree.relationships)) {
    if (![r?.person1, r?.person2, r?.parent, r?.child].includes(pid)) continue;
    for (const s of arr(r?.sources)) if (typeof s?.ref === "string") addRow(refOf(s.ref), "relationship", r);
  }

  // ── the records person mode read, from its sidecars ──
  const records = new Map<string, { gedcomx: any; bares: Set<string> }>();
  for (const e of arr(research?.log)) {
    if (e?.tool !== "record_read" || typeof e?.results_ref !== "string") continue;
    let results: unknown[];
    try {
      results = await readStagedResults(input.projectPath, e.results_ref);
    } catch {
      continue;
    }
    for (const r of results as any[]) {
      const g = r?.gedcomx;
      if (!g) continue;
      const bares = new Set<string>(
        [r?.recordId, ...arr(g.persons).map((p: any) => p?.ark)]
          .filter((x): x is string => typeof x === "string" && x !== "")
          .map((x) => arkToBareId(x).toUpperCase()),
      );
      const entry = { gedcomx: g, bares };
      for (const b of bares) if (!records.has(b)) records.set(b, entry);
    }
  }
  const indexed = rows.filter((r) => r.bare);
  if (indexed.length > 0 && !indexed.some((r) => records.has(r.bare!))) {
    return {
      ok: false,
      errors: [
        `None of ${pid}'s ${indexed.length} attached indexed record${indexed.length === 1 ? " has" : "s have"} been read into this project. ` +
          `Run extraction_append({ projectPath, personId: "${personId}" }) first, then call source_screen again.`,
      ],
    };
  }

  // ── which persona of each record is the person ──
  const live = arr(research?.assertions).filter(isLiveAssertion);
  const links = personaLinks(research);
  const linkedTo = (bare: string, personaId: string): Set<string> => links.get(`${bare}\u0000${personaId}`) ?? new Set();
  for (const row of rows) {
    if (!row.bare) {
      notScored(row, "unindexed", "the attachment is not an indexed record (an image, a document or a link to another site).");
      continue;
    }
    const rec = records.get(row.bare);
    if (!rec) {
      notScored(row, "unreadable", "person mode holds no read of this record.");
      continue;
    }
    row.record = rec.gedcomx;
    row.recordBares = rec.bares;
    const ark = recordArk(row.bare);
    if (row.level === "person") {
      const p = personaFor(rec.gedcomx, ark);
      if (!p) {
        notScored(row, "reused_hint_no_persona", "no persona of the record carries the attachment's ARK.");
        continue;
      }
      row.personaId = p.id;
    } else {
      const entry = { ark, source_ids: [row.sourceId], level: "relationship" as const };
      const sel = selectSubjectPersona(tree as any, pid, entry, rec.gedcomx);
      if ("unscored" in sel) {
        if (sel.unscored === "record_unreadable") notScored(row, "reused_hint_no_persona", "no persona of the record carries the attachment's ARK.");
        else notScored(row, "ambiguous_party", `the person's persona cannot be chosen (${sel.unscored}).`);
        continue;
      }
      row.personaId = sel.persona_id;
      const parties: Array<{ personId: string; personaId: string }> = [];
      let unresolved: string | undefined;
      for (const r of row.rels) {
        for (const party of [r.person1, r.person2, r.parent, r.child]) {
          if (typeof party !== "string" || party === pid || parties.some((x) => x.personId === party)) continue;
          const ps = selectSubjectPersona(tree as any, party, entry, rec.gedcomx);
          if ("unscored" in ps) unresolved ??= `${party} (${ps.unscored})`;
          else parties.push({ personId: party, personaId: ps.persona_id });
        }
      }
      if (unresolved) {
        notScored(row, "ambiguous_party", `the persona of party ${unresolved} cannot be chosen.`);
        continue;
      }
      row.parties = parties;
    }
    row.out.personaId = row.personaId;
    row.assertions = live.filter(
      (a) => a?.record_persona_id === row.personaId && typeof a?.record_id === "string" && rec.bares.has(arkToBareId(a.record_id).toUpperCase()),
    );
    const linked = row.assertions.some((a) => linkedTo(arkToBareId(a.record_id), row.personaId!).has(pid));
    if (!linked) notScored(row, "unlinked", `persona ${row.personaId} has no live link to ${pid}.`);
  }
  const scored = rows.filter((r) => r.out.verdict !== "not_scored");

  // ── a, c: one matcher call for every pair ──
  const supports = new Map<string, AttachmentSupport>();
  const supportFor = (id: string) => {
    if (!supports.has(id)) supports.set(id, supportOf(tree, research, id));
    return supports.get(id)!;
  };
  const pairs: MatchPair[] = [];
  const pairIndex = new Map<string, number>();
  const pairFor = (row: Row, treePerson: string, personaId: string): number | undefined => {
    const key = `${row.sourceId}\u0000${treePerson}\u0000${personaId}`;
    if (pairIndex.has(key)) return pairIndex.get(key);
    try {
      const loo = leaveOneOut(tree, supportFor(treePerson), row.recordBares!);
      pairs.push({
        kind: "tree_record", tree: loo, pid: treePerson, rec: row.record, personaId,
        familysearchTree: new Mob(loo, treePerson).matchSubset().gedcomx,
      });
    } catch {
      return undefined;
    }
    pairIndex.set(key, pairs.length - 1);
    return pairs.length - 1;
  };
  const plan = new Map<Row, { a?: number; parties: Array<[{ personId: string; personaId: string }, number | undefined]> }>();
  for (const row of scored) {
    const p: { a?: number; parties: any[] } = { parties: [] };
    if (on.has("a")) p.a = pairFor(row, pid, row.personaId!);
    if (on.has("c")) for (const party of row.parties ?? []) p.parties.push([party, pairFor(row, party.personId, party.personaId)]);
    plan.set(row, p);
  }
  let scores: PairScore[] = [];
  let matcherError: string | undefined;
  if (pairs.length > 0) {
    try {
      scores = (await matchPairs(pairs, principal, { concurrency: 4, retry: false })).results;
    } catch (e) {
      matcherError = e instanceof Error ? e.message : String(e);
    }
  }
  const scoreAt = (i: number | undefined): number | null => (i === undefined ? null : (scores[i]?.score ?? null));
  const whyNot = (i: number | undefined): string =>
    i === undefined ? "the pair could not be built" : (matcherError ?? scores[i]?.error?.message ?? "not scored");

  // ── the per-attachment rules ──
  const treeName = fullName(preferredName(person.names));
  for (const row of scored) {
    const sig: SourceScreenSignals = row.out.signals;
    const p = plan.get(row)!;
    const persona = arr(row.record?.persons).find((x: any) => x?.id === row.personaId);
    const recName = preferredName(persona?.names) ?? {};
    if (on.has("a")) {
      const s = scoreAt(p.a);
      if (s === null) sig.a = { not_run: whyNot(p.a) };
      else {
        const band = s < MISATTRIBUTED_BELOW ? "below" : s < WEAK_BELOW ? "grey" : "clear";
        sig.a = { score: s, band };
        if (band === "below") row.mis.push(`a: leave-one-out score ${s.toFixed(2)} is below ${MISATTRIBUTED_BELOW}.`);
        else if (band === "grey") row.soft.push(`a: leave-one-out score ${s.toFixed(2)} is in the grey band.`);
      }
    }
    if (on.has("b") && row.assertions!.length > 0) {
      const first = row.assertions![0];
      const loo = leaveOneOut(tree, supportFor(pid), row.recordBares!);
      const warns = introducedByLink(research, loo, first.record_id, first.record_role, pid);
      sig.b = { impossible: warns.filter((w) => w.impossible).map((w) => w.sentence), implausible: warns.filter((w) => !w.impossible).map((w) => w.sentence) };
      for (const w of sig.b.impossible) row.mis.push(`b: ${w}`);
      for (const w of sig.b.implausible) row.soft.push(`b: ${w}`);
    }
    if (on.has("c")) {
      const parties: PartyScore[] = p.parties.map(([x, i]) => ({ ...x, score: scoreAt(i) }));
      const disagreements: string[] = [];
      for (const b of row.recordBares!) {
        for (const s of statedRelationships(research, links, b)) {
          if (s.from !== pid && s.to !== pid) continue;
          const between = arr(tree.relationships).filter(
            (r) => [r?.person1, r?.person2, r?.parent, r?.child].includes(s.from) && [r?.person1, r?.person2, r?.parent, r?.child].includes(s.to),
          );
          if (between.length > 0 && !between.some((r) => relationshipMatches(s.type, s.from, s.to, r))) {
            disagreements.push(`the record states ${s.from} is ${s.type} of ${s.to}; the tree relates them otherwise (${s.assertionId}).`);
          }
        }
      }
      sig.c = { parties, disagreements };
      for (const x of parties) {
        if (x.score !== null && x.score < MISATTRIBUTED_BELOW) row.mis.push(`c: party ${x.personId} scores ${x.score.toFixed(2)} against persona ${x.personaId}.`);
      }
      for (const d of disagreements) row.mis.push(`c: ${d}`);
    }
  }

  // ── h: attachments that contradict each other ──
  if (on.has("h")) {
    const vitals = new Map<Row, any[]>(scored.map((r) => [r, vitalAssertions(r.assertions ?? [])]));
    for (let i = 0; i < scored.length; i++) {
      for (let j = i + 1; j < scored.length; j++) {
        const x = scored[i], y = scored[j];
        if ([...x.recordBares!].some((b) => y.recordBares!.has(b))) continue;
        for (const event of new Set(Object.values(VITAL_EVENT))) {
          const xs = vitals.get(x)!.filter((a) => VITAL_EVENT[a.fact_type] === event);
          const ys = vitals.get(y)!.filter((a) => VITAL_EVENT[a.fact_type] === event);
          let year = false, place = false;
          for (const a of xs) for (const b of ys) {
            const d = factsDisagree(a, b);
            year ||= d.year;
            place ||= d.place;
          }
          for (const [aspect, hit] of [["year", year], ["place", place]] as const) {
            if (!hit) continue;
            const fact = `${event} ${aspect}`;
            for (const [me, other] of [[x, y], [y, x]] as const) {
              me.out.signals.h ??= { contradicts: [] };
              me.out.signals.h.contradicts.push({ sourceId: other.sourceId, fact });
            }
          }
        }
      }
    }
    // A disagreement with an attachment the rules already call misattributed is
    // that attachment's finding, not the other's: only the misattributed side
    // names it, so a wrong record does not mark every right one `contradicts`.
    const misattributed = new Set(scored.filter((r) => r.mis.length > 0).map((r) => r.sourceId));
    for (const row of scored) {
      const h = row.out.signals.h;
      if (!h) continue;
      const named = row.mis.length > 0 ? h.contradicts : h.contradicts.filter((c) => !misattributed.has(c.sourceId));
      if (named.length > 0) row.out.contradicts = [...new Set(named.map((c) => c.sourceId))];
    }
  }

  // ── e: the page image, for flagged attachments only ──
  const flagged = scored.filter((r) => flaggedForImage(r.mis, r.soft, r.out.contradicts));
  if (on.has("e")) {
    const sourcesById = new Map<string, any>(arr(research?.sources).map((s) => [s?.id, s]));
    await Promise.all(
      flagged.map(async (row) => {
        const imageArk = sourcesById.get(row.assertions?.[0]?.source_id)?.image_ark;
        if (typeof imageArk !== "string" || imageArk === "") {
          row.out.signals.e = { not_run: "no_image: the record's source has no page image" };
          return;
        }
        const vital = row.out.signals.h?.contradicts[0]?.fact ?? (row.mis.some((m) => m.startsWith("b:")) ? "birth year" : undefined);
        const treeYear = vital ? treeEventYear(person, vital.startsWith("death") ? "death" : "birth") : undefined;
        const lookingFor = treeYear ? `${treeName}, ${vital!.split(" ")[0]} ${treeYear}` : treeName;
        const remaining = deadline - now();
        if (remaining <= 0) {
          row.out.signals.e = { not_run: "budget" };
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), remaining);
        });
        const call = transcribe({ ark: imageArk, lookingFor }, principal, { ocrTimeoutMs: remaining }).then(
          (r) => ({ r }),
          (err: unknown) => ({ err }),
        );
        const out = await Promise.race([call, timeout]);
        clearTimeout(timer);
        if (out === "timeout") row.out.signals.e = { not_run: "budget" };
        else if ("err" in out) {
          const msg = out.err instanceof Error ? out.err.message : String(out.err);
          row.out.signals.e = { not_run: /already running .*transcription/i.test(msg) ? `slot_limit: ${msg}` : `error: ${msg}` };
        } else if ("ok" in out.r) row.out.signals.e = { not_run: `error: ${out.r.errors.join(" ")}` };
        else if (out.r.found) row.out.signals.e = { lookingFor, found: out.r.found };
        else row.out.signals.e = { not_run: "no_answer: the image read gave no FOUND / NOT FOUND" };
      }),
    );
  }

  // ── verdicts ──
  for (const row of scored) {
    const e = row.out.signals.e;
    const confirmed = e && "found" in e && e.found === "FOUND";
    let verdict: SourceScreenVerdict;
    if (confirmed) verdict = "indexing_error";
    else if (row.mis.length > 0) verdict = "misattributed";
    else if ((row.out.contradicts?.length ?? 0) > 0) verdict = "contradicts";
    else if (row.soft.length > 0) verdict = "weak";
    else verdict = "fine";
    const reasons = [...row.mis, ...row.soft];
    for (const c of row.out.signals.h?.contradicts ?? []) {
      if (row.out.contradicts?.includes(c.sourceId)) reasons.push(`h: ${c.fact} disagrees with ${c.sourceId}.`);
    }
    if (e && "found" in e) {
      reasons.push(
        e.found === "FOUND"
          ? `e: the page shows "${e.lookingFor}" as the tree has it, so the index is what differs.`
          : `e: the page does not show "${e.lookingFor}"; the index stands.`,
      );
    }
    row.out.verdict = verdict;
    row.out.reasons = reasons;
  }

  const counts: Partial<Record<SourceScreenVerdict, number>> = {};
  for (const row of rows) counts[row.out.verdict] = (counts[row.out.verdict] ?? 0) + 1;
  return { ok: true, personId: pid, attachments: rows.map((r) => r.out), counts };
}

/** The year of the person's tree birth or death, for an image read's search key. */
function treeEventYear(person: SimplifiedPerson, event: "birth" | "death"): number | undefined {
  for (const f of person.facts ?? []) {
    const t = String(f.type ?? "").split("/").pop()!.toLowerCase();
    if (VITAL_EVENT[t] !== event) continue;
    const y = yearsOf(f);
    if (y && Number.isFinite(y[0])) return y[0];
  }
  return undefined;
}
