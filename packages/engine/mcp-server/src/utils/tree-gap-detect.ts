// Pure hole detection for `tree_gaps` — no network. The tool reads the pedigree
// and the descendancy trees, builds a `GapModel`, and calls `detectGaps`.
// Thresholds are the genealogist-settable constants below; the spec
// (docs/specs/tree-gaps-tool-spec.md, "Hole types") cites them by name.

import type {
  FSGapPerson,
  PlaceLevel,
  TreeGap,
  TreeGapType,
  TreeGapYearRange,
} from "../types/tree-gaps.js";

// ─── Thresholds ─────────────────────────────────────────────────────────────

/** A mother is assumed able to bear children between these ages. */
export const FERTILE_MIN_AGE = 15;
export const FERTILE_MAX_AGE = 45;
/** Consecutive births further apart than this (years) are a gap. */
export const CHILD_GAP_YEARS = 4;
/** A gap is only reported when the mother was at most this old at the earlier birth. */
export const CHILD_GAP_MAX_MOTHER_AGE = 40;
/** A last child born when the mother was younger than this is "early". */
export const EARLY_LAST_CHILD_AGE = 34;
/** ...and only when she is recorded as living to at least this age. */
export const EARLY_LAST_CHILD_MIN_LIFESPAN = 40;
/** The unexplained window must be at least this many years to be worth a search. */
export const MIN_WINDOW_YEARS = 4;
/** A deceased adult who died at or after this age with no spouse is a hole. */
export const NO_SPOUSE_MIN_DEATH_AGE = 25;
/** Earliest age a spouse search starts from. */
export const MARRIAGE_SEARCH_MIN_AGE = 18;
/** Assumed maximum lifespan when scoping a missing death date. */
export const MAX_LIFESPAN = 90;
/** A mother's age at a child's birth, bounding when she was born. */
export const MOTHER_AGE_RANGE: readonly [number, number] = [15, 45];
/** A father's age at a child's birth, bounding when he was born. */
export const FATHER_AGE_RANGE: readonly [number, number] = [15, 65];
/** How specific a place is: a locality is worth more to a record search than a country. */
export const PLACE_LEVEL_WEIGHT: Record<PlaceLevel, number> = {
  locality: 1,
  county: 0.75,
  region: 0.5,
  country: 0.25,
};

const TYPE_PRIORITY: Record<TreeGapType, number> = {
  missing_parents: 0,
  no_children: 1,
  child_gap: 2,
  early_last_child: 3,
  missing_surname: 4,
  no_birth_info: 5,
  no_spouse: 6,
  no_death_date: 7,
};

// ─── Model ──────────────────────────────────────────────────────────────────

export interface GapPerson {
  id: string;
  name: string;
  living: boolean;
  gender: "male" | "female" | "other";
  lifespan: string | null;
  birthYear: number | null;
  birthPlace: string | null;
  deathYear: number | null;
  hasDeathDate: boolean;
  marriageYear: number | null;
  marriagePlace: string | null;
  deathPlace: string | null;
  hasBirthDate: boolean;
  hasBirthPlace: boolean;
  /** False only when the name parts were read and carry no real surname. */
  hasSurname: boolean;
}

/** One line person's family as read from a descendancy tree. */
export interface GapFamily {
  personId: string;
  spouseIds: Set<string>;
  childIds: Set<string>;
  /** True only when some anchor read this person's children (not a leaf). */
  childrenKnown: boolean;
}

export interface GapModel {
  people: Map<string, GapPerson>;
  /** Signed generation from the root: positive above, negative below. */
  generation: Map<string, number>;
  /** Ahnentafel number -> person id, ancestors only. */
  ancestors: Map<number, string>;
  /** Number of generations the ancestry read covered. */
  ancestorGenerations: number;
  families: Map<string, GapFamily>;
}

export function emptyModel(ancestorGenerations: number): GapModel {
  return {
    people: new Map(),
    generation: new Map(),
    ancestors: new Map(),
    ancestorGenerations,
    families: new Map(),
  };
}

// ─── Parsing ────────────────────────────────────────────────────────────────

/** First 4-digit year in a FamilySearch date string ("12 February 1809"). */
export function yearOf(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = s.match(/\b(\d{4})\b/);
  return m ? Number(m[1]) : null;
}

const NO_SURNAME = /^[\s\[\]()?_.-]*(unknown|unk|nn|n\.n|none|no surname)?[\s\[\]()?_.-]*$/i;

