// `primary` follows its claim (Decision 34 of docs/plan/conclusion-tree.md): a
// tree fact is the concluded value of its type only while a live affirmed claim
// at `probable` or better covers it, by Decision 31's join. Shared by
// research_append, which clears the flag when its covering claim goes, and the
// tree writers, which warn when they set it on a fact no claim covers.

import { claimCoversFact } from "./claim-join.js";
import { PROOF_TIER_RANK } from "../validation/validator.js";

export type PrimaryHolder = { personId: string } | { relationshipId: string };

export interface PrimaryFact {
  holder: PrimaryHolder;
  holderIds: string[];
  fact: any;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const PROBABLE = PROOF_TIER_RANK.get("probable") ?? 3;

/** Every live affirmed claim at `probable` or better, across all summaries. */
export function probableClaims(research: any): any[] {
  return arr(research?.proof_summaries)
    .flatMap((s) => arr(s?.claims))
    .filter(
      (c) =>
        c &&
        typeof c === "object" &&
        c.polarity !== "denied" &&
        c.proof_tier !== "disproved" &&
        (typeof c.proof_tier === "string" ? PROOF_TIER_RANK.get(c.proof_tier) ?? -1 : -1) >= PROBABLE,
    );
}

/** Whether any of `claims` covers this fact on this holder. */
export function claimedFact(claims: readonly any[], holderIds: readonly string[], fact: any): boolean {
  return claims.some((c) => claimCoversFact(c, holderIds, fact));
}

/** Every fact in the tree, person facts and Couple facts, with its holder. */
export function treeFacts(tree: any): PrimaryFact[] {
  const out: PrimaryFact[] = [];
  for (const p of arr(tree?.persons)) {
    if (typeof p?.id !== "string") continue;
    for (const f of arr(p.facts)) out.push({ holder: { personId: p.id }, holderIds: [p.id], fact: f });
  }
  for (const r of arr(tree?.relationships)) {
    if (r?.type !== "Couple" || typeof r.id !== "string") continue;
    const ids = [r.person1, r.person2].filter((x): x is string => typeof x === "string");
    for (const f of arr(r.facts)) out.push({ holder: { relationshipId: r.id }, holderIds: ids, fact: f });
  }
  return out;
}

/** Every `primary: true` fact in the tree. */
export function primaryFacts(tree: any): PrimaryFact[] {
  return treeFacts(tree).filter((x) => x.fact?.primary === true);
}

const holderKey = (h: PrimaryHolder) => ("personId" in h ? `p:${h.personId}` : `r:${h.relationshipId}`);

/** The same holder's fact with the same id in another tree, if any. */
export function factIn(tree: any, holder: PrimaryHolder, factId: unknown): any | undefined {
  if (typeof factId !== "string") return undefined;
  const key = holderKey(holder);
  return treeFacts(tree).find((x) => holderKey(x.holder) === key && x.fact?.id === factId)?.fact;
}

/** The `{personId|relationshipId, factId}` target a finding names. */
export function primaryTarget(x: PrimaryFact): { personId?: string; relationshipId?: string; factId?: string } {
  return { ...x.holder, ...(typeof x.fact?.id === "string" ? { factId: x.fact.id } : {}) };
}

const MOVED_FIELDS = ["type", "date", "standard_date", "place", "standard_place", "value"] as const;

/** The tree writers' `primary` rule (Decision 34): every fact this call left
 *  `primary` that no live affirmed claim at `probable` or better covers, where the
 *  call set the flag, or moved a claimed fact's type, date, place or value off its
 *  claim. A primary no claim covered before the call (legacy or imported) is not
 *  its finding when corrected (Decision 24). */
export function unclaimedPrimarySet(beforeTree: any, afterTree: any, research: any): PrimaryFact[] {
  const claims = probableClaims(research);
  return primaryFacts(afterTree).filter((x) => {
    if (claimedFact(claims, x.holderIds, x.fact)) return false;
    const prior = factIn(beforeTree, x.holder, x.fact?.id);
    if (prior?.primary !== true) return true;
    const moved = MOVED_FIELDS.some((k) => prior[k] !== x.fact?.[k]);
    return moved && claimedFact(claims, x.holderIds, prior);
  });
}

/** What `clearUnclaimedPrimary` did, and how to take it back. */
export interface PrimaryClearResult {
  mutated: boolean;
  cleared: PrimaryFact[];
  undo: () => void;
}

/** research_append's half of Decision 34: clear `primary` on each fact a live
 *  affirmed claim at `probable` or better covered before the call (the fact as
 *  it stood then) and none covers after it, whether the claim was lowered,
 *  denied, disproved or removed. A primary no claim covered before the call
 *  (legacy or imported) is untouched (Decision 24). Mutates `tree`. */
export function clearUnclaimedPrimary(beforeResearch: any, research: any, beforeTree: any, tree: any): PrimaryClearResult {
  const before = probableClaims(beforeResearch);
  const result: PrimaryClearResult = { mutated: false, cleared: [], undo: () => {} };
  if (before.length === 0) return result;
  const after = probableClaims(research);
  for (const x of primaryFacts(tree)) {
    const prior = factIn(beforeTree, x.holder, x.fact?.id) ?? x.fact;
    if (!claimedFact(before, x.holderIds, prior) || claimedFact(after, x.holderIds, x.fact)) continue;
    delete x.fact.primary;
    result.cleared.push(x);
  }
  result.mutated = result.cleared.length > 0;
  result.undo = () => {
    for (const x of result.cleared) x.fact.primary = true;
  };
  return result;
}
