// MCP tool: person_quality
// See docs/specs/person-quality-tool-spec.md.
//
// Reads a person's FamilySearch data-quality score and returns the live issues
// to the LLM as interpolated English sentences (plus a compact score summary),
// keeping the LLM's context lean. Requires authentication.

import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { renderIssueSentence } from "./person-quality-templates.js";
import type {
  FSCategoryScore,
  FSQualityResponse,
  PersonQualityInput,
  PersonQualityResult,
  QualityCategoryOut,
  QualityIssueOut,
} from "../types/person-quality.js";

export type {
  PersonQualityInput,
  PersonQualityResult,
} from "../types/person-quality.js";

// Beta host, per the review decision. NEEDS VALIDATION: getValidToken() issues
// production familysearch.org tokens; confirm sg30p0 accepts them (see spec).
const HOST = "https://sg30p0.familysearch.org";

// Score categories in UI order, with each one's key on personScores.
const CATEGORY_ORDER: Array<{
  scoreType: string;
  key: keyof Pick<
    NonNullable<FSQualityResponse["personScores"]>,
    | "completenessScore"
    | "verifiabilityScore"
    | "consistencyScore"
    | "coherenceScore"
  >;
}> = [
  { scoreType: "COMPLETENESS", key: "completenessScore" },
  { scoreType: "VERIFIABILITY", key: "verifiabilityScore" },
  { scoreType: "CONSISTENCY", key: "consistencyScore" },
  { scoreType: "COHERENCE", key: "coherenceScore" },
];

// PROVISIONAL band mapping — the exact UI thresholds are unknown (spec Open
// Question 3); these are a reasonable stand-in and may change.
function qualityBand(overall: number | null): string | null {
  if (overall === null) return null;
  if (overall >= 0.95) return "High Quality";
  if (overall >= 0.8) return "Good Quality";
  if (overall >= 0.6) return "Fair Quality";
  return "Low Quality";
}

function numOrNull(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function categoryScore(block: FSCategoryScore | undefined): number | null {
  return numOrNull(block?.displayScore);
}

export const personQualityToolSchema = {
  name: "person_quality",
  description:
    "Read a person's FamilySearch data-quality score. Given a tree-person ID, " +
    "returns the live quality issues as plain English sentences (e.g. \"The " +
    "burial date is missing.\") grouped into four categories — Completeness, " +
    "Verifiability (source tagging), Consistency, and Coherence — plus an " +
    "overall score. Each issue carries its conclusionType and conclusionId so " +
    "it can be traced to the exact fact. Requires authentication — call the " +
    "login tool first if not logged in.",
  inputSchema: {
    type: "object" as const,
    properties: {
      personId: {
        type: "string",
        description:
          'FamilySearch tree-person ID (e.g. "KD96-TV2"). Resolve a name to an ' +
          "ID with person_search first if you don't have it.",
      },
    },
    required: ["personId"],
  },
} as const;

export async function personQualityTool(
  input: PersonQualityInput,
): Promise<PersonQualityResult> {
  const personId =
    typeof input.personId === "string" ? input.personId.trim() : "";
  if (personId === "") {
    throw new Error("personId is required.");
  }

  const token = await getValidToken();
  const url = `${HOST}/service/tree/tree-data/quality/person/${encodeURIComponent(
    personId,
  )}/scores`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": BROWSER_USER_AGENT,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    throw new Error(
      "FamilySearch rejected the access token (401). The session may have " +
        "expired or been revoked — call the login tool to re-authenticate.",
    );
  }
  if (res.status === 400) {
    // Malformed ID: the body is empty; the detail is in a `warning` header.
    const warning = res.headers.get("warning");
    throw new Error(
      `FamilySearch rejected the person ID '${personId}' (400): ${
        warning ?? "invalid identifier"
      }.`,
    );
  }
  if (!res.ok) {
    throw new Error(`FamilySearch quality API error: ${res.status}.`);
  }

  const body = (await res.json()) as FSQualityResponse;
  const scores = body.personScores;

  // NOT_FOUND (or any response with no personScores) is a not-found/not-visible
  // person — NOT a clean zero-issue person (that case has personScores present).
  if (!scores) {
    const visibility = body.visibility ?? scores;
    throw new Error(
      `No quality scores found for person ${personId} ` +
        `(not found or not visible${
          typeof visibility === "string" ? `: ${visibility}` : ""
        }).`,
    );
  }

  const rawIssues = Array.isArray(scores.issues) ? scores.issues : [];

  const issues: QualityIssueOut[] = rawIssues.map((issue) => ({
    sentence: renderIssueSentence(issue),
    conclusionType:
      typeof issue.conclusionType === "string" ? issue.conclusionType : undefined,
    conclusionId:
      typeof issue.conclusionId === "string" ? issue.conclusionId : undefined,
    scoreType: typeof issue.scoreType === "string" ? issue.scoreType : undefined,
  }));

  const categories: QualityCategoryOut[] = CATEGORY_ORDER.map(
    ({ scoreType, key }) => ({
      scoreType,
      count: rawIssues.filter((i) => i.scoreType === scoreType).length,
      score: categoryScore(scores[key]),
    }),
  );

  const overallScore = numOrNull(scores.overallDisplayScore);

  return {
    personId,
    segment: typeof scores.segment === "string" ? scores.segment : null,
    overallScore,
    qualityBand: qualityBand(overallScore),
    issueCount: issues.length,
    categories,
    issues,
  };
}
