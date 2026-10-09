import type { Principal } from "../auth/principal.js";
import { fsFetch } from "../utils/fs-fetch.js";
import { getValidToken } from "../auth/refresh.js";
import { parseUpstreamErrorBody } from "../utils/search-helpers.js";
import { mapWithConcurrency } from "../utils/place-resolver.js";
import { collectionCoverage, fetchAllCollections } from "./collections-search.js";
import {
  addAncestry,
  addDescendancy,
  detectGaps,
  selectGaps,
  emptyModel,
} from "../utils/tree-gap-detect.js";
import type { FSCurrentUserResponse } from "../types/person-ancestors.js";
import type { FSCollectionEntry } from "../types/collection.js";
import type {
  FSGapResponse,
  TreeGap,
  TreeGapType,
  TreeGapsInput,
  TreeGapsResult,
} from "../types/tree-gaps.js";

const API = "https://api.familysearch.org/platform";
const ACCEPT = "application/x-fs-v1+json";

// Measured by dev/probe-descendancy.ts: ancestry caps at 8, descendancy at 4.
const MAX_ANCESTOR_GENERATIONS = 8;
const MAX_DESCENDANT_GENERATIONS = 4;
const DEFAULT_ANCESTOR_GENERATIONS = 8;
const DEFAULT_DESCENDANT_GENERATIONS = 4;
const DEFAULT_MAX_HOLES = 20;
const MAX_MAX_HOLES = 50;

// Cowork cuts every MCP call at 60s. Stay well inside it, and cap the fan-out.
const TIME_BUDGET_MS = 40_000;
const CATALOG_WAIT_MS = 15_000;
const MAX_DESCENDANCY_READS = 60;
const CONCURRENCY = 6;

// Record-type facets (collections searchMetadata.typeFacet) that could hold the
// record each hole needs.
const TYPE_FACETS: Record<TreeGapType, readonly string[]> = {
  missing_parents: ["VITAL", "CHURCH_RECORD"],
  no_children: ["VITAL", "CHURCH_RECORD", "CENSUS"],
  child_gap: ["VITAL", "CHURCH_RECORD", "CENSUS"],
  early_last_child: ["VITAL", "CHURCH_RECORD", "CENSUS"],
  no_spouse: ["VITAL", "CHURCH_RECORD"],
  no_death_date: ["VITAL", "CHURCH_RECORD", "CENSUS", "NEWSPAPER"],
};

// ─── MCP schema ─────────────────────────────────────────────────────────────

export const treeGapsToolSchema = {
  name: "tree_gaps",
  description:
    "Survey a FamilySearch tree for holes FamilySearch may have records for, " +
    "before any research project exists. Reads the person's ancestors " +
    "(default 8 generations), the descendants of the person and of the " +
    "ancestors (default 4 generations down, which covers the direct line's " +
    "siblings), and returns the HOLES it computed, not the tree: parents " +
    "missing before the end of a line, a couple with no children, a gap of " +
    "more than 4 years between births, a last child born well before the " +
    "mother was 40, a deceased adult with no spouse, a deceased person with " +
    "no death date. Each hole gives the person's ID, name, life years, the " +
    "year range and place to search, and a `coverage` count of catalog " +
    "collections that could hold the record. Living people never carry a " +
    "hole. If personId is omitted it uses the logged-in user; for anyone " +
    "else, call person_search first. Reads only; writes nothing. Requires " +
    "authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      personId: {
        type: "string",
        description:
          'FamilySearch tree-person ID of the root (e.g. "LZJW-C31"). Omit to ' +
          "use the logged-in user's own tree person. Omit ONLY for " +
          "self-requests; resolve a named person with person_search first.",
      },
      ancestorGenerations: {
        type: "integer",
        description: "Generations of ancestors to read. Integer 1-8. Defaults to 8.",
      },
      descendantGenerations: {
        type: "integer",
        description:
          "Generations of the root's descendants to read. Integer 0-4. Defaults to 4.",
      },
      maxHoles: {
        type: "integer",
        description:
          "Stop reading and return once this many holes (excluding missing " +
          "death dates) are found. Integer 1-50. Defaults to 20.",
      },
    },
  },
} as const;

