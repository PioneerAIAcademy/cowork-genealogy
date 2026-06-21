// Similar-name pair detection.
//
// Port of Java MobWarnings.getSimilarNamePairs (warning-java.txt:2108).
// Given two lists of persons, returns the set of {personId1, personId2}
// pairs whose names are similar enough that they might be duplicate
// records of the same individual.
//
// The Java implementation uses three independent signals; ANY one
// triggering marks the pair as similar:
//   1. Dice similarity > 0.66 (DICE_CUTOFF) on any name combination
//   2. Subset overlap: one name fully shares its tokens with the other
//      (e.g. "John" vs "John Smith")
//   3. Initial alignment: when one name uses initials (e.g. "J Smith")
//      and they align with the other's full tokens
//
// This v1 port implements signals 1 and 2. Signal 3 is sketched but
// conservative — the Java source for `alignInitials` is not in our
// reference. Can be tightened when test cases drive the need.
//
// Used by the four similar-children / similar-spouses warnings plus
// the close-child-events and dissimilar-spouses warnings.

import type { SimplifiedPerson } from "../types/gedcomx.js";
import { diceCoefficient, normalizeString } from "./string-similarity.js";

/** Java parity: `private static final float DICE_CUTOFF = 0.66f;` */
const DICE_CUTOFF = 0.66;

/**
 * Returns an array of {a, b} id tuples (sorted lexicographically per
 * pair, so order is canonical) for every pair across the two person
 * lists whose names look similar. Diagonal pairs (a person compared
 * with themselves) and duplicate-direction pairs are skipped.
 *
 * @param targetPersons Persons on one side of the comparison.
 * @param candidatePersons Persons on the other side. When matching
 *   inside a single set, pass the same list twice.
 * @param noiseNames Strings that should not count as evidence of
 *   similarity (e.g., a child carrying the father's surname; the
 *   surname alone shouldn't be enough to call them duplicate spouses).
 * @param compareGivenOnly When true, only the given name is used;
 *   when false, given + surname are concatenated.
 */
export function getSimilarNamePairs(
  targetPersons: readonly SimplifiedPerson[],
  candidatePersons: readonly SimplifiedPerson[],
  noiseNames: readonly string[],
  compareGivenOnly: boolean,
): Array<readonly [string, string]> {
  const normalizedNoise = noiseNames
    .map((n) => normalizeString(n))
    .filter((n) => n.length > 0);
  const seen = new Set<string>();
  const out: Array<readonly [string, string]> = [];

  for (const target of targetPersons) {
    const tid = target.id;
    if (tid === undefined) continue;
    for (const candidate of candidatePersons) {
      const cid = candidate.id;
      if (cid === undefined) continue;
      if (tid === cid) continue; // skip self-pairs

      // Canonicalize the pair so {A,B} and {B,A} dedupe.
      const [a, b] = tid < cid ? [tid, cid] : [cid, tid];
      const key = `${a}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);

      if (isSimilarPair(target, candidate, normalizedNoise, compareGivenOnly)) {
        out.push([a, b] as const);
      }
    }
  }
  return out;
}

function isSimilarPair(
  person1: SimplifiedPerson,
  person2: SimplifiedPerson,
  noiseNames: readonly string[],
  compareGivenOnly: boolean,
): boolean {
  const names1 = getCleanNames(person1, noiseNames, compareGivenOnly);
  const names2 = getCleanNames(person2, noiseNames, compareGivenOnly);
  if (names1.length === 0 || names2.length === 0) return false;

  let anyDiceHit = false;
  let anySubsetHit = false;

  for (const n1 of names1) {
    for (const n2 of names2) {
      // Signal 1 — Dice similarity over the full strings.
      if (diceCoefficient(n1, n2) > DICE_CUTOFF) {
        anyDiceHit = true;
      }

      // Signal 2 — subset overlap: do the parts of one fully appear in
      // the other? (e.g. "John" vs "John Smith" → "John" is a subset)
      const parts1 = splitNameParts(n1);
      const parts2 = splitNameParts(n2);
      if (parts1.length > 0 && parts2.length > 0) {
        const shared = sharedPartCount(parts1, parts2);
        if (shared > 0) {
          const unshared1 = parts1.length - shared;
          const unshared2 = parts2.length - shared;
          if (unshared1 === 0 || unshared2 === 0) {
            anySubsetHit = true;
          }
        }
      }
    }
  }

  return anyDiceHit || anySubsetHit;
}

/**
 * Build the list of normalized "clean names" for similarity comparison.
 * When `compareGivenOnly` is true, emit just the given-name part of each
 * `names[]` entry; otherwise concatenate given + surname.
 *
 * Names matching the `noiseNames` filter are dropped (e.g. a noise list
 * containing the focal person's surname stops shared surnames from
 * counting toward similarity for `hasDissimilarSpousesWithSameMarriageYear`).
 */
function getCleanNames(
  person: SimplifiedPerson,
  noiseNames: readonly string[],
  compareGivenOnly: boolean,
): string[] {
  const out: string[] = [];
  const names = person.names ?? [];
  for (const name of names) {
    let raw: string;
    if (compareGivenOnly) {
      if (!name.given) continue;
      raw = name.given;
    } else {
      const parts: string[] = [];
      if (name.given) parts.push(name.given);
      if (name.surname) parts.push(name.surname);
      if (parts.length === 0) continue;
      raw = parts.join(" ");
    }
    const cleaned = normalizeString(raw);
    if (cleaned.length === 0) continue;
    if (noiseNames.includes(cleaned)) continue;
    out.push(cleaned);
  }
  return out;
}

function splitNameParts(s: string): string[] {
  return s.split(/\s+/).filter((p) => p.length > 0);
}

function sharedPartCount(
  parts1: readonly string[],
  parts2: readonly string[],
): number {
  const set2 = new Set(parts2);
  let shared = 0;
  const counted = new Set<string>();
  for (const p of parts1) {
    if (set2.has(p) && !counted.has(p)) {
      shared++;
      counted.add(p);
    }
  }
  return shared;
}
