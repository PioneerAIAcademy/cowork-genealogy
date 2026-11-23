// The merge's claim warnings (#3032 Stage 1b, Decision 13): a merge can leave
// the project's proof-summary claims in a state research_append's claim rules
// would warn about, or re-create a pair a claim rules out. Each such state the
// merge introduces is a synthetic warning the gate asks the caller to justify.
// Fires only where a summary carries claims.

import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { claimRuleFindings, Evidence, identityCoversMerge, namedPersons, type ClaimRuleId } from "./claim-rules.js";
import { disprovedClaimCovering, disprovedClaimsCovering, sameSubtype } from "../utils/claim-join.js";
import { getPersonName } from "../tools/person-warnings.js";

export interface SyntheticWarning {
  warningId: string;
  issueType: string;
  severity: "implausible";
  personId: string;
  personName: string;
  message: string;
}

/** The claim rules a merge re-runs: one per slot (2), polarity (9), proved identity (12). */
const MERGE_RULES: readonly ClaimRuleId[] = ["claims-one-per-slot", "claims-polarity", "claims-proved-identity"];

interface Side {
  research: any;
  tree: SimplifiedGedcomX;
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A short stable hash, so a warning id survives the retry that justifies it. */
function hash8(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Every finding of the merge rules on one side, as `summaryId|ruleId|message`. */
function findings(side: Side): Array<{ summaryId: string; ruleId: ClaimRuleId; message: string }> {
  const summaries = arr(side.research?.proof_summaries);
  const out: Array<{ summaryId: string; ruleId: ClaimRuleId; message: string }> = [];
  const ctx = { summaries, preCallResearch: side.research, tree: side.tree };
  for (const s of summaries) {
    const found = claimRuleFindings(s, ctx);
    for (const ruleId of MERGE_RULES) {
      for (const message of found.get(ruleId) ?? []) out.push({ summaryId: String(s?.id), ruleId, message });
    }
  }
  return out;
}

/** The synthetic warnings this merge introduces. `before` is the pre-merge
 *  research and tree; `after` the remapped research and the merged tree. */
export function mergeClaimWarnings(before: Side, after: Side, merges: ReadonlyArray<readonly [string, string]>): SyntheticWarning[] {
  const hasClaims = arr(after.research?.proof_summaries).some((s) => arr(s?.claims).length > 0);
  if (!hasClaims) return [];

  const survivors = merges.map(([s]) => s);
  // Collapsed ids become their survivor, except inside quoted claim labels, which
  // the merge's remap leaves alone: each known label is set aside verbatim first.
  const labels = [
    ...new Set(
      arr(before.research?.proof_summaries)
        .flatMap((s) => arr(s?.claims))
        .map((c) => c?.claim)
        .filter((l): l is string => typeof l === "string" && l !== ""),
    ),
  ].sort((a, b) => b.length - a.length);
  const token = (id: string) => new RegExp(`(?<![A-Za-z0-9_-])${escape(id)}(?![A-Za-z0-9_-])`, "g");
  const toSurvivor = (text: string) => {
    const held: string[] = [];
    let t = text;
    for (const l of labels) {
      t = t.split(`'${l}'`).join(`\u0000${held.length}\u0000`);
      held.push(`'${l}'`);
    }
    t = merges.reduce((acc, [s, c]) => acc.replace(token(c), s), t);
    return t.replace(/\u0000(\d+)\u0000/g, (_m, i) => held[Number(i)]);
  };
  // The survivor a warning concerns: one the claims it quotes (or its edge) name,
  // else one its text names, else the first.
  const afterClaims = arr(after.research?.proof_summaries).flatMap((s) => arr(s?.claims));
  const personFor = (text: string, ends: readonly unknown[] = []): string => {
    const quoted = afterClaims.filter((c) => typeof c?.claim === "string" && text.includes(`'${c.claim}'`));
    const named = new Set<string>([...quoted.flatMap((c) => namedPersons(c)), ...ends.filter((e): e is string => typeof e === "string")]);
    return survivors.find((s) => named.has(s)) ?? survivors.find((s) => token(s).test(text)) ?? survivors[0];
  };
  const nameOf = (id: string) => {
    const p = (after.tree.persons ?? []).find((x) => x.id === id);
    return p ? getPersonName(p) : "";
  };

  const out = new Map<string, SyntheticWarning>();
  const add = (warningId: string, issueType: string, message: string, ends: readonly unknown[] = []) => {
    if (out.has(warningId)) return;
    const personId = personFor(message, ends);
    out.set(warningId, { warningId, issueType, severity: "implausible", personId, personName: nameOf(personId), message });
  };

  // Rule 12 lists a couple's persons sorted, so rewriting a collapsed id can
  // reorder a run of ids: compare each run of known person ids sorted.
  const ids = new Set(
    [...arr(before.tree.persons), ...arr(after.tree.persons)]
      .map((p) => p?.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const canon = (text: string) =>
    text.replace(/[A-Za-z0-9_-]+(?:, [A-Za-z0-9_-]+)+/g, (run) => {
      const parts = run.split(", ");
      return parts.every((p) => ids.has(p)) ? [...parts].sort().join(", ") : run;
    });
  const prior = new Set(findings(before).map((f) => `${f.summaryId}|${f.ruleId}|${canon(toSurvivor(f.message))}`));
  for (const f of findings(after)) {
    if (prior.has(`${f.summaryId}|${f.ruleId}|${canon(f.message)}`)) continue;
    add(`mergeClaim|${f.ruleId}|${f.summaryId}|${hash8(f.message)}`, f.ruleId, `This merge leaves proof summary ${f.summaryId} in a state the claim rules warn about: ${f.message}`);
  }

  for (const r of arr(after.tree.relationships)) {
    if (typeof r?.id !== "string") continue;
    const ruled = disprovedClaimCovering(after.research, r);
    if (!ruled) continue;
    // Already standing: a pre-merge edge of the pair that a claim still ruling
    // this edge out also covered. Every covering claim is compared, since with
    // two the merge can change which comes first.
    const key = (d: { summaryId: string; label: string }) => `${d.summaryId}|${d.label}`;
    const now = new Set(disprovedClaimsCovering(after.research, r).map(key));
    const priorEdge = arr(before.tree.relationships).find(
      (b) => sameEnds(b, r, merges) && disprovedClaimsCovering(before.research, b).some((d) => now.has(key(d))),
    );
    if (priorEdge) continue;
    add(
      `mergeRuledOut|${r.id}`,
      "mergeRuledOut",
      `This merge makes relationship ${r.id} join a pair that proof summary ${ruled.summaryId} rules out (claim '${ruled.label}', disproved).`,
      [r.parent, r.child, r.person1, r.person2],
    );
  }
  return [...out.values()];
}

/** The same pair before and after the merge, ends compared through the collapse.
 *  Subtype is left to the covering claims: the dedup can retype the kept edge. */
function sameEnds(before: any, after: any, merges: ReadonlyArray<readonly [string, string]>): boolean {
  const map = new Map(merges.map(([s, c]) => [c, s]));
  const m = (id: unknown) => (typeof id === "string" ? map.get(id) ?? id : id);
  if (before?.type !== after?.type) return false;
  if (before.type === "ParentChild") return m(before.parent) === after.parent && m(before.child) === after.child;
  const a = [m(before.person1), m(before.person2)].sort().join("+");
  const b = [after.person1, after.person2].sort().join("+");
  return a === b;
}

/** Decision 13: each merge pair no identity claim covers. A merge needs an
 *  identity decision, or the user's instruction quoted as its justification. Read
 *  on the pre-merge research; fires with no claims at all. */
export function mergeIdentityWarnings(before: Side, merges: ReadonlyArray<readonly [string, string]>): SyntheticWarning[] {
  const summaries = arr(before.research?.proof_summaries);
  const claims = summaries.flatMap((s) => arr(s?.claims));
  const nameOf = (id: string) => {
    const p = (before.tree.persons ?? []).find((x) => x.id === id);
    return p ? getPersonName(p) : "";
  };
  const out: SyntheticWarning[] = [];
  const ev = new Evidence(before.research, summaries);
  for (const [survivor, collapsed] of merges) {
    if (claims.some((c) => identityCoversMerge(c, before.research, summaries, survivor, collapsed, ev))) continue;
    out.push({
      warningId: `mergeIdentity|${survivor}|${collapsed}`,
      issueType: "mergeIdentity",
      severity: "implausible",
      personId: survivor,
      personName: nameOf(survivor),
      message:
        `Merging ${collapsed} into ${survivor} needs an identity decision: no identity claim at probable or better ` +
        "records that they are one person. Quote the user's instruction to merge as the justification, or have " +
        "proof-conclusion record the identity first.",
    });
  }
  return out;
}