// ─── Entry point ────────────────────────────────────────────────────────────

function intInRange(
  value: number | undefined,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

async function readJson(
  principal: Principal,
  path: string,
  what: string,
): Promise<FSGapResponse | null> {
  const res = await fsFetch(principal, `${API}${path}`, {
    headers: { Accept: ACCEPT },
  });
  if (res.status === 204) return null;
  if (res.status === 401) {
    throw new Error(
      "FamilySearch rejected the access token (401). The session may have " +
        "expired or been revoked — call the login tool to re-authenticate.",
    );
  }
  if (res.status === 403) throw new Error(`${what} is restricted and cannot be viewed.`);
  if (res.status === 404) throw new Error(`${what} not found in the FamilySearch Family Tree.`);
  if (res.status === 410) throw new Error(`${what} has been deleted from the FamilySearch Family Tree.`);
  if (res.status === 429) {
    throw new Error("FamilySearch rate limit reached. Wait a moment and try again.");
  }
  if (res.status === 400) {
    let detail: string | null = null;
    try {
      detail = parseUpstreamErrorBody(await res.json());
    } catch {
      detail = null;
    }
    throw new Error(`FamilySearch request rejected: ${detail ?? "HTTP 400"}.`);
  }
  if (!res.ok) throw new Error(`FamilySearch tree API error: ${res.status}.`);
  return (await res.json()) as FSGapResponse;
}

async function currentUserPersonId(principal: Principal): Promise<string> {
  const res = await fsFetch(principal, `${API}/users/current`, {
    headers: { Accept: ACCEPT },
  });
  if (res.status === 401) {
    throw new Error(
      "FamilySearch rejected the access token (401). The session may have " +
        "expired or been revoked — call the login tool to re-authenticate.",
    );
  }
  if (!res.ok) {
    throw new Error(`FamilySearch could not read your current user: HTTP ${res.status}.`);
  }
  const body = (await res.json()) as FSCurrentUserResponse;
  const id = body.users?.[0]?.personId;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(
      "Could not determine your FamilySearch tree person (your account may " +
        "not be linked to one). Pass a personId explicitly.",
    );
  }
  return id.trim();
}

/** Catalog for coverage scoring; null when it is slow or unavailable. */
async function loadCatalog(principal: Principal): Promise<FSCollectionEntry[] | null> {
  try {
    const token = await getValidToken(principal);
    const data = await fetchAllCollections(token, principal);
    return data.entries ?? [];
  } catch {
    return null;
  }
}

function score(gaps: TreeGap[], catalog: FSCollectionEntry[]): void {
  for (const g of gaps) {
    if (!g.place || !g.yearRange) continue;
    g.coverage = collectionCoverage(
      catalog,
      g.place,
      g.yearRange.start,
      g.yearRange.end,
      TYPE_FACETS[g.type],
    );
  }
}

// Anchor depths for the descendancy reads: the farthest ancestors, then every
// 4 generations nearer, so each read's 4 levels meet the next one's.
export function anchorDepths(ancestorGenerations: number): number[] {
  const depths: number[] = [];
  for (let a = ancestorGenerations; a > 0; a -= MAX_DESCENDANT_GENERATIONS) depths.push(a);
  return depths.sort((x, y) => x - y);
}

