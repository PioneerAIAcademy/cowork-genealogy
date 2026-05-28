import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import type {
  RecordAttachmentsInput,
  RecordAttachmentsApiResponse,
  RecordAttachmentsResult,
  AttachedPerson,
} from "../types/record-attachments.js";

const URL =
  "https://www.familysearch.org/service/tree/links/sources/attachments";

export async function recordAttachmentsTool(
  input: RecordAttachmentsInput,
): Promise<RecordAttachmentsResult> {
  if (!Array.isArray(input.uris) || input.uris.length === 0) {
    throw new Error("uris array must not be empty.");
  }

  const token = await getValidToken();

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
      body: JSON.stringify({ uris: input.uris }),
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

  const data = (await response.json()) as RecordAttachmentsApiResponse;
  const map = data.attachedSourcesMap ?? {};

  const attachments: Record<string, AttachedPerson[]> = {};
  const unattached: string[] = [];

  for (const uri of input.uris) {
    const entries = map[uri];
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

export const recordAttachmentsSchema = {
  name: "record_attachments",
  description:
    "Check whether historical records from search results are already " +
    "attached to persons in the FamilySearch Family Tree. Pass a list of " +
    "record persona ARK URLs (the arkUrl field from record_search results) " +
    "and get back which tree person IDs each record is attached to, plus " +
    "tags indicating what information the record contains. " +
    "Requires authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object" as const,
    properties: {
      uris: {
        type: "array",
        items: { type: "string" },
        description:
          "List of historical record persona ARK URLs to check. " +
          "These come from the arkUrl field of record_search results.",
      },
    },
    required: ["uris"],
  },
};
