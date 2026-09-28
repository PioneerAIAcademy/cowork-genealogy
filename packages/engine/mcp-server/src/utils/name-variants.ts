import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeString } from "./string-similarity.js";

// Paths resolve to mcp-server/config/*.json in both dev (tsx/vitest running
// from src/) and prod (compiled JS in build/) — same ../../config pattern as
// BUNDLED_CLIENT_CONFIG_PATH in auth/config.ts.
const CONFIG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../config");

/** The table behind fulltext_search / image_transcribe's hidden expansion. */
export const GIVEN_NAME_VARIANTS_PATH = resolve(CONFIG_DIR, "given-name-variants.json");

/** The table behind get_name_variants (issue #2325). */
export const NAME_VARIANTS_GIVEN_PATH = resolve(CONFIG_DIR, "name-variants-given.json");

interface VariantEntry {
  form: string;
  attested?: boolean;
  source?: string;
}

interface FormalEntry {
  period?: string;
  region?: string;
  source?: string;
  variants: VariantEntry[];
}

interface VariantTable {
  _meta: Record<string, unknown>;
  [lang: string]: Record<string, FormalEntry> | Record<string, unknown>;
}

interface NameFamily {
  formal: string;
  allForms: string[];
}

interface NameExpansionResult {
  expanded: string;
  expansions: Record<string, string[]>;
}

interface LoadedTable {
  // Bidirectional lookup: normalized name → NameFamily (formal name + all forms).
  map: Map<string, NameFamily>;
  // Why the table could not be used, or null. Only `strict` lookups see it.
  error: string | null;
}

// One lazily built table per path, module-level cached (same pattern as
// browseBudgetSeen in image-transcribe.ts).
const tables = new Map<string, LoadedTable>();

