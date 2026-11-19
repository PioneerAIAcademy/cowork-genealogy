// The status of every tree fact and edge (Decision 6 of
// docs/plan/conclusion-tree.md), read from proof-summary claims, never from a
// tree field (Decision 4). Every claim reaches its tree object through
// claim-join.ts, Decision 31's one join; imports come from import-baseline.ts
// (Decision 7).

import { claimCoversEdge, claimCoversFact, claimKind, isBiologicalClaim, nearMiss } from "./claim-join.js";
import { importBaseline } from "./import-baseline.js";
import { claimProvedCapped, claimUngroundedPersons } from "../validation/claim-rules.js";
import { PROOF_TIER_RANK } from "../validation/validator.js";

export const STATUS_LABELS = {
  proved: "well established",
  probable: "likely",
  possible: "tentative",
  not_proved: "not established",
  disproved: "ruled out",
  import: "from your starting tree, not yet checked",
  found: "found in a record, not yet checked",
  legacy: "from an earlier finding, no claim recorded",
  doubted: "doubted",
} as const;

export interface StatusRow {
  holder: { personId: string } | { relationshipId: string };
  factId?: string;
  label: string;
  claim?: { summaryId: string; claim: string; tier: string; polarity?: string };
  winner?: string;
  rivalsWithoutVerdict?: string[];
  nearMiss?: { claim: string; claimValue: string; treeValue: string };
  subtypeLabel?: string;
}

interface Located {
  c: any;
  summaryId: string;
}

const rank = (tier: unknown) => (typeof tier === "string" ? PROOF_TIER_RANK.get(tier) ?? -1 : -1);
const isDenied = (c: any) => c?.polarity === "denied";
const isDisproved = (c: any) => c?.proof_tier === "disproved";
const isAffirmed = (c: any) => !isDenied(c) && !isDisproved(c);
const atLeastProbable = (c: any) => rank(c?.proof_tier) >= (PROOF_TIER_RANK.get("probable") ?? 3);
const slotGender = (g: unknown): g is "Male" | "Female" => g === "Male" || g === "Female";

function claimRef({ c, summaryId }: Located): StatusRow["claim"] {
  return { summaryId, claim: String(c.claim), tier: String(c.proof_tier), ...(isDenied(c) ? { polarity: "denied" } : {}) };
}

/** The strongest claim in `list` (by tier), ties to the first. */
function strongest(list: Located[]): Located | undefined {
  return list.reduce<Located | undefined>((best, x) => (best === undefined || rank(x.c.proof_tier) > rank(best.c.proof_tier) ? x : best), undefined);
}

/** A same-slot biological parent edge beside a winner: another parent of the same
 *  child and gender carrying an affirmed biological claim at probable or better,
 *  while this edge's best affirmed claim is possible or lower, or it carries a
 *  denial below the proof bar (Decision 9). Returns the winner's id, or null. */
export function setAsideBy(
  edge: any,
  located: readonly Located[],
  genderOf: (id: string) => string | undefined,
  edges?: readonly any[],
): string | null {
  if (edge?.type !== "ParentChild" || !isBiologicalClaim(edge)) return null;
  const gender = genderOf(String(edge.parent));
  if (!slotGender(gender)) return null;
  const own = located.filter(({ c }) => claimCoversEdge(c, edge));
  const bestAffirmed = strongest(own.filter(({ c }) => isAffirmed(c)));
  const belowBarDenial = own.some(({ c }) => isDenied(c));
  const ownWeak = bestAffirmed ? rank(bestAffirmed.c.proof_tier) <= rank("possible") : false;
  if (!ownWeak && !belowBarDenial) return null;
  if (bestAffirmed && atLeastProbable(bestAffirmed.c)) return null;
  for (const { c } of located) {
    const r = c?.relationship;
    if (!isAffirmed(c) || !atLeastProbable(c) || !isBiologicalClaim(r)) continue;
    if (r.child !== edge.child || r.parent === edge.parent || genderOf(r.parent) !== gender) continue;
    // With `edges`, a winner counts only when its own biological edge is in the tree.
    if (edges && !edges.some((o) => o !== edge && o?.type === "ParentChild" && isBiologicalClaim(o) && o.parent === r.parent && o.child === edge.child)) continue;
    return String(r.parent);
  }
  return null;
}

