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

/** `"1855-1876"` → [1855, 1876]; a single year `"1891"` → [1891, 1891], which the
 *  corpus writes for a one-census item. Anything else is null. */
function parseRange(value: string): [number, number] | null {
  const m = /^\s*(\d{4})\s*(?:-\s*(\d{4})\s*)?$/.exec(value);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? m[1])];
}

/**
 * A question's plans that leave most of its `date_window` unsearched (issue #2424).
 *
 * The window is the question's own: the years whose records could answer it, stated by
 * question-selection. The subject's lifetime is not a stand-in — a marriage question
 * needs the twenties, a death question the end of life — and measured as one it fired on
 * 145 of 391 committed plan-bearing questions, correct plans included.
 *
 * Judged on the SPAN of the question's live items (earliest start to latest end), not
 * their summed years: a census-only plan of single years 1850…1900 covers a life even
 * though each item is one year. Items on a superseded plan and skipped items search
 * nothing, so they are left out. Fires when more than half the window falls outside the
 * span. No window, a malformed one, or no parseable item: no opinion.
 *
 * A flag, never a gate (decided 2026-10-01): a plan can stop short for a reason the
 * documents do not hold.
 */
export function planWindowFlag(question: any, plans: any[]): string | null {
  const window = typeof question?.date_window === "string" ? parseRange(question.date_window) : null;
  if (!window || window[0] > window[1]) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const plan of plans ?? []) {
    if (plan?.question_id !== question.id || plan?.status === "superseded") continue;
    for (const item of Array.isArray(plan?.items) ? plan.items : []) {
      if (item?.status === "skipped" || typeof item?.date_range !== "string") continue;
      const r = parseRange(item.date_range);
      if (!r || r[0] > r[1]) continue;
      lo = Math.min(lo, r[0]);
      hi = Math.max(hi, r[1]);
    }
  }
  if (lo === Infinity) return null;
  const [ws, we] = window;
  const length = we - ws + 1;
  const outside =
    Math.min(length, Math.max(0, lo - ws)) + Math.min(length, Math.max(0, we - hi));
  const uncovered = Math.min(length, outside);
  if (uncovered * 2 <= length) return null;
  return (
    `${question.id}'s plans span ${lo}–${hi} but its date window is ${ws}–${we}: ` +
    `${uncovered} of its ${length} years fall outside every plan item. Add an item whose ` +
    `date_range covers the uncovered years, or say in that item's rationale why they ` +
    `cannot hold the record.`
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
