// Decision 31's one join (issue #3032): which tree object a proof-summary claim
// covers, and when two claims are about the same object. Every claim rule, the
// `primary` rule and the status lookup use it, so they cannot disagree.
//
// - Relationships: same type and endpoints; a Couple's pair is unordered. A
//   claim covers a tree edge whatever its subtype (Decision 32: an untyped claim
//   covers its pair); two claims are one object only when their subtypes agree,
//   untyped and Biological agreeing, so a Step claim and a denial of the
//   (biological) father do not collide.
// - Facts: same subject and type; dates by exact equality after `stdDate`
//   (written and ISO forms alike; the normalized text when `stdDate` returns
//   nothing); places compared most-specific-first, where one side may omit higher
//   jurisdictions but never names a finer place; value text normalized.
// - Names: normalized given name and surname.
// - Identity: the same record persona (`record_id` + `party`), or the same
//   `same_as` pair.
//
// A near miss (same subject and type, a differing date or place) never counts as
// the same object; `nearMiss` names both values so a message can say so.

import { stdDate } from "./date-standardize.js";
import { normalizeString } from "./string-similarity.js";
import { toTreeFactType } from "./record-persona.js";

type Pair = { person1: string; person2: string };

/** The subject of a fact claim as a sorted list of person ids (one, or a Couple's two). */
export function factSubjectIds(subject: unknown): string[] {
  if (typeof subject === "string") return [subject];
  if (subject && typeof subject === "object") {
    const { person1, person2 } = subject as Partial<Pair>;
    return [person1, person2].filter((p): p is string => typeof p === "string").sort();
  }
  return [];
}

/** A date compared by its standard form; the normalized text when it has none. */
export function joinDate(date: unknown): string | null {
  if (typeof date !== "string" || date.trim() === "") return null;
  const std = stdDate(date);
  return std !== "" ? std : normalizeString(date);
}

/** Place components, most specific first, normalized. */
export function placeTokens(place: unknown): string[] {
  if (typeof place !== "string") return [];
  return place.split(",").map((t) => normalizeString(t)).filter(Boolean);
}

/** The claim names the object's place, omitting higher jurisdictions at most. */
function placeCovers(claimPlace: string[], objectPlace: string[]): boolean {
  return claimPlace.length <= objectPlace.length && claimPlace.every((t, i) => objectPlace[i] === t);
}

function samePlace(a: unknown, b: unknown): boolean {
  const pa = placeTokens(a);
  const pb = placeTokens(b);
  if (pa.length === 0 || pb.length === 0) return pa.length === pb.length;
  return placeCovers(pa, pb) || placeCovers(pb, pa);
}

function sameText(a: unknown, b: unknown): boolean {
  const na = typeof a === "string" ? normalizeString(a) : "";
  const nb = typeof b === "string" ? normalizeString(b) : "";
  return na === nb;
}

/** Which slot of the tree a claim is about, before its values are compared. */
export function claimKind(claim: any): "relationship" | "fact" | "identity" | "name" | "finding" | null {
  for (const k of ["relationship", "fact", "identity", "name", "finding"] as const) {
    if (claim && typeof claim[k] === "object" && claim[k] !== null) return k;
  }
  return null;
}

function relationshipKey(r: any): string | null {
  if (r?.type === "ParentChild" && typeof r.parent === "string" && typeof r.child === "string") {
    return `ParentChild:${r.parent}>${r.child}`;
  }
  if (r?.type === "Couple") {
    const ids = factSubjectIds(r);
    return ids.length === 2 ? `Couple:${ids.join("+")}` : null;
  }
  return null;
}

/** Two claims on one ParentChild pair are about the same relationship when their
 *  subtypes agree, untyped and Biological agreeing. A Step and an untyped or
 *  Biological claim are different claims ("his stepfather, not his father"), so
 *  affirming one and denying the other is not a contradiction. Only the
 *  claim-to-claim form reads subtype: for status, rival verdicts and encoding an
 *  untyped claim covers its pair (Decision 32). */
export function sameSubtype(a: any, b: any): boolean {
  if (a?.type !== "ParentChild") return true;
  const norm = (v: unknown) => {
    const t = typeof v === "string" ? v.trim().toLowerCase() : "";
    return t === "" ? "biological" : t;
  };
  return norm(a.subtype) === norm(b.subtype);
}

/** A ParentChild claim reads biological: untyped or `Biological`. */
export function isBiologicalClaim(relationship: any): boolean {
  if (relationship?.type !== "ParentChild") return false;
  const sub = typeof relationship.subtype === "string" ? relationship.subtype.trim().toLowerCase() : "";
  return sub === "" || sub === "biological";
}

function factSlot(f: any): string | null {
  const ids = factSubjectIds(f?.subject);
  if (ids.length === 0 || typeof f?.fact_type !== "string") return null;
  return `${ids.join("+")}:${toTreeFactType(f.fact_type)}`;
}

/** Same subject and type, and every stated value equal (dates by standard form,
 *  places most-specific-first, value text normalized). */
function sameFactValues(a: any, b: any): boolean {
  const da = joinDate(a?.date);
  const db = joinDate(b?.date);
  if ((da === null) !== (db === null) || da !== db) return false;
  if (!samePlace(a?.place, b?.place)) return false;
  return sameText(a?.value, b?.value);
}

/** Two claims are about the same object. A claim with no object (a finding) is
 *  about nothing another claim can share. */
