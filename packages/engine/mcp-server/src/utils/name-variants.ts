import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Path resolves to mcp-server/config/given-name-variants.json in both dev
// (tsx/vitest running from src/) and prod (compiled JS in build/) — same
// ../../config pattern as BUNDLED_CLIENT_CONFIG_PATH in auth/config.ts.
const VARIANTS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../config/given-name-variants.json"
);

interface VariantEntry {
  form: string;
  attested: boolean;
  source?: string;
}

interface FormalEntry {
  period: string;
  region: string;
  source: string;
  variants: VariantEntry[];
}

interface VariantTable {
  _meta: Record<string, unknown>;
  [lang: string]: Record<string, FormalEntry> | Record<string, unknown>;
}

export interface NameFamily {
  formal: string;
  allForms: string[];
}

export interface NameExpansionResult {
  expanded: string;
  expansions: Record<string, string[]>;
}

// Bidirectional lookup: lowercased name → NameFamily (formal name + all forms).
// Lazily built on first access, module-level cached (same pattern as
// browseBudgetSeen in image-transcribe.ts).
let lookupMap: Map<string, NameFamily> | null = null;

function ensureLoaded(): Map<string, NameFamily> {
  if (lookupMap) return lookupMap;

  const raw = readFileSync(VARIANTS_PATH, "utf-8");
  const table: VariantTable = JSON.parse(raw);
  lookupMap = new Map();

  const en = table.en as Record<string, FormalEntry> | undefined;
  if (!en) return lookupMap;

  // Collect families, merging entries that share variant forms (e.g.
  // Catherine/Katherine both list Kate → they form one merged family).
  // Build in two passes:
  //   1. Collect raw families from table entries.
  //   2. Merge families that share any form, then register every form.

  const rawFamilies: { formal: string; forms: Set<string> }[] = [];
  for (const [formal, entry] of Object.entries(en)) {
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
      lookupMap.set(form.toLowerCase(), entry);
    }
  }

  return lookupMap;
}

/** Test-only reset — the Map is module-level and persists across `it()` blocks. */
export function __clearVariantCacheForTests(): void {
  lookupMap = null;
}

/**
 * Bidirectional lookup: given any name (formal or variant), returns the
 * family of equivalent names, or null if not in the table. Case-insensitive.
 */
export function lookupNameFamily(name: string): NameFamily | null {
  const map = ensureLoaded();
  return map.get(name.toLowerCase()) ?? null;
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
 * Given a full name string (e.g. "Elizabeth Martin"), expand any recognized
 * given names into Lucene OR groups for fulltext_search.
 *
 * Returns null if no expansion applies (no recognized given names, or all
 * tokens use explicit operators).
 *
 * Period-containing forms (scribal abbreviations like "Eliz.") are excluded
 * from the OR group to avoid Lucene parse errors.
 */
export function expandNameForFulltext(name: string): NameExpansionResult | null {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let anyExpanded = false;
  const expansions: Record<string, string[]> = {};
  const expandedTokens: string[] = [];

  for (const token of tokens) {
    if (hasOperator(token)) {
      expandedTokens.push(token);
      continue;
    }

    const family = lookupNameFamily(token);
    if (!family) {
      expandedTokens.push(token);
      continue;
    }

    // Build OR group with all forms in the family, excluding period-containing
    // forms. The original token's casing is preserved in the group.
    const forms = family.allForms.filter((f) => !hasPeriod(f));
    if (forms.length <= 1) {
      // Only one form survives after filtering — no expansion needed.
      expandedTokens.push(token);
      continue;
    }

    // Put the original token first in the group, then the rest.
    const originalLower = token.toLowerCase();
    const ordered = [
      token,
      ...forms.filter((f) => f.toLowerCase() !== originalLower),
    ];

    expandedTokens.push(`(${ordered.join(" OR ")})`);
    expansions[family.formal] = forms.filter(
      (f) => f.toLowerCase() !== originalLower
    );
    anyExpanded = true;
  }

  if (!anyExpanded) return null;

  return {
    expanded: expandedTokens.join(" "),
    expansions,
  };
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

  for (const token of tokens) {
    const family = lookupNameFamily(token);
    if (!family) continue;

    const originalLower = token.toLowerCase();
    const others = family.allForms.filter(
      (f) => f.toLowerCase() !== originalLower
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
