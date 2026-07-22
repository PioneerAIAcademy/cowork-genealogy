import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toSimplified } from "../utils/gedcomx-convert.js";
import { toArk, DOCUMENT_IMAGE_ARK_PATTERN } from "../utils/ark.js";
import { readStagedResults } from "../utils/results-staging.js";
import type { GedcomX, SimplifiedGedcomX } from "../types/gedcomx.js";
import type { RecordSearchResult } from "../types/record-search.js";
import type { RecordReadInput, RecordReadResult } from "../types/record-read.js";

const RECAPI_BASE =
  "https://sg30p0.familysearch.org/service/cds/recapi/records/persona";

// ─── MCP schema ───────────────────────────────────────────────────────────

export const recordReadSchema = {
  name: "record_read",
  description:
    "Fetch a FamilySearch historical record by its ARK and return it as " +
    "simplified GEDCOMX. Pass a record-persona ARK " +
    '(e.g., "ark:/61903/1:1:QVS9-DHDB") — the `recordId` returned by ' +
    "record_search. A bare entity ID (e.g., \"QVS9-DHDB\") is also accepted. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object",
    properties: {
      recordId: {
        type: "string",
        description:
          "FamilySearch record-persona ARK like " +
          '"ark:/61903/1:1:QVS9-DHDB" (feed record_search\'s `recordId` ' +
          'directly). A bare entity ID like "QVS9-DHDB" is also accepted. ' +
          "For a document-image ARK (3:1:/3:2:, e.g. fulltext_search's `id`), " +
          "use the image_read tool instead — this tool reads record personas, " +
          "not images. Required.",
      },
      resultsRef: {
        type: "string",
        description:
          "Optional. A `staged.resultsRef` handle from record_search (or a " +
          "finalized results/<log_id>.json ref) — read this record from that " +
          "sidecar host-side, WITHOUT a live FamilySearch fetch. For the person " +
          "you searched, the sidecar carries the same facts, the source citation, " +
          "and correctly standardized places (more reliable than a live read, whose " +
          "place standardization can misfire). It returns OTHER household members " +
          "(co-residents) with reduced facts — so omit this (live read) when you " +
          "need a co-resident's full facts, or for a record that was not part of a " +
          "staged search. Requires `projectPath`.",
      },
      projectPath: {
        type: "string",
        description:
          "Absolute path to the active project directory. Required when " +
          "`resultsRef` is given (the sidecar lives under the project's results/ dir).",
      },
    },
    required: ["recordId"],
  },
} as const;

// ─── Entry point ──────────────────────────────────────────────────────────

