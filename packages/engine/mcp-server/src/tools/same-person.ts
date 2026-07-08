import { getValidToken } from "../auth/refresh.js";
import { mapWithConcurrency, withRetry } from "../utils/place-resolver.js";
import { selectRelativePairs } from "../utils/relatives.js";
import { scorePair } from "../utils/match-engine.js";
// scorePair (with its anchoring + FS-id mint) lives in the shared match-engine
// so rank_search_matches can reuse it; this tool's public contract is unchanged.
import type { SimplifiedGedcomX } from "../types/gedcomx.js";
import type {
  SamePersonInput,
  SamePersonRelativeMatch,
  SamePersonRelativesResult,
  SamePersonResult,
} from "../types/same-person.js";

/** Concurrency cap for the relatives-mode fan-out of per-pair FS calls. */
const PAIR_CONCURRENCY = 5;
/** Stable role order for sorting the relatives-mode matches list. */
const ROLE_ORDER: Record<SamePersonRelativeMatch["role"], number> = {
  parent: 0,
  spouse: 1,
  child: 2,
};

export async function samePerson(
  input: SamePersonInput,
): Promise<SamePersonResult | SamePersonRelativesResult> {
  validateInput(input);

  // One OAuth token reused for the whole call (single pair or whole batch).
  const token = await getValidToken();

  if (input.matchRelatives) {
    return matchRelatives(input, token);
  }

  return scorePair(
    input.gedcomx1,
    input.primaryId1,
    input.gedcomx2,
    input.primaryId2,
    token,
  );
}

// ─── Relatives mode ──────────────────────────────────────────────────────────

async function matchRelatives(
  input: SamePersonInput,
  token: string,
): Promise<SamePersonRelativesResult> {
  const { pairs, droppedForCap } = selectRelativePairs(
    input.gedcomx1,
    input.primaryId1,
    input.gedcomx2,
    input.primaryId2,
  );

  // Fan out one FS call per surviving pair, bounded + retried. A pair whose
  // call keeps failing is omitted from the result — one bad pair must not fail
  // the whole batch.
  const results = await mapWithConcurrency(pairs, PAIR_CONCURRENCY, async (pair) => {
    let result: SamePersonResult;
    try {
      result = await withRetry(() =>
        scorePair(
          input.gedcomx1,
          pair.target.id as string,
          input.gedcomx2,
          pair.candidate.id as string,
          token,
        ),
      );
    } catch {
      return null;
    }
    const match: SamePersonRelativeMatch = {
      role: pair.role,
      targetId: pair.target.id as string,
      candidateId: pair.candidate.id as string,
      score: result.score,
      preScore: pair.preScore,
    };
    if (result.confidence !== undefined) match.confidence = result.confidence;
    return match;
  });

  const matches = results.filter(
    (m): m is SamePersonRelativeMatch => m !== null,
  );
  matches.sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.score - a.score,
  );

  const out: SamePersonRelativesResult = { matchRelatives: true, matches };
  if (droppedForCap > 0) out.droppedForCap = droppedForCap;
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function validateInput(input: SamePersonInput): void {
  const sides: Array<[SimplifiedGedcomX, string, "gedcomx1" | "gedcomx2"]> = [
    [input.gedcomx1, input.primaryId1, "gedcomx1"],
    [input.gedcomx2, input.primaryId2, "gedcomx2"],
  ];
  for (const [gedcomx, primaryId, side] of sides) {
    const persons = gedcomx?.persons;
    if (!Array.isArray(persons) || persons.length === 0) {
      throw new Error(
        `same_person: ${side} has no persons[] array.`,
      );
    }
    const ids = persons.map((p) => p.id).filter((id): id is string => typeof id === "string");
    if (!primaryId || !ids.includes(primaryId)) {
      throw new Error(
        `same_person: primaryId "${primaryId}" not found in ${side}. ` +
        `Available ids in ${side}: ${ids.join(", ") || "(none)"}.`,
      );
    }
  }
}

// ─── MCP schema ──────────────────────────────────────────────────────────────

export const samePersonSchema = {
  name: "same_person",
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
    "doesn't recognize a real match (confidence omitted, score near zero).\n" +
    "\n" +
    "Set `matchRelatives: true` to instead match the two focus persons' " +
    "RELATIVES (parents, spouses, children) — useful when attaching a " +
    "household record (head + spouse + children) to the tree and you need to " +
    "know which record-relative is which tree-relative. In that mode the result " +
    "shape is DIFFERENT: it has `matchRelatives: true` and a `matches` array of " +
    "`{ role, targetId, candidateId, score, confidence?, preScore }` triples " +
    "(targetId is a persons[].id in gedcomx1, candidateId in gedcomx2). It uses " +
    "local name/date heuristics to avoid scoring every possible pair.",
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
      matchRelatives: {
        type: "boolean",
        description:
          "Default false. When true, match the focus persons' relatives " +
          "(parents/spouses/children) instead of the focus persons themselves, " +
          "returning a `matches` array of (role, targetId, candidateId, score) " +
          "triples. `primaryId1`/`primaryId2` still identify whose relatives to " +
          "gather. Use for household record-to-tree pairing.",
      },
    },
    required: ["gedcomx1", "primaryId1", "gedcomx2", "primaryId2"],
  },
};