/** Every biological parent whose edge reads set aside (Decision 9) or ruled out
 *  (a `disproved` claim covers it, Decision 10), by child. The parent-count
 *  warnings and the competing-parentage refusal skip them (Decision 26), so a
 *  winner's edge lands beside a set-aside import. Empty with no claims: with no
 *  live summary nothing is skipped and the refusal still routes. */
export function setAsideParents(research: any, tree: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const summaries = Array.isArray(research?.proof_summaries) ? research.proof_summaries : [];
  const located: Located[] = summaries.flatMap((s: any) =>
    (Array.isArray(s?.claims) ? s.claims : [])
      .filter((c: any) => c && typeof c === "object")
      .map((c: any) => ({ c, summaryId: String(s.id) })),
  );
  if (located.length === 0) return out;
  const gender = new Map<string, string>();
  for (const p of Array.isArray(tree?.persons) ? tree.persons : []) {
    if (typeof p?.id === "string" && typeof p.gender === "string") gender.set(p.id, p.gender);
  }
  const genderOf = (id: string) => gender.get(id);
  const edges: any[] = Array.isArray(tree?.relationships) ? tree.relationships : [];
  for (const r of edges) {
    if (r?.type !== "ParentChild" || !isBiologicalClaim(r) || typeof r.parent !== "string" || typeof r.child !== "string") continue;
    const ruledOut = located.some(({ c }) => isDisproved(c) && claimCoversEdge(c, r));
    if (ruledOut || setAsideBy(r, located, genderOf, edges) !== null) {
      const set = out.get(r.child) ?? new Set<string>();
      set.add(r.parent);
      out.set(r.child, set);
    }
  }
  return out;
}

