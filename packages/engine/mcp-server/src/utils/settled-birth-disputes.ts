import { isLiveAssertion } from "./assertion-liveness.js";
import { compatiblePlace } from "./date-comparison.js";
import { placeSegments } from "./place-resolver.js";
import { recordPartyKeyer } from "./record-persona.js";

function isBlank(v: unknown): boolean {
  return typeof v !== "string" || v.trim() === "";
}

function liveAssertionsById(research: any): Map<string, any> {
  const byId = new Map<string, any>();
  for (const a of (research?.assertions ?? []) as any[]) {
    if (isLiveAssertion(a) && typeof a.id === "string") byId.set(a.id, a);
  }
  return byId;
}

export const YEAR_PATTERN = /\b(1[0-9]{3}|20[0-9]{2})\b/;

/** First 4-digit year in a date string, tolerating `~1845`, `11Jan1758`,
 *  `1858-03-12` and `about 1832`. Null when none is present -- an unparseable
 *  date states nothing to compare, which must not read as a contradiction. */
export function yearOf(value: unknown): number | null {
  const m = YEAR_PATTERN.exec(String(value ?? ""));
  return m ? Number(m[1]) : null;
}

/** Whether a record's birth place and the tree's agree, on their text or, when
 *  both carry one, on their resolved `standard_place` -- either agreeing is
 *  enough, since two resolutions of the same text can differ. Agreement is
 *  `compatiblePlace`, which lets "Staffordshire, England" agree with "West
 *  Bromwich, Staffordshire, England, United Kingdom" and "Georgia" with
 *  "Georgia, United States". Lining the two up from the country instead refused
 *  1,067 committed confident/probable links on place, almost all that shape. */
export function birthPlacesAgree(assertion: any, birth: any): boolean {
  if (compatiblePlace(String(assertion.place), String(birth.place))) return true;
  const sa = assertion?.standard_place;
  const sb = birth?.standard_place;
  return (
    typeof sa === "string" && placeSegments(sa).length > 0 &&
    typeof sb === "string" && placeSegments(sb).length > 0 &&
    compatiblePlace(sa, sb)
  );
}

/** The record an assertion belongs to, for grouping a record's assertions. */
export function recordIdOf(a: any): string | null {
  return a?.record_id ?? a?.source_id ?? null;
}


/** Every assertion of `recordId` among `assertions`, and the party key over
 *  them (`recordPartyKeyer`: the persona id, else the role, read across the
 *  whole record). The contradiction gate, its two-party arm and the move gate
 *  all key parties through here so they cannot drift apart. */
export function recordParties(assertions: Iterable<any>, recordId: string) {
  const onRecord = [...assertions].filter((a) => isLiveAssertion(a) && recordIdOf(a) === recordId);
  return { onRecord, partyKey: recordPartyKeyer(onRecord) };
}

/** `disputed_attribute` values that settle each arm, matched exactly after
 *  lower-casing and folding spaces and hyphens to underscores. The field is free
 *  text, so anything else ("birth year of John Laurie (GPZR-3X2)") settles
 *  neither arm and the assertion still caps, which fails safe. */
const BIRTH_PLACE_DISPUTES: ReadonlySet<string> = new Set([
  "birthplace", "birth_place", "place_of_birth",
]);

/** Whether a fact conflict's `disputed_attribute` names a birth place, read as
 *  `resolvedAgainstIds` reads it. */
