// The claim rules of issue #3032 Stage 1b (docs/plan/conclusion-tree.md,
// "research_append preconditions", rules 1, 2 and 4-12). Each is decided from
// the documents alone. They land in warn mode (rule-modes.ts) and refuse from
// Stage 1c. Rule 3, the disproof floor, shipped refusing in Stage 1a.
//
// Read discipline, as every proof gate in research_append: assertions and
// person_evidence come from the PRE-CALL research (a batch may not supply a link
// and spend it in the same call); summaries and questions come from the final
// in-batch state, so two summaries written in one call see each other; the tree
// is the pre-call tree (research_append writes no edge).

import { recordBasisOf } from "../utils/record-basis.js";
import { toTreeFactType } from "../utils/record-persona.js";
import { recordIdOf, recordParties } from "../utils/settled-birth-disputes.js";
import { countsForProofGate } from "../utils/tree-person.js";
import { isLiveAssertion } from "../utils/assertion-liveness.js";
import { stdDate } from "../utils/date-standardize.js";
import { getDayRange } from "../utils/date-helpers.js";
import { claimCoversEdge, claimKind, factSubjectIds, isBiologicalClaim, sameClaimObject, setAsideRival } from "../utils/claim-join.js";
import { PROOF_TIER_RANK } from "./validator.js";

export const CLAIM_RULE_IDS = [
  "claims-rival-verdicts",
  "claims-one-per-slot",
  "claims-no-empty-escape",
  "claims-present",
  "claims-cite",
  "claims-grounding",
  "claims-absence",
  "claims-polarity",
  "claims-couple-first",
  "claims-capped-open",
  "claims-proved-identity",
] as const;
export type ClaimRuleId = (typeof CLAIM_RULE_IDS)[number];

export interface ClaimRuleContext {
  /** Every proof summary in the final in-batch state. */
  summaries: readonly any[];
  /** research.json as it stood before the call. */
  preCallResearch: any;
  /** tree.gedcomx.json as it stood before the call. */
  tree: any;
}

const TREE_OBJECT_KINDS = new Set(["relationship", "fact", "identity", "name"]);
const VITAL_TYPES = new Set(["Birth", "Christening", "Death", "Burial"]);
const COUPLE_EVENT_TYPES = new Set(["Marriage", "Divorce"]);
const CHILD_ROLE_TOKENS = new Set(["child", "son", "daughter"]);

const isSlotGender = (g: unknown): g is "Male" | "Female" => g === "Male" || g === "Female";

/** A role naming the record's child. Only the part before "of" names who the
 *  party is ("daughter_of_deceased" is a daughter; "father_of_child" is a father),
 *  and an in-law, step-, grand- or god-relation is not the child, however the
 *  role is written ("son_in_law", "daughter in law", "grand_child"). */
function isChildRole(role: unknown): boolean {
  const tokens = String(role ?? "").toLowerCase().split(/[_\s()\-]+/).filter(Boolean);
  const ofAt = tokens.indexOf("of");
  const head = ofAt === -1 ? tokens : tokens.slice(0, ofAt);
  if (head.some((t, i) => t === "in" && head[i + 1] === "law")) return false;
  if (head.some((t) => t === "step" || t === "grand" || t === "god")) return false;
  return head.some((t) => CHILD_ROLE_TOKENS.has(t));
}

export const __isChildRoleForTests = isChildRole;

const rank = (tier: unknown) => (typeof tier === "string" ? PROOF_TIER_RANK.get(tier) ?? -1 : -1);
const atLeast = (tier: unknown, floor: string) => rank(tier) >= (PROOF_TIER_RANK.get(floor) ?? 99);
const isDenied = (c: any) => c?.polarity === "denied";
const isDisproved = (c: any) => c?.proof_tier === "disproved";
const isAffirmed = (c: any) => !isDenied(c) && !isDisproved(c);
const claimsOf = (summary: any): any[] =>
  (Array.isArray(summary?.claims) ? summary.claims : []).filter((c: any) => c && typeof c === "object");
