// Relative gathering + local pre-pairing heuristic for `same_person`'s
// match-relatives mode (docs/specs/same-person-match-relatives-spec.md).
//
// Everything in this module is pure and network-free: it walks the input
// GedcomX for each focus person's relatives, then uses cheap local scoring
// (name + birth-year + gender gate) to pick the most-likely one-to-one
// pairings per role — so the caller only spends a FamilySearch API call on
// pairs that are plausibly the same person, avoiding an N×M explosion.
//
// The relationship walk mirrors `Mob.collectRelatedIds` (src/utils/mob.ts:299)
// but is independent of the warnings-domain `Mob` class.

import {
  nameSimilarity,
  normalizeString,
} from "./string-similarity.js";
import { BIRTHLIKE_FACT_TYPES } from "./mob.js";
import type { SimplifiedGedcomX, SimplifiedPerson } from "../types/gedcomx.js";

// ─── Tunable constants ───────────────────────────────────────────────────────
// Defaults to tune against a real census household once it's running
// (spec §12). Declared here, named, so they are easy to find and adjust.

/** preScore = NAME_WEIGHT * nameScore + YEAR_WEIGHT * yearScore. */
const NAME_WEIGHT = 0.6;
const YEAR_WEIGHT = 0.4;
/** Years apart at which yearScore hits 0; closer years score higher. */
const YEAR_TOLERANCE = 10;
/** Below this preScore a pair is too dissimilar to spend an FS call on. */
export const PRE_SCORE_FLOOR = 0.2;
/** Per-role cap on relatives gathered (mirrors Java MAX_CHILDREN_TO_COMPARE). */
export const MAX_RELATIVES_PER_ROLE = 40;
/** Defensive cap on total FS calls across all roles. */
export const MAX_PAIR_CALLS = 30;

export type RelativeRole = "parent" | "spouse" | "child";

/** A relatives-mode work item: one candidate pairing to score via FamilySearch. */
export interface RelativePair {
  role: RelativeRole;
  target: SimplifiedPerson;
  candidate: SimplifiedPerson;
  preScore: number;
}