export async function recordReadTool(
  input: RecordReadInput,
): Promise<RecordReadResult> {
  const { recordId, resultsRef, projectPath } = input;
  if (typeof recordId !== "string" || recordId.trim() === "") {
    throw new Error(
      'The record_read tool requires a non-empty recordId string ' +
        '(e.g., "QVS9-DHDB" or "ark:/61903/1:1:QVS9-DHDB").',
    );
  }

  // Document-image ARK guard. record_read owns record personas (1:1:/1:2:); a
  // 3:1:/3:2: ARK is a document image and belongs to image_read. Without this
  // guard `extractEntityId` would strip it to a bare id and fetch the record
  // recapi, which 404s/403s — the silent-attempt failure that led an agent to
  // wrongly conclude "image-level ARKs are not resolvable through the available
  // tools." Route to image_read with an actionable error instead. Normalize with
  // toArk() first so a bare `3:1:…`/`3:2:…` id is caught too, and place this
  // BEFORE the resultsRef branch so sidecar callers are routed as well (an image
  // ARK is never a 1:1: sidecar key). Mirrors image_read's own "Unrecognized ark"
  // rejection of un-owned classes (image-read.ts).
  if (DOCUMENT_IMAGE_ARK_PATTERN.test(toArk(recordId.trim()))) {
    throw new Error(
      `'${recordId.trim()}' is a document-image ARK (3:1:/3:2:), not a record ` +
        "persona. record_read reads record personas (1:1:); use the image_read " +
        "tool with this ARK to fetch the image.",
    );
  }

  // Sidecar mode: resolve the record from a staged/finalized search sidecar
  // instead of a live FS fetch (no network round-trip). The staged gedcomx
  // carries the same persons, facts, and relationships as a live read (verified),
  // and its places are returned as-is — the search result already carries
  // FamilySearch's standardized places, which we keep (see readFromSidecar for
  // why we do NOT re-standardize). A live read (omit `resultsRef`) additionally
  // guarantees the authoritative source citation.
  if (resultsRef !== undefined) {
    return await readFromSidecar(recordId.trim(), resultsRef, projectPath);
  }

  const entityId = extractEntityId(recordId.trim());
  const token = await getValidToken();

  // TODO: implement fetch + convert logic
  // 1. Build URL: `${RECAPI_BASE}/${encodeURIComponent(entityId)}.json`
  // 2. Fetch with Bearer token and BROWSER_USER_AGENT
  // 3. Handle 401, 403, 404, 429, and generic errors
  // 4. Parse response body as GedcomX and call toSimplified(body)
  // 5. Return the simplified result

  const url = `${RECAPI_BASE}/${encodeURIComponent(entityId)}.json`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": BROWSER_USER_AGENT,
    },
  });

  if (res.status === 401) {
    throw new Error(
      "FamilySearch rejected the access token (401). The session may have " +
        "expired or been revoked — call the login tool to re-authenticate.",
    );
  }
  if (res.status === 403) {
    throw new Error(
      `Record ${entityId} is restricted and cannot be viewed.`,
    );
  }
  if (res.status === 404) {
    throw new Error(
      `Record ${entityId} was not found in FamilySearch historical records.`,
    );
  }
  if (res.status === 429) {
    throw new Error(
      "FamilySearch rate limit reached. Wait a moment and try again.",
    );
  }
  if (!res.ok) {
    throw new Error(`FamilySearch recapi error: ${res.status}`);
  }

  const body = (await res.json()) as GedcomX;
  // Use toSimplified, NOT toSimplifiedStandardized. The recapi record response
  // carries no FS-normalized place (only `original` + parsed County/City/State
  // fields), so re-standardizing would resolve the ambiguous place *name* through
  // the resolver and mis-place it (observed: "Southampton, NY" -> "Southampton,
  // England"; "Rochdale, England" -> "Rochdale, South Africa"). Leaving
  // standard_place unset is correct — never fabricate a wrong one. Records reached
  // via the search sidecar already carry FS's correct normalized place.
  return toSimplified(body);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Resolve one record's gedcomx from a staged/finalized search sidecar by id,
// returning the staged places as-is (NOT re-standardized — see the return
// statement below for why the search result's FS places are the trustworthy ones).
async function readFromSidecar(
  recordId: string,
  resultsRef: string,
  projectPath: string | undefined,
): Promise<RecordReadResult> {
  if (typeof projectPath !== "string" || projectPath.trim() === "") {
    throw new Error(
      "record_read with `resultsRef` also requires `projectPath` — the sidecar " +
        "lives under the project's results/ directory.",
    );
  }
  const wanted = extractEntityId(recordId);
  const results = (await readStagedResults(
    projectPath,
    resultsRef,
  )) as RecordSearchResult[];
  const match = results.find(
    (r) =>
      typeof r?.recordId === "string" && extractEntityId(r.recordId) === wanted,
  );
  if (!match || !match.gedcomx) {
    throw new Error(
      `record '${recordId}' was not found in staged results '${resultsRef}'. ` +
        "Do a live read (omit `resultsRef`) instead, or verify the ref/id.",
    );
  }
  // Return the staged record as-is. The search result already carries the
  // record's standardized places (from FamilySearch), and they are the more
  // trustworthy value: a live record_read re-standardizes place NAMES through the
  // resolver, which mis-resolves ambiguous names (observed: "Southampton, NY" ->
  // "Southampton, England"; "Rochdale, England" -> "Rochdale, South Africa"). So
  // we deliberately do NOT re-run standardizePlaces here.
  return match.gedcomx as SimplifiedGedcomX;
}

// Normalise the caller-supplied record ID to a bare entity ID.
// Full ARK format: "ark:/61903/1:1:QVS9-DHDB" → "QVS9-DHDB"
// Bare ID:         "QVS9-DHDB"                → "QVS9-DHDB"
export function extractEntityId(recordId: string): string {
  // ARKs contain at least one colon-separated segment after the last slash.
  // The entity ID is the final colon-delimited token.
  const lastColon = recordId.lastIndexOf(":");
  if (lastColon >= 0) {
    const candidate = recordId.slice(lastColon + 1);
    if (candidate.length > 0) return candidate;
  }
  return recordId;
}

// Re-export input type for index.ts wiring.
export type { RecordReadInput };