export function sameClaimObject(a: any, b: any): boolean {
  const kind = claimKind(a);
  if (kind === null || kind !== claimKind(b) || kind === "finding") return false;
  if (kind === "relationship") {
    const ka = relationshipKey(a.relationship);
    return ka !== null && ka === relationshipKey(b.relationship) && sameSubtype(a.relationship, b.relationship);
  }
  if (kind === "fact") {
    const sa = factSlot(a.fact);
    return sa !== null && sa === factSlot(b.fact) && sameFactValues(a.fact, b.fact);
  }
  if (kind === "name") {
    return (
      typeof a.name.person === "string" &&
      a.name.person === b.name.person &&
      sameText(a.name.given, b.name.given) &&
      sameText(a.name.surname, b.name.surname)
    );
  }
  const ia = a.identity;
  const ib = b.identity;
  if (typeof ia.same_as === "string" || typeof ib.same_as === "string") {
    const pa = [ia.person, ia.same_as].sort().join("+");
    const pb = [ib.person, ib.same_as].sort().join("+");
    return typeof ia.same_as === "string" && typeof ib.same_as === "string" && pa === pb;
  }
  return ia.record_id === ib.record_id && ia.party === ib.party && typeof ia.record_id === "string";
}

/** Same subject and type but a differing date or place: what a message names when
 *  it explains why one claim does not count as another. Null when not a near miss. */
export function nearMiss(a: any, b: any): { a: string; b: string } | null {
  if (claimKind(a) !== "fact" || claimKind(b) !== "fact") return null;
  const sa = factSlot(a.fact);
  if (sa === null || sa !== factSlot(b.fact) || sameFactValues(a.fact, b.fact)) return null;
  const show = (f: any) => [f?.date, f?.place, f?.value].filter((v) => typeof v === "string" && v).join(", ") || "(no value)";
  return { a: show(a.fact), b: show(b.fact) };
}

/** A relationship claim covers a tree edge: same type and endpoints, subtype ignored. */
export function claimCoversEdge(claim: any, edge: any): boolean {
  const key = relationshipKey(claim?.relationship);
  if (key === null) return false;
  return key === relationshipKey(edge);
}

/** A fact claim covers a tree fact held by `holderIds` (a person's id, or a
 *  Couple edge's two ids): same subject and type, a stated date equal to the fact's
 *  standard form, and a stated place naming the fact's place or a coarser form of
 *  it, never a finer one. A claim value the fact lacks never matches. */
export function claimCoversFact(claim: any, holderIds: readonly string[], fact: any): boolean {
  const f = claim?.fact;
  if (!f || typeof f.fact_type !== "string" || typeof fact?.type !== "string") return false;
  const subject = factSubjectIds(f.subject);
  if (subject.length === 0 || subject.join("+") !== [...holderIds].sort().join("+")) return false;
  if (toTreeFactType(f.fact_type) !== fact.type) return false;
  // A fact carries its text as written and, often, a standardized form; a claim
  // copied from either is the same value ("about 1882" against standard "1882";
  // a written place beside a resolver's standard_place, right or wrong).
  const claimDate = joinDate(f.date);
  if (claimDate !== null && ![fact.standard_date, fact.date].some((d) => joinDate(d) === claimDate)) return false;
  const claimPlace = placeTokens(f.place);
  if (claimPlace.length > 0 && ![fact.standard_place, fact.place].some((pl) => placeCovers(claimPlace, placeTokens(pl)))) {
    return false;
  }
  if (typeof f.value === "string" && f.value.trim() !== "" && !sameText(f.value, fact.value)) return false;
  return true;
}

/** A ParentChild claim at `possible` that sits beside a winner: another affirmed,
 *  biological ParentChild claim at `probable` or better on the same child whose
 *  parent has the same gender (Decision 9's "set aside in favour of"). Rule 11
 *  lets such a claim stay unground without holding its question open, and the
 *  status lookup reads the same predicate. */
export function setAsideRival(
  claim: any,
  allClaims: readonly any[],
  genderOf: (personId: string) => string | undefined,
): boolean {
  const r = claim?.relationship;
  if (!isBiologicalClaim(r) || claim.proof_tier !== "possible" || claim.polarity === "denied") return false;
  const gender = genderOf(r.parent);
  if (gender !== "Male" && gender !== "Female") return false;
  return allClaims.some((other) => {
    const o = other?.relationship;
    return (
      other !== claim &&
      isBiologicalClaim(o) &&
      o.child === r.child &&
      o.parent !== r.parent &&
      other.polarity !== "denied" &&
      (other.proof_tier === "probable" || other.proof_tier === "proved") &&
      gender !== undefined &&
      genderOf(o.parent) === gender
    );
  });
}

/** The first live `disproved` claim covering this edge, if any (Decision 10): a
 *  pair a proof summary rules out. */
export function disprovedClaimCovering(research: any, edge: any): { summaryId: string; label: string } | null {
  for (const s of Array.isArray(research?.proof_summaries) ? research.proof_summaries : []) {
    for (const [i, c] of (Array.isArray(s?.claims) ? s.claims : []).entries()) {
      // A disproof naming a subtype rules out only that subtype (Decision 32):
      // "not the biological father" leaves a Step edge free.
      const typed = typeof c?.relationship?.subtype === "string" && c.relationship.subtype.trim() !== "";
      if (c?.proof_tier === "disproved" && claimCoversEdge(c, edge) && (!typed || sameSubtype(c.relationship, edge))) {
        return { summaryId: String(s.id), label: typeof c.claim === "string" ? c.claim : `claims[${i}]` };
      }
    }
  }
  return null;
}