const labelOf = (c: any, i: number) => (typeof c?.claim === "string" ? c.claim : `claims[${i}]`);
const citedIds = (c: any): string[] =>
  (Array.isArray(c?.supporting_assertion_ids) ? c.supporting_assertion_ids : []).filter(
    (id: unknown): id is string => typeof id === "string",
  );

/** The persons a claim names: both ends of a relationship, a fact's subject
 *  (or both spouses), an identity's person (and `same_as`), a name's person. */
export function namedPersons(claim: any): string[] {
  const k = claimKind(claim);
  if (k === "relationship") {
    const r = claim.relationship;
    return (r.type === "Couple" ? [r.person1, r.person2] : [r.parent, r.child]).filter(
      (p: unknown): p is string => typeof p === "string",
    );
  }
  if (k === "fact") return factSubjectIds(claim.fact.subject);
  if (k === "identity") {
    return [claim.identity.person, claim.identity.same_as].filter((p: unknown): p is string => typeof p === "string");
  }
  if (k === "name") return typeof claim.name.person === "string" ? [claim.name.person] : [];
  return [];
}

/** A denial's anchor: the person whose slot it contests (rule 7). */
function denialAnchors(claim: any): string[] {
  const k = claimKind(claim);
  if (k === "relationship") {
    const r = claim.relationship;
    return r.type === "Couple" ? namedPersons(claim) : typeof r.child === "string" ? [r.child] : [];
  }
  if (k === "fact") return factSubjectIds(claim.fact.subject);
  if (k === "identity") return namedPersons(claim);
  if (k === "name") return namedPersons(claim);
  return [];
}

/** What every rule reads from the pre-call research, computed once per call. */
class Evidence {
  readonly assertions = new Map<string, any>();
  private readonly links = new Map<string, Set<string>>();
  private readonly confidentLinks = new Map<string, Set<string>>();
  private readonly personaOf = new Map<string, string>();
  private readonly personaAssertions = new Map<string, string[]>();
  private readonly deniedTies = new Set<string>();

  constructor(preCallResearch: any, summaries: readonly any[]) {
    const live = (Array.isArray(preCallResearch?.assertions) ? preCallResearch.assertions : []).filter(isLiveAssertion);
    for (const a of live) if (typeof a?.id === "string") this.assertions.set(a.id, a);
    for (const pe of Array.isArray(preCallResearch?.person_evidence) ? preCallResearch.person_evidence : []) {
      if (!countsForProofGate(pe) || typeof pe.assertion_id !== "string" || typeof pe.person_id !== "string") continue;
      add(this.links, pe.assertion_id, pe.person_id);
      if (pe.confidence === "confident") add(this.confidentLinks, pe.assertion_id, pe.person_id);
    }
    const byRecord = new Map<string, any[]>();
    for (const a of live) {
      const rid = recordIdOf(a);
      if (rid === null) continue;
      byRecord.set(rid, [...(byRecord.get(rid) ?? []), a]);
    }
    for (const [rid, list] of byRecord) {
      const { partyKey } = recordParties(list, rid);
      for (const a of list) {
        const key = `${rid}\u0000${partyKey(a) ?? `#${a.id}`}`;
        this.personaOf.set(a.id, key);
        this.personaAssertions.set(key, [...(this.personaAssertions.get(key) ?? []), a.id]);
      }
    }
    // A link from a persona a live denied identity claim covers does not count.
    for (const s of summaries) {
      for (const c of claimsOf(s)) {
        const idn = c.identity;
        if (!isDenied(c) || typeof idn?.record_id !== "string" || typeof idn.person !== "string") continue;
        this.deniedTies.add(`${idn.record_id}\u0000${idn.party ?? ""}\u0000${idn.person}`);
      }
    }
  }

  private denied(assertionId: string, personId: string): boolean {
    const key = this.personaOf.get(assertionId);
    if (key === undefined) return false;
    return this.deniedTies.has(`${key}\u0000${personId}`);
  }

