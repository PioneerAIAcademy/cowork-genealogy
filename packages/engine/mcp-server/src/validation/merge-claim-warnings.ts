// The merge's claim warnings (#3032 Stage 1b, Decision 13): a merge can leave
// the project's proof-summary claims in a state research_append's claim rules
// would warn about, or re-create a pair a claim rules out. Each such state the
// merge introduces is a synthetic warning the gate asks the caller to justify.
// Fires only where a summary carries claims.

import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { claimRuleFindings, type ClaimRuleId } from "./claim-rules.js";
import { disprovedClaimCovering } from "../utils/claim-join.js";
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
  // the merge's remap leaves alone.
  const toSurvivor = (text: string) =>
    text
      .split(/('[^']*')/)
      .map((part) =>
        part.startsWith("'")
          ? part
          : merges.reduce((t, [s, c]) => t.replace(new RegExp(`(?<![A-Za-z0-9_-])${escape(c)}(?![A-Za-z0-9_-])`, "g"), s), part),
      )
      .join("");
  const personFor = (text: string) =>
    survivors.find((s) => new RegExp(`(?<![A-Za-z0-9_-])${escape(s)}(?![A-Za-z0-9_-])`).test(text)) ?? survivors[0];
  const nameOf = (id: string) => {
    const p = (after.tree.persons ?? []).find((x) => x.id === id);
    return p ? getPersonName(p) : "";
  };

  const out = new Map<string, SyntheticWarning>();
  const add = (warningId: string, issueType: string, message: string) => {
    if (out.has(warningId)) return;
    const personId = personFor(message);
    out.set(warningId, { warningId, issueType, severity: "implausible", personId, personName: nameOf(personId), message });
  };

  const prior = new Set(findings(before).map((f) => `${f.summaryId}|${f.ruleId}|${toSurvivor(f.message)}`));
  for (const f of findings(after)) {
    if (prior.has(`${f.summaryId}|${f.ruleId}|${f.message}`)) continue;
    add(`mergeClaim|${f.ruleId}|${f.summaryId}|${hash8(f.message)}`, f.ruleId, `This merge leaves proof summary ${f.summaryId} in a state the claim rules warn about: ${f.message}`);
  }

  for (const r of arr(after.tree.relationships)) {
    if (typeof r?.id !== "string") continue;
    const ruled = disprovedClaimCovering(after.research, r);
    if (!ruled) continue;
    const priorEdge = arr(before.tree.relationships).find((b) => disprovedClaimCovering(before.research, b) && sameEnds(b, r, merges));
    if (priorEdge) continue;
    add(
      `mergeRuledOut|${r.id}`,
      "mergeRuledOut",
      `This merge makes relationship ${r.id} join a pair that proof summary ${ruled.summaryId} rules out (claim '${ruled.label}', disproved).`,
    );
  }
  return [...out.values()];
}

/** The same edge before and after the merge, ends compared through the collapse. */
function sameEnds(before: any, after: any, merges: ReadonlyArray<readonly [string, string]>): boolean {
  const map = new Map(merges.map(([s, c]) => [c, s]));
  const m = (id: unknown) => (typeof id === "string" ? map.get(id) ?? id : id);
  if (before?.type !== after?.type) return false;
  if (before.type === "ParentChild") return m(before.parent) === after.parent && m(before.child) === after.child;
  const a = [m(before.person1), m(before.person2)].sort().join("+");
  const b = [after.person1, after.person2].sort().join("+");
  return a === b;
}