export async function treeGapsTool(
  input: TreeGapsInput,
  principal: Principal,
): Promise<TreeGapsResult> {
  const ancestorGenerations = intInRange(
    input.ancestorGenerations,
    "ancestorGenerations",
    1,
    MAX_ANCESTOR_GENERATIONS,
    DEFAULT_ANCESTOR_GENERATIONS,
  );
  const descendantGenerations = intInRange(
    input.descendantGenerations,
    "descendantGenerations",
    0,
    MAX_DESCENDANT_GENERATIONS,
    DEFAULT_DESCENDANT_GENERATIONS,
  );
  const maxHoles = intInRange(input.maxHoles, "maxHoles", 1, MAX_MAX_HOLES, DEFAULT_MAX_HOLES);

  const started = Date.now();
  const provided = typeof input.personId === "string" ? input.personId.trim() : "";
  const rootId = provided !== "" ? provided : await currentUserPersonId(principal);

  const catalogPromise = loadCatalog(principal);
  const model = emptyModel(ancestorGenerations);
  const notes: string[] = [];

  const ancestry = await readJson(
    principal,
    `/tree/ancestry?person=${encodeURIComponent(rootId)}&generations=${ancestorGenerations}&personDetails=true`,
    `Person ${rootId}`,
  );
  addAncestry(model, ancestry?.persons ?? []);
  const rootPerson = model.people.get(model.ancestors.get(1) ?? rootId);
  if (!rootPerson) {
    throw new Error(`Person ${rootId} not found in the FamilySearch Family Tree.`);
  }

  // Waves, nearest the root first, so a stop early keeps the closest holes.
  const waves: { depth: number; ids: string[] }[] = [];
  if (descendantGenerations > 0) waves.push({ depth: 0, ids: [rootPerson.id] });
  for (const depth of anchorDepths(ancestorGenerations)) {
    const ids: string[] = [];
    for (const [n, id] of model.ancestors) {
      if (Math.floor(Math.log2(n)) === depth) ids.push(id);
    }
    if (ids.length > 0) waves.push({ depth, ids });
  }

  let reads = 0;
  let failedReads = 0;
  let stopReason: TreeGapsResult["scanned"]["stopReason"] = null;
  const target = (): number =>
    detectGaps(model).filter((g) => g.type !== "no_death_date").length;

  for (const wave of waves) {
    if (stopReason) break;
    // The near tier (the root's descendants and every anchor within 4
    // generations) always runs: its holes outrank anything a far anchor adds,
    // and a pedigree edge alone can already hold maxHoles holes. Only the far
    // anchors are skipped once maxHoles are in hand.
    if (wave.depth > MAX_DESCENDANT_GENERATIONS && target() >= maxHoles) {
      stopReason = "maxHoles";
      break;
    }
    const levels =
      wave.depth === 0 ? descendantGenerations : Math.min(MAX_DESCENDANT_GENERATIONS, wave.depth);
    const room = MAX_DESCENDANCY_READS - reads;
    if (room <= 0) {
      stopReason = "readCap";
      break;
    }
    const ids = wave.ids.slice(0, room);
    if (ids.length < wave.ids.length) stopReason = "readCap";
    const bodies = await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
      if (Date.now() - started > TIME_BUDGET_MS) return "timeout" as const;
      try {
        return await readJson(
          principal,
          `/tree/descendancy?person=${encodeURIComponent(id)}&generations=${levels}&personDetails=true`,
          `Person ${id}`,
        );
      } catch (e) {
        if (wave.depth === 0) throw e;
        failedReads += 1;
        return null;
      }
    });
    for (const body of bodies) {
      if (body === "timeout") {
        stopReason = "timeBudget";
        continue;
      }
      reads += 1;
      if (body) addDescendancy(model, body.persons ?? [], wave.depth, levels);
    }
  }

  const gaps = selectGaps(detectGaps(model), maxHoles);

  let waitTimer: ReturnType<typeof setTimeout> | undefined;
  const catalog = await Promise.race([
    catalogPromise,
    new Promise<null>((r) => {
      waitTimer = setTimeout(() => r(null), CATALOG_WAIT_MS);
    }),
  ]);
  clearTimeout(waitTimer);
  if (catalog) {
    score(gaps, catalog);
  } else {
    notes.push("Collection coverage was unavailable; `coverage` is null on every hole.");
  }
  if (failedReads > 0) {
    notes.push(
      `${failedReads} descendancy read${failedReads === 1 ? "" : "s"} failed and ` +
        "were skipped; holes in those lines may be missing.",
    );
  }
  if (stopReason === "readCap") {
    notes.push("The read cap was reached; holes further from the root may be missing.");
  } else if (stopReason === "timeBudget") {
    notes.push("The time budget was reached; holes further from the root may be missing.");
  }

  return {
    root: { personId: rootPerson.id, name: rootPerson.name },
    gaps,
    scanned: {
      ancestorGenerations,
      descendantGenerations,
      persons: model.people.size,
      descendancyReads: reads,
      stoppedEarly: stopReason !== null,
      stopReason,
    },
    notes,
  };
}

export type { TreeGapsInput };
