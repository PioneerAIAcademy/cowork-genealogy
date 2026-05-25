import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toGedcomX } from "../utils/gedcomx-convert.js";
import type { GedcomX, SimplifiedGedcomX } from "../types/gedcomx.js";
import type {
  MatchTwoExamplesApiResponse,
  MatchTwoExamplesInput,
  MatchTwoExamplesResult,
} from "../types/match-two-examples.js";

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

export async function matchTwoExamples(
  input: MatchTwoExamplesInput,
): Promise<MatchTwoExamplesResult> {
  validateInput(input);

  const token = await getValidToken();
  const raw1 = buildRawWithAnchor(input.gedcomx1, input.primaryId1);
  const raw2 = buildRawWithAnchor(input.gedcomx2, input.primaryId2);

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
      body: JSON.stringify({
        entries: [
          { content: { gedcomx: raw1 } },
          { content: { gedcomx: raw2 } },
        ],
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach FamilySearch matchTwoExamples API: ${message}.`,
    );
  }

  if (!response.ok) {
    await throwForBadStatus(response);
  }

  const body = (await response.json()) as MatchTwoExamplesApiResponse;

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    throw new Error(
      "matchTwoExamples API returned no entries[]; this is unexpected per FS behavior.",
    );
  }

  const entry = body.entries[0];
  const result: MatchTwoExamplesResult = {
    matched: entry.confidence !== undefined,
    score: entry.score,
    queryArk: parseArkFromTitle(body.title),
    candidateArk: entry.id,
    apiTitle: body.title,
    updated: body.updated,
  };
  if (entry.confidence !== undefined) {
    result.confidence = entry.confidence;
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateInput(input: MatchTwoExamplesInput): void {
  const sides: Array<[SimplifiedGedcomX, string, "gedcomx1" | "gedcomx2"]> = [
    [input.gedcomx1, input.primaryId1, "gedcomx1"],
    [input.gedcomx2, input.primaryId2, "gedcomx2"],
  ];
  for (const [gedcomx, primaryId, side] of sides) {
    const persons = gedcomx?.persons;
    if (!Array.isArray(persons) || persons.length === 0) {
      throw new Error(
        `matchTwoExamples: ${side} has no persons[] array.`,
      );
    }
    const ids = persons.map((p) => p.id).filter((id): id is string => typeof id === "string");
    if (!primaryId || !ids.includes(primaryId)) {
      throw new Error(
        `matchTwoExamples: primaryId "${primaryId}" not found in ${side}. ` +
        `Available ids in ${side}: ${ids.join(", ") || "(none)"}.`,
      );
    }
  }
}

function buildRawWithAnchor(
  simplified: SimplifiedGedcomX,
  primaryId: string,
): GedcomX {
  const raw = toGedcomX(simplified);
  // Append the sourceDescription anchor with a unique id to avoid colliding
  // with any caller-provided sourceDescription that might already use a
  // common id like "mainSrc".
  raw.sourceDescriptions = [
    ...(raw.sourceDescriptions ?? []),
    { id: "match-anchor", about: "#" + primaryId },
  ];
  return raw;
}

// Parse the bare ARK out of the API's `title` field and return it as a full
// URL to match the format of `entries[0].id`.
function parseArkFromTitle(title: string): string {
  const match = title.match(/ark:\/[\w/:.\-]+/);
  if (!match) return title;
  return "https://familysearch.org/" + match[0];
}

async function throwForBadStatus(response: Response): Promise<never> {
  const status = response.status;
  if (status === 401) {
    throw new Error(
      "FamilySearch session not accepted; call the login tool to re-authenticate.",
    );
  }
  if (status === 403) {
    // Imperva WAF body looks like { errorCode: "15", description: "..." }
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
        "FamilySearch matchTwoExamples blocked by WAF. The User-Agent header " +
        "was rejected — check that the MCP server is running an unmodified build.",
      );
    }
    throw new Error(
      `FamilySearch matchTwoExamples API error: 403 ${response.statusText}.`,
    );
  }
  if (status === 400) {
    let detail: string | null = null;
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail = typeof body.detail === "string" ? body.detail : null;
    } catch {
      detail = null;
    }
    throw new Error(
      detail
        ? `FamilySearch matchTwoExamples rejected the payload: ${detail}.`
        : `FamilySearch matchTwoExamples rejected the payload (400 ${response.statusText}).`,
    );
  }
  throw new Error(
    `FamilySearch matchTwoExamples API error: ${status} ${response.statusText}.`,
  );
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const matchTwoExamplesSchema = {
  name: "match_two_examples",
  description:
    "Ask FamilySearch whether two records describe the same person. Use this " +
    "when the user wants to verify whether two search results are duplicates " +
    "— typically after a `record_search` returned multiple records and the user picks " +
    "two to compare.\n" +
    "\n" +
    "Each result from the `record_search` tool carries a `gedcomx` field and a " +
    "`primaryId` field. Pass them straight through: `gedcomx1` = the first " +
    "result's `gedcomx`, `primaryId1` = its `primaryId`; likewise for " +
    "`gedcomx2`/`primaryId2`. Do NOT hand-build the gedcomx from the flat " +
    "summary fields — that drops the record ARK and the comparison fails.\n" +
    "\n" +
    "Returns a match decision with confidence (integer 1-10, omitted on " +
    "no-match) and score (float 0-1). Returns `matched: false` when the API " +
    "doesn't recognize a real match (confidence omitted, score near zero).",
  inputSchema: {
    type: "object" as const,
    properties: {
      gedcomx1: {
        type: "object",
        description:
          "First record's simplified-GedcomX document — the `gedcomx` field " +
          "of a `record_search` result, passed through verbatim.",
      },
      primaryId1: {
        type: "string",
        description:
          "The `primaryId` field of the same `record_search` result. Must match a " +
          "`persons[].id` in gedcomx1.",
      },
      gedcomx2: {
        type: "object",
        description:
          "Second record's simplified-GedcomX document — the `gedcomx` field " +
          "of another `record_search` result.",
      },
      primaryId2: {
        type: "string",
        description:
          "The `primaryId` field of the second `record_search` result. Must match a " +
          "`persons[].id` in gedcomx2.",
      },
    },
    required: ["gedcomx1", "primaryId1", "gedcomx2", "primaryId2"],
  },
};
