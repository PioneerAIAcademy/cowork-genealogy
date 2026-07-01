import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { arkToUrl } from "../utils/ark.js";
import type {
  SourceAttachmentsInput,
  SourceAttachmentsApiResponse,
  SourceAttachmentsResult,
  AttachedPerson,
} from "../types/source-attachments.js";

const URL =
  "https://www.familysearch.org/service/tree/links/sources/attachments";

export async function sourceAttachmentsTool(
  input: SourceAttachmentsInput,
): Promise<SourceAttachmentsResult> {
  if (!Array.isArray(input.uris) || input.uris.length === 0) {
    throw new Error("uris array must not be empty.");
  }

  const token = await getValidToken();

  // Callers pass ARKs (canonical `ark:/61903/...`, the form record_search and
  // fulltext_search now emit) or full resolver URLs. The attachments API keys
  // on resolver URLs, so expand each input; keep the original→URL mapping so
  // the response can be re-keyed to the caller's input string.
  const urlByInput = new Map<string, string>();
  for (const uri of input.uris) urlByInput.set(uri, arkToUrl(uri));
  const apiUris = [...new Set(urlByInput.values())];

  let response: Response;
  try {
    response = await fetch(URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": BROWSER_USER_AGENT,
      },
      body: JSON.stringify({ uris: apiUris }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach FamilySearch attachments API: ${message}.`,
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "FamilySearch session not accepted; call the login tool to re-authenticate.",
      );
    }
    if (response.status === 403) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const isWaf =
        body !== null &&
        typeof body === "object" &&
        "errorCode" in body &&
        (body as { errorCode?: unknown }).errorCode === "15";
      if (isWaf) {
        throw new Error(
          "FamilySearch attachments blocked by WAF. The User-Agent header " +
          "was rejected — check that the MCP server is running an unmodified build.",
        );
      }
      throw new Error(
        `FamilySearch attachments API error: 403 ${response.statusText}.`,
      );
    }
    throw new Error(
      `FamilySearch attachments API error: ${response.status} ${response.statusText}.`,
    );
  }

  const data = (await response.json()) as SourceAttachmentsApiResponse;
  const map = data.attachedSourcesMap ?? {};

  const attachments: Record<string, AttachedPerson[]> = {};
  const unattached: string[] = [];

  for (const uri of input.uris) {
    const entries = map[urlByInput.get(uri) ?? uri];
    if (!entries || entries.length === 0) {
      unattached.push(uri);
      continue;
    }

    const persons: AttachedPerson[] = [];
    for (const entry of entries) {
      for (const person of entry.persons ?? []) {
        persons.push({
          personId: person.entityId,
          tags: person.tags ?? [],
        });
      }
    }

    if (persons.length === 0) {
      unattached.push(uri);
    } else {
      attachments[uri] = persons;
    }
  }

  return { attachments, unattached };
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const sourceAttachmentsSchema = {
  name: "source_attachments",
  description:
    "Check whether sources from search results are already attached to " +
    "persons in the FamilySearch Family Tree. Pass a list of source ARKs — " +
    "either record personas (1:1:) from record_search results, or document " +
    "images (3:1: / 3:2:) from fulltext_search results — and get back which " +
    "tree person IDs each source is attached to, plus tags indicating what " +
    "information the source contains. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object" as const,
    properties: {
      uris: {
        type: "array",
        items: { type: "string" },
        description:
          "List of source ARKs to check, in canonical form " +
          "(e.g. 'ark:/61903/1:1:QK2S-4W7G'). Each may be a record-persona " +
          "ARK (contains '1:1:', the `recordId` from record_search results) " +
          "or a document-image ARK (contains '3:1:' or '3:2:', from " +
          "fulltext_search results). Full resolver URLs are also accepted.",
      },
    },
    required: ["uris"],
  },
};
