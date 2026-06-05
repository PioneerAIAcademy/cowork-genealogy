import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toSimplifiedStandardized } from "../utils/gedcomx-convert.js";
import type { GedcomX } from "../types/gedcomx.js";
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
    },
    required: ["recordId"],
  },
} as const;

// ─── Entry point ──────────────────────────────────────────────────────────

export async function recordReadTool(
  input: RecordReadInput,
): Promise<RecordReadResult> {
  const { recordId } = input;
  if (typeof recordId !== "string" || recordId.trim() === "") {
    throw new Error(
      'The record_read tool requires a non-empty recordId string ' +
        '(e.g., "QVS9-DHDB" or "ark:/61903/1:1:QVS9-DHDB").',
    );
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
  return await toSimplifiedStandardized(body);
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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
