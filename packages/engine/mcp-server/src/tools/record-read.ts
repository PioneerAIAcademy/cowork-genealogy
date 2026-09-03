import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithTimeout } from "../utils/http.js";
import { toSimplified } from "../utils/gedcomx-convert.js";
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
          'directly). A bare entity ID like "QVS9-DHDB" is also accepted. Required.',
      },
      resultsRef: {
        type: "string",
        description:
          "Optional. A `staged.resultsRef` handle from record_search (or a " +
          "finalized results/<log_id>.json ref) — read this record from that " +
          "sidecar host-side, WITHOUT a live FamilySearch fetch. For the person " +
          "you searched, the sidecar carries the same facts, the source citation, " +
          "and standardized places from the search stage (a live read keeps only " +
          "the record's own normalized places, never resolver-derived ones). It returns OTHER household members " +
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

  // Sidecar mode: resolve the record from a staged/finalized search sidecar
  // instead of a live FS fetch (no network round-trip). The staged gedcomx
  // carries the same persons, facts, and relationships as a live read (verified),
  // and it already carries standardized places from the search stage
  // (record_search runs standardizePlaces) — so we return it as-is and do NOT
  // re-standardize here. A live read (omit `resultsRef`) additionally guarantees
  // the authoritative source citation.
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

  const res = await fetchWithTimeout(url, {
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
  // Use toSimplified, NOT toSimplifiedStandardized. toSimplified keeps whatever
  // standard_place the record's own `normalized` value supplies and never falls
  // back to the resolver; toSimplifiedStandardized would additionally resolve any
  // free-text place NAME the record left un-normalized, and the resolver
  // mis-places ambiguous names (observed 2026-07-08: "Southampton, NY" ->
  // "Southampton, England"; "Rochdale, England" -> "Rochdale, South Africa").
  // How often a recapi record response carries a `normalized` place is what
  // dev/probe-record-read-places.ts measures; either way, we never resolver-fill
  // it here. Records reached via the search sidecar already carry the search
  // stage's standardized place.
  return toSimplified(body);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Resolve one record's gedcomx from a staged/finalized search sidecar by id,
// returning it as-is. The staged search result already carries standardized
// places from the search stage; this path does not re-standardize (and a live
// record_read does not standardize either — it uses pure toSimplified).
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
  // Return the staged record as-is. Its standard_place values are a mixture set
  // at search time: FS-normalized where the search response supplied a
  // `normalized` value (via toSimplified), resolver-derived where it did not (via
  // record_search's standardizePlaces, whose filter fills only facts that lack a
  // standard_place). We do NOT re-run standardizePlaces here — that same filter
  // skips every fact that already has a standard_place, so a re-run cannot change
  // any value already set; it could only retry the few that resolved to null or
  // hit the soft cap, spending FS round-trips on the one path whose purpose is to
  // avoid them. A live record_read (omit resultsRef) does not resolver-standardize
  // at all: it uses pure toSimplified (see the comment above), keeping only the
  // record's own normalized places — never resolving an ambiguous place NAME and
  // mis-placing it (see the toSimplified comment above for the observed
  // mis-resolutions).
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