export interface SelectedRelativePairs {
  pairs: RelativePair[];
  /** How many pairs the MAX_PAIR_CALLS cap dropped (0 when none). */
  droppedForCap: number;
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Gather both focus persons' relatives, pre-pair them per role with the local
 * heuristic, and return the bounded work list of pairs to score via the API.
 */
export function selectRelativePairs(
  gedcomx1: SimplifiedGedcomX,
  focusId1: string,
  gedcomx2: SimplifiedGedcomX,
  focusId2: string,
): SelectedRelativePairs {
  const targets = gatherRelatives(gedcomx1, focusId1);
  const candidates = gatherRelatives(gedcomx2, focusId2);

  const roles: RelativeRole[] = ["parent", "spouse", "child"];
  let pairs: RelativePair[] = [];
  for (const role of roles) {
    pairs = pairs.concat(
      pairRole(role, targets[role], candidates[role]),
    );
  }

  // Defensive global cap: keep the highest-preScore pairs, report the rest.
  let droppedForCap = 0;
  if (pairs.length > MAX_PAIR_CALLS) {
    pairs.sort(
      (a, b) =>
        b.preScore - a.preScore ||
        compareIds(a.target.id, b.target.id) ||
        compareIds(a.candidate.id, b.candidate.id),
    );
    droppedForCap = pairs.length - MAX_PAIR_CALLS;
    pairs = pairs.slice(0, MAX_PAIR_CALLS);
  }

  return { pairs, droppedForCap };
}

// ─── Relative gathering ──────────────────────────────────────────────────────

interface RelativesByRole {
  parent: SimplifiedPerson[];
  spouse: SimplifiedPerson[];
  child: SimplifiedPerson[];
}

/**
 * Walk `relationships[]` once and collect the focus person's parents, spouses,
 * and children, resolved to their `persons[]` entries. Ids not present in
 * `persons[]` are skipped. Each role is capped at MAX_RELATIVES_PER_ROLE.
 */
export function gatherRelatives(
  gedcomx: SimplifiedGedcomX,
  focusId: string,
): RelativesByRole {
  const parentIds = new Set<string>();
  const spouseIds = new Set<string>();
  const childIds = new Set<string>();

  for (const rel of gedcomx.relationships ?? []) {
    if (rel.type === "ParentChild") {
      if (rel.child === focusId && rel.parent !== undefined) {
        parentIds.add(rel.parent);
      }
      if (rel.parent === focusId && rel.child !== undefined) {
        childIds.add(rel.child);
      }
    } else if (rel.type === "Couple") {
      if (rel.person1 === focusId && rel.person2 !== undefined) {
        spouseIds.add(rel.person2);
      } else if (rel.person2 === focusId && rel.person1 !== undefined) {
        spouseIds.add(rel.person1);
      }
    }
  }

  const byId = new Map<string, SimplifiedPerson>();
  for (const p of gedcomx.persons ?? []) {
    if (p.id !== undefined) byId.set(p.id, p);
  }
  const resolve = (ids: Set<string>): SimplifiedPerson[] => {
    const out: SimplifiedPerson[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (p !== undefined) out.push(p);
    }
    return out.slice(0, MAX_RELATIVES_PER_ROLE);
  };

  return {
    parent: resolve(parentIds),
    spouse: resolve(spouseIds),
    child: resolve(childIds),
  };
}

// ─── Per-role greedy pairing ─────────────────────────────────────────────────

/**
 * Greedy one-to-one assignment within a single role: score every
 * target×candidate pair, sort by preScore descending (deterministic id
 * tie-break), then assign each relative at most once, stopping at the floor.
 * Collapses N×M into at most min(N, M) pairs.
 */
export function pairRole(
  role: RelativeRole,
  targets: SimplifiedPerson[],
  candidates: SimplifiedPerson[],
): RelativePair[] {
  const scored: Array<{
    target: SimplifiedPerson;
    candidate: SimplifiedPerson;
    preScore: number;
  }> = [];
  for (const target of targets) {
    for (const candidate of candidates) {
      scored.push({ target, candidate, preScore: preScore(target, candidate) });
    }
  }

  scored.sort(
    (a, b) =>
      b.preScore - a.preScore ||
      compareIds(a.target.id, b.target.id) ||
      compareIds(a.candidate.id, b.candidate.id),
  );

  const usedTarget = new Set<SimplifiedPerson>();
  const usedCandidate = new Set<SimplifiedPerson>();
  const pairs: RelativePair[] = [];
  for (const s of scored) {
    if (s.preScore < PRE_SCORE_FLOOR) break; // sorted desc → nothing better remains
    if (usedTarget.has(s.target) || usedCandidate.has(s.candidate)) continue;
    pairs.push({ role, target: s.target, candidate: s.candidate, preScore: s.preScore });
    usedTarget.add(s.target);
    usedCandidate.add(s.candidate);
  }
  return pairs;
}

// ─── Local pre-score ─────────────────────────────────────────────────────────

/**
 * Cheap network-free likelihood that two same-role relatives are the same
 * person. Gender mismatch hard-gates to 0; otherwise a name+year blend.
 */
export function preScore(t: SimplifiedPerson, c: SimplifiedPerson): number {
  // Gender gate: a male relative can't be the same person as a female one.
  if (t.gender && c.gender && t.gender !== c.gender) return 0;

  const nameScore = nameSimilarity(fullName(t), fullName(c));

  const yearT = birthYear(t);
  const yearC = birthYear(c);
  let yearScore: number;
  if (yearT !== undefined && yearC !== undefined) {
    yearScore = Math.max(0, 1 - Math.abs(yearT - yearC) / YEAR_TOLERANCE);
  } else {
    yearScore = 0.5; // neutral — don't penalize missing data
  }

  return NAME_WEIGHT * nameScore + YEAR_WEIGHT * yearScore;
}

/** Normalized `given surname` of the person's preferred (else first) name. */
function fullName(p: SimplifiedPerson): string {
  const names = p.names ?? [];
  const name = names.find((n) => n.preferred) ?? names[0];
  if (name === undefined) return "";
  const parts = [name.given, name.surname].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );
  return normalizeString(parts.join(" "));
}

/**
 * Earliest birth (or birth-like) year for the person, parsed as the first
 * 4-digit run of any birth-like fact's `standard_date` (falling back to `date`).
 * Full date precision is unnecessary for a pre-filter.
 */
function birthYear(p: SimplifiedPerson): number | undefined {
  let earliest: number | undefined;
  for (const fact of p.facts ?? []) {
    if (fact.type === undefined || !BIRTHLIKE_FACT_TYPES.has(fact.type)) continue;
    const raw = fact.standard_date ?? fact.date;
    if (raw === undefined) continue;
    const match = raw.match(/(\d{4})/);
    if (match === null) continue;
    const year = Number(match[1]);
    if (earliest === undefined || year < earliest) earliest = year;
  }
  return earliest;
}

/** Stable id comparison; undefined ids sort last. */
function compareIds(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a < b ? -1 : 1;
}
