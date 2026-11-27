import type { CollectionCatalogLoader, CollectionCounts } from "../types/collection.js";
import { isFsBudgetExhausted } from "./fs-budget.js";

/** FamilySearch's collection catalog as a writer read it before its lock, or
 *  `"unavailable"` when that read failed or ran past its budget. */
export type CollectionCatalog = ReadonlyMap<string, CollectionCounts> | "unavailable";

/** How long a caller's write waits on the catalog before going on without it. A
 *  cold read can run past 30s (2 of 51 in the committed e2e logs took 33s and 36s), and Cowork's bridge aborts a call at 60s
 *  (`COWORK_CALL_ABORT_MS`), which the write's own place lookups also spend. The
 *  read keeps running and fills the cache for the next write. */
export const CATALOG_READ_BUDGET_MS = 20_000;

export interface ReadCatalogOptions {
  /** Defaults to `CATALOG_READ_BUDGET_MS`. */
  budgetMs?: number;
  /** Default true: a spent FamilySearch budget is a refusal, not a failed read,
   *  and is rethrown. A caller whose catalog only ever REFUSES passes false, so a
   *  spent budget reads as `"unavailable"` and the write goes ahead: a spent
   *  budget is not evidence about any collection. */
  rethrowBudget?: boolean;
}

/** `loadCatalog`, or `"unavailable"` when it fails or outlasts the budget. */
export async function readCatalog(
  loadCatalog: CollectionCatalogLoader,
  options: ReadCatalogOptions = {},
): Promise<CollectionCatalog> {
  const budgetMs = options.budgetMs ?? CATALOG_READ_BUDGET_MS;
  const rethrowBudget = options.rethrowBudget ?? true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"unavailable">((done) => {
    timer = setTimeout(() => done("unavailable"), budgetMs);
  });
  // Through a resolved promise so a loader that throws synchronously is caught
  // like one that rejects.
  const read = Promise.resolve().then(loadCatalog).catch((err: unknown) => {
    if (rethrowBudget && isFsBudgetExhausted(err)) throw err;
    return "unavailable" as const;
  });
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
