/**
 * Flags on a planned next action that is unlikely to be usable.
 *
 * "Dead ends become next actions" fails when the next actions are not usable. In the
 * reported case 2 of 8, then 1 of 3 suggestions were viable; the rest were "in the
 * wrong place or years", including COUNTY records for a death in an independent city
 * the locality guide had already flagged. A researcher hitting that churns.
 *
 * Decided from the project documents alone — the recorded localities and the item's
 * own fields — so it needs no network call and works while the run is offline.
 *
 * **Flags, never gates.** Searching a neighbouring jurisdiction can be deliberate and
 * right; a year outside the obvious window can be a fallback. This reports and the
 * researcher decides. A rule that refused these writes would block correct work, and
 * the repo's own doctrine is that heuristics are flags, never gates.
 */

export interface PlanItemLike {
  jurisdiction?: unknown;
  date_range?: unknown;
}

export interface LocalityLike {
  place?: unknown;
}

export interface PlanItemFlag {
  kind: "jurisdiction" | "date_range";
  message: string;
}

/** `"Detroit, Wayne, Michigan"` sits inside `"Wayne, Michigan"`. Compared on the
 *  place-string TAIL, which is how the corpus writes nesting, and case-folded so a
 *  capitalisation difference is not read as a different place. */
function isInside(item: string, locality: string): boolean {
  const a = item.trim().toLowerCase();
  const b = locality.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b || a.endsWith(`, ${b}`);
}

function parseRange(value: string): [number, number] | null {
  const m = /^\s*(\d{4})\s*-\s*(\d{4})\s*$/.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

export function planItemFlags(
  item: PlanItemLike,
  localities: LocalityLike[]
): PlanItemFlag[] {
  const flags: PlanItemFlag[] = [];
  const jurisdiction = typeof item?.jurisdiction === "string" ? item.jurisdiction : "";
  const range = typeof item?.date_range === "string" ? item.date_range : "";

  // Only speak when the project has said where it is working. With no recorded
  // locality there is nothing to be inconsistent WITH, and guessing would flag every
  // first plan item ever written.
  const places = (localities ?? [])
    .map((l) => (typeof l?.place === "string" ? l.place : ""))
    .filter(Boolean);
  if (jurisdiction && places.length > 0 && !places.some((p) => isInside(jurisdiction, p))) {
    flags.push({
      kind: "jurisdiction",
      message:
        `${jurisdiction} is not inside any locality this project has researched ` +
        `(${places.join("; ")}). An independent city belongs to no county, so county ` +
        `records cannot hold a record created in one.`
    });
  }

  // An unparseable range gets no opinion: the corpus writes "1900-1900" and
  // "1855-1876", but a human may write "c. 1880s", and flagging that as wrong would
  // be the tool being confidently ignorant.
  const parsed = range ? parseRange(range) : null;
  if (parsed && parsed[0] > parsed[1]) {
    flags.push({
      kind: "date_range",
      message: `${range} runs backwards — the search would cover no years at all.`
    });
  }

  return flags;
}
