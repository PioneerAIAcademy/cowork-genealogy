// String similarity helpers.
//
// `nameSimilarity` is a Java-parity port of MobWarnings.nameSimilarity:
// case-insensitive, Levenshtein-based, returns 1.0 for an exact match and
// approaches 0 as the strings diverge. The Java implementation is at
// personal/person_warning/warning-java.txt:2169.
//
// Used by `hasDiffSurname` (and the relative-mob variant) to ignore minor
// spelling differences (e.g., "Smith" vs "Smyth" still scores > 0.5).

/**
 * Levenshtein edit distance between two strings.
 *
 * Standard O(m * n) dynamic-programming version with a single-row rolling
 * buffer (O(min(m, n)) memory). Pure ASCII characters are compared
 * code-unit by code-unit, which matches Java's `String.charAt` behavior on
 * BMP characters.
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure b is the shorter string so the row is as small as possible.
  if (a.length < b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const m = a.length;
  const n = b.length;
  let prev: number[] = new Array(n + 1);
  let curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n];
}

/**
 * Similarity score in [0, 1]: 1.0 = identical (case-insensitive), 0 = totally
 * different. Mirrors Java's MobWarnings.nameSimilarity exactly:
 *
 *   nameSimilarity = 1 - (levenshtein(a, b) / max(len(a), len(b)))
 *
 * Empty inputs return 1.0 when both empty, 0.0 when only one is empty.
 */
export function nameSimilarity(name1: string, name2: string): number {
  const a = name1.toLowerCase();
  const b = name2.toLowerCase();
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1.0 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Sorensen-Dice coefficient over character bigrams. The value Java's
 * MobWarnings uses for similar-name detection (DICE_CUTOFF = 0.66, declared
 * at warning-java.txt:16). Returns 0..1 — higher = more similar.
 *
 * Strings are lowercased, diacritic-stripped, whitespace-collapsed
 * before bigram extraction so "José" and "jose" score the same. Strings
 * shorter than 2 characters always score 0 (no bigrams to compare).
 *
 * Bigrams are extracted with overlap and counted with multiplicity, so
 * "abcd" → {ab:1, bc:1, cd:1}. The Dice formula is:
 *   2 * |intersection| / (|bg(s1)| + |bg(s2)|)
 * where the intersection size sums the min-of-counts per shared bigram.
 */
export function diceCoefficient(s1: string, s2: string): number {
  const a = normalizeString(s1);
  const b = normalizeString(s2);
  if (a.length < 2 || b.length < 2) return 0;
  if (a === b) return 1.0;
  const bg1 = bigramCounts(a);
  const bg2 = bigramCounts(b);
  let intersection = 0;
  for (const [bg, count1] of bg1) {
    const count2 = bg2.get(bg);
    if (count2 !== undefined) intersection += Math.min(count1, count2);
  }
  const total1 = a.length - 1;
  const total2 = b.length - 1;
  return (2 * intersection) / (total1 + total2);
}

function bigramCounts(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const bg = s.substring(i, i + 2);
    out.set(bg, (out.get(bg) ?? 0) + 1);
  }
  return out;
}

/**
 * Java parity for NormalizeUtil.normalizeString — lowercase, strip
 * combining marks (diacritics), collapse whitespace runs to single
 * spaces, trim. Used as the entry-point pre-process for every name
 * similarity comparison.
 *
 * Unicode NFD decomposes accented characters into base + combining mark,
 * and the regex strips the marks (̀-ͯ covers the combining
 * diacritical block).
 */
export function normalizeString(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
