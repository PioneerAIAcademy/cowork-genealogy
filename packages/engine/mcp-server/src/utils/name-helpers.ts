// name-helpers — per-object selectors over a person's `names`, mirroring
// fact-helpers' per-object shape. Selection only: callers own their own
// formatting and no-name fallback, which deliberately differ.

import type { SimplifiedName } from "../types/gedcomx.js";

/**
 * The person's preferred name, else the first, else undefined.
 *
 * Tests `preferred === true`, not truthiness: `preferred` is `const: true` in
 * the tree schema and `tree-sanitize.ts` prunes any non-`true` value at read,
 * so the two spellings can only differ on a value the validator rejects.
 *
 * The `?? names[0]` fallback is load-bearing, not dead code: the persisted tree
 * still writes a non-preferred `names[0]` (producer side, out of scope of the
 * consumer consolidation), so callers must not "simplify" to `names[0]`.
 */
export function preferredName(
  names: SimplifiedName[] | undefined,
): SimplifiedName | undefined {
  const list = names ?? [];
  return list.find((n) => n.preferred === true) ?? list[0];
}