export function conclusionStatus(research: any, tree: any, startingTree: any | null): StatusRow[] {
  const summaries = Array.isArray(research?.proof_summaries) ? research.proof_summaries : [];
  const located: Located[] = summaries.flatMap((s: any) =>
    (Array.isArray(s?.claims) ? s.claims : [])
      .filter((c: any) => c && typeof c === "object")
      .map((c: any) => ({ c, summaryId: String(s.id) })),
  );
  const persons: any[] = Array.isArray(tree?.persons) ? tree.persons : [];
  const edges: any[] = Array.isArray(tree?.relationships) ? tree.relationships : [];
  const gender = new Map<string, string>();
  const nameOf = new Map<string, string>();
  for (const p of persons) {
    if (typeof p?.id !== "string") continue;
    if (typeof p.gender === "string") gender.set(p.id, p.gender);
    const n = (Array.isArray(p.names) ? p.names : [])[0];
    const display = [n?.given, n?.surname].filter((x: unknown) => typeof x === "string" && x.trim()).join(" ");
    nameOf.set(p.id, display || p.id);
  }
  const genderOf = (id: string) => gender.get(id);
  const baseline = importBaseline(tree, startingTree);

  /** The label an affirmed covering claim gives, grounding applied. */
  const affirmedLabel = (x: Located): string => {
    if (atLeastProbable(x.c)) {
      const missing = claimUngroundedPersons(x.c, research, summaries);
      if (missing.length > 0) return `tentative, not yet confirmed to be ${missing.map((p) => nameOf.get(p) ?? p).join(" and ")}`;
    }
    // Decision 30 (claim rule 12): a proved claim on a probable-only identity stands at probable.
    if (claimProvedCapped(x.c, research, summaries)) return STATUS_LABELS.probable;
    return STATUS_LABELS[x.c.proof_tier as keyof typeof STATUS_LABELS] ?? STATUS_LABELS.found;
  };

  /** A grounded denial at probable with no winner in its slot. */
  const doubting = (covering: Located[]): Located | undefined =>
    covering.find(({ c }) => isDenied(c) && atLeastProbable(c) && claimUngroundedPersons(c, research, summaries).length === 0);

  const rows: StatusRow[] = [];

  const factRow = (holder: StatusRow["holder"], holderIds: string[], fact: any) => {
    const covering = located.filter(({ c }) => claimKind(c) === "fact" && claimCoversFact(c, holderIds, fact));
    const row: StatusRow = { holder, ...(typeof fact?.id === "string" ? { factId: fact.id } : {}), label: "" };
    const ruledOut = covering.find(({ c }) => isDisproved(c));
    const best = strongest(covering.filter(({ c }) => isAffirmed(c)));
    const doubt = doubting(covering);
    if (ruledOut) {
      row.label = STATUS_LABELS.disproved;
      row.claim = claimRef(ruledOut);
    } else if (best) {
      row.label = affirmedLabel(best);
      row.claim = claimRef(best);
    } else if (doubt) {
      row.label = STATUS_LABELS.doubted;
      row.claim = claimRef(doubt);
    } else {
      row.label = baseline.isImportFact(holderIds, fact)
        ? STATUS_LABELS.import
        : fact?.primary === true
          ? STATUS_LABELS.legacy
          : STATUS_LABELS.found;
      const treeAsClaim = {
        fact: {
          subject: holderIds.length === 2 ? { person1: holderIds[0], person2: holderIds[1] } : holderIds[0],
          fact_type: fact?.type,
          date: fact?.standard_date ?? fact?.date,
          place: fact?.place,
          value: fact?.value,
        },
      };
      for (const { c } of located) {
        const miss = nearMiss(c, treeAsClaim);
        if (miss) {
          row.nearMiss = { claim: String(c.claim), claimValue: miss.a, treeValue: miss.b };
          break;
        }
      }
    }
    rows.push(row);
  };

  for (const p of persons) {
    if (typeof p?.id !== "string") continue;
    for (const f of Array.isArray(p.facts) ? p.facts : []) factRow({ personId: p.id }, [p.id], f);
  }

  for (const r of edges) {
    if (typeof r?.id !== "string") continue;
    const covering = located.filter(({ c }) => claimCoversEdge(c, r));
    const row: StatusRow = { holder: { relationshipId: r.id }, label: "" };
    const ruledOut = covering.find(({ c }) => isDisproved(c));
    const best = strongest(covering.filter(({ c }) => isAffirmed(c)));
    const winner = setAsideBy(r, located, genderOf, edges);
    const doubt = doubting(covering);
    if (ruledOut) {
      row.label = STATUS_LABELS.disproved;
      row.claim = claimRef(ruledOut);
    } else if (winner) {
      row.label = `set aside in favour of ${nameOf.get(winner) ?? winner}`;
      row.winner = winner;
      const own = strongest(covering);
      if (own) row.claim = claimRef(own);
    } else if (best) {
      row.label = affirmedLabel(best);
      row.claim = claimRef(best);
      // Decision 8: a parent shows as likely only after every rival has a verdict.
      if (r.type === "ParentChild" && isBiologicalClaim(r) && atLeastProbable(best.c) && slotGender(genderOf(r.parent))) {
        const rivals = edges
          .filter(
            (o) =>
              o !== r &&
              o?.type === "ParentChild" &&
              isBiologicalClaim(o) &&
              o.child === r.child &&
              o.parent !== r.parent &&
              genderOf(String(o.parent)) === genderOf(String(r.parent)),
          )
          .map((o) => String(o.parent))
          .filter((rival) => !located.some(({ c }) => claimCoversEdge(c, { type: "ParentChild", parent: rival, child: r.child })));
        if (rivals.length > 0) {
          row.label = STATUS_LABELS.possible;
          row.rivalsWithoutVerdict = rivals;
        }
      }
    } else if (doubt) {
      row.label = STATUS_LABELS.doubted;
      row.claim = claimRef(doubt);
    } else {
      row.label = baseline.isImportEdge(r) ? STATUS_LABELS.import : STATUS_LABELS.found;
    }
    // Decision 32: a typed edge's subtype is unchecked unless a claim names it.
    const sub = typeof r.subtype === "string" ? r.subtype.trim() : "";
    if (sub !== "") {
      const named = covering.some(({ c }) => String(c.relationship?.subtype ?? "").toLowerCase() === sub.toLowerCase());
      if (!named) row.subtypeLabel = STATUS_LABELS.import;
    }
    rows.push(row);
    for (const f of r.type === "Couple" && Array.isArray(r.facts) ? r.facts : []) {
      factRow({ relationshipId: r.id }, [String(r.person1), String(r.person2)], f);
    }
  }
  return rows;
}