/**
 * Whether the person's name parts carry a surname. Unknown (no `names` block in
 * the response) counts as having one: a hole is never reported on what the
 * endpoint did not show.
 */
function hasSurnamePart(p: FSGapPerson): boolean {
  if (!p.names) return true;
  for (const n of p.names) {
    for (const f of n.nameForms ?? []) {
      for (const part of f.parts ?? []) {
        if (part.type?.endsWith("/Surname") && !NO_SURNAME.test(part.value ?? "")) return true;
      }
    }
  }
  return false;
}

export function toGapPerson(p: FSGapPerson): GapPerson | null {
  if (typeof p.id !== "string" || p.id === "") return null;
  const d = p.display ?? {};
  const g = (d.gender ?? "").toLowerCase();
  const lifespan = d.lifespan ?? null;
  return {
    id: p.id,
    name: d.name ?? p.id,
    // Absent flag is treated as living: never report a hole we cannot prove is
    // on a deceased person.
    living: p.living !== false,
    gender: g === "male" ? "male" : g === "female" ? "female" : "other",
    lifespan,
    birthYear: yearOf(d.birthDate) ?? yearOf(lifespan?.split("-")[0]),
    birthPlace: d.birthPlace ?? null,
    deathYear: yearOf(d.deathDate),
    hasDeathDate: !!d.deathDate,
    marriageYear: yearOf(d.marriageDate),
    marriagePlace: d.marriagePlace ?? null,
    deathPlace: d.deathPlace ?? null,
    hasBirthDate: !!d.birthDate,
    hasBirthPlace: !!d.birthPlace,
    hasSurname: hasSurnamePart(p),
  };
}

/** Level of a place string by its comma-separated parts. */
export function placeLevel(place: string): PlaceLevel {
  const n = place.split(",").filter((x) => x.trim() !== "").length;
  return n >= 4 ? "locality" : n === 3 ? "county" : n === 2 ? "region" : "country";
}

/** 0 with no matching collection; else 1 (+1 with a census year in the window), weighted by place level. */
export function coverageScore(collections: number, censusYears: number, level: PlaceLevel): number {
  if (collections <= 0) return 0;
  return Math.round((1 + (censusYears > 0 ? 1 : 0)) * PLACE_LEVEL_WEIGHT[level] * 100) / 100;
}

/** Ahnentafel depth of number n: 1 -> 0, 2-3 -> 1, 4-7 -> 2. */
export function ahnentafelDepth(n: number): number {
  return Math.floor(Math.log2(n));
}

/** Add one ancestry response to the model. */
export function addAncestry(model: GapModel, persons: FSGapPerson[]): void {
  for (const raw of persons) {
    const person = toGapPerson(raw);
    if (!person) continue;
    model.people.set(person.id, person);
    const asc = raw.display?.ascendancyNumber;
    if (asc && /^\d+$/.test(asc)) {
      const n = Number(asc);
      model.ancestors.set(n, person.id);
      model.generation.set(person.id, ahnentafelDepth(n));
    }
  }
}

/**
 * Add one descendancy response read from an anchor `anchorDepth` generations
 * above the root, requested with `generations` levels. Parentage comes from
 * the descendancy number ("1.2.3" is the third child of "1.2"; "1.2-S1" is a
 * spouse of "1.2") — the endpoint's relationships are couples only.
 */
export function addDescendancy(
  model: GapModel,
  persons: FSGapPerson[],
  anchorDepth: number,
  generations: number,
): void {
  const byNumber = new Map<string, string>();
  for (const raw of persons) {
    const person = toGapPerson(raw);
    const num = raw.display?.descendancyNumber;
    if (!person || !num) continue;
    byNumber.set(num, person.id);
    const existing = model.people.get(person.id);
    // Keep the first read; a later read of the same person adds nothing.
    if (!existing) model.people.set(person.id, person);
    const isSpouse = num.includes("-S");
    const k = isSpouse ? num.split("-S")[0].split(".").length - 1 : num.split(".").length - 1;
    if (!model.generation.has(person.id)) {
      model.generation.set(person.id, anchorDepth - k);
    }
  }
  const family = (id: string): GapFamily => {
    let f = model.families.get(id);
    if (!f) {
      f = { personId: id, spouseIds: new Set(), childIds: new Set(), childrenKnown: false };
      model.families.set(id, f);
    }
    return f;
  };
  for (const [num, id] of byNumber) {
    if (num.includes("-S")) {
      const lineId = byNumber.get(num.split("-S")[0]);
      if (lineId) family(lineId).spouseIds.add(id);
      continue;
    }
    const f = family(id);
    const depthInTree = num.split(".").length - 1;
    // A leaf's children were not read, so its (empty) child list is unknown.
    if (depthInTree < generations) f.childrenKnown = true;
    const dot = num.lastIndexOf(".");
    if (dot > 0) {
      const parentId = byNumber.get(num.slice(0, dot));
      if (parentId) family(parentId).childIds.add(id);
    }
  }
}

