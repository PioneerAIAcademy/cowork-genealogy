// Which attached records support each tree name, fact and relationship.
//
// An imported tree fact cites no source, so "supported only by this record"
// cannot be read off the tree. This module infers it: a tree item is supported
// by every record whose live assertions, linked to the person, agree with it.
// `source_screen` uses it to score a record against the person minus what only
// that record supports (leave-one-out). Spec: docs/specs/source-screen-tool-spec.md.

import type { SimplifiedGedcomX, SimplifiedName, SimplifiedPerson } from "../types/gedcomx.js";
import { arkToBareId } from "./ark.js";
import { isLiveAssertion } from "./assertion-liveness.js";
import { lookupNameFamily, lookupNameVariants } from "./name-variants.js";
import { VITAL_EVENT, YEAR_TOLERANCE, placeForms, placesAgree, yearsOf } from "./question-state.js";
import { birthRangeFromAge } from "./record-extract.js";
import { normalizeString } from "./string-similarity.js";
import { patronymicVariants } from "./surname-variant-hints.js";

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Tree item key -> the bare record ids whose assertions agree with it. */
export interface AttachmentSupport {
  personId: string;
  names: Map<string, Set<string>>;
  facts: Map<string, Set<string>>;
  relationships: Map<string, Set<string>>;
}

const keyOf = (item: { id?: unknown } | undefined, i: number): string =>
  typeof item?.id === "string" && item.id !== "" ? item.id : `#${i}`;

/** A fact type on either side, lower-cased, without a URI prefix, with
 *  `birthplace`/`deathplace` folded into their event. */
export function foldFactType(type: unknown): string {
  const t = String(type ?? "").split("/").pop()!.trim().toLowerCase();
  return VITAL_EVENT[t] ?? t;
}

/** Whether two dated/placed facts of one type agree: no aspect disagrees and at
 *  least one agrees. Years agree within `YEAR_TOLERANCE`; places agree when the
 *  less specific one is contained in the other. */
export function factsAgree(x: any, y: any): boolean {
  const yx = yearsOf(x), yy = yearsOf(y);
  const yearOk = yx && yy ? !(yx[0] > yy[1] + YEAR_TOLERANCE || yy[0] > yx[1] + YEAR_TOLERANCE) : null;
  const px = placeForms(x), py = placeForms(y);
  const placeOk = px.length > 0 && py.length > 0 ? placesAgree(px, py) : null;
  if (yearOk === false || placeOk === false) return false;
  return yearOk === true || placeOk === true;
}

/** Whether two fact values disagree on year or place (both must be present). */
export function factsDisagree(x: any, y: any): { year: boolean; place: boolean } {
  const yx = yearsOf(x), yy = yearsOf(y);
  const year = !!(yx && yy) && (yx[0] > yy[1] + YEAR_TOLERANCE || yy[0] > yx[1] + YEAR_TOLERANCE);
  const px = placeForms(x), py = placeForms(y);
  const place = px.length > 0 && py.length > 0 && !placesAgree(px, py);
  return { year, place };
}

const firstToken = (s: string): string => normalizeString(s).split(" ")[0] ?? "";

/** Two given names the same, or related by the given-name tables
 *  (`lookupNameVariants`, `lookupNameFamily`): one lists the other, or both
 *  list three or more shared forms — Louis and Lewis share Lew, Lou and
 *  Louie. Two are not enough: Margaret and Mary share Mamie and May, which
 *  are nicknames of both. First name only. */
export function givenNamesRelated(a: string, b: string): "same" | "variant" | "different" {
  const x = firstToken(a), y = firstToken(b);
  if (x === "" || y === "") return "different";
  if (x === y) return "same";
  const forms = (p: string): Set<string> =>
    new Set([p, ...lookupNameVariants(p), ...(lookupNameFamily(p)?.allForms ?? [])].map(normalizeString));
  const fx = forms(x), fy = forms(y);
  return fx.has(y) || fy.has(x) || [...fx].filter((v) => fy.has(v)).length >= 3 ? "variant" : "different";
}

/** Two surnames the same, or one a -datter/-dotter abbreviation of the other
 *  (`patronymicVariants`). An abbreviating period is ignored. */
export function surnamesRelated(a: string, b: string): "same" | "variant" | "different" {
  const norm = (s: string) => normalizeString(s.replace(/\./g, ""));
  const x = norm(a), y = norm(b);
  if (x === "" || y === "") return "different";
  if (x === y) return "same";
  const related = (p: string, qn: string): boolean => patronymicVariants(p).some((v) => norm(v) === qn);
  return related(a, y) || related(b, x) ? "variant" : "different";
}