function buildTable(tablePath: string): LoadedTable {
  const map = new Map<string, NameFamily>();

  let raw: string;
  try {
    raw = readFileSync(tablePath, "utf-8");
  } catch {
    return { map, error: `name-variant table is missing or unreadable: ${tablePath}` };
  }

  let table: VariantTable;
  try {
    table = JSON.parse(raw);
  } catch {
    return { map, error: `name-variant table is not valid JSON: ${tablePath}` };
  }

  const en = table.en as Record<string, FormalEntry> | undefined;
  if (!en || typeof en !== "object" || Array.isArray(en)) {
    return { map, error: `name-variant table has no "en" object: ${tablePath}` };
  }

  // Collect families, merging entries that share variant forms (e.g.
  // Catherine/Katherine both list Kate → they form one merged family).
  // Build in two passes:
  //   1. Collect raw families from table entries.
  //   2. Merge families that share any form, then register every form.

  const rawFamilies: { formal: string; forms: Set<string> }[] = [];
  for (const [formal, entry] of Object.entries(en)) {
    if (!Array.isArray(entry?.variants)) {
      return { map, error: `name-variant table entry "${formal}" has no variants array: ${tablePath}` };
    }
    const forms = new Set<string>();
    forms.add(formal);
    for (const v of entry.variants) {
      forms.add(v.form);
    }
    rawFamilies.push({ formal, forms });
  }

  // Merge families that share any form (e.g. Catherine and Katherine).
  // Simple union-find: iterate and merge until stable.
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rawFamilies.length; i++) {
      for (let j = i + 1; j < rawFamilies.length; j++) {
        let overlap = false;
        for (const f of rawFamilies[j].forms) {
          if (rawFamilies[i].forms.has(f)) {
            overlap = true;
            break;
          }
        }
        if (overlap) {
          for (const f of rawFamilies[j].forms) {
            rawFamilies[i].forms.add(f);
          }
          // Keep the first formal name as the family's formal name
          rawFamilies.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  // Register every form in every merged family.
  for (const family of rawFamilies) {
    const allForms = [...family.forms];
    const entry: NameFamily = { formal: family.formal, allForms };
    for (const form of allForms) {
      map.set(normalizeString(form), entry);
    }
  }

  return { map, error: null };
}

// Cached only once fully built, so a failed build never leaves a partial map.
function ensureLoaded(tablePath: string): LoadedTable {
  let loaded = tables.get(tablePath);
  if (!loaded) {
    loaded = buildTable(tablePath);
    tables.set(tablePath, loaded);
  }
  return loaded;
}

/** Test-only reset — the cache is module-level and persists across `it()` blocks. */
export function __clearVariantCacheForTests(): void {
  tables.clear();
}

/**
 * Bidirectional lookup: given any name (formal or variant), returns the
 * family of equivalent names, or null if not in the table. Case- and
 * diacritic-insensitive. A table that cannot be loaded degrades to null for
 * every name — unless `strict`, which throws instead.
 */
export function lookupNameFamily(
  name: string,
  tablePath: string = GIVEN_NAME_VARIANTS_PATH,
  opts: { strict?: boolean } = {}
): NameFamily | null {
  const { map, error } = ensureLoaded(tablePath);
  if (error && opts.strict) throw new Error(error);
  return map.get(normalizeString(name)) ?? null;
}

// Tokens that start with an operator or contain special Lucene syntax
// should not be expanded — the user chose explicit query syntax.
function hasOperator(token: string): boolean {
  return /^[+\-"]/.test(token) || token.includes("*") || token.includes('"');
}

// A form containing a period risks Lucene field-access parse errors inside
// an unquoted OR group — exclude from fulltext expansion, keep for VLM.
function hasPeriod(form: string): boolean {
  return form.includes(".");
}

/**
 * Given a full name string (e.g. "Elizabeth Martin"), expand the first
 * recognized given name into quoted-phrase variants for fulltext_search.
 *
 * FamilySearch's q.fullName does not support (A OR B) syntax — parentheses
 * and OR are treated as literal text. Instead, each variant is combined with
 * the remaining tokens as a separate quoted phrase:
 *   "Elizabeth Martin" "Betty Martin" "Bess Martin"
 *
 * Returns null if no expansion applies (no recognized given names, all
 * tokens use explicit operators, or the input contains double quotes).
 *
 * Only the first recognized given-name token is expanded — expanding
 * surname-position tokens dissolves the only discriminating half of the
 * query (e.g. "Mary Thomas" would fan "Thomas" to Thos, which is wrong).
 *
 * Period-containing forms (scribal abbreviations like "Eliz.") are excluded
 * to avoid Lucene parse errors.
 */
export function expandNameForFulltext(name: string): NameExpansionResult | null {
  // Bail if the input contains quotes — the caller chose explicit phrase
  // syntax, and inserting our own quotes would corrupt it.
  if (name.includes('"')) return null;

  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // If any token uses an operator, bail entirely — the caller chose explicit
  // query syntax and expansion would interfere.
  if (tokens.some(hasOperator)) return null;

  // Find the first token that matches a name family.
  let expandedIndex = -1;
  let family: NameFamily | null = null;
  for (let i = 0; i < tokens.length; i++) {
    family = lookupNameFamily(tokens[i]);
    if (family) {
      expandedIndex = i;
      break;
    }
  }

  if (expandedIndex === -1 || !family) return null;

  const expandedToken = tokens[expandedIndex];
  const forms = family.allForms.filter((f) => !hasPeriod(f));
  if (forms.length <= 1) return null;

  // Put the original token first, then the other variants.
  const originalNorm = normalizeString(expandedToken);
  const ordered = [
    expandedToken,
    ...forms.filter((f) => normalizeString(f) !== originalNorm),
  ];

  // Build one quoted phrase per variant, combining it with the unchanged
  // remaining tokens. For a single-token name, emit unquoted variants
  // (no surname context to phrase-wrap with).
  const otherTokens = tokens.filter((_, i) => i !== expandedIndex);
  let expanded: string;

  if (otherTokens.length === 0) {
    // Single token — space-separated variants, no quotes needed.
    expanded = ordered.join(" ");
  } else {
    // Multi-token — each variant combined with the other tokens as a phrase.
    const phrases = ordered.map((variant) => {
      const parts = [...tokens];
      parts[expandedIndex] = variant;
      return `"${parts.join(" ")}"`;
    });
    expanded = phrases.join(" ");
  }

  const others = forms.filter((f) => normalizeString(f) !== originalNorm);
  const expansions: Record<string, string[]> = {
    [expandedToken]: others,
  };

  return { expanded, expansions };
}

// Words that are both given-name variants and common English words.
// For these, expandLookingFor requires an adjacent capitalized token
// (another proper name) before expanding — "29 MAY 1774" does not
// expand, but "May Thornton" does.  Validated against the 180 real
// lookingFor values in eval/ (clack391 round-2 B3).
const AMBIGUOUS_WORDS = new Set([
  "may", "will", "bill", "jack", "beth", "frank", "chuck",
  "rick", "dick", "bob", "ed", "ted", "ned", "hank", "harry",
  "art", "pat", "gene", "ray", "rod", "grant", "rich",
]);

function hasAdjacentCapital(tokens: string[], index: number): boolean {
  const prev = index > 0 ? tokens[index - 1] : undefined;
  const next = index < tokens.length - 1 ? tokens[index + 1] : undefined;
  return (prev !== undefined && /^[A-Z]/.test(prev)) ||
         (next !== undefined && /^[A-Z]/.test(next));
}

/**
 * Given a lookingFor string, expand recognized given names and return
 * an expanded string listing all variant forms for image_transcribe's VLM
 * prompt. Includes all forms (including period-containing scribal abbreviations)
 * since the VLM reads natural language, not query syntax.
 *
 * Returns null if no expansion applies.
 */
export function expandLookingFor(lookingFor: string): NameExpansionResult | null {
  const tokens = lookingFor.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const alsoKnownAs: string[] = [];
  const expansions: Record<string, string[]> = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Only expand tokens that look like proper names (start with uppercase).
    // Lowercase words like "will", "may" match the table but are ordinary
    // English — expanding them corrupts the VLM prompt.
    if (token.length > 0 && token.charAt(0) === token.charAt(0).toLowerCase()) continue;

    // Ambiguous words (names that double as common English) need an
    // adjacent capitalized token to confirm they are used as a name.
    // "29 MAY 1774" → no adjacent capital → skip.
    // "May Thornton" → "Thornton" starts with T → expand.
    if (AMBIGUOUS_WORDS.has(token.toLowerCase()) && !hasAdjacentCapital(tokens, i)) continue;

    const family = lookupNameFamily(token);
    if (!family) continue;

    const originalNorm = normalizeString(token);
    const others = family.allForms.filter(
      (f) => normalizeString(f) !== originalNorm
    );
    if (others.length === 0) continue;

    alsoKnownAs.push(...others);
    expansions[family.formal] = others;
  }

  if (alsoKnownAs.length === 0) return null;

  // Deduplicate (in case multiple tokens resolve to overlapping families)
  const unique = [...new Set(alsoKnownAs)];

  return {
    expanded: `${lookingFor} (also known as ${unique.join(", ")})`,
    expansions,
  };
}