export function isBirthPlaceDispute(attribute: unknown): boolean {
  return BIRTH_PLACE_DISPUTES.has(String(attribute ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_"));
}
const BIRTH_DATE_DISPUTES: ReadonlySet<string> = new Set([
  "birth_year", "birth_date", "birthdate", "date_of_birth", "year_of_birth",
  "christening_date", "baptism_date",
]);

export interface ResolvedAgainst {
  place: ReadonlySet<string>;
  date: ReadonlySet<string>;
  /** The conflict that set each assertion aside. */
  conflictOf: ReadonlyMap<string, string>;
}

/** Assertions a settled FACT conflict set aside, per arm, released only on the
 *  arm its `disputed_attribute` names: every competitor but its
 *  `preferred_assertion_id`. A `resolved` conflict settles when it names a
 *  preferred assertion. A `moot` one settles only when it carries non-blank
 *  `independence_analysis` and `weighing_analysis`, the bar `resolved` meets:
 *  `moot` itself owes only a `resolution_rationale`, and one sentence must not
 *  lift the cap. Issue #4255: a late group baptism, 12 years after the birth,
 *  found to be two events and marked moot, left every link capped with no way
 *  out. A contradiction the project has already weighed and set aside is not a
 *  live one, so it cannot cap the link; one it did not weigh (a birthplace
 *  dispute says nothing about the same record's christening date) still does.
 *
 *  An identity conflict releases nothing: its loser was judged to be a
 *  different person, so a link through it to the rejected identity is exactly
 *  what must stay capped. For the same reason a moot conflict releases nothing
 *  while an identity conflict still doubts the record person behind one of its
 *  competitors: `moot` is also how a fact conflict ends when its record turns
 *  out to be someone else (#2475), and that must not lift the cap onto the
 *  wrong person. The doubt is read by record person (`recordParties`), not by
 *  assertion id, because an identity conflict usually names the persona's name
 *  assertion rather than its christening. It holds at any status: a `resolved`
 *  identity conflict does not say which way it settled (the corpus holds one
 *  whose rationale rejects the person its preferred assertion names). A moot
 *  meaning "someone else" written with no identity conflict beside it cannot be
 *  told apart from the documents, and releases.
 *
 *  Read from the document as this op sees it, so a conflict settled LATER in the
 *  same batch still refuses, which fails safe. Figures:
 *  `dev/measure-core-identifier-gate.ts`. */
export function resolvedAgainstIds(research: any, assertionById: Map<string, any>): ResolvedAgainst {
  const place = new Set<string>();
  const date = new Set<string>();
  const conflictOf = new Map<string, string>();
  const conflicts: any[] = Array.isArray(research?.conflicts) ? research.conflicts : [];
  const competingIds = (c: any): string[] =>
    Array.isArray(c?.competing_assertion_ids)
      ? c.competing_assertion_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
  // The record person an assertion is about, or the assertion itself when its
  // record or party cannot be read.
  const keyers = new Map<string, (a: any) => string | null>();
  const personOf = (id: string): string => {
    const a = assertionById.get(id);
    const recordId = a ? recordIdOf(a) : null;
    if (recordId == null) return `assertion ${id}`;
    let keyOf = keyers.get(recordId);
    if (!keyOf) keyers.set(recordId, (keyOf = recordParties(assertionById.values(), recordId).partyKey));
    const party = keyOf(a);
    return party == null ? `assertion ${id}` : `${recordId} ${party}`;
  };
  const doubted = new Set(
    conflicts
      .filter((c) => c?.conflict_type === "identity")
      .flatMap(competingIds)
      .map(personOf),
  );
  for (const c of conflicts) {
    if (c?.conflict_type !== "fact") continue;
    const attr = String(c.disputed_attribute ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const into = BIRTH_PLACE_DISPUTES.has(attr) ? place : BIRTH_DATE_DISPUTES.has(attr) ? date : null;
    if (!into) continue;
    const ids = competingIds(c);
    const settled =
      c.status === "resolved"
        ? typeof c.preferred_assertion_id === "string"
        : c.status === "moot" &&
          !isBlank(c.independence_analysis) &&
          !isBlank(c.weighing_analysis) &&
          !ids.some((id) => doubted.has(personOf(id)));
    if (!settled) continue;
    for (const id of ids) {
      if (id === c.preferred_assertion_id) continue;
      into.add(id);
      if (typeof c.id === "string") conflictOf.set(id, c.id);
    }
  }
  return { place, date, conflictOf };
}

/** For `same_person`'s answer: one sentence per birth place or birth date of
 *  the scored record person that a settled fact conflict set aside. The agent
 *  is told to look conflicts up before it reads a disagreement as a
 *  contradiction; this hands it the settled ones on the call it already makes,
 *  by the rule the contradiction gate itself applies (`resolvedAgainstIds`).
 *  Only a value that disagrees with the tree person's Birth fact is named: a
 *  set-aside competitor that agrees with it is nothing the agent could misread.
 *  Empty when the assertion has no readable record person, the tree person has
 *  no Birth fact, or nothing that disagrees was set aside. */
export function settledBirthDisputes(
  research: any,
  tree: any,
  assertionId: string,
  treePersonId: string,
): string[] {
  const assertionById = liveAssertionsById(research);
  const scored = assertionById.get(assertionId);
  if (!scored) return [];
  const recordId = recordIdOf(scored);
  if (recordId == null) return [];
  const { onRecord, partyKey } = recordParties(assertionById.values(), recordId);
  const own = partyKey(scored);
  if (own === null) return [];
  const person = ((tree?.persons ?? []) as any[]).find((p: any) => p?.id === treePersonId);
  const birth = ((person?.facts ?? []) as any[]).find(
    (f: any) => String(f?.type ?? "").toLowerCase() === "birth",
  );
  if (!birth) return [];
  const against = resolvedAgainstIds(research, assertionById);
  const out: string[] = [];
  for (const a of onRecord) {
    if (partyKey(a) !== own) continue;
    const arm = against.place.has(a.id) ? "birth place" : against.date.has(a.id) ? "birth date" : null;
    if (!arm) continue;
    const stated = arm === "birth place" ? a.place : a.date;
    if (arm === "birth place") {
      if (typeof a.place !== "string" || typeof birth.place !== "string" || birthPlacesAgree(a, birth)) continue;
    } else {
      const [recordYear, treeYear] = [yearOf(a.date), yearOf(birth.date)];
      if (recordYear == null || treeYear == null || recordYear === treeYear) continue;
    }
    out.push(
      `Conflict '${against.conflictOf.get(a.id) ?? "(no id)"}' already set aside this record's ` +
        `${arm} ${JSON.stringify(stated)} (assertion '${a.id}'), which differs from the tree ` +
        `person's. It is settled: not a contradiction, and not a reason to lower or withhold ` +
        `this link.`,
    );
  }
  return out;
}
