// MCP tool: person_quality
// See docs/specs/person-quality-tool-spec.md.
//
// Reads a person's FamilySearch data-quality score and returns the live issues
// to the LLM as interpolated English sentences (plus a compact score summary),
// keeping the LLM's context lean. Requires authentication.

import type { Principal } from "../auth/principal.js";
import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { fetchWithRetry } from "../utils/http.js";
import { renderIssueSentence } from "./person-quality-templates.js";
import type {
  FSCategoryScore,
  FSPersonScores,
  FSQualityIssue,
  FSQualityResponse,
  PersonQualityDetail,
  PersonQualityInput,
  PersonQualityResult,
  QualityCategoryOut,
  QualityConflictOut,
  QualityFactOut,
  QualityFactSourceOut,
  QualityIssueOut,
} from "../types/person-quality.js";

export type {
  PersonQualityInput,
  PersonQualityResult,
} from "../types/person-quality.js";

// Beta host, per the review decision. NEEDS VALIDATION: getValidToken(principal) issues
// production familysearch.org tokens; confirm sg30p0 accepts them (see spec).
const HOST = "https://sg30p0.familysearch.org";

// The score service computes asynchronously. A cold request returns
// `{ visibility: "CALCULATING", isValid: false }` with no personScores; the
// score lands on a subsequent request. Poll a few times before giving up.
const CALC_MAX_ATTEMPTS = 5; // total attempts, including the first
const CALC_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function numOrNull(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function categoryScore(block: FSCategoryScore | undefined): number | null {
  return numOrNull(block?.displayScore);
}

// Fetch the score, handling error statuses and polling through the
// CALCULATING state until the score is ready (or attempts run out).
async function fetchScores(
  token: string,
  url: string,
  personId: string,
): Promise<FSQualityResponse> {
  for (let attempt = 1; attempt <= CALC_MAX_ATTEMPTS; attempt++) {
    const res = await fetchWithRetry(url, {
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

    // Score not ready yet — the service computes it asynchronously. Wait and
    // retry; the score lands on a later request (as it did for the boss).
    if (body.visibility === "CALCULATING") {
      if (attempt < CALC_MAX_ATTEMPTS) {
        await sleep(CALC_RETRY_DELAY_MS);
        continue;
      }
      throw new Error(
        `FamilySearch is still calculating the quality score for ${personId}. ` +
          "Try again in a few seconds.",
      );
    }

    return body;
  }
  // Unreachable: the loop returns or throws on every path.
  throw new Error(`FamilySearch quality API error for ${personId}.`);
}

export const personQualityToolSchema = {
  name: "person_quality",
  description:
    "Read a person's FamilySearch data-quality score. Given a tree-person ID, " +
    "returns the live quality issues as plain English sentences (e.g. \"The " +
    "burial date is missing.\") grouped into four categories — Completeness, " +
    "Verifiability (source tagging), Consistency, and Coherence — plus an " +
    "overall score. Each issue carries its conclusionType and conclusionId so " +
    "it can be traced to the exact fact. Pass detail=true to also get the " +
    "per-fact breakdown — which attached sources touch each fact and whether " +
    "each agrees, and which sources disagree with each other. Requires " +
    "authentication — call the login tool first if not logged in.",
  inputSchema: {
    type: "object" as const,
    properties: {
      personId: {
        type: "string",
        description:
          'FamilySearch tree-person ID (e.g. "KD96-TV2"). Resolve a name to an ' +
          "ID with person_search first if you don't have it.",
      },
      detail: {
        type: "boolean",
        description:
          "Include the per-fact breakdown: for each of the person's conclusions, " +
          "its score, the issues affecting it, and which attached sources touch " +
          "it and whether each agrees — plus the disagreements between attached " +
          "sources. Defaults to false; omit it for a per-person summary.",
      },
    },
    required: ["personId"],
  },
} as const;

// ─── Opt-in detail (#2225 D2) ───────────────────────────────────────────────
// Everything below runs only when the caller passes `detail: true`. Upstream
// sends all of it on every request; excluding it by default is what keeps the
// existing caller's payload byte-identical.

// A source as it bears on one fact. `agrees` is null when upstream omitted it —
// never defaulted to true, which would assert agreement nobody measured.
function sourceOut(
  title: string | undefined,
  uri: string | undefined,
  agrees: boolean | undefined,
): QualityFactSourceOut {
  return {
    title: typeof title === "string" ? title : null,
    uri: typeof uri === "string" ? uri : null,
    agrees: typeof agrees === "boolean" ? agrees : null,
  };
}

// conclusionId -> the attached sources touching it, deduped by source uri.
//
// Upstream nests the other way round (source -> conclusions), and a single
// source can repeat the same conclusion id inside its own `conclusions[]` — 13
// of 28 sources did on KD96-TV2. Inverting turns that into one source listed
// twice under one fact, so the dedupe key here is the URI, not the conclusion
// id. Measured lossless: 21 duplicate (conclusion, uri) pairs, none of which
// disagreed on `agreesWithSource`. See dev/probe-person-quality-detail.ts,
// finding 4 — whose "dedupe by id" is correct for the raw shape, not this one.
function sourcesByConclusion(
  scores: FSPersonScores,
): Map<string, QualityFactSourceOut[]> {
  const byConclusion = new Map<string, QualityFactSourceOut[]>();
  const seen = new Map<string, Set<string>>();

  for (const cluster of scores.sourceClusters?.sourceClusters ?? []) {
    for (const source of cluster.sources ?? []) {
      for (const conclusion of source.conclusions ?? []) {
        const id = conclusion.id;
        if (typeof id !== "string") continue;
        const key = source.uri ?? source.title ?? "";
        const seenHere = seen.get(id) ?? new Set<string>();
        if (seenHere.has(key)) continue;
        seenHere.add(key);
        seen.set(id, seenHere);
        const list = byConclusion.get(id) ?? [];
        list.push(sourceOut(source.title, source.uri, conclusion.agreesWithSource));
        byConclusion.set(id, list);
      }
    }
  }
  return byConclusion;
}

// Group the pairwise conflict list into one entry per real disagreement.
//
// Upstream restates a single disagreement once per source pair, so the raw list
// is quadratic in the number of sources holding the field: KD96-TV2 returns 50
// entries encoding 5 actual disagreements. Passing that through would flood the
// context — the very failure the original exclusion was guarding against.
// Grouping key is (field name, its sorted value set).
function groupConflicts(
  scores: FSPersonScores,
  titleByUri: Map<string, string>,
): QualityConflictOut[] {
  const groups = new Map<
    string,
    { field: string; values: string[]; uris: Set<string> }
  >();

  for (const conflict of scores.sourceClusters?.conflicts ?? []) {
    const uris = (conflict.sourceUris ?? []).filter(
      (u): u is string => typeof u === "string",
    );
    for (const field of conflict.conflictingFields ?? []) {
      const name = typeof field.name === "string" ? field.name : "";
      const values = [...(field.values ?? [])]
        .filter((v): v is string => typeof v === "string")
        .sort();
      if (name === "" || values.length === 0) continue;
      const key = `${name}\u0000${values.join("\u0000")}`;
      const group = groups.get(key) ?? { field: name, values, uris: new Set() };
      for (const u of uris) group.uris.add(u);
      groups.set(key, group);
    }
  }

  return [...groups.values()].map(({ field, values, uris }) => ({
    field,
    values,
    sources: [...uris].map((uri) => sourceOut(titleByUri.get(uri), uri, undefined)),
  }));
}

// One entry per conclusion, carrying the rendered sentence of each issue that
// affects it. Upstream gives `affectingIssueIds`, which join onto
// `FSQualityIssue.id` — a field this tool's issue output does not carry, so the
// join is resolved here and the sentence emitted rather than an id that would
// point at nothing on the caller's side.
function buildDetail(
  scores: FSPersonScores,
  rawIssues: FSQualityIssue[],
): PersonQualityDetail {
  const sentenceById = new Map<string, string>();
  for (const issue of rawIssues) {
    if (typeof issue.id === "string") {
      sentenceById.set(issue.id, renderIssueSentence(issue));
    }
  }

  const titleByUri = new Map<string, string>();
  for (const cluster of scores.sourceClusters?.sourceClusters ?? []) {
    for (const source of cluster.sources ?? []) {
      if (typeof source.uri === "string" && typeof source.title === "string") {
        titleByUri.set(source.uri, source.title);
      }
    }
  }

  const sourcesFor = sourcesByConclusion(scores);

  const facts: QualityFactOut[] = (scores.conclusionScores ?? []).map((entry) => {
    const fact: QualityFactOut = {
      conclusionId:
        typeof entry.conclusionId === "string" ? entry.conclusionId : null,
      conclusionType:
        typeof entry.conclusionType === "string" ? entry.conclusionType : null,
      score: numOrNull(entry.combinedDisplayScore),
      issues: (entry.affectingIssueIds ?? [])
        .map((id) => sentenceById.get(id))
        .filter((s): s is string => typeof s === "string"),
      sources:
        (typeof entry.conclusionId === "string"
          ? sourcesFor.get(entry.conclusionId)
          : undefined) ?? [],
    };
    if (typeof entry.relationshipId === "string") {
      fact.relationshipId = entry.relationshipId;
    }
    return fact;
  });

  return { facts, conflicts: groupConflicts(scores, titleByUri) };
}

export async function personQualityTool(
  input: PersonQualityInput,
  principal: Principal,
): Promise<PersonQualityResult> {
  const personId =
    typeof input.personId === "string" ? input.personId.trim() : "";
  if (personId === "") {
    throw new Error("personId is required.");
  }

  const token = await getValidToken(principal);
  const url = `${HOST}/service/tree/tree-data/quality/person/${encodeURIComponent(
    personId,
  )}/scores`;

  const body = await fetchScores(token, url, personId);
  const scores = body.personScores;

  // No personScores (and not CALCULATING — handled in fetchScores). Two known
  // states reach here, both `isValid: true`: TOMBSTONED (the record was deleted
  // or merged away) and NOT_FOUND (doesn't exist / not visible). Neither is a
  // clean zero-issue person — that case has personScores present with issues: [].
  if (!scores) {
    if (body.visibility === "TOMBSTONED") {
      // TOMBSTONED = the person was deleted or merged into another profile
      // (confirmed with FS). Terminal — no score will ever come, so we do NOT
      // retry (unlike CALCULATING). A merge may instead surface the surviving
      // profile with a link; a bare TOMBSTONED like this is a true delete.
      throw new Error(
        `Person ${personId} is tombstoned in the FamilySearch tree — it has ` +
          "been deleted or merged into another profile — so it has no quality score.",
      );
    }
    const visibility = body.visibility;
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

  const result: PersonQualityResult = {
    personId,
    segment: typeof scores.segment === "string" ? scores.segment : null,
    overallScore: numOrNull(scores.overallDisplayScore),
    issueCount: issues.length,
    categories,
    issues,
  };

  // Absent, not empty, when the flag is off — the byte-identical guarantee D2
  // rests on, pinned by a deep-equal test in tests/tools/person-quality.test.ts.
  if (input.detail === true) {
    result.detail = buildDetail(scores, rawIssues);
  }

  return result;
}