// ─── Detection ──────────────────────────────────────────────────────────────

function gap(
  model: GapModel,
  type: TreeGapType,
  p: GapPerson,
  detail: string,
  yearRange: TreeGapYearRange | null,
  place: string | null,
  spouse?: GapPerson,
): TreeGap {
  const out: TreeGap = {
    type,
    personId: p.id,
    name: p.name,
    lifespan: p.lifespan,
    generation: model.generation.get(p.id) ?? 0,
    detail,
    yearRange,
    place,
    coverage: null,
  };
  if (spouse) {
    out.spouseId = spouse.id;
    out.spouseName = spouse.name;
  }
  return out;
}

// The mother a family hole is about, so the same hole found from either spouse
// of a couple (or from her own read with several husbands) collapses to one.
const motherKey = new WeakMap<TreeGap, string>();

function range(start: number, end: number): TreeGapYearRange | null {
  return end >= start ? { start, end } : null;
}

function missingParents(model: GapModel, out: TreeGap[]): void {
  for (const [n, id] of model.ancestors) {
    const p = model.people.get(id);
    if (!p || p.living) continue;
    // At the cap the endpoint never returns parents, so absence is unknowable.
    if (ahnentafelDepth(n) >= model.ancestorGenerations) continue;
    const noFather = !model.ancestors.has(2 * n);
    const noMother = !model.ancestors.has(2 * n + 1);
    if (!noFather && !noMother) continue;
    const which = noFather && noMother ? "Father and mother are both" : noFather ? "The father is" : "The mother is";
    const by = p.birthYear;
    out.push(
      gap(
        model,
        "missing_parents",
        p,
        `${which} missing from the tree.`,
        by == null ? null : range(by - 1, by + 3),
        p.birthPlace,
      ),
    );
  }
}

/** Mother of this person's children, when it can be told. */
function motherOf(model: GapModel, p: GapPerson, f: GapFamily): GapPerson | null {
  if (p.gender === "female") return p;
  if (f.spouseIds.size !== 1) return null;
  const s = model.people.get([...f.spouseIds][0]);
  return s && s.gender === "female" ? s : null;
}

