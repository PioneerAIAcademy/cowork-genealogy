// Owed findings (Decision 33 of docs/plan/conclusion-tree.md): what a project
// still owes before its answer is complete, decided from the documents. Served
// as project_context.owedFindings; completion warns while a blocking item, or an
// `encode` item, is owed, and refuses only once Stage 1c has measured the rate.
//
// `nextStep` keeps the "unit — detail" shape every question-state arm uses: the
// unit is the agent that answers the item (the research skill routes an
// unencoded conclusion back to proof-conclusion, which encodes it with tree_edit).

import { liveAssertions, questionAssertions } from "./assertion-liveness.js";
import { claimCoversEdge, claimCoversFact, claimKind, factSubjectIds, setAsideRival } from "./claim-join.js";
import { normalizeString } from "./string-similarity.js";
import { countsForProofGate } from "./tree-person.js";
import { PROOF_TIER_RANK } from "../validation/validator.js";

export type OwedKind = "extract" | "conclude" | "hypothesis" | "encode" | "raise" | "claims" | "frame";

export interface OwedFinding {
  kind: OwedKind;
  ref: string;
  personIds: string[];
  nextStep: string;
  blocksCompletion: boolean;
}

const KIND_ORDER: readonly OwedKind[] = ["extract", "conclude", "hypothesis", "encode", "raise", "claims", "frame"];
const BLOCKING: ReadonlySet<OwedKind> = new Set(["conclude", "hypothesis"]);

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const rank = (tier: unknown) => (typeof tier === "string" ? PROOF_TIER_RANK.get(tier) ?? -1 : -1);
const isAffirmed = (c: any) => c?.polarity !== "denied" && c?.proof_tier !== "disproved";
const ENCODABLE = new Set(["relationship", "fact", "name"]);

/** Persons a set of assertions is linked to (live, confident or probable). */
function linkedPersons(research: any, assertionIds: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const pe of arr(research?.person_evidence)) {
    if (countsForProofGate(pe) && assertionIds.has(pe?.assertion_id) && typeof pe.person_id === "string") out.add(pe.person_id);
  }
  return [...out].sort();
}

/** A claim the tree already carries, by Decision 31's join. */
function encodedInTree(claim: any, tree: any): boolean {
  const kind = claimKind(claim);
  if (kind === "relationship") return arr(tree?.relationships).some((r) => claimCoversEdge(claim, r));
  if (kind === "fact") {
    const subject = factSubjectIds(claim.fact.subject);
    if (subject.length === 1) {
      const person = arr(tree?.persons).find((p) => p?.id === subject[0]);
      return arr(person?.facts).some((f) => claimCoversFact(claim, subject, f));
    }
    return arr(tree?.relationships).some(
      (r) => r?.type === "Couple" && arr(r.facts).some((f) => claimCoversFact(claim, [String(r.person1), String(r.person2)], f)),
    );
  }
  if (kind === "name") {
    const person = arr(tree?.persons).find((p) => p?.id === claim.name.person);
    const fold = (v: unknown) => (typeof v === "string" ? normalizeString(v) : "");
    return arr(person?.names).some(
      (n) =>
        (claim.name.given === undefined || fold(n?.given) === fold(claim.name.given)) &&
        (claim.name.surname === undefined || fold(n?.surname) === fold(claim.name.surname)),
    );
  }
  return true;
}

/** Every finding the project owes, in kind order. `tree` null skips `encode`. */
export function owedFindings(research: any, tree: any | null): OwedFinding[] {
  const items: OwedFinding[] = [];
  // `ref` carries the id; `nextStep` names none, so a reader can repeat it to the
  // researcher as it stands (lead, 2026-11-19, #4661).
  const add = (kind: OwedKind, ref: string, personIds: string[], nextStep: string) =>
    items.push({ kind, ref, personIds, nextStep, blocksCompletion: BLOCKING.has(kind) });

  const summaries = arr(research?.proof_summaries);
  const summarised = new Set(summaries.map((s) => s?.question_id));
  const questions = arr(research?.questions).filter(
    (q) => typeof q?.id === "string" && q.status !== "superseded",
  );

  for (const q of questions) {
    const tied = questionAssertions(research, q.id);
    // extract: a positive log entry on this question's plan item, with nothing extracted.
    // A page `image_transcribe` logged itself is a read, not a find (as questionStatus).
    if (tied.length === 0) {
      const itemIds = new Set(
        arr(research?.plans)
          .filter((p) => p?.question_id === q.id)
          .flatMap((p) => arr(p?.items).map((i) => i?.id)),
      );
      for (const e of arr(research?.log)) {
        if (
          e?.outcome === "positive" &&
          e?.written_by !== "image_transcribe" &&
          itemIds.has(e?.plan_item_id) &&
          typeof e.id === "string"
        ) {
          add("extract", e.id, [], "extraction — a positive search found a record for this question and nothing is extracted from it yet");
        }
      }
    }
    // conclude: tied assertions and no proof summary.
    if (tied.length > 0 && !summarised.has(q.id)) {
      const ids = new Set<string>(tied.map((a) => String(a.id)));
      add("conclude", q.id, linkedPersons(research, ids), `proof-conclusion — this question has ${tied.length} tied assertion(s) and no proof summary`);
    }
  }

  // hypothesis: supported, with no summary on any related question.
  for (const h of arr(research?.hypotheses)) {
    if (h?.status !== "supported" || typeof h.id !== "string") continue;
    const related = arr(h.related_question_ids);
    if (related.some((qid) => summarised.has(qid))) continue;
    add("hypothesis", h.id, [], "proof-conclusion — a supported hypothesis has no proof summary on a related question");
  }

  const allClaims = summaries.flatMap((s) => arr(s?.claims).filter((c) => c && typeof c === "object"));
  const genderOf = (id: string) => arr(tree?.persons).find((p) => p?.id === id)?.gender;
  for (const s of summaries) {
    const sid = String(s?.id);
    const claims = arr(s?.claims).filter((c) => c && typeof c === "object");
    claims.forEach((c, i) => {
      const label = typeof c.claim === "string" ? c.claim : `claims[${i}]`;
      const kind = claimKind(c);
      if (!kind || !ENCODABLE.has(kind) || !isAffirmed(c)) return;
      // encode: affirmed at probable or better, and no tree object carries it.
      if (tree && rank(c.proof_tier) >= rank("probable") && !encodedInTree(c, tree)) {
        add("encode", `${sid}/${label}`, [], `proof-conclusion — encode ${label}`);
      }
      // raise (advisory): affirmed at possible, not a rival set aside beside a winner.
      if (c.proof_tier === "possible" && !setAsideRival(c, allClaims, genderOf)) {
        add("raise", `${sid}/${label}`, [], `proof-conclusion — ${label} stands at possible`);
      }
    });
    // claims (advisory): a summary at possible or better, or disproved, stating none.
    if ((rank(s?.tier) >= rank("possible") || s?.tier === "disproved") && claims.length === 0) {
      add("claims", sid, [], "proof-conclusion — a proof summary states no claims");
    }
  }

  // frame (advisory): assertions exist and none is tied to any question.
  const live = liveAssertions(research);
  if (live.length > 0 && live.every((a) => arr(a?.extracted_for_question_ids).length === 0)) {
    add("frame", "project", [], `question-selection — no assertion is tied to any question`);
  }

  return KIND_ORDER.flatMap((k) => items.filter((x) => x.kind === k));
}