export type NameRelation = "same" | "variant" | "different" | "unknown";

/** How a record name relates to a tree name: `variant` when each part is the
 *  same or related by a variant table and at least one is only related. */
export function nameRelation(
  tree: { given?: string; surname?: string },
  rec: { given?: string; surname?: string },
): NameRelation {
  const tg = (tree.given ?? "").trim(), ts = (tree.surname ?? "").trim();
  const rg = (rec.given ?? "").trim(), rs = (rec.surname ?? "").trim();
  if ((tg === "" && ts === "") || (rg === "" && rs === "")) return "unknown";
  const parts: Array<"same" | "variant" | "different"> = [];
  if (tg !== "" && rg !== "") parts.push(givenNamesRelated(tg, rg));
  if (ts !== "" && rs !== "") parts.push(surnamesRelated(ts, rs));
  if (parts.length === 0) return "unknown";
  if (parts.includes("different")) return "different";
  return parts.includes("variant") ? "variant" : "same";
}

/** A name assertion's given name and surname: its structured value, else the
 *  last word of its value as the surname. */
export function assertionName(a: any): { given?: string; surname?: string } {
  const sv = a?.structured_value;
  if (sv && (typeof sv.given === "string" || typeof sv.surname === "string")) {
    return { given: sv.given, surname: sv.surname };
  }
  const words = String(a?.value ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return {};
  if (words.length === 1) return { given: words[0] };
  return { given: words.slice(0, -1).join(" "), surname: words[words.length - 1] };
}

const recordKey = (a: any): string => (typeof a?.record_id === "string" ? arkToBareId(a.record_id) : "");
const personaKey = (a: any): string => `${recordKey(a)}\u0000${a?.record_persona_id ?? ""}`;

/** Live person_evidence links: persona (record + persona id) -> tree person ids. */
export function personaLinks(research: any): Map<string, Set<string>> {
  const live = new Map<string, any>(arr(research?.assertions).filter(isLiveAssertion).map((a) => [a.id, a]));
  const out = new Map<string, Set<string>>();
  for (const pe of arr(research?.person_evidence)) {
    if (pe?.superseded_by != null || typeof pe?.person_id !== "string") continue;
    const a = live.get(pe.assertion_id);
    if (!a || typeof a.record_persona_id !== "string") continue;
    const k = personaKey(a);
    const s = out.get(k) ?? new Set<string>();
    s.add(pe.person_id);
    out.set(k, s);
  }
  return out;
}

/** A record's vital assertions for one persona, with a census age read as the
 *  birth window `birthRangeFromAge` gives when the record states no birth year. */
export function vitalAssertions(personaAssertions: readonly any[]): any[] {
  const out = personaAssertions.filter((a) => VITAL_EVENT[a?.fact_type]);
  const hasBirthYear = out.some((a) => VITAL_EVENT[a.fact_type] === "birth" && yearsOf(a) !== null);
  if (!hasBirthYear) {
    const age = personaAssertions.find((a) => a?.fact_type === "age");
    const event = personaAssertions.find((a) => /census|death|burial|marriage/.test(String(a?.fact_type ?? "")) && a?.date);
    const range = age && event ? birthRangeFromAge(age.value, event.date) : null;
    if (range) out.push({ ...age, fact_type: "birth", date: range.date, value: range.date, place: undefined, standard_place: undefined });
  }
  return out;
}

const REL_TYPE: Record<string, (x: string, y: string, r: any) => boolean> = {
  spouse: (x, y, r) => r?.type === "Couple" && ((r.person1 === x && r.person2 === y) || (r.person1 === y && r.person2 === x)),
  child: (x, y, r) => r?.type === "ParentChild" && r.child === x && r.parent === y,
  parent: (x, y, r) => r?.type === "ParentChild" && r.parent === x && r.child === y,
};

/** A record's stated relationships between linked tree persons: each relationship
 *  assertion whose persona and related persona both link to a tree person. */
export function statedRelationships(
  research: any,
  links: Map<string, Set<string>>,
  recordBare?: string,
): Array<{ record: string; type: string; from: string; to: string; assertionId: string }> {
  const live = arr(research?.assertions).filter(isLiveAssertion);
  const out: Array<{ record: string; type: string; from: string; to: string; assertionId: string }> = [];
  for (const a of live) {
    if (a?.fact_type !== "relationship") continue;
    const rec = recordKey(a);
    if (recordBare !== undefined && rec !== recordBare) continue;
    const type = a?.structured_value?.relationship_type;
    const role = a?.structured_value?.related_person_role;
    if (typeof type !== "string" || typeof role !== "string") continue;
    const related = live.find((b) => recordKey(b) === rec && b?.record_role === role && typeof b?.record_persona_id === "string");
    if (!related) continue;
    for (const from of links.get(personaKey(a)) ?? []) {
      for (const to of links.get(personaKey(related)) ?? []) {
        if (from !== to) out.push({ record: rec, type, from, to, assertionId: a.id });
      }
    }
  }
  return out;
}

/** Whether a tree relationship is the one a stated relationship names. */
export function relationshipMatches(type: string, from: string, to: string, r: any): boolean {
  return REL_TYPE[type]?.(from, to, r) ?? false;
}

/**
 * Map each of `personId`'s tree names and facts, and each relationship they are
 * an endpoint of, to the attached records whose live assertions linked to the
 * person agree with it. Names agree after the variant fold; facts agree on type
 * (birth/death folded), year within `YEAR_TOLERANCE` and place at any level;
 * a relationship agrees with a relationship assertion of its type naming both
 * parties' personas.
 */
export function supportOf(tree: SimplifiedGedcomX, research: any, personId: string): AttachmentSupport {
  const support: AttachmentSupport = { personId, names: new Map(), facts: new Map(), relationships: new Map() };
  const person: SimplifiedPerson | undefined = (tree?.persons ?? []).find((p) => p?.id === personId);
  if (!person) return support;
  const links = personaLinks(research);
  const mine = new Set<string>();
  for (const [k, who] of links) if (who.has(personId)) mine.add(k);
  const byPersona = new Map<string, any[]>();
  for (const a of arr(research?.assertions).filter(isLiveAssertion)) {
    const k = personaKey(a);
    if (!mine.has(k)) continue;
    byPersona.set(k, [...(byPersona.get(k) ?? []), a]);
  }
  const add = (m: Map<string, Set<string>>, key: string, rec: string) => {
    const s = m.get(key) ?? new Set<string>();
    s.add(rec);
    m.set(key, s);
  };

  for (const assertions of byPersona.values()) {
    const rec = recordKey(assertions[0]);
    if (rec === "") continue;
    const facts = [...assertions.filter((a) => !VITAL_EVENT[a?.fact_type]), ...vitalAssertions(assertions)];
    (person.names ?? []).forEach((n, i) => {
      if (assertions.some((a) => a?.fact_type === "name" && ["same", "variant"].includes(nameRelation(n, assertionName(a))))) {
        add(support.names, keyOf(n, i), rec);
      }
    });
    (person.facts ?? []).forEach((f, i) => {
      const t = foldFactType(f.type);
      if (facts.some((a) => foldFactType(a?.fact_type) === t && factsAgree(f, a))) add(support.facts, keyOf(f, i), rec);
    });
  }

  const stated = statedRelationships(research, links).filter((s) => s.from === personId || s.to === personId);
  (tree.relationships ?? []).forEach((r, i) => {
    for (const s of stated) if (relationshipMatches(s.type, s.from, s.to, r)) add(support.relationships, keyOf(r, i), s.record);
  });
  return support;
}

/**
 * The tree with every name, fact and relationship of `support.personId` that
 * only `recordId` supports removed. `recordId` may be a set: the bare ids of one
 * record read under several persona ARKs. An item no record supports stays, and
 * the person keeps at least one name. The input tree is not changed.
 */
export function leaveOneOut(
  tree: SimplifiedGedcomX,
  support: AttachmentSupport,
  recordId: string | ReadonlySet<string>,
): SimplifiedGedcomX {
  const ids = typeof recordId === "string" ? new Set([arkToBareId(recordId)]) : new Set([...recordId].map(arkToBareId));
  const only = (s: Set<string> | undefined): boolean => !!s && s.size > 0 && [...s].every((r) => ids.has(r));
  const persons = (tree.persons ?? []).map((p) => {
    if (p?.id !== support.personId) return p;
    const names = (p.names ?? []).filter((n, i) => !only(support.names.get(keyOf(n, i))));
    return {
      ...p,
      names: names.length > 0 ? names : p.names,
      facts: (p.facts ?? []).filter((f, i) => !only(support.facts.get(keyOf(f, i)))),
    };
  });
  const relationships = (tree.relationships ?? []).filter((r, i) => !only(support.relationships.get(keyOf(r, i))));
  return { ...tree, persons, relationships };
}