function familyHoles(model: GapModel, out: TreeGap[]): void {
  for (const f of model.families.values()) {
    const p = model.people.get(f.personId);
    if (!p || p.living) continue;
    const spouses = [...f.spouseIds]
      .map((id) => model.people.get(id))
      .filter((s): s is GapPerson => !!s);
    if (spouses.some((s) => s.living)) continue;

    // no_spouse
    if (
      f.spouseIds.size === 0 &&
      p.birthYear != null &&
      p.deathYear != null &&
      p.deathYear - p.birthYear >= NO_SPOUSE_MIN_DEATH_AGE
    ) {
      out.push(
        gap(
          model,
          "no_spouse",
          p,
          `Died at ${p.deathYear - p.birthYear} with no spouse in the tree.`,
          range(p.birthYear + MARRIAGE_SEARCH_MIN_AGE, p.deathYear),
          p.birthPlace,
        ),
      );
    }

    if (!f.childrenKnown) continue;
    const mother = motherOf(model, p, f);
    if (!mother || mother.birthYear == null) {
      // No-children can still be scoped from a marriage year when she is unknown.
      if (f.childIds.size === 0 && f.spouseIds.size === 1 && p.marriageYear != null) {
        out.push(
          gap(
            model,
            "no_children",
            p,
            "A married couple with no children in the tree.",
            range(p.marriageYear, p.marriageYear + FERTILE_MIN_AGE),
            p.marriagePlace ?? p.birthPlace,
            spouses[0],
          ),
        );
      }
      continue;
    }

    const mb = mother.birthYear;
    // Last year she could have borne a child: 45, her death, or her husband's.
    let fertileEnd = mb + FERTILE_MAX_AGE;
    if (mother.deathYear != null) fertileEnd = Math.min(fertileEnd, mother.deathYear);
    if (f.spouseIds.size === 1 && mother.id !== p.id && p.deathYear != null) {
      fertileEnd = Math.min(fertileEnd, p.deathYear + 1);
    }
    const place = p.marriagePlace ?? mother.birthPlace;
    const couple = spouses.length === 1 ? spouses[0] : undefined;
    const add = (g: TreeGap): void => {
      motherKey.set(g, mother.id);
      out.push(g);
    };

    const births = [...f.childIds]
      .map((id) => model.people.get(id)?.birthYear)
      .filter((y): y is number => typeof y === "number")
      .sort((a, b) => a - b);

    if (f.childIds.size === 0 && f.spouseIds.size === 1) {
      const start = Math.max(mb + FERTILE_MIN_AGE, p.marriageYear ?? 0);
      const r = fertileEnd - start >= MIN_WINDOW_YEARS ? range(start, fertileEnd) : null;
      if (r) {
        add(
          gap(model, "no_children", p, "A married couple with no children in the tree.", r, place, couple),
        );
      }
      continue;
    }

    for (let i = 0; i + 1 < births.length; i++) {
      const a = births[i];
      const b = births[i + 1];
      const ageAtA = a - mb;
      if (b - a > CHILD_GAP_YEARS && ageAtA >= FERTILE_MIN_AGE && ageAtA <= CHILD_GAP_MAX_MOTHER_AGE) {
        add(
          gap(
            model,
            "child_gap",
            p,
            `${b - a} years between children born ${a} and ${b}.`,
            range(a + 1, b - 1),
            place,
            couple,
          ),
        );
      }
    }

    if (births.length > 0) {
      const last = births[births.length - 1];
      const ageAtLast = last - mb;
      const lived = mother.deathYear != null ? mother.deathYear - mb : 0;
      if (
        ageAtLast < EARLY_LAST_CHILD_AGE &&
        lived >= EARLY_LAST_CHILD_MIN_LIFESPAN &&
        fertileEnd - (last + 1) >= MIN_WINDOW_YEARS
      ) {
        add(
          gap(
            model,
            "early_last_child",
            p,
            `Last recorded child born ${last}, when the mother was ${ageAtLast}.`,
            range(last + 1, fertileEnd),
            place,
            couple,
          ),
        );
      }
    }
  }
}

/** Every family in which `id` is a spouse (not the line person). */
function familiesAsSpouse(model: GapModel, id: string): GapFamily[] {
  return [...model.families.values()].filter((f) => f.spouseIds.has(id));
}

/** Deceased wives whose name parts show no real surname: the maiden name is the hole. */
function missingSurnames(model: GapModel, out: TreeGap[]): void {
  const wives = new Set<string>();
  for (const [n, id] of model.ancestors) {
    if (n >= 3 && n % 2 === 1) wives.add(id);
  }
  for (const f of model.families.values()) {
    const line = model.people.get(f.personId);
    if (line?.gender === "female" && f.spouseIds.size > 0) wives.add(line.id);
    for (const sid of f.spouseIds) {
      if (model.people.get(sid)?.gender === "female") wives.add(sid);
    }
  }
  for (const id of wives) {
    const p = model.people.get(id);
    if (!p || p.living || p.gender !== "female" || p.hasSurname) continue;
    const theirs = [...familiesAsSpouse(model, id), ...(model.families.has(id) ? [model.families.get(id)!] : [])];
    const husbands = [...new Set(familiesAsSpouse(model, id).map((f) => f.personId))]
      .map((hid) => model.people.get(hid))
      .filter((h): h is GapPerson => !!h);
    const husband = husbands.length === 1 ? husbands[0] : undefined;
    const marriage = p.marriageYear ?? husband?.marriageYear ?? null;
    const kids = theirs.flatMap((f) => [...f.childIds]);
    const births = kids
      .map((k) => model.people.get(k)?.birthYear)
      .filter((y): y is number => typeof y === "number");
    let window: TreeGapYearRange | null = null;
    if (marriage != null) window = range(marriage - 1, marriage + 1);
    else if (births.length > 0) {
      const first = Math.min(...births);
      window = range(first - 1, first + 1);
    } else if (p.birthYear != null) window = range(p.birthYear + FERTILE_MIN_AGE, p.birthYear + 35);
    out.push(
      gap(
        model,
        "missing_surname",
        p,
        "The wife's surname (maiden name) is missing from the tree.",
        window,
        p.marriagePlace ?? husband?.marriagePlace ?? p.birthPlace ?? p.deathPlace,
        husband,
      ),
    );
  }
}