  /** Persons a cited assertion links (live, confident or probable). */
  linkedFrom(ids: readonly string[], confidentOnly = false): Set<string> {
    const out = new Set<string>();
    const map = confidentOnly ? this.confidentLinks : this.links;
    for (const id of ids) for (const p of map.get(id) ?? []) if (!this.denied(id, p)) out.add(p);
    return out;
  }

  /** Persons the persona of `assertionId` is tied to: any of its assertions,
   *  cited or not, linked to them. */
  tiedTo(assertionId: string): Set<string> {
    const key = this.personaOf.get(assertionId);
    return this.linkedFrom(key === undefined ? [assertionId] : this.personaAssertions.get(key) ?? [assertionId]);
  }

  persona(assertionId: string): string | undefined {
    return this.personaOf.get(assertionId);
  }

  isAbsence(assertionId: string): boolean {
    const a = this.assertions.get(assertionId);
    return a !== undefined && recordBasisOf(a) === "absent";
  }
}

function add(map: Map<string, Set<string>>, key: string, value: string): void {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

/** Tree facts: a person's gender and biological parents. */
class Tree {
  private readonly gender = new Map<string, string>();
  readonly parentsByChild = new Map<string, Set<string>>();
  constructor(tree: any) {
    for (const p of Array.isArray(tree?.persons) ? tree.persons : []) {
      if (typeof p?.id === "string" && typeof p.gender === "string") this.gender.set(p.id, p.gender);
    }
    for (const r of Array.isArray(tree?.relationships) ? tree.relationships : []) {
      if (r?.type !== "ParentChild" || !isBiologicalClaim(r)) continue;
      if (typeof r.parent === "string" && typeof r.child === "string") add(this.parentsByChild, r.child, r.parent);
    }
  }
  genderOf = (id: string) => this.gender.get(id);
  /** A child's biological parents of one gender. Only Male and Female form a
   *  slot: two parents of unknown gender are not rivals. */
  sameGenderParents(child: string, gender: string | undefined): string[] {
    if (!isSlotGender(gender)) return [];
    return [...(this.parentsByChild.get(child) ?? [])].filter((p) => this.genderOf(p) === gender);
  }
}

/** Rule 7's verdict on one claim against one research document: null when the
 *  claim is grounded, else why it would stand at possible. */
export function claimGrounding(claim: any, research: any, summaries: readonly any[] = []): string | null {
  return groundingShortfall(claim, new Evidence(research, summaries));
}

/** The persons rule 7 finds the claim does not reach: each named person no cited
 *  assertion links, or, for a fact whose value persona is tied to no subject, that
 *  subject. Empty when the claim is grounded. The status lookup names them. */
export function claimUngroundedPersons(claim: any, research: any, summaries: readonly any[] = []): string[] {
  const ev = new Evidence(research, summaries);
  if (groundingShortfall(claim, ev) === null) return [];
  const cited = citedIds(claim).filter((id) => ev.assertions.has(id));
  const linked = ev.linkedFrom(cited);
  const unlinked = (isDenied(claim) ? denialAnchors(claim) : namedPersons(claim)).filter((p) => !linked.has(p));
  return unlinked.length > 0 ? unlinked : namedPersons(claim);
}

/** Rule 12 (Decision 30): the persons a `proved` claim names that are neither
 *  linked at confident from an assertion it cites nor covered by a proved
 *  identity claim whose own confident persona it cites. Empty when it holds. */
function provedWeakPersons(claim: any, ev: Evidence, allClaims: readonly any[]): string[] {
  const cited = citedIds(claim);
  const confident = ev.linkedFrom(cited, true);
  const coveredByIdentity = new Set<string>();
  for (const other of allClaims) {
    const idn = other?.identity;
    if (other?.proof_tier !== "proved" || isDenied(other) || typeof idn?.person !== "string") continue;
    const idCited = citedIds(other).filter((id) => ev.linkedFrom([id], true).has(idn.person));
    const persona = new Set(idCited.map((id) => ev.persona(id)));
    if (cited.some((id) => persona.has(ev.persona(id)))) coveredByIdentity.add(idn.person);
  }
  return namedPersons(claim).filter((p) => !confident.has(p) && !coveredByIdentity.has(p));
}

/** Decision 13: whether an identity claim records that `survivor` and `collapsed`
 *  are one person. Affirmed at probable or better, and either a `same_as` naming
 *  the pair whose cited assertions link to both, or a record identity naming one of
 *  them whose persona is tied to the other. Links are read as rule 7 reads them. */
export function identityCoversMerge(claim: any, research: any, summaries: readonly any[], survivor: string, collapsed: string): boolean {
  const idn = claim?.identity;
  if (!idn || isDenied(claim) || claim?.proof_tier === "disproved" || !atLeast(claim?.proof_tier, "probable")) return false;
  const ev = new Evidence(research, summaries);
  const pair = new Set([survivor, collapsed]);
  if (typeof idn.same_as === "string") {
    if (!pair.has(idn.person) || !pair.has(idn.same_as) || idn.person === idn.same_as) return false;
    return citedIds(claim).some((id) => {
      const linked = ev.linkedFrom([id]);
      return linked.has(survivor) && linked.has(collapsed);
    });
  }
  if (typeof idn.record_id !== "string" || !pair.has(idn.person)) return false;
  const other = idn.person === survivor ? collapsed : survivor;
  const persona = `${idn.record_id}\u0000${idn.party ?? ""}`;
  return citedIds(claim).some((id) => ev.persona(id) === persona && ev.tiedTo(id).has(other));
}

/** Rule 12 for the status lookup: a `proved` claim that would stand at probable. */
export function claimProvedCapped(claim: any, research: any, summaries: readonly any[] = []): boolean {
  if (claim?.proof_tier !== "proved") return false;
  const all = summaries.flatMap((s: any) => (Array.isArray(s?.claims) ? s.claims : []));
  return provedWeakPersons(claim, new Evidence(research, summaries), all).length > 0;
}

/** Rule 7's verdict on one claim: null when grounded, else why it would stand at possible. */
function groundingShortfall(claim: any, ev: Evidence): string | null {
  const kind = claimKind(claim);
  if (kind === null || !TREE_OBJECT_KINDS.has(kind)) return null;
  const cited = citedIds(claim).filter((id) => ev.assertions.has(id));
  const linked = ev.linkedFrom(cited);
  if (isDenied(claim)) {
    const anchors = denialAnchors(claim);
    if (!anchors.some((p) => linked.has(p))) {
      return `no assertion it cites is linked to ${anchors.join(" or ") || "its anchor"}, the person whose slot it contests`;
    }
    return kind === "fact" ? factValueShortfall(claim, cited, ev) : null;
  }
  const unlinked = namedPersons(claim).filter((p) => !linked.has(p));
  if (unlinked.length > 0) return `no assertion it cites is linked to ${unlinked.join(", ")}`;
  return kind === "fact" ? factValueShortfall(claim, cited, ev) : null;
}

/** A fact's value persona must be tied to its subject (each spouse, for a couple fact). */
function factValueShortfall(claim: any, cited: readonly string[], ev: Evidence): string | null {
  const type = toTreeFactType(String(claim.fact.fact_type ?? ""));
  const values = cited.filter((id) => {
    const a = ev.assertions.get(id);
    return a !== undefined && !ev.isAbsence(id) && typeof a.fact_type === "string" && toTreeFactType(a.fact_type) === type;
  });
  if (values.length === 0) return null;
  for (const person of factSubjectIds(claim.fact.subject)) {
    if (!values.some((id) => ev.tiedTo(id).has(person))) {
      return `no cited ${type} assertion (${values.join(", ")}) comes from a record persona tied to ${person}`;
    }
  }
  return null;
}

/** Each rule's findings on one summary, keyed by rule id. */
export function claimRuleFindings(summary: any, ctx: ClaimRuleContext): Map<ClaimRuleId, string[]> {
  const out = new Map<ClaimRuleId, string[]>();
  const push = (id: ClaimRuleId, m: string) => out.set(id, [...(out.get(id) ?? []), m]);
  const ev = new Evidence(ctx.preCallResearch, ctx.summaries);
  const tree = new Tree(ctx.tree);
  const claims = claimsOf(summary);
  const allClaims = ctx.summaries.flatMap((s) => claimsOf(s).map((c) => ({ c, summary: s })));
  const tier = summary?.tier;
  const concluding = atLeast(tier, "possible") || tier === "disproved";

  // Rule 5: claims present.
  if (concluding && claims.length === 0) {
    push("claims-present", `the summary is at '${tier}' and carries no claims; state the object it concludes as a claim (Decision 27).`);
  }

  // Rule 4: no empty escape on rivals.
  if (concluding && !claims.some((c) => TREE_OBJECT_KINDS.has(claimKind(c) ?? ""))) {
    const cited = new Set<string>([
      ...(Array.isArray(summary?.supporting_assertion_ids) ? summary.supporting_assertion_ids : []),
      ...claims.flatMap(citedIds),
    ]);
    const children = new Set<string>();
    for (const id of cited) {
      if (!isChildRole(ev.assertions.get(id)?.record_role)) continue;
      for (const p of ev.linkedFrom([id])) children.add(p);
    }
    for (const child of children) {
      for (const gender of ["Male", "Female"]) {
        const rivals = tree.sameGenderParents(child, gender);
        if (rivals.length >= 2) {
          push(
            "claims-no-empty-escape",
            `it concludes at '${tier}' with no relationship, fact, identity or name claim, while cited child ${child} has ` +
              `${rivals.length} ${gender === "Male" ? "fathers" : "mothers"} in the tree (${rivals.join(", ")}); state which ` +
              `one the answer affirms or sets aside, or decline at not_proved.`,
          );
        }
      }
    }
  }

  claims.forEach((c, i) => {
    const label = labelOf(c, i);
    const kind = claimKind(c);
    const cited = citedIds(c);

    // Rule 6: claims cite.
    if (atLeast(c.proof_tier, "possible") || isDenied(c) || isDisproved(c)) {
      const viaLogs =
        kind === "finding" &&
        (c.finding.finding_type === "absence" || c.finding.finding_type === "completeness") &&
        Array.isArray(c.finding.log_entry_ids) &&
        c.finding.log_entry_ids.length > 0;
      if (cited.length === 0 && !viaLogs) {
        push("claims-cite", `claim '${label}' cites no assertion; every claim at possible or better, every denial and every disproved claim cites at least one.`);
      }
    }

    const treeObject = TREE_OBJECT_KINDS.has(kind ?? "");

    // Rule 7: grounding.
    if (treeObject && atLeast(c.proof_tier, "probable") && !isDisproved(c)) {
      const why = groundingShortfall(c, ev);
      if (why !== null) push("claims-grounding", `claim '${label}' would stand at possible: ${why}.`);
    }

    // Rule 8: absence never grounds.
    if (treeObject && isAffirmed(c) && atLeast(c.proof_tier, "probable") && cited.length > 0) {
      const known = cited.filter((id) => ev.assertions.has(id));
      if (known.length > 0 && known.every((id) => ev.isAbsence(id))) {
        push("claims-absence", `claim '${label}' at '${c.proof_tier}' cites only absence evidence (${known.join(", ")}), which never grounds an affirmed claim.`);
      }
    }

    // Rule 12: proved needs confident identity.
    if (c.proof_tier === "proved" && treeObject) {
      const weak = provedWeakPersons(c, ev, allClaims.map(({ c: o }) => o));
      if (weak.length > 0) {
        push(
          "claims-proved-identity",
          `claim '${label}' would stand at probable: ${weak.join(", ")} is not linked at confident from an assertion it ` +
            `cites, nor covered by a proved identity claim whose persona it cites (Decision 30).`,
        );
      }
    }

    // Rule 10: couple first.
    if (kind === "fact" && isAffirmed(c) && atLeast(c.proof_tier, "probable")) {
      const type = toTreeFactType(String(c.fact.fact_type ?? ""));
      const pair = factSubjectIds(c.fact.subject);
      if (COUPLE_EVENT_TYPES.has(type) && pair.length === 2) {
        const couple = allClaims.some(
          ({ c: o }) =>
            o.relationship?.type === "Couple" &&
            isAffirmed(o) &&
            rank(o.proof_tier) >= rank(c.proof_tier) &&
            claimCoversEdge(o, { type: "Couple", person1: pair[0], person2: pair[1] }),
        );
        if (!couple) {
          push("claims-couple-first", `claim '${label}' affirms a ${type} of ${pair.join(" and ")} at '${c.proof_tier}' with no affirmed Couple claim on that pair at the same tier or better.`);
        }
      }
    }

    // Rule 1: rival verdicts.
    if (kind === "relationship" && isBiologicalClaim(c.relationship) && isAffirmed(c) && atLeast(c.proof_tier, "probable")) {
      const { parent, child } = c.relationship;
      const rivals = tree.sameGenderParents(child, tree.genderOf(parent)).filter((p) => p !== parent);
      for (const rival of rivals) {
        const verdict = allClaims.some(({ c: o }) => claimCoversEdge(o, { type: "ParentChild", parent: rival, child }));
        if (!verdict) {
          push("claims-rival-verdicts", `claim '${label}' concludes ${parent} as a parent of ${child} while rival parent ${rival} has no claim at any tier; record a verdict on ${rival} (Decision 8).`);
        }
      }
    }

    // Rule 9: polarity holds (affirmed against denied or disproved).
    if (treeObject && isAffirmed(c)) {
      for (const { c: o, summary: s } of allClaims) {
        if (o === c || !(isDenied(o) || isDisproved(o)) || !sameClaimObject(c, o)) continue;
        push("claims-polarity", `claim '${label}' affirms an object that claim '${o.claim}' in ${s?.id} ${isDisproved(o) ? "rules out" : "denies"}.`);
      }
    }
  });

  // Rule 9, persona half: one record persona affirmed at probable+ as two persons.
  const personaClaims = allClaims.filter(
    ({ c }) => typeof c.identity?.record_id === "string" && isAffirmed(c) && atLeast(c.proof_tier, "probable"),
  );
  for (const c of claims) {
    const idn = c.identity;
    if (typeof idn?.record_id !== "string" || !isAffirmed(c) || !atLeast(c.proof_tier, "probable")) continue;
    for (const { c: o, summary: s } of personaClaims) {
      const pairOnce = s !== summary || claims.indexOf(o) > claims.indexOf(c);
      if (o !== c && pairOnce && o.identity.record_id === idn.record_id && o.identity.party === idn.party && o.identity.person !== idn.person) {
        push("claims-polarity", `claim '${c.claim}' affirms record persona ${idn.record_id} (${idn.party}) as ${idn.person}, and claim '${o.claim}' affirms it as ${o.identity.person}.`);
      }
    }
  }

  // A pair inside this summary is reported once, from its earlier claim.
  const laterOrElsewhere = (c: any, o: any, s: any) => s !== summary || claims.indexOf(o) > claims.indexOf(c);

  // Rule 2: one answer per slot.
  for (const c of claims) {
    if (!isAffirmed(c) || !atLeast(c.proof_tier, "probable")) continue;
    if (isBiologicalClaim(c.relationship)) {
      const { parent, child } = c.relationship;
      const gender = tree.genderOf(parent);
      for (const { c: o, summary: s } of allClaims) {
        if (o === c || !laterOrElsewhere(c, o, s) || !isBiologicalClaim(o.relationship) || !isAffirmed(o) || !atLeast(o.proof_tier, "probable")) continue;
        if (o.relationship.child === child && o.relationship.parent !== parent && isSlotGender(gender) && tree.genderOf(o.relationship.parent) === gender) {
          push("claims-one-per-slot", `claim '${c.claim}' and claim '${o.claim}' both affirm a ${gender === "Male" ? "father" : "mother"} of ${child} at probable or better (${parent}, ${o.relationship.parent}).`);
        }
      }
    }
    if (claimKind(c) === "fact") {
      const type = toTreeFactType(String(c.fact.fact_type ?? ""));
      const subject = factSubjectIds(c.fact.subject);
      if (!VITAL_TYPES.has(type) || subject.length !== 1) continue;
      for (const { c: o, summary: s } of allClaims) {
        if (o === c || !laterOrElsewhere(c, o, s) || claimKind(o) !== "fact" || !isAffirmed(o) || !atLeast(o.proof_tier, "probable")) continue;
        if (toTreeFactType(String(o.fact.fact_type ?? "")) !== type || factSubjectIds(o.fact.subject).join("+") !== subject[0]) continue;
        if (!oneValue(c.fact.date, o.fact.date)) {
          push("claims-one-per-slot", `claim '${c.claim}' (${c.fact.date}) and claim '${o.claim}' (${o.fact.date}) both affirm a ${type} of ${subject[0]} at probable or better, and neither date contains the other.`);
        }
      }
    }
  }
  return out;
}

/** Two vital dates count as one value when one's unfudged day range contains the
 *  other's (Decision 3). An undated or unreadable value never conflicts. */
function oneValue(a: unknown, b: unknown): boolean {
  const ra = unfudgedRange(a);
  const rb = unfudgedRange(b);
  if (!ra || !rb) return true;
  return (ra.min <= rb.min && rb.max <= ra.max) || (rb.min <= ra.min && ra.max <= rb.max);
}

/** A date's unfudged day range: "Abt 1879" reads as 1879, while "Bef" and "Aft"
 *  are open-ended on their far side ("Aft 1898" is any day from 1898 on). */
function unfudgedRange(date: unknown): { min: number; max: number } | null {
  if (typeof date !== "string") return null;
  const std = stdDate(date);
  const range = getDayRange(std, 0, false);
  if (!range) return null;
  if (/^bef\b/i.test(std)) return { min: -Infinity, max: range.max };
  if (/^aft\b/i.test(std)) return { min: range.min, max: Infinity };
  return range;
}

/** Rule 11: a question set resolved while its summary holds an affirmed
 *  tree-object claim at possible or better that grounding holds at possible,
 *  except a rival set aside beside a winner. Keyed by summary id. */
export function questionCapFindings(question: any, ctx: ClaimRuleContext): { summaryId: string; messages: string[] }[] {
  const ev = new Evidence(ctx.preCallResearch, ctx.summaries);
  const tree = new Tree(ctx.tree);
  const allClaims = ctx.summaries.flatMap(claimsOf);
  const out: { summaryId: string; messages: string[] }[] = [];
  for (const s of ctx.summaries) {
    if (s?.question_id !== question?.id) continue;
    const messages: string[] = [];
    claimsOf(s).forEach((c, i) => {
      if (!TREE_OBJECT_KINDS.has(claimKind(c) ?? "") || !isAffirmed(c) || !atLeast(c.proof_tier, "possible")) return;
      if (setAsideRival(c, allClaims, tree.genderOf)) return;
      const why = groundingShortfall(c, ev);
      if (why !== null) {
        messages.push(`question ${question.id} is set resolved while claim '${labelOf(c, i)}' stands at possible because ${why}; leave the question open until it is linked.`);
      }
    });
    if (messages.length > 0) out.push({ summaryId: String(s.id), messages });
  }
  return out;
}
