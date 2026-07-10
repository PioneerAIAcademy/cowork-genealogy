// Read-time healing for legacy tree.gedcomx.json documents.
//
// The validator closed every object shape (tree-shape.ts), which means trees
// written before the tightening — by the old merge core (`preferred: false`
// on every non-preferred merged name, top-level `places[]` carried per the
// old spec §6.7), by the old open-shape validator (person-level `sources`,
// invented fact keys like `date_certainty`), or by hand — no longer validate.
// Every persistence tool validates the WHOLE project before writing anything,
// so one legacy shape would otherwise brick every write on that project,
// including research-log appends, with no tree_edit op able to express the
// repair.
//
// `sanitizeTree` heals exactly the shapes whose repair is unambiguous, and
// returns one warning per healed class so the LLM can narrate what changed.
// Ambiguous problems are deliberately NOT healed and still hard-fail
// validation: dangling references (can't infer the target), swapped
// relationship endpoint keys (can't infer direction), duplicate ids (can't
// pick a winner), missing `given` (spelling unknowns as `""` is the agent's
// call), and non-PascalCase fact types (meaning is the agent's call).
//
// Callers: every tool that reads tree.gedcomx.json — tree_edit and the merge
// tools persist the healed document on their next successful write (one-shot
// migration); research_append/research_log_append heal in memory only, so
// their cross-file validation sees the healed tree without touching it.
// The inline-candidate twin is `sanitizeCandidate` in tools/merge-shared.ts,
// which strips the record_read-legal shapes (places, person sources) but
// leaves everything else to hard validation — candidates are fresh tool
// output, not legacy documents, and junk there should be rejected loudly.

import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import { nextId } from "../utils/gedcomx-ids.js";
import {
  TREE_TOP_LEVEL_FIELDS,
  TREE_PERSON_FIELDS,
  TREE_NAME_FIELDS,
  TREE_FACT_FIELDS,
  TREE_PARENT_CHILD_FIELDS,
  TREE_COUPLE_FIELDS,
  TREE_SOURCE_FIELDS,
  TREE_SOURCE_REF_FIELDS,
} from "./tree-shape.js";

export interface SanitizeTreeResult {
  tree: SimplifiedGedcomX;
  warnings: string[];
}

/** Tally of healed shapes, flushed into human-readable warnings at the end. */
class Tally {
  droppedKeys = new Map<string, number>(); // "persons.date_certainty" -> n
  flags = new Map<string, number>(); // "preferred" | "primary" -> n
  mintedIds = new Map<string, number>(); // prefix -> n
  qualityCoerced = 0;
  qualityDropped = 0;
  placesDropped = 0;
  personSourcesDropped = 0;
  nonObjectsDropped = 0;

  key(where: string, key: string): void {
    const k = `${where}.${key}`;
    this.droppedKeys.set(k, (this.droppedKeys.get(k) ?? 0) + 1);
  }
}

function pruneKeys(obj: any, allowed: Set<string>, where: string, tally: Tally): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      // places / person-sources get their own targeted warnings below.
      if (!(where === "tree" && key === "places") && !(where === "persons" && key === "sources")) {
        tally.key(where, key);
      }
      delete obj[key];
    }
  }
}

/** `preferred`/`primary` are `const: true` — anything else means "not it". */
function pruneFlag(obj: any, field: string, tally: Tally): void {
  if (field in obj && obj[field] !== true) {
    delete obj[field];
    tally.flags.set(field, (tally.flags.get(field) ?? 0) + 1);
  }
}

/** Legacy string QUAY ("0"–"3") becomes the integer; anything else invalid goes. */
function pruneQuality(sref: any, tally: Tally): void {
  if (!("quality" in sref)) return;
  const q = sref.quality;
  if (Number.isInteger(q) && q >= 0 && q <= 3) return;
  if (typeof q === "string" && /^[0-3]$/.test(q.trim())) {
    sref.quality = Number(q.trim());
    tally.qualityCoerced += 1;
    return;
  }
  delete sref.quality;
  tally.qualityDropped += 1;
}

function sanitizeSourceRefs(holder: any, tally: Tally): void {
  if (!("sources" in holder)) return;
  if (!Array.isArray(holder.sources)) {
    delete holder.sources;
    tally.nonObjectsDropped += 1;
    return;
  }
  holder.sources = holder.sources.filter((s: any) => {
    if (!s || typeof s !== "object") {
      tally.nonObjectsDropped += 1;
      return false;
    }
    return true;
  });
  for (const sref of holder.sources) {
    pruneKeys(sref, TREE_SOURCE_REF_FIELDS, "source refs", tally);
    pruneQuality(sref, tally);
  }
  if (holder.sources.length === 0) delete holder.sources;
}

/**
 * Filter non-object entries out of an array IN PLACE on `holder[key]`.
 * Deliberately does nothing when the value is missing or not an array:
 * inventing an empty section would heal a truncated or corrupt file into a
 * "valid" empty tree — silent data loss. The validator reports those.
 */
function objectEntries(holder: any, key: string, tally: Tally): any[] {
  if (!Array.isArray(holder[key])) return [];
  holder[key] = holder[key].filter((x: any) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) {
      tally.nonObjectsDropped += 1;
      return false;
    }
    return true;
  });
  return holder[key];
}