/** Deceased people with no birth date and/or no birth place. */
function missingBirthInfo(model: GapModel, out: TreeGap[]): void {
  const now = new Date().getFullYear();
  for (const p of model.people.values()) {
    if (p.living || (p.hasBirthDate && p.hasBirthPlace)) continue;
    const missing = !p.hasBirthDate && !p.hasBirthPlace ? "date or place" : !p.hasBirthDate ? "date" : "place";
    let window: TreeGapYearRange | null = null;
    const kids = [...(model.families.get(p.id)?.childIds ?? [])]
      .map((k) => model.people.get(k)?.birthYear)
      .filter((y): y is number => typeof y === "number");
    if (p.birthYear != null) window = range(p.birthYear - 1, p.birthYear + 3);
    else if (kids.length > 0) {
      const first = Math.min(...kids);
      const [lo, hi] = p.gender === "female" ? MOTHER_AGE_RANGE : FATHER_AGE_RANGE;
      window = range(first - hi, first - lo);
    } else if (p.deathYear != null) window = range(p.deathYear - MAX_LIFESPAN, p.deathYear);
    if (window && window.end > now) window = range(window.start, now);
    out.push(
      gap(
        model,
        "no_birth_info",
        p,
        `Deceased, but the tree gives no birth ${missing}.`,
        window,
        p.birthPlace ?? p.deathPlace ?? p.marriagePlace,
      ),
    );
  }
}

function missingDeathDates(model: GapModel, out: TreeGap[]): void {
  for (const p of model.people.values()) {
    if (p.living || p.hasDeathDate || p.birthYear == null) continue;
    out.push(
      gap(
        model,
        "no_death_date",
        p,
        "Deceased, but the tree gives no death date.",
        range(p.birthYear, Math.min(p.birthYear + MAX_LIFESPAN, new Date().getFullYear())),
        p.birthPlace,
      ),
    );
  }
}

/** All holes in the model, nearest the root first. Deduplicated and unscored. */
export function detectGaps(model: GapModel): TreeGap[] {
  const out: TreeGap[] = [];
  missingParents(model, out);
  familyHoles(model, out);
  missingSurnames(model, out);
  missingBirthInfo(model, out);
  missingDeathDates(model, out);

  out.sort(byDistance);
  // A couple's hole is found once from each spouse when both are line persons
  // (two ancestors): key it on the pair so it is reported once.
  const seen = new Set<string>();
  return out.filter((g) => {
    const span = `${g.yearRange?.start}-${g.yearRange?.end}`;
    const mother = motherKey.get(g);
    const key = mother
      ? `${g.type}|mother:${mother}|${g.type === "child_gap" ? span : ""}`
      : g.spouseId
        ? `${g.type}|${[g.personId, g.spouseId].sort().join("+")}|${g.type === "child_gap" ? span : ""}`
        : `${g.type}|${g.personId}|${span}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const byDistance = (a: TreeGap, b: TreeGap): number =>
  Math.abs(a.generation) - Math.abs(b.generation) ||
  b.generation - a.generation ||
  TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type] ||
  a.personId.localeCompare(b.personId);

/**
 * Pick `n` holes from a `detectGaps` list, round-robin across hole types (each
 * type nearest-the-root first) so one common type — a deceased adult with no
 * spouse — cannot fill the whole answer. Returned nearest the root first.
 */
export function selectGaps(gaps: TreeGap[], n: number): TreeGap[] {
  const queues = new Map<TreeGapType, TreeGap[]>();
  for (const g of gaps) {
    const q = queues.get(g.type) ?? [];
    q.push(g);
    queues.set(g.type, q);
  }
  const order = [...queues.keys()].sort((a, b) => TYPE_PRIORITY[a] - TYPE_PRIORITY[b]);
  const picked: TreeGap[] = [];
  for (let i = 0; picked.length < n; i++) {
    let any = false;
    for (const t of order) {
      const g = queues.get(t)![i];
      if (g) {
        any = true;
        if (picked.length < n) picked.push(g);
      }
    }
    if (!any) break;
  }
  return picked.sort(byDistance);
}
