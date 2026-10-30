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

/** The two strings, each with its own trailing (outermost) segment removed —
 *  `"Wayne, Michigan"` for `"Wayne, Michigan, United States"`. `""` when there is
 *  no comma to cut at. */
function stripOutermost(s: string): string {
  const i = s.lastIndexOf(",");
  return i === -1 ? "" : s.slice(0, i).trim();
}

function tailMatch(a: string, b: string): boolean {
  return !!a && !!b && (a === b || a.endsWith(`, ${b}`));
}

/** `"Detroit, Wayne, Michigan"` sits inside `"Wayne, Michigan"`. Compared on the
 *  place-string TAIL, which is how the corpus writes nesting, and case-folded so a
 *  capitalisation difference is not read as a different place.
 *
 *  Tolerates a COUNTRY-level segment present on only ONE side: `jurisdiction` and
 *  a recorded locality are populated by different callers, and one routinely
 *  carries a trailing "United States" (or another country) that the other omits
 *  — found against a real project where `jurisdiction` ("Detroit, Wayne,
 *  Michigan, United States") and the matching recorded locality ("Wayne,
 *  Michigan") were the SAME place and still read as unrelated. Dropping exactly
 *  one trailing segment from exactly one side and retrying the same tail check
 *  catches that without loosening anything else: it can only turn a match that
 *  failed solely on an extra outermost segment into a match, never a genuinely
 *  different county into one — that mismatch sits at the county/city level,
 *  which this never touches. */
function isInside(item: string, locality: string): boolean {
  const a = item.trim().toLowerCase();
  const b = locality.trim().toLowerCase();
  if (!a || !b) return false;
  return (
    tailMatch(a, b) ||
    tailMatch(stripOutermost(a), b) ||
    tailMatch(a, stripOutermost(b))
  );
}

function parseRange(value: string): [number, number] | null {
  const m = /^\s*(\d{4})\s*-\s*(\d{4})\s*$/.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

const PLACE_JOINER = /\s+(?:and|or|&)\s+|\s*[;/]\s*/i;

/** The refusal for a plan item whose `jurisdiction` joins two or more places, or
 *  `undefined`. Unlike the flags below this gates: search-records hands the
 *  jurisdiction to `record_search` as its one `residencePlace`, so "Alabama and
 *  Texas, United States" is an item no search can run, not a judgment call.
 *
 *  Refused only when the string splits on "and", "or", "&", ";" or "/" into two or
 *  more parts and EVERY part sits inside, or encloses, a locality this project has
 *  researched. That is what tells two places apart from one place whose name
 *  holds a joiner: "Lewis and Clark County, Montana" splits into "Lewis", which no
 *  locality matches, so it is left alone, as is anything in a project with no
 *  recorded locality. An elided part ("Smith County and Hill County, Texas") is
 *  not caught, because filling in its tail would also split "Lewis and Clark". */
export function compoundJurisdictionError(
  item: PlanItemLike,
  localities: LocalityLike[]
): string | undefined {
  const jurisdiction = typeof item?.jurisdiction === "string" ? item.jurisdiction : "";
  const parts = jurisdiction.split(PLACE_JOINER).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const places = (localities ?? [])
    .map((l) => (typeof l?.place === "string" ? l.place : ""))
    .filter(Boolean);
  const known = (part: string) => places.some((p) => isInside(part, p) || isInside(p, part));
  if (!parts.every(known)) return undefined;
  return (
    `jurisdiction '${jurisdiction}' names ${parts.length} places (${parts.join("; ")}). ` +
    `A plan item searches one place: write one item per place, each with its own ` +
    `place_search standardPlace.`
  );
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
  // Either direction: a search inside a recorded locality, or one that ENCLOSES it (a
  // statewide or national index covering the county), is in the right place.
  if (
    jurisdiction &&
    places.length > 0 &&
    !places.some((p) => isInside(jurisdiction, p) || isInside(p, jurisdiction))
  ) {
    flags.push({
      kind: "jurisdiction",
      message:
        `${jurisdiction} is not inside any locality this project has researched ` +
        `(${places.join("; ")}). Check that its records can hold an event from there.`
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