function sanitizeFact(fact: any, tree: SimplifiedGedcomX, tally: Tally): void {
  pruneKeys(fact, TREE_FACT_FIELDS, "facts", tally);
  pruneFlag(fact, "primary", tally);
  if (!fact.id) {
    fact.id = nextId(tree, "F");
    tally.mintedIds.set("F", (tally.mintedIds.get("F") ?? 0) + 1);
  }
  sanitizeSourceRefs(fact, tally);
}

/**
 * Heal the legacy shapes in a parsed tree.gedcomx.json whose repair is
 * unambiguous. Returns a deep copy plus one warning per healed class; the
 * input is never mutated. A tree with nothing to heal comes back with zero
 * warnings and deep-equal content.
 */
export function sanitizeTree(input: unknown): SanitizeTreeResult {
  const tally = new Tally();
  const warnings: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    // Not tree-shaped at all — nothing sane to heal; let validation report it.
    return { tree: input as SimplifiedGedcomX, warnings };
  }
  const tree = structuredClone(input) as any;

  const placeCount = Array.isArray(tree.places) ? tree.places.length : "places" in tree ? 1 : 0;
  if (placeCount > 0) tally.placesDropped = placeCount;
  pruneKeys(tree, TREE_TOP_LEVEL_FIELDS, "tree", tally);

  for (const person of objectEntries(tree, "persons", tally)) {
    if (Array.isArray(person.sources)) tally.personSourcesDropped += person.sources.length;
    else if ("sources" in person) tally.personSourcesDropped += 1;
    pruneKeys(person, TREE_PERSON_FIELDS, "persons", tally);
    if (!person.id) {
      person.id = nextId(tree, "I");
      tally.mintedIds.set("I", (tally.mintedIds.get("I") ?? 0) + 1);
    }
    for (const name of objectEntries(person, "names", tally)) {
      pruneKeys(name, TREE_NAME_FIELDS, "names", tally);
      pruneFlag(name, "preferred", tally);
      if (!name.id) {
        name.id = nextId(tree, "N");
        tally.mintedIds.set("N", (tally.mintedIds.get("N") ?? 0) + 1);
      }
      sanitizeSourceRefs(name, tally);
    }
    if (Array.isArray(person.facts)) {
      for (const fact of objectEntries(person, "facts", tally)) {
        sanitizeFact(fact, tree, tally);
      }
      if (person.facts.length === 0) delete person.facts;
    }
  }

  for (const rel of objectEntries(tree, "relationships", tally)) {
    const allowed = rel.type === "Couple" ? TREE_COUPLE_FIELDS : TREE_PARENT_CHILD_FIELDS;
    // Couple facts are legal; ParentChild facts are not — but a ParentChild's
    // stray `facts` is an unknown key for its type and prunes with a warning.
    pruneKeys(rel, allowed, "relationships", tally);
    if (!rel.id) {
      rel.id = nextId(tree, "R");
      tally.mintedIds.set("R", (tally.mintedIds.get("R") ?? 0) + 1);
    }
    if (rel.type === "Couple" && Array.isArray(rel.facts)) {
      for (const fact of objectEntries(rel, "facts", tally)) {
        sanitizeFact(fact, tree, tally);
      }
      if (rel.facts.length === 0) delete rel.facts;
    }
    sanitizeSourceRefs(rel, tally);
  }

  for (const src of objectEntries(tree, "sources", tally)) {
    pruneKeys(src, TREE_SOURCE_FIELDS, "sources", tally);
    if (!src.id) {
      src.id = nextId(tree, "S");
      tally.mintedIds.set("S", (tally.mintedIds.get("S") ?? 0) + 1);
    }
  }

  // ── Flush the tally into narratable warnings ──────────────────────────────
  if (tally.placesDropped > 0) {
    warnings.push(
      `healed legacy tree: dropped the top-level places section ` +
        `(${tally.placesDropped} entr${tally.placesDropped === 1 ? "y" : "ies"}) — ` +
        `the tree format carries places as names on facts`,
    );
  }
  if (tally.personSourcesDropped > 0) {
    warnings.push(
      `healed legacy tree: dropped ${tally.personSourcesDropped} person-level ` +
        `source reference(s) — tree source references live on names/facts/relationships`,
    );
  }
  for (const [field, n] of tally.flags) {
    warnings.push(
      `healed legacy tree: removed '${field}: false' from ${n} ` +
        `${field === "preferred" ? "name(s)" : "fact(s)"} — absence means false, ` +
        `and the schema pins ${field} to true-or-absent`,
    );
  }
  for (const [key, n] of [...tally.droppedKeys].sort()) {
    const [where, name] = key.split(".");
    warnings.push(
      `healed legacy tree: dropped unknown property '${name}' from ${n} ${where} ` +
        `object(s) — not part of the tree format`,
    );
  }
  for (const [prefix, n] of [...tally.mintedIds].sort()) {
    warnings.push(`healed legacy tree: assigned ${prefix} ids to ${n} object(s) that had none`);
  }
  if (tally.qualityCoerced > 0) {
    warnings.push(
      `healed legacy tree: converted ${tally.qualityCoerced} string quality value(s) ` +
        `to the QUAY integer`,
    );
  }
  if (tally.qualityDropped > 0) {
    warnings.push(
      `healed legacy tree: dropped ${tally.qualityDropped} quality value(s) that were ` +
        `not integers 0-3 (GEDCOM QUAY)`,
    );
  }
  if (tally.nonObjectsDropped > 0) {
    warnings.push(
      `healed legacy tree: removed ${tally.nonObjectsDropped} entry(ies) that were ` +
        `not objects where the format requires them`,
    );
  }

  return { tree: tree as SimplifiedGedcomX, warnings };
}
