import { getValidToken } from "../auth/refresh.js";
import { BROWSER_USER_AGENT } from "../constants.js";
import { toGedcomX } from "../utils/gedcomx-convert.js";
import { toArk } from "../utils/ark.js";
// NOTE: toArk is used both for the candidate ARK in the result and to restore
// the full Persistent-identifier ARK that matchTwoExamples requires.
import { mapWithConcurrency, withRetry } from "../utils/place-resolver.js";
import { selectRelativePairs } from "../utils/relatives.js";
import type { GedcomX, SimplifiedGedcomX } from "../types/gedcomx.js";
import type {
  SamePersonApiResponse,
  SamePersonInput,
  SamePersonRelativeMatch,
  SamePersonRelativesResult,
  SamePersonResult,
} from "../types/same-person.js";

const URL =
  "https://www.familysearch.org/service/search/record/collections/match/matchTwoExamples";

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

// ─── Single-pair scoring ─────────────────────────────────────────────────────

/**
 * Score one (id1, id2) pair against FamilySearch matchTwoExamples, anchoring
 * each side's full document on the given id. The single-pair path and every
 * relatives-mode pair go through this.
 */
async function scorePair(
  gedcomx1: SimplifiedGedcomX,
  id1: string,
  gedcomx2: SimplifiedGedcomX,
  id2: string,
  token: string,
): Promise<SamePersonResult> {
  const raw1 = buildRawWithAnchor(gedcomx1, id1);
  const raw2 = buildRawWithAnchor(gedcomx2, id2);

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

  const body = (await response.json()) as SamePersonApiResponse;

  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    throw new Error(
      "matchTwoExamples API returned no entries[]; this is unexpected per FS behavior.",
    );
  }

  const entry = body.entries[0];
  const result: SamePersonResult = {
    matched: entry.confidence !== undefined,
    score: entry.score,
    queryArk: parseArkFromTitle(body.title),
    candidateArk: toArk(entry.id),
    apiTitle: body.title,
    updated: body.updated,
  };
  if (entry.confidence !== undefined) {
    result.confidence = entry.confidence;
  }
  return result;
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

const PERSISTENT_ID = "http://gedcomx.org/Persistent";

// FamilySearch persona ids are 4-char-3-char (e.g. "KGS8-LY1") drawn from
// A-Z0-9 minus the vowels A/E/I/O/U. matchTwoExamples requires the Persistent
// identifier in full canonical ARK form (`ark:/61903/n:n:<id>`) — a bare id is
// rejected as "M2E Invalid Feed supplied". For ids that aren't already in valid
// FS format (made-up local ids, stubs), we mint a random conforming id so the
// API never chokes on a malformed id (per Dallan/Richard, 2026-06-23). The
// score is unaffected — FS matches on the document content, and relatives-mode
// results report the caller's local ids, not these FS-facing ones.
const FS_ID_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ0123456789"; // A-Z0-9 minus AEIOU
const VALID_FS_ID_RE = /^[BCDFGHJKLMNPQRSTVWXYZ0-9]{4}-[BCDFGHJKLMNPQRSTVWXYZ0-9]{3}$/;
const DEFAULT_ARK_TYPE = "1:1"; // record-persona type, used when none is known

function randomFsId(): string {
  const pick = (n: number): string =>
    Array.from(
      { length: n },
      () => FS_ID_ALPHABET[Math.floor(Math.random() * FS_ID_ALPHABET.length)],
    ).join("");
  return `${pick(4)}-${pick(3)}`;
}

// Normalize a person's `ark` to a full canonical ARK whose id segment is a
// valid FS persona id, minting a random conforming id when it isn't.
function toValidFsArk(ark: string): string {
  const canonical = toArk(ark);
  const m = canonical.match(/^ark:\/61903\/(\d:\d):(.+)$/);
  const type = m ? m[1] : DEFAULT_ARK_TYPE;
  const id = m ? m[2] : canonical;
  const validId = VALID_FS_ID_RE.test(id.toUpperCase()) ? id : randomFsId();
  return `ark:/61903/${type}:${validId}`;
}

function buildRawWithAnchor(
  simplified: SimplifiedGedcomX,
  primaryId: string,
): GedcomX {
  const raw = toGedcomX(simplified);

  // Restore the Persistent identifier to a full, valid-format canonical ARK.
  // The general gedcomx converter intentionally emits the bare id (it stays
  // API-agnostic); this matchTwoExamples-specific requirement lives in the
  // tool. The full ARK comes from the simplified person's `ark` field, since
  // the converter's bare id has already dropped the `n:n:` type segment.
  const arkById = new Map<string, string>();
  for (const p of simplified.persons ?? []) {
    if (p.id !== undefined && typeof p.ark === "string" && p.ark.length > 0) {
      arkById.set(p.id, toValidFsArk(p.ark));
    }
  }
  for (const person of raw.persons ?? []) {
    if (person.id === undefined) continue;
    const ark = arkById.get(person.id);
    if (ark && person.identifiers?.[PERSISTENT_ID]) {
      person.identifiers[PERSISTENT_ID] = [ark];
    }
  }

  // Append the sourceDescription anchor with a unique id to avoid colliding
  // with any caller-provided sourceDescription that might already use a
  // common id like "mainSrc".
  raw.sourceDescriptions = [
    ...(raw.sourceDescriptions ?? []),
    { id: "match-anchor", about: "#" + primaryId },
  ];
  return raw;
}

// Parse the ARK out of the API's `title` field, in canonical `ark:/...`
// form to match `candidateArk`. Returns the raw title if no ARK is found.
function parseArkFromTitle(title: string): string {
  const match = title.match(/ark:\/[\w/:.\-]+/);
  if (!match) return title;
  return match[0];
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
