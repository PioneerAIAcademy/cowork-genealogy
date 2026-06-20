// gedcomx-ids — shared id-allocation helpers for SimplifiedGedcomX writers.
//
// The merge core (utils/merge-gedcomx.ts) and the tree_edit tool both allocate
// the next `<prefix><n>` id above the document's current maximum. This is the
// single source of that logic so the two cannot drift.

import type { SimplifiedGedcomX } from "../types/gedcomx.js";

/** Highest numeric suffix used by any `<prefix><n>` id of `prefix` in `doc`. */
export function maxIdNum(doc: SimplifiedGedcomX, prefix: string): number {
  let max = 0;
  const consider = (id: string | undefined): void => {
    if (!id) return;
    const m = id.match(/^([A-Za-z]+)(\d+)$/);
    if (m && m[1] === prefix) {
      const n = Number(m[2]);
      if (n > max) max = n;
    }
  };
  for (const p of doc.persons ?? []) {
    consider(p.id);
    for (const n of p.names ?? []) consider(n.id);
    for (const f of p.facts ?? []) consider(f.id);
  }
  for (const r of doc.relationships ?? []) {
    consider(r.id);
    for (const f of r.facts ?? []) consider(f.id);
  }
  for (const s of doc.sources ?? []) consider(s.id);
  for (const pl of doc.places ?? []) consider(pl.id);
  return max;
}

/** The next free `<prefix><n>` id (max + 1) in `doc`. */
export function nextId(doc: SimplifiedGedcomX, prefix: string): string {
  return `${prefix}${maxIdNum(doc, prefix) + 1}`;
}
