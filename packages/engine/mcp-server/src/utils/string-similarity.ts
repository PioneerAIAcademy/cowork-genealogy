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
